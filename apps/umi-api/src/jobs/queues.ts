/**
 * Single source of truth for BullMQ queue names. Import `QUEUES.x` everywhere;
 * never hardcode a queue string. Processors land in later phases:
 *   turns        → turn.integrity, turn.process            (Phase 3)
 *   enrichment   → embed, summarize, extract-facts          (Phase 3)
 *   outbound     → twilio reply + notifications + lifecycle  (Phase 3)
 *   integrations → zettle.sync                               (Phase 3)
 *   lifecycle    → repeatable crons (birthday, winback, …)   (Phase 3/5)
 */
export const QUEUES = {
  system: 'system', // health/wiring + maintenance (Phase 0)
  turns: 'turns',
  enrichment: 'enrichment',
  outbound: 'outbound',
  integrations: 'integrations',
  lifecycle: 'lifecycle',
  /**
   * The terminal's own answers: one job per Mercado Pago Point notification.
   *
   * IT IS NOT `integrations` ON PURPOSE. A queue is a work stream, and BullMQ hands each
   * job to whichever consumer takes it first — so a second `@Processor` on an existing
   * queue does not add a handler, it COMPETES with the first one. The tender notification
   * was briefly routed to `integrations` and the existing processor logged
   * `unknown integrations job: tender.point.notification` and returned, dropping the
   * resolution the till was waiting for. A tender that money depends on gets its own
   * queue, its own retry policy and its own consumer.
   */
  tender: 'tender',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);
