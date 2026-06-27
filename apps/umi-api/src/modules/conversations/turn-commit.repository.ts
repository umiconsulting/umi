import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The transactional outbox boundary for a turn reply (spec §10.4). In ONE
 * worker-pool transaction it:
 *   1. CAS-updates the conversation state (guards against a concurrent writer),
 *   2. inserts the assistant message,
 *   3. inserts the `queue.outbox_events` reply row (the OutboxRelay drains it to
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
      const cas = await client.query<{ id: string }>(
        `UPDATE comms.conversations
            SET current_state = $2,
                pending_clarification = $3::jsonb,
                state_version = state_version + 1,
                last_message_at = now()
          WHERE id = $1 AND state_version = $4
          RETURNING id`,
        [
          params.conversationId,
          params.nextState,
          params.pendingClarification != null ? JSON.stringify(params.pendingClarification) : null,
          params.expectedStateVersion,
        ],
      );
      if (!cas.rows.length) return { committed: false };

      const msg = await client.query<{ id: string }>(
        `INSERT INTO comms.messages
           (tenant_id, conversation_id, role, content, message_index)
         VALUES ($1, $2, 'assistant', $3,
           (SELECT COALESCE(MAX(message_index) + 1, 0)
              FROM comms.messages WHERE conversation_id = $2))
         RETURNING id`,
        [params.tenantId, params.conversationId, params.replyBody],
      );

      const ob = await client.query<{ id: string }>(
        `INSERT INTO queue.outbox_events
           (tenant_id, event_type, aggregate_id, idempotency_key, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          params.tenantId,
          params.eventType,
          params.conversationId,
          params.idempotencyKey,
          JSON.stringify(params.payload ?? {}),
        ],
      );

      return {
        committed: true,
        assistantMessageId: msg.rows[0]?.id ?? null,
        outboxId: ob.rows[0]?.id ?? null,
      };
    });
  }
}
