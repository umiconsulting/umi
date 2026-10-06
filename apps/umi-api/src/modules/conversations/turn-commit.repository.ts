import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The transactional-outbox boundary for a turn reply. In ONE worker-pool transaction
 * it claims the outbox idempotency key, inserts the assistant message, and touches the
 * durable thread. The reply row is drained by the OutboxRelay → Twilio.
 *
 * There is no state CAS any more (the FSM is gone). Exactly-once is carried entirely by
 * the outbox `idempotency_key`: a replayed commit collides on the unique key and returns
 * without a duplicate message. The "did the conversation move on before we replied?"
 * guard is a `hasNewerUserMessages` re-check in TurnService, done BEFORE the commit.
 */

export interface CommitTurnReplyParams {
  merchantId: string;
  conversationId: string;
  replyBody: string;
  /** Outbox topic (route key); the relay maps it to the outbound queue. */
  eventType: string;
  /** Deterministic idempotency key (e.g. `twilio_reply_turn:<lastUserMessageId>`). */
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface CommitTurnReplyResult {
  assistantMessageId: string | null;
  /** Null when the outbox row already existed (idempotent replay — no new message). */
  outboxId: string | null;
}

@Injectable()
export class TurnCommitRepository {
  constructor(private readonly pg: PgService) {}

  async commitTurnReply(params: CommitTurnReplyParams): Promise<CommitTurnReplyResult> {
    return this.pg.workerTx(async (client) => {
      // 1. Claim the reply via the outbox idempotency key. If it already exists, a
      //    prior attempt committed + relayed this reply: return WITHOUT inserting a
      //    duplicate assistant message. The relay drains every row, so the reply is
      //    (or will be) delivered exactly once.
      const ob = await client.query<{ id: string }>(
        `INSERT INTO runtime.outbox_event
           (merchant_id, topic, aggregate_id, idempotency_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (merchant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          params.merchantId,
          params.eventType,
          params.conversationId,
          params.idempotencyKey,
          JSON.stringify(params.payload ?? {}),
        ],
      );
      if (!ob.rows.length) {
        return { assistantMessageId: null, outboxId: null };
      }

      // 2. Touch the durable thread so listing/ordering by last_message_at stays fresh.
      await client.query(`UPDATE merchant.conversation SET last_message_at = now() WHERE id = $1`, [
        params.conversationId,
      ]);

      // 3. Persist the assistant message. sender='bot' — the DB vocabulary
      // (customer|bot|staff|system), not the LLM 'assistant'. The message scopes to
      // the merchant via its conversation (no merchant_id column); order is by created_at.
      const msg = await client.query<{ id: string }>(
        `INSERT INTO merchant.message (conversation_id, sender, body)
         VALUES ($1, 'bot', $2)
         RETURNING id`,
        [params.conversationId, params.replyBody],
      );

      return {
        assistantMessageId: msg.rows[0]?.id ?? null,
        outboxId: ob.rows[0].id,
      };
    });
  }
}
