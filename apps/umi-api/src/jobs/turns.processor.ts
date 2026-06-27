import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions, JobPriority } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { EnqueueService } from './enqueue.service';
import { TurnIntegrityService } from '../modules/conversations/turn-integrity.service';
import type {
  TurnIntegrityPayload,
  TurnProcessPayload,
} from '../modules/conversations/turn-integrity.service';
import { TurnService, TURN_LOCK_TTL_MS } from '../modules/conversations/turn.service';
import { ConversationLockService } from '../modules/conversations/conversation-lock.service';

/**
 * BullMQ consumer for the `turns` queue (Phase 3b). Routes:
 *   - `turn.integrity` → multi-bubble debounce (delayed re-enqueue while buffering)
 *   - `turn.process`   → the mini-harness turn, behind a per-conversation
 *                        single-flight (Redis SET NX PX). On lock contention the
 *                        job re-enqueues with a short delay instead of running.
 * Correctness is also guaranteed by the conversation state_version CAS.
 */
@Processor(QUEUES.turns, workerOptions(QUEUES.turns))
export class TurnsProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly integrity: TurnIntegrityService,
    private readonly turn: TurnService,
    private readonly lock: ConversationLockService,
    private readonly enqueue: EnqueueService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'turn.integrity') {
      await this.integrity.process(job.data as TurnIntegrityPayload);
      return;
    }

    if (job.name === 'turn.process') {
      const payload = job.data as TurnProcessPayload;
      const acquired = await this.lock.acquire(payload.conversation_id, TURN_LOCK_TTL_MS);
      if (!acquired) {
        // Another worker holds the conversation — re-enqueue (fresh job id) with
        // a short delay rather than running the LLM loop concurrently.
        await this.enqueue.enqueue(QUEUES.turns, 'turn.process', payload, {
          priority: JobPriority.Interactive,
          delayMs: 1500,
        });
        return;
      }
      try {
        await this.turn.process(payload);
      } finally {
        await this.lock.release(payload.conversation_id);
      }
      return;
    }

    this.logger.warn(`unknown turns job: ${job.name} #${job.id}`);
  }
}
