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
 * identity, gates duplicates via `runtime.inbound_event`, persists the user
 * message, enqueues `turn.integrity` (MessageSid = deterministic jobId), and
 * returns empty TwiML fast — the real reply arrives async via the outbound
 * processor. All heavy work is off the request path.
 */
@Controller('conversations')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);
  private readonly authToken?: string;
  private readonly webhookUrl?: string;
  private readonly allowInsecure: boolean;

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
    this.allowInsecure = config.get('ALLOW_INSECURE_TWILIO_WEBHOOK', { infer: true });
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
    // FAIL CLOSED: without an auth token we cannot verify the sender, so drop the
    // request unless an explicit local-dev bypass is set (never in production).
    if (!this.authToken || !this.webhookUrl) {
      if (this.allowInsecure) {
        this.logger.warn('twilio signature validation BYPASSED (ALLOW_INSECURE_TWILIO_WEBHOOK)');
      } else {
        this.logger.error(
          `twilio webhook missing TWILIO_AUTH_TOKEN/URL — dropping unsigned request request_id=${requestId}`,
        );
        return emptyTwiml();
      }
    } else {
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

    // ── Identity: resolve-or-create tenant.customer (federated graph) ──
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

    // ── Ingress observability gate (runtime.inbound_event UNIQUE(provider, event id)) ──
    // NOTE: this is NOT the authoritative dedup. It commits before the message
    // insert + enqueue, so hard-dropping on its `duplicate` flag would strand a
    // first attempt that crashed mid-flight (gate written, work not done). The
    // durable, idempotent guards are below: tenant.message.twilio_message_sid
    // (UNIQUE) → DUPLICATE_MESSAGE, and the enqueue jobId=messageSid (BullMQ drops
    // a re-add). So we log a duplicate here and continue; the message-level dedup
    // is what actually prevents a double turn.
    if (messageSid) {
      const gate = await this.queue.registerInboundEvent({
        tenantId,
        provider: 'twilio',
        providerEventId: messageSid,
        eventType: 'whatsapp_message',
        payload: { phone_hash: this.trace.hashPhone(phone), message_length: message.length },
      });
      if (gate.duplicate) {
        this.logger.log(`inbound_event_seen message_sid=${messageSid} (continuing; message-level dedup is authoritative)`);
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
