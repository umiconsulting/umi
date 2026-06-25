import type { JobsOptions, WorkerOptions } from 'bullmq';
import { QUEUES, type QueueName } from './queues';

/**
 * Logical job priority. Producers express *intent* with this enum; the BullMQ
 * numeric priority is derived once, centrally (`toBullPriority`), so no caller
 * ever hand-codes a raw priority number.
 *
 * ⚠️ Sign inversion (confirmed by the 2026-06-24 preflight): the live
 * `queue.jobs.priority` used a higher-number-is-more-urgent convention
 * (claimable index `ORDER BY priority DESC`, legacy INTERACTIVE=100 > BACKGROUND=-10).
 * BullMQ is the opposite — a LOWER number is more urgent. We invert here so
 * interactive customer turns always preempt background enrichment (port analysis §3).
 *
 * ⚠️ BullMQ treats an unset/0 priority as the MOST urgent (it preempts a job
 * mapped to Interactive=1). So every job MUST carry a mapped priority: the
 * `EnqueueService.enqueue` path always sets `toBullPriority(...)`, and the
 * queues are registered with a `Default` (5) `defaultJobOptions.priority` so a
 * raw `getQueue().add(...)` without a priority still can't default to 0 and
 * jump the interactive lane (queue.module.ts).
 */
export enum JobPriority {
  Interactive = 'interactive', // customer-facing turns/replies — preempt everything
  Default = 'default',
  Background = 'background', // embeddings, summaries, lifecycle batches
}

const PRIORITY_TO_BULLMQ: Record<JobPriority, number> = {
  [JobPriority.Interactive]: 1,
  [JobPriority.Default]: 5,
  [JobPriority.Background]: 10,
};

/** Logical priority → BullMQ numeric priority (1 = most urgent). */
export function toBullPriority(priority: JobPriority = JobPriority.Default): number {
  return PRIORITY_TO_BULLMQ[priority];
}

export interface QueueReliability {
  /** Max delivery attempts before the job is terminal → dead-lettered. */
  attempts: number;
  /** Base delay (ms) for exponential backoff between attempts. */
  backoffMs: number;
  /**
   * Stalled-lock window (ms). A job whose lock isn't renewed within this window
   * is considered stalled and reclaimed. Replaces the legacy 2-minute Postgres
   * reclaim (`public.reclaim_stale_jobs`). Must exceed the slowest expected job
   * runtime, or a still-running job is falsely reclaimed → duplicate processing.
   */
  lockDurationMs: number;
  removeOnCompleteCount: number;
  removeOnFailCount: number;
}

const DEFAULTS: QueueReliability = {
  attempts: 3,
  backoffMs: 5_000,
  lockDurationMs: 60_000,
  removeOnCompleteCount: 1_000,
  removeOnFailCount: 5_000,
};

/**
 * Per-queue reliability tuning (single source of truth).
 * - `turns` gets a 5-minute lock: an LLM turn is a multi-call tool loop that can
 *   exceed 2 minutes; the legacy 2-min reclaim was too tight and would falsely
 *   reclaim a running turn → double replies (port analysis §3).
 * - `outbound` keeps the legacy outbox `max_attempts = 5`.
 * - `system` is infra: a single attempt, no retry.
 */
export const QUEUE_RELIABILITY: Record<QueueName, QueueReliability> = {
  [QUEUES.system]: { ...DEFAULTS, attempts: 1 },
  [QUEUES.turns]: { ...DEFAULTS, attempts: 3, lockDurationMs: 300_000 },
  [QUEUES.enrichment]: { ...DEFAULTS, attempts: 3 },
  [QUEUES.outbound]: { ...DEFAULTS, attempts: 5 },
  [QUEUES.integrations]: { ...DEFAULTS, attempts: 3 },
  [QUEUES.lifecycle]: { ...DEFAULTS, attempts: 3 },
};

/** Default producer-side job options for a queue (retry/backoff/retention). */
export function defaultJobOptions(queue: QueueName): JobsOptions {
  const r = QUEUE_RELIABILITY[queue];
  return {
    attempts: r.attempts,
    backoff: { type: 'exponential', delay: r.backoffMs },
    removeOnComplete: r.removeOnCompleteCount,
    removeOnFail: r.removeOnFailCount,
  };
}

/**
 * Consumer-side worker options for a queue. Spread into the `@Processor`
 * decorator's options so the stalled-lock window matches the queue's workload.
 * `maxStalledCount: 1` means a job stalled twice is failed (and dead-lettered)
 * rather than retried forever.
 */
export function workerOptions(
  queue: QueueName,
): Pick<WorkerOptions, 'lockDuration' | 'maxStalledCount'> {
  return {
    lockDuration: QUEUE_RELIABILITY[queue].lockDurationMs,
    maxStalledCount: 1,
  };
}
