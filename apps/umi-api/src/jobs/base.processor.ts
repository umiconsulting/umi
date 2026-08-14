import { Logger } from '@nestjs/common';
import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DeadLetterService } from './dead-letter.service';

/**
 * Base class for every BullMQ processor. Subclasses implement `process(job)`;
 * this base wires the reliability tail uniformly:
 *   - retries are logged as they happen,
 *   - a job that has exhausted its `attempts` is routed to the dead-letter sink.
 *
 * BullMQ handles retry/backoff declaratively (via the job options from
 * `defaultJobOptions`); this just observes the terminal outcome. The `failed`
 * event fires on every attempt, so we only dead-letter once attempts are spent.
 */
export abstract class BaseProcessor extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  protected constructor(protected readonly deadLetters: DeadLetterService) {
    super();
  }

  @OnWorkerEvent('failed')
  protected async onFailed(job: Job | undefined, error: Error): Promise<void> {
    if (!job) return; // a failure with no associated job (e.g. a missing lock)
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `retry ${job.attemptsMade}/${maxAttempts} ${job.queueName}/${job.name} ` +
          `#${job.id}: ${error.message}`,
      );
      return;
    }
    await this.deadLetters.recordTerminalFailure(job, error);
  }
}
