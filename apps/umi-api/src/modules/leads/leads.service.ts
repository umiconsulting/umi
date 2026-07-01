import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../shared/config/config.schema';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { LeadsRepository, type LeadDiagnosticData } from './leads.repository';
import { SequencesService } from './sequences.service';
import {
  contactAutoReplyTemplate,
  contactInternalTemplate,
} from './leads.templates';
import type { ContactDto } from './dto/contact.dto';
import type { CreateLeadDto, UpdateLeadDto } from './dto/lead.dto';
import type { EmailResponseWebhookDto } from './dto/webhook.dto';

const DEFAULT_INTERNAL_EMAIL = 'hola@umiconsulting.co';

/**
 * Landing-page lead orchestration (Phase 5): the contact form send, the internal
 * lead-management surface (`/api/leads` POST/GET/PUT), and the email-response
 * webhook. Diagnostic scoring lives in DiagnosticService; the sequence engine in
 * SequencesService — this service wires the HTTP edges to them.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly repo: LeadsRepository,
    private readonly sequences: SequencesService,
    private readonly email: EmailAdapter,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private internalEmail(): string {
    return (
      this.config.get('CONTACT_TO_EMAIL', { infer: true }) ??
      this.config.get('EMAIL_FROM', { infer: true }) ??
      DEFAULT_INTERNAL_EMAIL
    );
  }

  /**
   * Contact form: notify Umi (reply-to the prospect) + auto-reply the prospect.
   * Email-only — no lead row is created (matches the ported /api/contact). Throws
   * when BOTH sends fail so the controller can surface a 500.
   */
  async sendContact(dto: ContactDto): Promise<{ sent: number; failed: number }> {
    const to = this.internalEmail();
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

  /** POST /api/leads — upsert a lead and optionally kick off the sequence. */
  async createLead(dto: CreateLeadDto): Promise<{
    leadId: string;
    isNew: boolean;
    sequenceStarted: boolean;
  }> {
    const diagnosticData = normalizeDiagnosticData(dto.diagnosticData);
    const { lead, isNew } = await this.repo.upsertByEmail({
      email: dto.email,
      name: dto.name,
      company: dto.company ?? null,
      phone: dto.phone ?? null,
      diagnosticData,
      diagnosticDate: new Date().toISOString(),
    });
    let sequenceStarted = false;
    if (dto.triggerSequence) {
      sequenceStarted = await this.sequences.sendWelcome(lead);
    }
    return { leadId: lead.id, isNew, sequenceStarted };
  }

  /** GET /api/leads — funnel stats. */
  async getStats(): Promise<{
    totalLeads: number;
    activeSequences: number;
    pausedSequences: number;
    emailsSentToday: number;
  }> {
    return this.repo.metrics();
  }

  /** PUT /api/leads — pause / resume / mark-responded. */
  async updateLead(dto: UpdateLeadDto): Promise<boolean> {
    switch (dto.action) {
      case 'pause_sequence':
        return this.sequences.pauseSequence(dto.leadId, dto.data?.reason || 'manual_pause');
      case 'resume_sequence':
        return this.sequences.resumeSequence(dto.leadId);
      case 'mark_responded':
        return this.sequences.markResponded(dto.leadId, dto.data?.responseType || 'email');
      default:
        return false;
    }
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
   * matching `sha256=<hex>` HMAC over the raw JSON body. When unset, allow only
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

/** Coerce the loose /api/leads diagnosticData payload into the canonical shape. */
function normalizeDiagnosticData(raw: Record<string, unknown>): LeadDiagnosticData {
  const score = typeof raw.score === 'number' ? raw.score : 0;
  const level = typeof raw.level === 'string' ? raw.level : 'Inicial';
  const recommendations = Array.isArray(raw.recommendations)
    ? (raw.recommendations.filter((r) => typeof r === 'string') as string[])
    : typeof raw.primaryChallenge === 'string'
      ? [raw.primaryChallenge]
      : [];
  return { score, level, recommendations };
}
