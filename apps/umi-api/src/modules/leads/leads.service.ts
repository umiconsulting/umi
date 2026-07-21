import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../shared/config/config.schema';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { SequencesService } from './sequences.service';
import { contactAutoReplyTemplate, contactInternalTemplate } from './leads.templates';
import type { ContactDto } from './dto/contact.dto';
import type { EmailResponseWebhookDto } from './dto/webhook.dto';

/**
 * Landing-page lead orchestration (Phase 5): the contact-form send and the
 * email-response webhook. Diagnostic scoring lives in DiagnosticService; the
 * sequence engine (and its pause/resume/responded actions) in SequencesService —
 * this service wires the public HTTP edges to them.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly sequences: SequencesService,
    private readonly email: EmailAdapter,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Internal notification recipient — no hard-coded fallback (fail closed). */
  private internalEmail(): string | null {
    return (
      this.config.get('CONTACT_TO_EMAIL', { infer: true }) ??
      this.config.get('EMAIL_FROM', { infer: true }) ??
      null
    );
  }

  /**
   * Contact form: notify Umi (reply-to the prospect) + auto-reply the prospect.
   * Email-only — no lead row is created (matches the ported /api/contact). Throws
   * when BOTH sends fail so the controller can surface a 500.
   */
  async sendContact(dto: ContactDto): Promise<{ sent: number; failed: number }> {
    const to = this.internalEmail();
    if (!to) {
      // Misconfiguration — never silently route prospect data to a default inbox.
      this.logger.error('contact_internal_email_missing');
      throw new Error('contact_internal_email_missing');
    }
    const internal = await this.email.send({
      to,
      subject: `Nueva consulta Umi de ${dto.name} - ${dto.company || 'Cliente potencial'}`,
      html: contactInternalTemplate(dto),
      replyTo: dto.email,
    });
    const autoReply = await this.email.send({
      to: dto.email,
      subject: 'Hemos recibido tu consulta - Umi',
      html: contactAutoReplyTemplate(dto),
    });
    const sent = (internal ? 1 : 0) + (autoReply ? 1 : 0);
    const failed = 2 - sent;
    if (sent === 0) {
      throw new Error('contact_email_send_failed');
    }
    return { sent, failed };
  }

  /** POST /api/leads/webhook/email-response — provider callback. */
  async handleEmailResponse(dto: EmailResponseWebhookDto): Promise<void> {
    switch (dto.type) {
      case 'email_reply':
        await this.sequences.markResponded(dto.leadId, dto.responseType ?? 'email');
        return;
      case 'meeting_scheduled':
        await this.sequences.pauseSequence(dto.leadId, 'meeting_scheduled');
        return;
      case 'unsubscribe':
        await this.sequences.unsubscribe(dto.leadId);
        return;
    }
  }

  /**
   * Verify the webhook signature. When `LEADS_WEBHOOK_SECRET` is set, require a
   * matching `sha256=<hex>` HMAC over the JSON body. When unset, allow only
   * outside production (local testing) — production fails closed.
   */
  verifyWebhookSignature(signature: string | null, rawBody: string): boolean {
    const secret = this.config.get('LEADS_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      return this.config.get('NODE_ENV', { infer: true }) !== 'production';
    }
    if (!signature) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
