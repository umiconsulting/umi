import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';

/** The job name the sweep is scheduled under, and the one `SystemProcessor` looks for. */
export const POINT_ATTEMPT_HEALTH_JOB = 'point_attempt_health';

/**
 * EVERY FIVE MINUTES, WHICH IS ABOUT HOW LONG A WAITING CUSTOMER IS ACCEPTABLE.
 *
 * §7 item 3 calls this number the health of the integration, and health that is sampled once an
 * hour is a post-mortem rather than a signal: a terminal that stopped answering at 12:01 should be
 * visible at 12:06, while somebody can still walk over to the counter. The cost is one indexed
 * count every five minutes — the cheapest job in the system — which is why the interval is chosen
 * for the operator rather than for the database.
 */
const HEALTH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * THE CLOCK FOR §7 ITEM 3, and the same shape every scheduled job here uses: the WORKER owns the
 * clock, `SystemProcessor` owns the work, and a repeatable job on the `system` queue is how the
 * two meet without the API process doing background reads.
 *
 * IT IS NEVER DISABLED, DELIBERATELY. The renewal sweep is removed when a deployment has no OAuth
 * identity because there is nothing for it to do; this job counts rows that exist whether or not
 * anyone ever connects an account — a deployment taking cards with its own token needs it just as
 * much — so there is no configuration under which it should stop watching.
 */
@Injectable()
export class PointAttemptHealthScheduler implements OnModuleInit {
  private readonly logger = new Logger(PointAttemptHealthScheduler.name);

  constructor(private readonly enqueue: EnqueueService) {}

  async onModuleInit(): Promise<void> {
    await this.enqueue
      .getQueue(QUEUES.system)
      .upsertJobScheduler(
        'mercado-pago-point:attempt-health',
        { every: HEALTH_INTERVAL_MS },
        { name: POINT_ATTEMPT_HEALTH_JOB },
      );
    this.logger.log('mercado pago point attempt health scheduled');
  }
}
