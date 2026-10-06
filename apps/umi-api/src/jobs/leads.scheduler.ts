import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';

/**
 * Registers the repeatable landing-page email-sequence tick (Phase 5) on the
 * `lifecycle` queue (spec §10.1: lifecycle = cash crons + landing email
 * sequences). Worker-only. Replaces the landing page's `/api/cron/email-sequence`
 * Vercel cron. Gated by `LEADS_SEQUENCE_ENABLED`: when off (default), any
 * previously-registered scheduler is torn down so the landing page stays the sole
 * sender during the dual-run window — flipping the flag is the cutover switch.
 *
 * Daily at 13:00 UTC: the sequence steps are day-grained (0/2/5/10/30), so one
 * tick a day is enough; the emails_sent dedup makes re-ticks harmless.
 */
const SCHEDULE = { id: 'leads:email_sequence', jobName: 'email_sequence', pattern: '0 13 * * *' };

@Injectable()
export class LeadsScheduler implements OnModuleInit {
  private readonly logger = new Logger(LeadsScheduler.name);

  constructor(
    private readonly enqueue: EnqueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get('LEADS_SEQUENCE_ENABLED', { infer: true });
    const queue = this.enqueue.getQueue(QUEUES.lifecycle);

    if (!enabled) {
      await queue.removeJobScheduler(SCHEDULE.id).catch(() => undefined);
      this.logger.log('leads email sequence disabled (LEADS_SEQUENCE_ENABLED=false)');
      return;
    }

    await queue.upsertJobScheduler(
      SCHEDULE.id,
      { pattern: SCHEDULE.pattern, tz: 'UTC' },
      { name: SCHEDULE.jobName, data: {} },
    );
    this.logger.log(`leads email sequence scheduled (${SCHEDULE.pattern} UTC)`);
  }
}
