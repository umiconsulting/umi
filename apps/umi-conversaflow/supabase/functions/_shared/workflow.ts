import { slog } from './logger.ts'

export const INTERACTIVE_JOB_PRIORITY = 100
export const BACKGROUND_JOB_PRIORITY = -10

// ── Job & Outbox insertion helpers ──────────────────────────────────────────
// Used by ingress handlers to enqueue jobs, and by job processors to write
// outbox rows or enqueue child jobs.

/**
 * Fire-and-forget HTTP call to the job-worker edge function so it picks up
 * newly inserted jobs immediately. This is a push notification — the worker
 * still uses FOR UPDATE SKIP LOCKED, so concurrent triggers are safe.
 *
 * Returns void; errors are logged but never thrown (callers should not depend
 * on this succeeding — pg_cron is the reliable safety net).
 */
export async function triggerJobWorker(): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      slog('warn', 'trigger_job_worker_missing_env', {
        msg: 'Cannot trigger job-worker: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set',
      })
      return
    }

    const url = `${supabaseUrl}/functions/v1/job-worker`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '(unreadable)')
      slog('warn', 'trigger_job_worker_failed', { status: resp.status, body })
    }
  } catch (err) {
    slog('warn', 'trigger_job_worker_error', { error: String(err) })
  }
}

export interface InsertJobParams {
  inbound_event_id?: string | null
  business_id: string
  job_type: string
  aggregate_type?: string
  aggregate_id?: string
  payload: Record<string, unknown>
  priority?: number       // Higher = sooner. Default 0
  max_attempts?: number   // Default 3
  next_run_at?: string | null
}

/**
 * Insert a job row. Returns the job ID, or null on duplicate/error.
 * Uses ON CONFLICT (inbound_event_id, job_type) DO NOTHING for idempotency
 * when inbound_event_id is provided.
 */
export async function insertJob(
  supabase: any,
  params: InsertJobParams,
): Promise<string | null> {
  try {
    const row = {
      inbound_event_id: params.inbound_event_id ?? null,
      business_id: params.business_id,
      job_type: params.job_type,
      aggregate_type: params.aggregate_type ?? null,
      aggregate_id: params.aggregate_id ?? null,
      payload: params.payload,
      state: 'pending',
      priority: params.priority ?? 0,
      max_attempts: params.max_attempts ?? 3,
      next_run_at: params.next_run_at ?? new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('jobs')
      .insert(row)
      .select('id')
      .single()

    if (error) {
      // 23505 = unique_violation — duplicate (inbound_event_id, job_type) from retry
      if (error.code === '23505') {
        slog('info', 'job_insert_duplicate', {
          job_type: params.job_type,
          inbound_event_id: params.inbound_event_id,
        })
        return null
      }
      slog('error', 'job_insert_error', {
        job_type: params.job_type,
        error: error.message,
        code: error.code,
      })
      return null
    }

    slog('info', 'job_inserted', {
      job_id: data.id,
      job_type: params.job_type,
      aggregate_type: params.aggregate_type,
      aggregate_id: params.aggregate_id,
    })

    return data.id
  } catch (err) {
    slog('error', 'job_insert_failed', {
      job_type: params.job_type,
      error: String(err),
    })
    return null
  }
}

export interface InsertOutboxParams {
  job_id?: string | null
  business_id: string
  kind: string
  aggregate_id?: string
  idempotency_key: string
  payload: Record<string, unknown>
  max_attempts?: number   // Default 5
}

/**
 * Insert an outbox row. Returns the outbox ID, or null on duplicate/error.
 * Uses UNIQUE(idempotency_key) — if the same side effect is produced twice
 * (job retry), the second insert is a no-op.
 */
export async function insertOutbox(
  supabase: any,
  params: InsertOutboxParams,
): Promise<string | null> {
  try {
    const row = {
      job_id: params.job_id ?? null,
      business_id: params.business_id,
      kind: params.kind,
      aggregate_id: params.aggregate_id ?? null,
      idempotency_key: params.idempotency_key,
      payload: params.payload,
      state: 'pending',
      max_attempts: params.max_attempts ?? 5,
    }

    const { data, error } = await supabase
      .from('outbox')
      .insert(row)
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        slog('info', 'outbox_insert_duplicate', {
          kind: params.kind,
          idempotency_key: params.idempotency_key,
        })
        return null
      }
      slog('error', 'outbox_insert_error', {
        kind: params.kind,
        error: error.message,
        code: error.code,
      })
      return null
    }

    slog('info', 'outbox_inserted', {
      outbox_id: data.id,
      kind: params.kind,
      idempotency_key: params.idempotency_key,
    })

    return data.id
  } catch (err) {
    slog('error', 'outbox_insert_failed', {
      kind: params.kind,
      error: String(err),
    })
    return null
  }
}
