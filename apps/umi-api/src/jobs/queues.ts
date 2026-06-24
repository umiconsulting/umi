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
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const ALL_QUEUES: QueueName[] = Object.values(QUEUES);
