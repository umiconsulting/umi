import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import { LeadsRepository, type LeadRecord } from './leads.repository';
import {
  day0UrgencyTemplate,
  day2PressureTemplate,
  day5CaseStudyTemplate,
  day10FreeOfferTemplate,
  day30ReactivationTemplate,
  type LeadTemplateData,
} from './leads.templates';

/**
 * The diagnostic-followup email sequence engine (Phase 5). Unifies the landing
 * page's two overlapping senders (`diagnosticTrigger` logged-but-didn't-send +
 * `sequenceManager` sent-but-didn't-persist) into ONE idempotent engine backed
 * by `grow.leads.emails_sent`. A step is sent at most once per lead: membership
 * of its `diagnostic_followup_day_N` key in `emails_sent` is the dedup gate, so
 * a retry/re-tick never double-mails.
 *
 * Gated by `LEADS_SEQUENCE_ENABLED` at both entry points (`sendDueEmails` for the
 * cron, `sendWelcome` for the diagnostic path) so nothing sends while the landing
 * page still runs its own cron during the dual-run window.
 */

interface SequenceStep {
  day: number;
  name: string;
  subject: string;
  template: (d: LeadTemplateData) => string;
}

const SEQUENCE_ID = 'diagnostic_followup';

// Ported from sequenceManager.initializeSequences (diagnostic_followup).
const STEPS: SequenceStep[] = [
  { day: 0, name: 'day0Urgency', subject: '⚡ ¡Momento clave para ${company}!', template: day0UrgencyTemplate },
  { day: 2, name: 'day2Pressure', subject: '⏰ ${company}: Ventana cerrándose', template: day2PressureTemplate },
  { day: 5, name: 'day5CaseStudy', subject: '📊 Caso real: Empresa como ${company}', template: day5CaseStudyTemplate },
  { day: 10, name: 'day10FreeOffer', subject: '🎁 Última oportunidad: Implementación gratuita', template: day10FreeOfferTemplate },
  { day: 30, name: 'day30Reactivation', subject: '📈 Actualización del mercado: Nuevas tendencias BI', template: day30ReactivationTemplate },
];

export interface SequenceRunResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

function stepKey(day: number): string {
  return `${SEQUENCE_ID}_day_${day}`;
}

function daysSince(iso: string, now: number): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / (1000 * 60 * 60 * 24)));
}

@Injectable()
export class SequencesService {
  private readonly logger = new Logger(SequencesService.name);

  constructor(
    private readonly repo: LeadsRepository,
    private readonly email: EmailAdapter,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private enabled(): boolean {
    return this.config.get('LEADS_SEQUENCE_ENABLED', { infer: true });
  }

  /** Cron entry: send every due, not-yet-sent step for every active lead. */
  async sendDueEmails(now: number = Date.now()): Promise<SequenceRunResult> {
    if (!this.enabled()) {
      this.logger.log('email sequence skipped (LEADS_SEQUENCE_ENABLED=false)');
      return { processed: 0, sent: 0, failed: 0, skipped: true };
    }
    const leads = await this.repo.listActive();
    let processed = 0;
    let sent = 0;
    let failed = 0;
    for (const lead of leads) {
      const elapsed = daysSince(lead.diagnosticDate, now);
      let touched = false;
      for (const step of STEPS) {
        if (elapsed < step.day) continue;
        if (lead.emailsSent.includes(stepKey(step.day))) continue;
        touched = true;
        const ok = await this.sendStepToLead(lead, step);
        if (ok) sent++;
        else failed++;
      }
      if (touched) processed++;
    }
    this.logger.log(
      `email sequence: ${processed} leads processed, ${sent} sent, ${failed} failed`,
    );
    return { processed, sent, failed, skipped: false };
  }

  /** Diagnostic path: send the day-0 welcome immediately (idempotent). */
  async sendWelcome(lead: LeadRecord): Promise<boolean> {
    if (!this.enabled()) return false;
    return this.sendStepToLead(lead, STEPS[0]);
  }

  /**
   * Send one sequence step to one lead; persist the outcome. Idempotent and
   * race-safe: the step is RESERVED atomically in the DB before the provider
   * call (the in-memory `emailsSent` check is only a fast path), so concurrent
   * web `sendWelcome` + worker `sendDueEmails` can't both send day 0. On a send
   * failure the reservation is released so a later tick retries.
   */
  private async sendStepToLead(
    lead: LeadRecord,
    step: SequenceStep,
  ): Promise<boolean> {
    const key = stepKey(step.day);
    if (lead.emailsSent.includes(key)) return false; // fast path (DB snapshot)

    const reserved = await this.repo.reserveEmailStep(lead.id, key);
    if (!reserved) {
      // Another path already reserved/sent this step — mirror + don't send.
      lead.emailsSent.push(key);
      return false;
    }

    const company = lead.company?.trim() || 'tu negocio';
    const data: LeadTemplateData = {
      name: lead.name,
      email: lead.email,
      company,
      diagnostic: {
        score: lead.diagnosticData?.score ?? 0,
        level: lead.diagnosticData?.level ?? 'Inicial',
        recommendations: lead.diagnosticData?.recommendations ?? [],
      },
    };
    const subject = this.personalize(step.subject, data);
    const html = step.template(data);

    const result = await this.email.send({ to: lead.email, subject, html });
    const meta = {
      leadId: lead.id,
      emailKey: key,
      templateName: step.name,
      sequenceDay: step.day,
      subject,
    };
    if (result) {
      await this.repo.finalizeEmailSent(meta);
      lead.emailsSent.push(key); // mirror the persisted reservation
      return true;
    }
    // Send failed → release the reservation so a later tick retries.
    await this.repo.releaseEmailStep(meta);
    return false;
  }

  private personalize(subject: string, data: LeadTemplateData): string {
    return subject
      .replace(/\$\{company\}/g, data.company)
      .replace(/\$\{name\}/g, data.name)
      .replace(/\$\{level\}/g, data.diagnostic.level);
  }

  // ── Lifecycle actions (webhook + admin PUT) ────────────────────────────────

  async pauseSequence(leadId: string, reason: string): Promise<boolean> {
    return this.repo.setPaused(leadId, true, reason, 'sequence_paused', { reason });
  }

  async resumeSequence(leadId: string): Promise<boolean> {
    return this.repo.setPaused(leadId, false, null, 'sequence_resumed');
  }

  /** Lead replied — pause follow-ups and record the response. */
  async markResponded(leadId: string, responseType = 'email'): Promise<boolean> {
    return this.repo.setPaused(
      leadId,
      true,
      `Lead responded via ${responseType}`,
      'responded',
      { response_type: responseType },
    );
  }

  async unsubscribe(leadId: string): Promise<boolean> {
    return this.repo.setPaused(leadId, true, 'unsubscribed', 'unsubscribed');
  }
}
