import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';

/**
 * Registers the repeatable lifecycle crons on the `lifecycle` queue (3d-lifecycle).
 * Worker-only (registered in WorkerModule). Cron times mirror the legacy pg_cron
 * schedules in `20260613000003_cron_jobs.sql` (UTC). Gated by
 * `LIFECYCLE_CRONS_ENABLED`: when off (default), any previously-registered
 * schedulers are torn down so umi-cash stays the sole sender during the
 * dual-writer window — flipping the flag is the whole cutover switch.
 */
const SCHEDULES: { id: string; jobName: string; pattern: string }[] = [
  { id: 'lifecycle:reward_expiring', jobName: 'reward_expiring', pattern: '0 14 * * *' },
  { id: 'lifecycle:welcome_no_visit', jobName: 'welcome_no_visit', pattern: '0 17 * * *' },
  { id: 'lifecycle:winback_inactive', jobName: 'winback_inactive', pattern: '30 17 * * *' },
  { id: 'lifecycle:streak_recognition', jobName: 'streak_recognition', pattern: '0 18 * * 1' },
];

@Injectable()
export class LifecycleScheduler implements OnModuleInit {
  private readonly logger = new Logger(LifecycleScheduler.name);

  constructor(
    private readonly enqueue: EnqueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get('LIFECYCLE_CRONS_ENABLED', { infer: true });
    const queue = this.enqueue.getQueue(QUEUES.lifecycle);

    if (!enabled) {
      // Idempotent teardown so a flag flip actually stops delivery.
      for (const s of SCHEDULES) {
        await queue.removeJobScheduler(s.id).catch(() => undefined);
      }
      this.logger.log('lifecycle crons disabled (LIFECYCLE_CRONS_ENABLED=false)');
      return;
    }

    for (const s of SCHEDULES) {
      await queue.upsertJobScheduler(
        s.id,
        { pattern: s.pattern, tz: 'UTC' },
        { name: s.jobName, data: {} },
      );
    }
    this.logger.log(`lifecycle crons scheduled: ${SCHEDULES.map((s) => s.jobName).join(', ')}`);
  }
}
