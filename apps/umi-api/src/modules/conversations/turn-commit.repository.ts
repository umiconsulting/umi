import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The transactional outbox boundary for a turn reply (spec §10.4). In ONE
 * worker-pool transaction it:
 *   1. CAS-updates the conversation state (guards against a concurrent writer),
 *   2. inserts the assistant message,
 *   3. inserts the `runtime.outbox_event` reply row (the OutboxRelay drains it to
 *      the outbound queue → Twilio send in Phase 3d).
 * If the CAS loses (another writer advanced state_version), the whole tx rolls
 * back and `committed=false` is returned — the caller supersedes + requeues. So a
 * crash between "decide" and "send" can never drop or duplicate a reply.
 */

export interface CommitTurnReplyParams {
  tenantId: string;
  conversationId: string;
  expectedStateVersion: number;
  nextState: string;
  pendingClarification: Record<string, unknown> | null;
  replyBody: string;
  /** Outbox event_type (route key); the relay maps it to the outbound queue. */
  eventType: string;
  /** Deterministic idempotency key (e.g. `twilio_reply_turn:<lastUserMessageId>`). */
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface CommitTurnReplyResult {
  committed: boolean;
  assistantMessageId?: string | null;
  /** Null when the outbox row already existed (idempotency_key conflict). */
  outboxId?: string | null;
}

@Injectable()
export class TurnCommitRepository {
  constructor(private readonly pg: PgService) {}

  async commitTurnReply(params: CommitTurnReplyParams): Promise<CommitTurnReplyResult> {
    return this.pg.workerTx(async (client) => {
      // 1. Claim the reply via the outbox idempotency key FIRST. If it already
      //    exists, this turn's reply was committed + relayed by a prior attempt:
      //    return committed (so the caller doesn't supersede) WITHOUT re-CASing
      //    state or inserting a duplicate assistant message. ON CONFLICT means a
      //    committed row exists, and the relay drains every row, so the reply is
      //    (or will be) delivered exactly once.
      const ob = await client.query<{ id: string }>(
        `INSERT INTO runtime.outbox_event
           (business_id, topic, aggregate_id, idempotency_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (business_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          params.tenantId,
          params.eventType,
          params.conversationId,
          params.idempotencyKey,
          JSON.stringify(params.payload ?? {}),
        ],
      );
      if (!ob.rows.length) {
        return { committed: true, assistantMessageId: null, outboxId: null };
      }

      // 2. CAS the conversation LIVE state (runtime.conversation_state). If a
      //    concurrent writer advanced state_version, the whole tx (including the
      //    outbox claim above) rolls back and the caller supersedes + requeues —
      //    never a half-commit. The durable thread (tenant.conversation) is
      //    touched separately below once the CAS holds.
      const cas = await client.query<{ id: string }>(
        `UPDATE runtime.conversation_state
            SET current_state = $2,
                pending_clarification = $3::jsonb,
                state_version = state_version + 1,
                updated_at = now()
          WHERE conversation_id = $1 AND state_version = $4
          RETURNING id`,
        [
          params.conversationId,
          params.nextState,
          params.pendingClarification != null ? JSON.stringify(params.pendingClarification) : null,
          params.expectedStateVersion,
        ],
      );
      if (!cas.rows.length) return { committed: false };

      // Touch the durable thread so listing/ordering by last_message_at stays fresh.
      await client.query(`UPDATE tenant.conversation SET last_message_at = now() WHERE id = $1`, [
        params.conversationId,
      ]);

      // 3. Persist the assistant message. Only now is the turn truly committed.
      // sender='bot' — the DB vocabulary (customer|bot|staff|system), not the LLM
      // 'assistant' (which violates the CHECK). See message-vocab.ts.
      const msg = await client.query<{ id: string }>(
        `INSERT INTO tenant.message
           (business_id, conversation_id, sender, body, message_index)
         VALUES ($1, $2, 'bot', $3,
           (SELECT COALESCE(MAX(message_index) + 1, 0)
              FROM tenant.message WHERE conversation_id = $2))
         RETURNING id`,
        [params.tenantId, params.conversationId, params.replyBody],
      );

      return {
        committed: true,
        assistantMessageId: msg.rows[0]?.id ?? null,
        outboxId: ob.rows[0].id,
      };
    });
  }
}
