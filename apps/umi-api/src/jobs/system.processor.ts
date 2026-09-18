import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { PosCustomerValueRepository } from '../modules/pos-customer-value/pos-customer-value.repository';
import {
  POINT_CREDENTIAL_RENEWAL_BATCH,
  POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS,
  PointCredentialRenewalService,
} from '../modules/mercado-pago/point-credential-renewal.service';
import { POINT_CREDENTIAL_RENEWAL_JOB } from './mp-point-credential.scheduler';
import { POINT_ATTEMPT_HEALTH_JOB } from './mp-point-attempt-health.scheduler';
import { PointAttemptHealthService } from '../modules/tender/point-attempt-health.service';

/**
 * Infra/maintenance queue processor. Proves the BullMQ wiring end-to-end and
 * exercises the reliability tail (retry → dead-letter) via BaseProcessor. Real
 * domain processors (turns, enrichment, outbound, …) land in later phases as
 * their own files, each extending BaseProcessor with `workerOptions(QUEUES.x)`.
 */
@Processor(QUEUES.system, workerOptions(QUEUES.system))
export class SystemProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly customerValue: PosCustomerValueRepository,
    /**
     * THE MERCADO PAGO RENEWAL SWEEP (plan D8, phase 5 step 2). It is here rather than in its own
     * processor because it is maintenance on a clock rather than a work stream with its own
     * retry semantics: `QUEUES.system` is the queue BullMQ docs describe for exactly this, and a
     * second `@Processor` on an existing queue COMPETES with the first rather than adding to it
     * (`queues.ts` says so about the tender notification, from experience).
     */
    private readonly credentialRenewal: PointCredentialRenewalService,
    /**
     * §7 item 3's counter. It is here for the same reason the renewal sweep is: a repeatable
     * maintenance read belongs on the `system` queue rather than in a second `@Processor`, which
     * would COMPETE with this one rather than add to it (`queues.ts` says so, from experience).
     */
    private readonly attemptHealth: PointAttemptHealthService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'customer_value_authorization_expiry') {
      const count = await this.customerValue.expireAllAuthorizations(
        Number(job.data?.batchSize ?? 100),
      );
      this.logger.log(`customer value authorizations expired: ${count}`);
      return;
    }
    if (job.name === POINT_CREDENTIAL_RENEWAL_JOB) {
      // The numbers ride in the payload so the job states its own policy and a test can run the
      // sweep over a different margin without a second configuration key.
      await this.credentialRenewal.renewDue(
        Number(job.data?.marginDays ?? POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS),
        Number(job.data?.batchSize ?? POINT_CREDENTIAL_RENEWAL_BATCH),
      );
      return;
    }
    if (job.name === POINT_ATTEMPT_HEALTH_JOB) {
      await this.attemptHealth.report();
      return;
    }
    this.logger.log(`system job processed: ${job.name} #${job.id}`);
  }
}
