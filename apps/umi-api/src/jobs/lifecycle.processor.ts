import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import { QUEUES } from './queues';
import { workerOptions } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { LifecycleService } from '../modules/lifecycle/lifecycle.service';
import { SequencesService } from '../modules/leads/sequences.service';

/**
 * Lifecycle queue consumer (3d-lifecycle + Phase 5). Runs two independently-gated
 * families of scheduled work on the one `lifecycle` queue (spec §10.1):
 *   - cash WhatsApp journeys (LifecycleScheduler) — gated by LIFECYCLE_CRONS_ENABLED
 *   - landing email sequences (LeadsScheduler)     — gated by LEADS_SEQUENCE_ENABLED
 * Each cash journey is idempotent at the row level (`loyalty.lifecycle_sends`
 * claim); the email sequence is idempotent via `grow.leads.emails_sent`. The two
 * flags are checked per-job so neither family can gate the other. Worker-only.
 */
@Processor(QUEUES.lifecycle, workerOptions(QUEUES.lifecycle))
export class LifecycleProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly lifecycle: LifecycleService,
    private readonly sequences: SequencesService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    // Landing email sequences are gated by their OWN flag (independent of the
    // cash dual-writer window). SequencesService re-checks LEADS_SEQUENCE_ENABLED
    // and no-ops when off, so a job queued before a flag flip is honored too.
    if (job.name === 'email_sequence') {
      await this.sequences.sendDueEmails();
      return;
    }

    // Re-check the flag at run time: removing the scheduler stops FUTURE repeats
    // but a job already queued before the flag flipped could still fire. Honor the
    // current flag so disabling the crons is immediate and complete.
    if (!this.config.get('LIFECYCLE_CRONS_ENABLED', { infer: true })) {
      this.logger.log(`lifecycle job ${job.name} skipped (LIFECYCLE_CRONS_ENABLED=false)`);
      return;
    }
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
