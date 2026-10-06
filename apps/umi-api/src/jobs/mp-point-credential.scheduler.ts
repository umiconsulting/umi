import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../shared/config/config.schema';
import {
  POINT_CREDENTIAL_RENEWAL_BATCH,
  POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS,
} from '../modules/mercado-pago/point-credential-renewal.service';
import { EnqueueService } from './enqueue.service';
import { QUEUES } from './queues';

/** The job name the sweep is scheduled under, and the one `SystemProcessor` looks for. */
export const POINT_CREDENTIAL_RENEWAL_JOB = 'point_credential_renewal';

/**
 * FOUR TIMES A DAY, WHICH IS ABOUT RECOVERING FROM A MISSED RUN RATHER THAN ABOUT PRECISION.
 *
 * The margin is fourteen days (D8), so a cadence measured in hours cannot be too late: what the
 * frequency buys is the ability to lose a run to a restart, a deploy or a full queue and still
 * have the token renewed with days to spare. The cost of the extra runs is one indexed scan that
 * usually finds nothing, which is why this is not a decision anyone has to revisit.
 */
const RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * THE RENEWAL SWEEP'S CLOCK — phase 5 step 2 of the Point plan, and the same shape
 * `CustomerValueExpiryScheduler` uses for the same reason: the API process must not run
 * background work, so the WORKER schedules a repeatable job on the shared `system` queue and
 * `SystemProcessor` does it.
 *
 * IT IS REMOVED WHEN THE DEPLOYMENT HAS NO OAUTH APPLICATION IDENTITY. `upsertJobScheduler` is
 * idempotent, so the else-branch is not a no-op: a deployment that once had a client id and no
 * longer does gets its scheduler REMOVED rather than left to enqueue work that can only log a
 * warning. The same discipline is what `CUSTOMER_VALUE_EXPIRY_ENABLED` expresses with a flag; here
 * the flag would be a second way to say what the missing client id already says.
 */
@Injectable()
export class PointCredentialRenewalScheduler implements OnModuleInit {
  private readonly logger = new Logger(PointCredentialRenewalScheduler.name);

  constructor(
    private readonly enqueue: EnqueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const queue = this.enqueue.getQueue(QUEUES.system);
    const id = 'mercado-pago-point:credential-renewal';
    if (!this.config.get('MERCADO_PAGO_POINT_CLIENT_ID', { infer: true })) {
      await queue.removeJobScheduler(id).catch(() => undefined);
      this.logger.log('mercado pago point credential renewal disabled');
      return;
    }
    await queue.upsertJobScheduler(
      id,
      { every: RENEWAL_INTERVAL_MS },
      {
        name: POINT_CREDENTIAL_RENEWAL_JOB,
        data: {
          marginDays: POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS,
          batchSize: POINT_CREDENTIAL_RENEWAL_BATCH,
        },
      },
    );
    this.logger.log('mercado pago point credential renewal scheduled');
  }
}
