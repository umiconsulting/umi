import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Data access for landing-page leads (Phase 5, spec §9.3). Reads/writes the
 * canonical `umi.prospect` + `umi.prospect_event` tables — confirmed live on the
 * platform DB (2026-06-30) with every column §9.3 lists, so NO schema migration
 * is needed. `grow` is a service-role-only schema, so this repository always
 * uses the BYPASSRLS **worker pool** (`pg.query`) — leads have no tenant and no
 * authenticated user, exactly like the lifecycle reads. Isolation is not an
 * issue: prospects are Umi-internal, `business_id` is NULL by design.
 *
 * Event-sourced: every mutation appends a `umi.prospect_event` row (email_sent,
 * email_failed, sequence_paused/resumed, responded, diagnostic_completed, …).
 */

// Statuses the partial-unique index `umi_prospect_email_active_uidx` protects —
// only one live lead per email may sit in these. Once a lead is converted/lost/
// unsubscribed it leaves the set and the email can appear again.
const ACTIVE_STATUSES = ['new', 'nurturing', 'qualified'] as const;

export interface LeadDiagnosticData {
  score: number;
  level: string;
  recommendations: string[];
  areas?: {
    dataCollection: number;
    analysis: number;
    visualization: number;
    decisionMaking: number;
  };
}

