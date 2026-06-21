import { supabase } from '@/lib/supabase'
import { getActiveBusinessId } from '@/lib/auth'

export interface InboundEvent {
  id: string
  source: string
  source_event_id: string | null
  event_type: string
  status: string
  payload: Record<string, unknown>
  request_id: string | null
  received_at: string
}

export interface Job {
  id: string
  job_type: string
  aggregate_type: string | null
  aggregate_id: string | null
  state: string
  priority: number
  attempt_count: number
  max_attempts: number
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface OutboxItem {
  id: string
  kind: string
  aggregate_id: string | null
  idempotency_key: string
  state: string
  attempts: number
  max_attempts: number
  error: string | null
  created_at: string
  delivered_at: string | null
}

export interface WorkflowMetrics {
  pendingJobs: number
  runningJobs: number
  deadJobs: number
  pendingOutbox: number
  deliveredOutbox24h: number
  failedOutbox: number
}

export async function fetchInboundEvents(options: {
  limit?: number
  offset?: number
  status?: string
  source?: string
} = {}): Promise<InboundEvent[]> {
  const businessId = await getActiveBusinessId()
  const { limit = 50, offset = 0, status, source } = options

  let q = supabase
    .from('inbound_events')
    .select('id, source, source_event_id, event_type, status, payload, request_id, received_at')
    .eq('business_id', businessId)
    .order('received_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) q = q.eq('status', status)
  if (source) q = q.eq('source', source)

  const { data } = await q
  return (data ?? []) as InboundEvent[]
}

export async function fetchJobs(options: {
  limit?: number
  offset?: number
  state?: string
  jobType?: string
} = {}): Promise<Job[]> {
  const businessId = await getActiveBusinessId()
  const { limit = 50, offset = 0, state, jobType } = options

  let q = supabase
    .from('jobs')
    .select('id, job_type, aggregate_type, aggregate_id, state, priority, attempt_count, max_attempts, error, created_at, completed_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (state) q = q.eq('state', state)
  if (jobType) q = q.eq('job_type', jobType)

  const { data } = await q
  return (data ?? []) as Job[]
}

export async function fetchOutboxItems(options: {
  limit?: number
  offset?: number
  state?: string
  kind?: string
} = {}): Promise<OutboxItem[]> {
  const businessId = await getActiveBusinessId()
  const { limit = 50, offset = 0, state, kind } = options

  let q = supabase
    .from('outbox')
    .select('id, kind, aggregate_id, idempotency_key, state, attempts, max_attempts, error, created_at, delivered_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (state) q = q.eq('state', state)
  if (kind) q = q.eq('kind', kind)

  const { data } = await q
  return (data ?? []) as OutboxItem[]
}

export async function fetchWorkflowMetrics(): Promise<WorkflowMetrics> {
  const businessId = await getActiveBusinessId()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [pending, running, dead, pendingOutbox, delivered, failed] = await Promise.all([
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'pending'),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'running'),
    supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'dead'),
    supabase.from('outbox').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'pending'),
    supabase.from('outbox').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'delivered').gte('delivered_at', since24h),
    supabase.from('outbox').select('id', { count: 'exact', head: true }).eq('business_id', businessId).eq('state', 'dead'),
  ])

  return {
    pendingJobs: pending.count ?? 0,
    runningJobs: running.count ?? 0,
    deadJobs: dead.count ?? 0,
    pendingOutbox: pendingOutbox.count ?? 0,
    deliveredOutbox24h: delivered.count ?? 0,
    failedOutbox: failed.count ?? 0,
  }
}

export async function retryDeadJob(jobId: string): Promise<boolean> {
  const { error } = await supabase
    .from('jobs')
    .update({ state: 'pending', locked_at: null, locked_by: null, error: null })
    .eq('id', jobId)
    .eq('state', 'dead')

  return !error
}
