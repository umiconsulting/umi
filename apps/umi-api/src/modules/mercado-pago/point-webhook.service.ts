import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { EnqueueService } from '../../jobs/enqueue.service';
import { QUEUES } from '../../jobs/queues';
import { verifyPointSignature, type PointSignatureVerdict } from './point-signature';

/**
 * The one integration job name this module produces. It lives here rather than in
 * `src/jobs` because the receiver owns the contract and the processor is written
 * against it (plan Phase 2 step 3).
 */
export const POINT_NOTIFICATION_JOB = 'tender.point.notification';

/**
 * What the receiver hands the worker. This is a WAKE-UP, not the truth (plan §3 D5):
 * the worker re-reads the order with `GET /v1/orders/{id}` before it writes anything,
 * because the Point body carries no notification id, delivery is at-least-once with
 * unbounded retries, and a duplicate must never undo a resolution.
 */
export interface PointNotificationEnvelope {
  /** `order.processed | order.canceled | order.refunded | order.action_required | order.failed | order.expired` */
  action: string;
  /** `body.data.id`. */
  orderId: string | null;
  /** `body.data.external_reference` — our command identity. */
  externalReference: string | null;
  /** `body.data.status`. */
  status: string | null;
  /** `body.data.status_detail`. */
  statusDetail: string | null;
  /** `body.user_id` — routes to a merchant once Phase 5 stores it. */
  sellerUserId: string | null;
  /** `body.live_mode` — false in test mode. */
  liveMode: boolean | null;
  /** `x-request-id`. */
  requestId: string | null;
}

/**
 * The receiver's two jobs: decide whether the notification is really from the
 * panel, and put it on a queue. That is the whole class.
 *
 * IT NEVER WRITES AND NEVER CALLS THE PROVIDER. The vendor gives us 22 seconds to
 * answer and retries every 15 minutes forever, so a receiver that did the work
 * inline turns a slow database into a retry storm (plan §3 D2). The 22-second
 * budget is the vendor's; the work belongs to the worker.
 */
@Injectable()
export class PointWebhookService {
  private readonly logger = new Logger(PointWebhookService.name);

  constructor(
    private readonly enqueue: EnqueueService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * The panel secret is resolved per call, never cached: the deployment can be
   * configured between two notifications, and a cached `undefined` would keep
   * refusing valid traffic until a restart.
   */
  verify(input: {
    signatureHeader?: string | null;
    requestId?: string | null;
    dataId?: string | null;
  }): PointSignatureVerdict {
    return verifyPointSignature({
      signatureHeader: input.signatureHeader,
      requestId: input.requestId,
      dataId: input.dataId,
      secret: this.config.get('MERCADO_PAGO_POINT_WEBHOOK_SECRET', { infer: true }),
    });
  }

  /**
   * Enqueue ONE job on the existing integrations queue and report whether it landed.
   *
   * NO DEDUPE KEY, deliberately. At-least-once delivery is documented, the body
   * carries no usable notification id, and the receiver has no durable place to
   * record a notification. Inventing a key (a hash of the body, say) would be a
   * guess that silently drops a real second event — the same order id legitimately
   * changes status several times. So `requestId` travels to the worker inside the
   * envelope and the worker resolves idempotently against the actual order state.
   *
   * `enqueued: false` means Redis refused the add (queue backpressure, a dropped
   * connection). The caller turns that into a non-2xx so the vendor retries — the
   * notification is never silently swallowed.
   */
  async accept(envelope: PointNotificationEnvelope): Promise<{ enqueued: boolean }> {
    try {
      // The TENDER queue, not `integrations`: a queue is handed to whichever consumer takes
      // the job first, and the generic integrations processor would consume this one and
      // drop it as "unknown" (see `queues.ts`). The terminal's answer gets its own lane.
      await this.enqueue.enqueue(QUEUES.tender, POINT_NOTIFICATION_JOB, envelope);
      return { enqueued: true };
    } catch (error) {
      this.logger.error(
        `mercado_pago_point_enqueue_failed order=${envelope.orderId ?? '-'} request_id=${envelope.requestId ?? '-'} error=${error instanceof Error ? error.message : String(error)}`,
      );
      return { enqueued: false };
    }
  }
}