export interface LeadRecord {
  id: string;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  lifecycleStatus: string;
  diagnosticData: LeadDiagnosticData | null;
  diagnosticDate: string; // ISO
  sequencePaused: boolean;
  pauseReason: string | null;
  emailsSent: string[];
  lastEmailSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// node-postgres parses timestamptz columns into JS Date objects, so the
// timestamp fields arrive as Date (string only for a text-typed value).
type Ts = Date | string;

interface LeadRow {
  id: string;
  email: string;
  name: string;
  company: string | null;
  phone: string | null;
  lifecycle_status: string;
  diagnostic_data: LeadDiagnosticData | null;
  diagnostic_date: Ts;
  sequence_paused: boolean;
  pause_reason: string | null;
  emails_sent: string[] | null;
  last_email_sent_at: Ts | null;
  created_at: Ts;
  updated_at: Ts;
}

function toIso(v: Ts | null): string {
  if (v == null) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

const SELECT_COLS = `id::text, email, name, company, phone, lifecycle_status,
  diagnostic_data, diagnostic_date, sequence_paused, pause_reason,
  emails_sent, last_email_sent_at, created_at, updated_at`;

function toRecord(r: LeadRow): LeadRecord {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    company: r.company,
    phone: r.phone,
    lifecycleStatus: r.lifecycle_status,
    diagnosticData: r.diagnostic_data,
    diagnosticDate: toIso(r.diagnostic_date),
    sequencePaused: r.sequence_paused,
    pauseReason: r.pause_reason,
    emailsSent: r.emails_sent ?? [],
    lastEmailSentAt: r.last_email_sent_at == null ? null : toIso(r.last_email_sent_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export interface UpsertLeadInput {
  email: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  diagnosticData: LeadDiagnosticData;
  diagnosticDate: string; // ISO — required (umi.prospect.diagnostic_date is NOT NULL, no default)
  sourceApp?: string;
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly pg: PgService) {}

  /** The single active lead for an email (matches the partial-unique index). */
  async findActiveByEmail(email: string): Promise<LeadRecord | null> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM umi.prospect
        WHERE email = $1 AND lifecycle_status = ANY($2::text[])
        ORDER BY created_at DESC LIMIT 1`,
      [email, ACTIVE_STATUSES],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<LeadRecord | null> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM umi.prospect WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /**
   * Insert-or-update by active email. Returns the resulting lead. On update we
   * keep the original diagnostic_date (like the ported updateExistingLead) and
   * only refresh name/company/phone/diagnostic_data.
   */
  async upsertByEmail(input: UpsertLeadInput): Promise<{ lead: LeadRecord; isNew: boolean }> {
    const existing = await this.findActiveByEmail(input.email);
    if (existing) {
      return { lead: await this.applyUpdate(existing.id, input), isNew: false };
    }

    try {
      const { rows } = await this.pg.query<LeadRow>(
        `INSERT INTO umi.prospect
           (email, name, company, phone, diagnostic_data, diagnostic_date, source_app, submitted_form)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7, 'umi-landing-page'), 'diagnostic')
         RETURNING ${SELECT_COLS}`,
        [
          input.email,
          input.name,
          input.company ?? null,
          input.phone ?? null,
          JSON.stringify(input.diagnosticData),
          input.diagnosticDate,
          input.sourceApp ?? null,
        ],
      );
      return { lead: toRecord(rows[0]), isNew: true };
    } catch (err) {
      // TOCTOU: a concurrent submission for the same email inserted the active
      // lead between our findActiveByEmail() and this INSERT, tripping the partial
      // unique index umi_prospect_email_active_uidx (23505). Re-read and update so
      // the flow stays idempotent instead of throwing.
      if ((err as { code?: string }).code === '23505') {
        const now = await this.findActiveByEmail(input.email);
        if (now) {
          return { lead: await this.applyUpdate(now.id, input), isNew: false };
        }
      }
      throw err;
    }
  }

  /** Refresh a lead's mutable fields, keeping its original diagnostic_date. */
  private async applyUpdate(id: string, input: UpsertLeadInput): Promise<LeadRecord> {
    const { rows } = await this.pg.query<LeadRow>(
      `UPDATE umi.prospect
          SET name = $2,
              company = COALESCE($3, company),
              phone = COALESCE($4, phone),
              diagnostic_data = $5::jsonb,
              updated_at = now()
        WHERE id = $1
      RETURNING ${SELECT_COLS}`,
      [
        id,
        input.name,
        input.company ?? null,
        input.phone ?? null,
        JSON.stringify(input.diagnosticData),
      ],
    );
    return toRecord(rows[0]);
  }

  /** Append a raw funnel event. */
  async recordEvent(
    leadId: string,
    eventType: string,
    eventData?: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO umi.prospect_event (prospect_id, event_type, event_data)
       VALUES ($1, $2, $3::jsonb)`,
      [leadId, eventType, eventData ? JSON.stringify(eventData) : null],
    );
  }

  /**
   * ATOMICALLY reserve an email step before sending. Appends `emailKey` to
   * `emails_sent` only if it's not already there, and returns whether THIS call
   * won the reservation. This is the deduplication gate: two racers (e.g. the
   * web `sendWelcome` and the worker `sendDueEmails`) can both see the step as
   * unsent in memory, but only one UPDATE flips the array — the loser gets
   * `false` and must not send. The provider call happens only on a `true`.
   */
  async reserveEmailStep(leadId: string, emailKey: string): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE umi.prospect
          SET emails_sent = array_append(emails_sent, $2), updated_at = now()
        WHERE id = $1 AND NOT ($2 = ANY(emails_sent))`,
      [leadId, emailKey],
    );
    return rowCount === 1;
  }

  /** Finalize a reserved step after a successful send: stamp + log the event. */
  async finalizeEmailSent(params: {
    leadId: string;
    emailKey: string;
    templateName: string;
    sequenceDay: number;
    subject: string;
    sentAt?: string;
  }): Promise<void> {
    await this.pg.query(
      `UPDATE umi.prospect
          SET last_email_sent_at = COALESCE($2, now()), updated_at = now()
        WHERE id = $1`,
      [params.leadId, params.sentAt ?? null],
    );
    await this.recordEvent(params.leadId, 'email_sent', {
      template_name: params.templateName,
      sequence_day: params.sequenceDay,
      subject: params.subject,
      email_key: params.emailKey,
    });
  }

  /**
   * Release a reserved step after a failed send: remove `emailKey` so a later
   * tick retries it, and log the failure event.
   */
  async releaseEmailStep(params: {
    leadId: string;
    emailKey: string;
    templateName: string;
    sequenceDay: number;
    subject: string;
  }): Promise<void> {
    await this.pg.query(
      `UPDATE umi.prospect
          SET emails_sent = array_remove(emails_sent, $2), updated_at = now()
        WHERE id = $1`,
      [params.leadId, params.emailKey],
    );
    await this.recordEvent(params.leadId, 'email_failed', {
      template_name: params.templateName,
      sequence_day: params.sequenceDay,
      subject: params.subject,
      email_key: params.emailKey,
    });
  }

  /** Active (non-paused) leads still inside a live lifecycle status. */
  async listActive(): Promise<LeadRecord[]> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM umi.prospect
        WHERE sequence_paused = false AND lifecycle_status = ANY($1::text[])
        ORDER BY diagnostic_date ASC`,
      [ACTIVE_STATUSES],
    );
    return rows.map(toRecord);
  }

  /** Pause/resume a lead's sequence + record the transition event. */
  async setPaused(
    leadId: string,
    paused: boolean,
    reason: string | null,
    eventType: string,
    eventData?: Record<string, unknown>,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `UPDATE umi.prospect
          SET sequence_paused = $2,
              pause_reason = $3,
              updated_at = now()
        WHERE id = $1`,
      [leadId, paused, reason],
    );
    if (!rowCount) return false;
    await this.recordEvent(leadId, eventType, eventData);
    return true;
  }
}
