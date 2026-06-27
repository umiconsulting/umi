import { Body, Controller, Header, Headers, Logger, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { EnqueueService } from '../../jobs/enqueue.service';
import { JobPriority } from '../../jobs/job-options';
import { QUEUES } from '../../jobs/queues';
import { QueueRepository } from '../../jobs/queue.repository';
import { TraceService } from '../../shared/logging/trace.service';
import { twimlMessage, emptyTwiml } from '../../shared/format/whatsapp';
import { TenantResolutionService } from './tenant-resolution.service';
import {
  SECURITY_CONFIG,
  SecurityService,
  detectPromptInjection,
  sanitizeInput,
  validateTwilioSignature,
} from './security.service';
import { IdentityRepository } from './identity.repository';
import { ConversationsRepository } from './conversations.repository';
import { MessagesRepository, DUPLICATE_MESSAGE } from './messages.repository';

/**
 * Twilio WhatsApp webhook ingress (spec §8.2). Port of `whatsapp-handler/index.ts`.
 * Validates the HMAC-SHA1 signature against the RAW form body (Fastify
 * form-urlencoded raw-body parser, registered in main.ts), resolves tenant +
 * identity, gates duplicates via `queue.inbound_events`, persists the user
 * message, enqueues `turn.integrity` (MessageSid = deterministic jobId), and
 * returns empty TwiML fast — the real reply arrives async via the outbound
 * processor. All heavy work is off the request path.
 */
@Controller('conversations')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  private readonly authToken?: string;
  private readonly webhookUrl?: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tenants: TenantResolutionService,
    private readonly security: SecurityService,
    private readonly identity: IdentityRepository,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly queue: QueueRepository,
    private readonly enqueue: EnqueueService,
    private readonly trace: TraceService,
  ) {
    this.authToken = config.get('TWILIO_AUTH_TOKEN', { infer: true });
    this.webhookUrl = config.get('TWILIO_WEBHOOK_URL', { infer: true });
  }

  @Post('whatsapp')
  @Header('Content-Type', 'text/xml; charset=utf-8')
  async webhook(
    @Body() rawBody: unknown,
    @Headers('x-twilio-signature') signature?: string,
  ): Promise<string> {
    const requestId = randomUUID();
    const params = new URLSearchParams(typeof rawBody === 'string' ? rawBody : '');

    // ── SEC-01/FT-02: signature validation against the exact signed URL ──
    if (this.authToken) {
      if (!this.webhookUrl) {
        this.logger.error('TWILIO_WEBHOOK_URL not set — cannot validate Twilio signature');
        return twimlMessage('Lo siento, estoy teniendo problemas. Intenta de nuevo.');
      }
      const valid = validateTwilioSignature(this.authToken, signature ?? '', this.webhookUrl, params);
      if (!valid) {
        this.logger.warn(`twilio_sig_invalid request_id=${requestId}`);
        return emptyTwiml(); // drop silently (don't process unsigned requests)
      }
    }

    const phone = (params.get('From') ?? '').replace('whatsapp:', '');
    const toAddress = params.get('To') ?? '';
    const rawMessage = params.get('Body') ?? '';
    const profileName = params.get('ProfileName') ?? null;
    const messageSid = params.get('MessageSid') ?? undefined;

    if (rawMessage.length > SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
      return twimlMessage(
        'Lo siento, tu mensaje es demasiado largo. Por favor, envía un mensaje más corto.',
      );
    }

    // ── Tenant resolution (inbound business number → tenant) ──
    const resolved = await this.tenants.resolveInboundTenant(toAddress);
    if (!resolved) {
      this.logger.error(`unresolved inbound WhatsApp number; dropping. request_id=${requestId}`);
      return emptyTwiml();
    }
    const { tenantId, locationId } = resolved;

    // ── Identity (creates core.people + contact_methods idempotently) ──
    const personId = await this.identity.resolveContact({
      tenantId,
      kind: 'whatsapp',
      rawValue: phone,
      displayName: profileName,
      sourceSystem: 'whatsapp',
    });
    if (!personId) {
      this.logger.error(`identity resolution failed; dropping. request_id=${requestId}`);
      return emptyTwiml();
    }

    // ── Rate limit + prompt-injection ──
    const rate = await this.security.checkRateLimit(tenantId, personId);
    if (!rate.allowed) {
      await this.trace.logSecurityEvent({
        phone,
        eventType: 'rate_limit_exceeded',
        inputText: `${rate.count} messages`,
        requestId,
      });
      return twimlMessage(
        'Has enviado demasiados mensajes. Por favor, espera un momento antes de continuar.',
      );
    }
    const injection = detectPromptInjection(rawMessage);
    if (injection.detected) {
      await this.trace.logSecurityEvent({
        phone,
        eventType: 'prompt_injection_attempt',
        inputText: rawMessage,
        details: injection.pattern,
        requestId,
      });
      return twimlMessage(
        'Lo siento, tu mensaje contiene caracteres no permitidos. Por favor, reformula tu pregunta.',
      );
    }

    const message = sanitizeInput(rawMessage);

    // ── Idempotent ingress gate (queue.inbound_events UNIQUE(provider, event id)) ──
    if (messageSid) {
      const gate = await this.queue.registerInboundEvent({
        tenantId,
        provider: 'twilio',
        providerEventId: messageSid,
        eventType: 'whatsapp_message',
        payload: { phone_hash: this.trace.hashPhone(phone), message_length: message.length },
      });
      if (gate.duplicate) {
        this.logger.log(`duplicate_webhook_ignored message_sid=${messageSid}`);
        return emptyTwiml();
      }
    }

    const { conversation } = await this.conversations.getOrCreateConversation(tenantId, personId);

    // ── Persist the user message (twilio_message_sid dedup backstop) ──
    const userMsgId = await this.messages.insertMessage({
      tenantId,
      conversationId: conversation.id,
      role: 'user',
      content: message,
      twilioMessageSid: messageSid,
    });
    if (userMsgId === DUPLICATE_MESSAGE) {
      return emptyTwiml();
    }

    // ── Enqueue turn integrity (MessageSid = deterministic jobId) ──
    await this.enqueue.enqueue(
      QUEUES.turns,
      'turn.integrity',
      {
        conversation_id: conversation.id,
        person_id: personId,
        tenant_id: tenantId,
        location_id: locationId,
        request_id: requestId,
      },
      { priority: JobPriority.Interactive, jobId: messageSid },
    );

    await this.trace.logPipelineTrace({
      trace_id: requestId,
      conversation_id: conversation.id,
      business_id: tenantId,
      stage: 'inbound',
      event: 'enqueued',
      detail: { user_message_id: userMsgId, message_sid: messageSid ?? null },
    });

    return emptyTwiml();
  }
}
