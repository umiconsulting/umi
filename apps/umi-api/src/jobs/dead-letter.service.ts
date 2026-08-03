import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueRepository } from './queue.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pull a merchant id out of a job payload, tolerating both casings. */
function extractMerchantId(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const id = d.merchantId ?? d.merchant_id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/**
 * Routes terminally-failed BullMQ jobs to the canonical `runtime.dead_letter`
 * sink (spec §10.5). Merchant-scoped jobs are persisted; infra/system jobs that
 * carry no merchant are log-only, because `runtime.dead_letter.merchant_id` is NOT
 * NULL and FKs `merchant.merchant` (build-v2). Best-effort: a
 * dead-letter write must never throw back into the worker.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(private readonly repo: QueueRepository) {}

  async recordTerminalFailure(job: Job, error: unknown): Promise<void> {
    const category = error instanceof Error ? error.name : 'Error';
    const merchantId = extractMerchantId(job.data);

    if (!merchantId) {
      this.logger.error(
        `dead-letter (no merchant — log only): ${job.queueName}/${job.name} #${job.id} ` +
          `after ${job.attemptsMade} attempts: ${category}`,
      );
      return;
    }

    try {
      await this.repo.recordDeadLetter({
        merchantId,
        sourceSchema: 'bullmq',
        sourceTable: job.queueName,
        sourceId: typeof job.id === 'string' && UUID_RE.test(job.id) ? job.id : null,
        eventType: job.name,
        payload: job.data,
        error: category,
        attempts: job.attemptsMade,
      });
      this.logger.error(
        `dead-lettered ${job.queueName}/${job.name} #${job.id} ` +
          `after ${job.attemptsMade} attempts: ${category}`,
      );
    } catch (err) {
      this.logger.warn(
        `dead_letter_insert_failed for ${job.queueName}/${job.name} #${job.id}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
