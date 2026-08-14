import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { PosCustomerValueRepository } from '../modules/pos-customer-value/pos-customer-value.repository';

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
    this.logger.log(`system job processed: ${job.name} #${job.id}`);
  }
}
