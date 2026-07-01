import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Data access for landing-page leads (Phase 5, spec §9.3). Reads/writes the
 * canonical `grow.leads` + `grow.lead_events` tables — confirmed live on the
 * platform DB (2026-06-30) with every column §9.3 lists, so NO schema migration
 * is needed. `grow` is a service-role-only schema, so this repository always
 * uses the BYPASSRLS **worker pool** (`pg.query`) — leads have no tenant and no
 * authenticated user, exactly like the lifecycle reads. Isolation is not an
 * issue: prospects are Umi-internal, `tenant_id` is NULL by design.
 *
 * Event-sourced: every mutation appends a `grow.lead_events` row (email_sent,
 * email_failed, sequence_paused/resumed, responded, diagnostic_completed, …).
 */

// Statuses the partial-unique index `grow_leads_email_active_uidx` protects —
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

export interface LeadMetrics {
  totalLeads: number;
  activeSequences: number;
  pausedSequences: number;
  emailsSentToday: number;
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
  diagnosticDate: string; // ISO — required (grow.leads.diagnostic_date is NOT NULL, no default)
  sourceApp?: string;
}

@Injectable()
export class LeadsRepository {
  constructor(private readonly pg: PgService) {}

  /** The single active lead for an email (matches the partial-unique index). */
  async findActiveByEmail(email: string): Promise<LeadRecord | null> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM grow.leads
        WHERE email = $1 AND lifecycle_status = ANY($2::text[])
        ORDER BY created_at DESC LIMIT 1`,
      [email, ACTIVE_STATUSES as unknown as string[]],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async findById(id: string): Promise<LeadRecord | null> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM grow.leads WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /**
   * Insert-or-update by active email. Returns the resulting lead. On update we
   * keep the original diagnostic_date (like the ported updateExistingLead) and
   * only refresh name/company/phone/diagnostic_data.
   */
  async upsertByEmail(
    input: UpsertLeadInput,
  ): Promise<{ lead: LeadRecord; isNew: boolean }> {
    const existing = await this.findActiveByEmail(input.email);
    if (existing) {
      const { rows } = await this.pg.query<LeadRow>(
        `UPDATE grow.leads
            SET name = $2,
                company = COALESCE($3, company),
                phone = COALESCE($4, phone),
                diagnostic_data = $5::jsonb,
                updated_at = now()
          WHERE id = $1
        RETURNING ${SELECT_COLS}`,
        [
          existing.id,
          input.name,
          input.company ?? null,
          input.phone ?? null,
          JSON.stringify(input.diagnosticData),
        ],
      );
      return { lead: toRecord(rows[0]), isNew: false };
    }

    const { rows } = await this.pg.query<LeadRow>(
      `INSERT INTO grow.leads
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
  }

  /** Append a raw funnel event. */
  async recordEvent(
    leadId: string,
    eventType: string,
    eventData?: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO grow.lead_events (lead_id, event_type, event_data)
       VALUES ($1, $2, $3::jsonb)`,
      [leadId, eventType, eventData ? JSON.stringify(eventData) : null],
    );
  }

  /**
   * Record an email send outcome. On success, idempotently append `emailKey` to
   * `emails_sent` and stamp `last_email_sent_at`; on failure, only log the event
   * so the next tick retries. Writes the matching lead_event either way.
   */
  async markEmailSent(params: {
    leadId: string;
    emailKey: string;
    templateName: string;
    sequenceDay: number;
    subject: string;
    status: 'sent' | 'failed';
    sentAt?: string;
  }): Promise<void> {
    await this.recordEvent(
      params.leadId,
      params.status === 'failed' ? 'email_failed' : 'email_sent',
      {
        template_name: params.templateName,
        sequence_day: params.sequenceDay,
        subject: params.subject,
        status: params.status,
        email_key: params.emailKey,
      },
    );
    if (params.status !== 'sent') return;
    await this.pg.query(
      `UPDATE grow.leads
          SET emails_sent = CASE
                WHEN $2 = ANY(emails_sent) THEN emails_sent
                ELSE array_append(emails_sent, $2)
              END,
              last_email_sent_at = COALESCE($3, now()),
              updated_at = now()
        WHERE id = $1`,
      [params.leadId, params.emailKey, params.sentAt ?? null],
    );
  }

  /** Active (non-paused) leads still inside a live lifecycle status. */
  async listActive(): Promise<LeadRecord[]> {
    const { rows } = await this.pg.query<LeadRow>(
      `SELECT ${SELECT_COLS} FROM grow.leads
        WHERE sequence_paused = false AND lifecycle_status = ANY($1::text[])
        ORDER BY diagnostic_date ASC`,
      [ACTIVE_STATUSES as unknown as string[]],
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
      `UPDATE grow.leads
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

  async metrics(): Promise<LeadMetrics> {
    const { rows } = await this.pg.query<{
      total: string;
      active: string;
      paused: string;
      today: string;
    }>(
      `SELECT
         (SELECT count(*) FROM grow.leads) AS total,
         (SELECT count(*) FROM grow.leads WHERE sequence_paused = false) AS active,
         (SELECT count(*) FROM grow.leads WHERE sequence_paused = true) AS paused,
         (SELECT count(*) FROM grow.lead_events
            WHERE event_type = 'email_sent'
              AND created_at >= date_trunc('day', now())) AS today`,
    );
    const r = rows[0];
    return {
      totalLeads: Number(r?.total ?? 0),
      activeSequences: Number(r?.active ?? 0),
      pausedSequences: Number(r?.paused ?? 0),
      emailsSentToday: Number(r?.today ?? 0),
    };
  }
}
