import { getSupabaseClient } from '../_shared/supabase.ts'
import { slog, logPipelineTrace } from '../_shared/logger.ts'
import { PROCESSORS } from './processors/index.ts'

const JOB_BATCH_SIZE = 5
const OUTBOX_BATCH_SIZE = 10
const BACKOFF_CAP_MS = 5 * 60 * 1000 // 5 minutes

Deno.serve(async (req) => {
  const start = Date.now()
  const workerId = crypto.randomUUID().slice(0, 8)
  const supabase = getSupabaseClient()

  let processedJobs = 0
  let deliveredOutbox = 0
  let failedJobs = 0
  let failedOutbox = 0
  let processedWorkflowJobs = 0
  let failedWorkflowJobs = 0

  try {
    // Phase 1: Reclaim stale locks (crash recovery)
    const { data: staleCount } = await supabase.rpc('reclaim_stale_jobs')
    const { data: staleOutbox } = await supabase.rpc('reclaim_stale_outbox')

    if (staleCount > 0) slog('info', 'reclaimed_stale_jobs', { count: staleCount, worker_id: workerId })
    if (staleOutbox > 0) slog('info', 'reclaimed_stale_outbox', { count: staleOutbox, worker_id: workerId })

    // Phase 2: Process jobs. Job execution may itself enqueue outbox work.
    const jobStats = await drainJobs(supabase, workerId)
    processedJobs += jobStats.processed
    failedJobs += jobStats.failed

    // Phase 2b: Process workflow_jobs (cash cron jobs — S4.4)
    const wfStats = await drainWorkflowJobs(supabase, workerId)
    processedWorkflowJobs += wfStats.processed
    failedWorkflowJobs += wfStats.failed

    // Phase 3: Deliver outbox independently from job availability.
    // Ingress paths can enqueue side effects directly without creating jobs,
    // so outbox delivery cannot depend on jobs existing.
    const outboxStats = await drainOutbox(supabase, workerId)
    deliveredOutbox += outboxStats.delivered
    failedOutbox += outboxStats.failed
  } catch (err) {
    slog('error', 'worker_tick_error', { error: String(err), worker_id: workerId })
  }

  const durationMs = Date.now() - start

  slog('info', 'worker_tick', {
    worker_id: workerId,
    processed: processedJobs,
    failed: failedJobs,
    workflow_processed: processedWorkflowJobs,
    workflow_failed: failedWorkflowJobs,
    delivered: deliveredOutbox,
    failed_outbox: failedOutbox,
    duration_ms: durationMs,
  })

  return new Response(
    JSON.stringify({
      processedJobs, failedJobs,
      processedWorkflowJobs, failedWorkflowJobs,
      deliveredOutbox, failedOutbox,
      durationMs, workerId,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})

// ── Job processing ──────────────────────────────────────────────────────────

async function drainJobs(supabase: any, workerId: string): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0

  for (let i = 0; i < JOB_BATCH_SIZE; i++) {
    const { data: jobs, error } = await supabase.rpc('claim_next_job', { p_worker_id: workerId })
    if (error) {
      slog('error', 'claim_next_job_error', { worker_id: workerId, error: error.message })
      break
    }

    const job = jobs?.[0]
    if (!job) {
      if (i === 0) slog('info', 'claim_next_job_empty', { worker_id: workerId })
      break
    }

    slog('info', 'job_claimed', {
      worker_id: workerId,
      job_id: job.id,
      job_type: job.job_type,
      aggregate_type: job.aggregate_type,
      aggregate_id: job.aggregate_id,
      priority: job.priority,
      next_run_at: job.next_run_at,
    })

    await processJob(supabase, job, workerId)
    if (job._outcome === 'success') processed++
    else failed++
  }

  return { processed, failed }
}

async function processJob(supabase: any, job: any, workerId: string): Promise<void> {
  const processor = PROCESSORS[job.job_type]
  if (!processor) {
    slog('error', 'unknown_job_type', { job_id: job.id, job_type: job.job_type })
    await failJob(supabase, job, `Unknown job type: ${job.job_type}`)
    return
  }

  // Transition to running + create attempt row
  const attemptNum = (job.attempt_count ?? 0) + 1
  await supabase
    .from('jobs')
    .update({ state: 'running', attempt_count: attemptNum })
    .eq('id', job.id)

  const { data: attempt } = await supabase
    .from('job_attempts')
    .insert({ job_id: job.id, attempt: attemptNum, outcome: 'running' })
    .select('id')
    .single()

  const attemptId = attempt?.id

  try {
    await processor(supabase, job.payload)

    // Success
    await supabase
      .from('jobs')
      .update({ state: 'completed', completed_at: new Date().toISOString(), error: null })
      .eq('id', job.id)

    if (attemptId) {
      await supabase
        .from('job_attempts')
        .update({ outcome: 'success', finished_at: new Date().toISOString() })
        .eq('id', attemptId)
    }

    job._outcome = 'success'
  } catch (err) {
    const errorMsg = String(err)
    slog('error', 'job_processing_error', { job_id: job.id, job_type: job.job_type, attempt: attemptNum, error: errorMsg })

    if (attemptId) {
      await supabase
        .from('job_attempts')
        .update({ outcome: 'error', finished_at: new Date().toISOString(), error: errorMsg })
        .eq('id', attemptId)
    }

    await failJob(supabase, job, errorMsg)
    job._outcome = 'error'
  }
}

async function failJob(supabase: any, job: any, errorMsg: string): Promise<void> {
  const attemptCount = (job.attempt_count ?? 0) + 1
  const maxAttempts = job.max_attempts ?? 3

  if (attemptCount >= maxAttempts) {
    // Exhausted retries → dead letter
    await supabase
      .from('jobs')
      .update({ state: 'dead', error: errorMsg, attempt_count: attemptCount })
      .eq('id', job.id)

    slog('warn', 'job_dead', { job_id: job.id, job_type: job.job_type, attempts: attemptCount })
  } else {
    // Retry with exponential backoff: 2^attempt seconds, capped at 5 minutes
    const backoffMs = Math.min(Math.pow(2, attemptCount) * 1000, BACKOFF_CAP_MS)
    const nextRunAt = new Date(Date.now() + backoffMs).toISOString()

    await supabase
      .from('jobs')
      .update({
        state: 'pending',
        locked_at: null,
        locked_by: null,
        error: errorMsg,
        attempt_count: attemptCount,
        next_run_at: nextRunAt,
      })
      .eq('id', job.id)
  }
}

// ── Outbox delivery ─────────────────────────────────────────────────────────

async function drainOutbox(supabase: any, workerId: string): Promise<{ delivered: number; failed: number }> {
  let delivered = 0
  let failed = 0

  const { data: outboxRows } = await supabase.rpc('claim_outbox_batch', {
    p_worker_id: workerId,
    p_limit: OUTBOX_BATCH_SIZE,
  })

  for (const row of outboxRows ?? []) {
    const success = await deliverOutboxRow(supabase, row)
    if (success) delivered++
    else failed++
  }

  return { delivered, failed }
}

async function deliverOutboxRow(supabase: any, row: any): Promise<boolean> {
  try {
    // Dynamic import of dispatchers (added incrementally in Steps 6-7)
    const { DISPATCHERS } = await import('./dispatchers/index.ts')
    const dispatcher = DISPATCHERS[row.kind]

    if (!dispatcher) {
      slog('warn', 'unknown_outbox_kind', { outbox_id: row.id, kind: row.kind })
      await markOutboxFailed(supabase, row, `Unknown outbox kind: ${row.kind}`)
      return false
    }

    await dispatcher(supabase, row)

    // Mark delivered
    await supabase
      .from('outbox')
      .update({ state: 'delivered', delivered_at: new Date().toISOString() })
      .eq('id', row.id)

    return true
  } catch (err) {
    const errorMsg = String(err)
    slog('error', 'outbox_delivery_error', { outbox_id: row.id, kind: row.kind, error: errorMsg })
    await markOutboxFailed(supabase, row, errorMsg)
    return false
  }
}

async function markOutboxFailed(supabase: any, row: any, errorMsg: string): Promise<void> {
  const attempts = row.attempts ?? 1
  const maxAttempts = row.max_attempts ?? 5

  if (attempts >= maxAttempts) {
    await supabase
      .from('outbox')
      .update({ state: 'dead', error: errorMsg })
      .eq('id', row.id)

    slog('warn', 'outbox_dead', { outbox_id: row.id, kind: row.kind, attempts })

    // Surface delivery failures in pipeline_traces so they're findable in one query.
    const traceId = row.payload?.trace_id
    if (traceId) {
      await logPipelineTrace({
        trace_id: traceId,
        conversation_id: row.aggregate_id,
        turn_id: row.payload?.turn_id ?? undefined,
        stage: 'dispatch',
        event: 'dead',
        error: errorMsg,
        detail: { outbox_id: row.id, kind: row.kind, attempts },
      })
    }
  } else {
    const backoffMs = Math.min(Math.pow(2, attempts) * 1000, BACKOFF_CAP_MS)
    const nextRunAt = new Date(Date.now() + backoffMs).toISOString()

    await supabase
      .from('outbox')
      .update({ state: 'pending', error: errorMsg, next_run_at: nextRunAt })
      .eq('id', row.id)
  }
}

// ── Workflow jobs (cash cron) ───────────────────────────────────────────────

const WF_BATCH_SIZE = 3

async function drainWorkflowJobs(
  supabase: any,
  workerId: string,
): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0

  for (let i = 0; i < WF_BATCH_SIZE; i++) {
    const { data: jobs, error } = await supabase.rpc('claim_next_workflow_job', {
      p_worker_id: workerId,
    })

    if (error) {
      slog('error', 'claim_next_workflow_job_error', {
        worker_id: workerId,
        error: error.message,
      })
      break
    }

    const job = jobs?.[0]
    if (!job) break

    slog('info', 'workflow_job_claimed', {
      worker_id: workerId,
      job_id: job.id,
      job_type: job.job_type,
      tenant_id: job.tenant_id,
    })

    await processWorkflowJob(supabase, job, workerId)
    if (job._outcome === 'success') processed++
    else failed++
  }

  return { processed, failed }
}

async function processWorkflowJob(
  supabase: any,
  job: any,
  workerId: string,
): Promise<void> {
  const processor = PROCESSORS[job.job_type]

  if (!processor) {
    slog('error', 'unknown_workflow_job_type', {
      job_id: job.id,
      job_type: job.job_type,
    })
    await supabase
      .from('workflow_jobs')
      .update({
        state: 'failed',
        error: `Unknown job type: ${job.job_type}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    job._outcome = 'error'
    return
  }

  try {
    await processor(supabase, job.payload)

    await supabase
      .from('workflow_jobs')
      .update({
        state: 'completed',
        completed_at: new Date().toISOString(),
        error: null,
      })
      .eq('id', job.id)

    job._outcome = 'success'
  } catch (err) {
    const errorMsg = String(err)

    slog('error', 'workflow_job_processing_error', {
      job_id: job.id,
      job_type: job.job_type,
      error: errorMsg,
    })

    await supabase
      .from('workflow_jobs')
      .update({
        state: 'failed',
        error: errorMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    job._outcome = 'error'
  }
}
