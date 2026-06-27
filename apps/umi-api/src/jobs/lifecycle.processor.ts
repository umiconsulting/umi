import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { LifecycleService } from '../modules/lifecycle/lifecycle.service';

/**
 * Lifecycle queue consumer (3d-lifecycle). Runs the scheduled WhatsApp journeys
 * enqueued by LifecycleScheduler. Each journey is idempotent at the row level
 * (`loyalty.lifecycle_sends` claim), so a retry after a partial run only sends
 * the cards it hasn't already claimed. Worker-only.
 */
@Processor(QUEUES.lifecycle, workerOptions(QUEUES.lifecycle))
export class LifecycleProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly lifecycle: LifecycleService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'reward_expiring':
        await this.lifecycle.runRewardExpiring();
        return;
      case 'streak_recognition':
        await this.lifecycle.runStreakRecognition();
        return;
      case 'welcome_no_visit':
        await this.lifecycle.runWelcomeNoVisit();
        return;
      case 'winback_inactive':
        await this.lifecycle.runWinbackInactive();
        return;
      default:
        this.logger.warn(`unknown lifecycle job: ${job.name} #${job.id}`);
    }
  }
}
