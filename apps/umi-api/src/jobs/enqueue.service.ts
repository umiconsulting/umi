import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES, type QueueName } from './queues';
import { defaultJobOptions, JobPriority, toBullPriority } from './job-options';

export interface EnqueueOptions {
  /** Logical priority — inverted to BullMQ's numeric scale centrally. */
  priority?: JobPriority;
  /**
   * Deterministic job id for idempotency (e.g. Twilio MessageSid for ingress,
   * turn_id for a reply, `cardId:journey:date` for a lifecycle nudge). Any ':' is
   * sanitized to '_' before enqueue (BullMQ forbids it in custom ids). BullMQ
   * drops a duplicate enqueue while a job with this id still exists. For durable
   * cross-restart idempotency, pair this with the `runtime.inbound_event` gate or
   * a `runtime.outbox_event` UNIQUE(idempotency_key) row (see QueueRepository).
   */
  jobId?: string;
  /** Delay before the job becomes eligible (ms). Used for debounce/backoff. */
  delayMs?: number;
}

/**
 * The single producer entry point for every queue. Centralizes the reliability
 * policy: applies per-queue default job options (retry/backoff/retention) and
 * the priority inversion, so producers never touch raw BullMQ options. Available
 * in both processes (web enqueues on ingress; worker enqueues follow-ups and the
 * outbox relay enqueues drained events).
 */
@Injectable()
export class EnqueueService {
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QUEUES.system) system: Queue,
    @InjectQueue(QUEUES.turns) turns: Queue,
    @InjectQueue(QUEUES.enrichment) enrichment: Queue,
    @InjectQueue(QUEUES.outbound) outbound: Queue,
    @InjectQueue(QUEUES.integrations) integrations: Queue,
    @InjectQueue(QUEUES.lifecycle) lifecycle: Queue,
  ) {
    this.queues = {
      system,
      turns,
      enrichment,
      outbound,
      integrations,
      lifecycle,
    };
  }

  /** Enqueue a job with the queue's reliability defaults + inverted priority. */
  async enqueue<T extends object>(
    queue: QueueName,
    name: string,
    data: T,
    opts: EnqueueOptions = {},
  ): Promise<string> {
    const job = await this.queues[queue].add(name, data, {
      ...defaultJobOptions(queue),
      priority: toBullPriority(opts.priority),
      // BullMQ uses ':' as its Redis key separator and rejects custom job ids
      // containing it ("Custom Ids cannot contain :"). Callers build readable
      // ids like `turn_process:<id>`, `twilio_reply_turn:<id>` or
      // `cardId:journey:date`, so sanitize here. The mapping is deterministic,
      // so BullMQ's dedup-by-id (and the outbox stale-lease re-ack) still holds.
      jobId: opts.jobId?.replace(/:/g, '_'),
      delay: opts.delayMs,
    });
    // BullMQ always assigns an id for a queued job; a missing id signals an
    // unexpected enqueue state, so fail fast rather than returning a fake id
    // that a caller might persist or dedup against.
    if (job.id == null) {
      throw new Error(`enqueue ${queue}/${name} returned no job id`);
    }
    return job.id;
  }

  /** Escape hatch for callers that need the raw queue (e.g. repeatable jobs). */
  getQueue(queue: QueueName): Queue {
    return this.queues[queue];
  }
}
