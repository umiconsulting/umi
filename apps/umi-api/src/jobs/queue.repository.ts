import { Injectable } from '@nestjs/common';
import { PgService } from '../shared/database/pg.service';

/**
 * Raw SQL for the canonical `queue.*` durability tables, confirmed column-exact
 * against the live platform DB on 2026-06-24
 * (`docs/migration/2026-06-24-phase1c-queue-schema-preflight.md`). All access is
 * via the worker pool — `queue` is a service-role-only schema (§9.1) and every
 * table carries a NOT NULL `tenant_id` FK to `tenant.tenant`.
 *
 * BullMQ owns *execution* state (queue.jobs/job_attempts are superseded, §10.5).
 * This repository owns the durable boundaries BullMQ does not: the inbound
 * idempotency gate, the transactional outbox, generic idempotency keys, and the
 * dead-letter sink.
 */
export interface DeadLetterInput {
  tenantId: string;
  sourceSchema?: string | null;
  sourceTable?: string | null;
  /** Only set when the originating id is a real uuid (BullMQ ids often aren't). */
  sourceId?: string | null;
  eventType?: string | null;
  payload: unknown;
  error?: string | null;
  attempts: number;
}

export interface OutboxEventRow {
  id: string;
  tenantId: string;
  eventType: string;
  aggregateId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

@Injectable()
export class QueueRepository {
  constructor(private readonly pg: PgService) {}

  // ── runtime.dead_letters — exhausted-job sink ────────────────────────────────

  async recordDeadLetter(dl: DeadLetterInput): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.dead_letters
         (tenant_id, source_schema, source_table, source_id, event_type, payload, error, attempts)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        dl.tenantId,
        dl.sourceSchema ?? null,
        dl.sourceTable ?? null,
        dl.sourceId ?? null,
        dl.eventType ?? null,
        JSON.stringify(dl.payload ?? {}),
        dl.error ?? null,
        dl.attempts,
      ],
    );
  }

  // ── runtime.inbound_events — idempotent ingress gate ─────────────────────────

  /**
   * Register an inbound provider event (e.g. Twilio MessageSid). Returns the
   * event id and whether it was a duplicate, via the UNIQUE(provider,
   * provider_event_id) constraint. Duplicates must be dropped before enqueue.
   */
  async registerInboundEvent(input: {
    tenantId: string;
    provider: string;
    providerEventId: string;
    eventType: string;
    payloadHash?: string | null;
    payload: unknown;
  }): Promise<{ id: string; duplicate: boolean }> {
    const inserted = await this.pg.query<{ id: string }>(
      `INSERT INTO runtime.inbound_events
         (tenant_id, provider, provider_event_id, event_type, payload_hash, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        input.tenantId,
        input.provider,
        input.providerEventId,
        input.eventType,
        input.payloadHash ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    if (inserted.rows[0]) {
      return { id: inserted.rows[0].id, duplicate: false };
    }
    const existing = await this.pg.query<{ id: string }>(
      `SELECT id FROM runtime.inbound_events WHERE provider = $1 AND provider_event_id = $2`,
      [input.provider, input.providerEventId],
    );
    return { id: existing.rows[0]?.id ?? '', duplicate: true };
  }

  // ── runtime.idempotency_keys — generic dedup ─────────────────────────────────

  /**
   * Claim an idempotency key. Returns true if this caller claimed it (first
   * time), false if it already existed. UNIQUE(tenant_id, scope, key).
   */
  async claimIdempotencyKey(
    tenantId: string,
    scope: string,
    key: string,
    expiresAt?: Date | null,
  ): Promise<boolean> {
    const res = await this.pg.query(
      `INSERT INTO runtime.idempotency_keys (tenant_id, scope, key, expires_at)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, scope, key) DO NOTHING`,
      [tenantId, scope, key, expiresAt ?? null],
    );
    return (res.rowCount ?? 0) > 0;
  }

  // ── runtime.outbox_events — transactional outbox (relay drains this) ─────────

  /**
   * Atomically claim a batch of deliverable outbox rows, flipping them to
   * 'delivering' and stamping `run_at = now()` as the lease start. Claims both
   * fresh rows (`status='pending'`, `run_at<=now()`) AND stale leases
   * (`status='delivering'` older than `leaseSeconds`) — so a row left
   * 'delivering' by a crashed relay is reclaimed instead of stranded. FOR UPDATE
   * SKIP LOCKED makes it safe to run multiple relay workers concurrently.
   */
  async claimPendingOutbox(
    limit: number,
    leaseSeconds: number,
  ): Promise<OutboxEventRow[]> {
    const res = await this.pg.query<{
      id: string;
      tenant_id: string;
      event_type: string;
      aggregate_id: string | null;
      idempotency_key: string;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(
      `UPDATE runtime.outbox_events o
          SET status = 'delivering', run_at = now()
        FROM (
          SELECT id FROM runtime.outbox_events
           WHERE (status = 'pending' AND run_at <= now())
              OR (status = 'delivering'
                  AND run_at < now() - make_interval(secs => $2))
           ORDER BY created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
        ) c
       WHERE o.id = c.id
       RETURNING o.id, o.tenant_id, o.event_type, o.aggregate_id,
                 o.idempotency_key, o.payload, o.attempts, o.max_attempts`,
      [limit, leaseSeconds],
    );
    return res.rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      eventType: r.event_type,
      aggregateId: r.aggregate_id,
      idempotencyKey: r.idempotency_key,
      payload: r.payload ?? {},
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
    }));
  }

  async markOutboxDelivered(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.outbox_events
          SET status = 'delivered', published_at = now(), error = NULL
        WHERE id = $1`,
      [id],
    );
  }

  /**
   * A genuine delivery failure: increment attempts with exponential backoff,
   * and move to 'dead' once max_attempts is reached.
   */
  async markOutboxFailed(id: string, error: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.outbox_events
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= max_attempts THEN 'dead' ELSE 'pending' END,
              run_at = now() + (interval '5 seconds' * power(2, attempts)),
              error = $2
        WHERE id = $1`,
      [id, error],
    );
  }

  /**
   * No consumer is registered for this event_type yet — defer it WITHOUT
   * counting an attempt (a missing route is an infra gap, not a delivery
   * failure, so it must never exhaust attempts → 'dead'). Pushes run_at forward
   * so the relay doesn't hot-loop.
   */
  async deferOutbox(id: string, deferSeconds: number): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.outbox_events
          SET status = 'pending', run_at = now() + make_interval(secs => $2)
        WHERE id = $1`,
      [id, deferSeconds],
    );
  }
}
