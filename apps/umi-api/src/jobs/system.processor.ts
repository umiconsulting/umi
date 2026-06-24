import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';

/**
 * Placeholder processor that proves the BullMQ wiring end-to-end (Phase 0).
 * Real domain processors (turns, enrichment, outbound, …) are added in later
 * phases as their own files in this folder.
 */
@Processor(QUEUES.system)
export class SystemProcessor extends WorkerHost {
  private readonly logger = new Logger(SystemProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.log(`system job processed: ${job.name} #${job.id}`);
  }
}
