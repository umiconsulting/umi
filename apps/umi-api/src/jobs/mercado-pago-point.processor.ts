import { Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { TenderService } from '../modules/tender/tender.service';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { workerOptions } from './job-options';
import { QUEUES } from './queues';

/**
 * THE WAKE-UP, WORKED. §4 Phase 2 steps 3 and 4 of the Point plan.
 *
 * The web process verifies the notification's signature, enqueues one job and answers
 * 200 inside the vendor's 22-second budget. This is the other half: what the job does
 * with it.
 *
 * IT RE-READS THE ORDER; IT DOES NOT BELIEVE THE BODY (plan D5). Three documented facts
 * make that the only safe shape: the notification body carries no notification id, so it
 * cannot be deduplicated on its own; delivery is at-least-once with unbounded retries, so a
 * duplicate is normal rather than exceptional; and a duplicate must never undo a
 * resolution. So the payload is used for exactly two things — which attempt to look at, and
 * which order to ask about — and the answer comes from `GET /v1/orders/{order_id}` through
 * the provider adapter, written by the same monotonic `resolveAttempt` an operator's query
 * uses.
 *
 * NOTHING HERE THROWS FOR A FORGETTABLE FACT. A notification naming an attempt this
 * deployment never recorded, or one whose outcome the terminal has not decided yet, is
 * logged and dropped: retrying the job cannot make either of those true, and the till
 * already has its own poll at `queryAfterSeconds` as the delivery path. A genuine failure
 * — the database, or an unexpected shape — propagates so BullMQ's three attempts and the
 * dead-letter sink do their job.
 *
 * The realtime nudge is raised by the DATABASE, not here: `merchant.pos_payment_attempt`
 * raises `umi_tender_attempt` on a resolving write (`72_mp_point.sql`), the web process
 * listens and emits, and the till re-reads over REST. The worker has no socket, which is
 * why the nudge is driven from the row.
 */

/** The payload the receiver enqueues. Ids and the vendor's own words, nothing else. */
interface PointNotificationJobData {
  action?: unknown;
  orderId?: unknown;
  externalReference?: unknown;
  status?: unknown;
  requestId?: unknown;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

@Processor(QUEUES.tender, workerOptions(QUEUES.tender))
export class MercadoPagoPointProcessor extends BaseProcessor {
  private readonly pointLogger = new Logger(MercadoPagoPointProcessor.name);

  constructor(
    deadLetters: DeadLetterService,
    private readonly tender: TenderService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'tender.point.notification') return;
    const data: PointNotificationJobData = isRecord(job.data) ? job.data : {};
    const correlationId = asString(data.requestId) ?? String(job.id ?? 'unknown');
    const startedAt = Date.now();
    const resolution = await this.tender.resolveFromNotification({
      providerOrderId: asString(data.orderId),
      commandIdentity: asString(data.externalReference),
      statusHint: asString(data.status),
      correlationId,
    });

    if (!resolution) {
      this.pointLogger.warn(
        `point notification names no attempt we hold action=${String(data.action)} ` +
          `order=${String(data.orderId)} correlation=${correlationId}`,
      );
      return;
    }

    this.pointLogger.log(
      `point notification resolved attempt=${resolution.attemptId} state=${resolution.state} ` +
        `providerAsked=${resolution.providerAsked} resolvedNow=${resolution.resolvedNow} ` +
        `latencyMs=${Date.now() - startedAt} correlation=${correlationId}`,
    );
  }
}
