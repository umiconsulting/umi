import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { MessageRunItem } from './turn.types';

/**
 * Queries for `runtime.conversation_turn` — the fragment-merge / debounce buffer,
 * plus the trailing-user-run read over `tenant.message`. The turn is slimmed to that
 * job: NO integrity/reconcile/base_state_version columns (they existed only to
 * reconcile against the deleted FSM). Worker pool — the WhatsApp path is unauthenticated.
 *
 * Status vocabulary: `pending|processing|completed|failed|superseded`. The legacy
 * `buffering`/`released` states both map to `pending`; `released_at` (set when the
 * debounce fires) distinguishes a released turn from one still buffering.
 */

/** Canonical turn status. */
export type TurnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'superseded';

export interface TurnRecord {
  id: string;
  status: TurnStatus;
  sourceMessageIds: string[];
  mergedUserText: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  holdUntil: string | null;
  releasedAt: string | null;
}

interface TurnRow {
  id: string;
  status: TurnStatus;
  source_message_ids: string[] | null;
  merged_user_text: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  hold_until: string | null;
  released_at: string | null;
}

const TURN_COLUMNS = `id::text, status, source_message_ids, merged_user_text,
  first_message_at, last_message_at, hold_until, released_at`;

function mapTurn(row: TurnRow): TurnRecord {
  return {
    id: row.id,
    status: row.status,
    sourceMessageIds: row.source_message_ids ?? [],
    mergedUserText: row.merged_user_text ?? '',
    firstMessageAt: row.first_message_at,
    lastMessageAt: row.last_message_at,
    holdUntil: row.hold_until,
    releasedAt: row.released_at,
  };
}

export interface UpsertTurnParams {
  existingTurnId?: string | null;
  tenantId: string;
  conversationId: string;
  status: TurnStatus;
  sourceMessageIds: string[];
  mergedUserText: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  holdUntil?: string | null;
  releasedAt?: string | null;
  supersededAt?: string | null;
}

@Injectable()
export class ConversationTurnsRepository {
  constructor(private readonly pg: PgService) {}

  /** Trailing run of consecutive user messages (stops at the first assistant). */
  async getTrailingUserRun(conversationId: string, limit = 20): Promise<MessageRunItem[]> {
    const { rows } = await this.pg.query<MessageRunItem>(
      `SELECT id::text,
              CASE sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                          WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(body, '') AS content, created_at
         FROM tenant.message
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [conversationId, limit],
    );
    const run: MessageRunItem[] = [];
    for (const message of rows) {
      // Only consecutive USER messages form the trailing run — stop at the first
      // non-user row (assistant/system/tool) so they can't leak into the merged turn.
      if (message.role !== 'user') break;
      run.push(message);
    }
    return run.reverse();
  }

  async hasNewerUserMessages(
    conversationId: string,
    afterTimestamp: string,
    excludeMessageIds: string[] = [],
  ): Promise<boolean> {
    // `afterTimestamp` is the turn's last_message_at, which round-trips through a
    // JS Date and is truncated to MILLISECOND precision, while
    // tenant.message.created_at keeps Postgres MICROSECOND precision. A strict
    // `created_at > $2` then treats the turn's own newest message as "newer"
    // (e.g. .62592 > .625), so the turn supersedes + re-queues forever. Excluding
    // the turn's source message ids makes the check precision-immune: a genuinely
    // newer message is one that is not already part of this turn.
    const { rows } = await this.pg.query(
      `SELECT 1
         FROM tenant.message
        WHERE conversation_id = $1 AND sender = 'customer' AND created_at > $2
          AND id <> ALL ($3::uuid[])
        LIMIT 1`,
      [conversationId, afterTimestamp, excludeMessageIds],
    );
    return rows.length > 0;
  }

  /** Most recent active (pending/processing) turn for a conversation. */
  async findActiveTurn(conversationId: string): Promise<TurnRecord | null> {
    const { rows } = await this.pg.query<TurnRow>(
      `SELECT ${TURN_COLUMNS}
         FROM runtime.conversation_turn
        WHERE conversation_id = $1 AND status IN ('pending', 'processing')
        ORDER BY created_at DESC
        LIMIT 1`,
      [conversationId],
    );
    return rows[0] ? mapTurn(rows[0]) : null;
  }

  async loadTurn(turnId: string): Promise<TurnRecord | null> {
    const { rows } = await this.pg.query<TurnRow>(
      `SELECT ${TURN_COLUMNS} FROM runtime.conversation_turn WHERE id = $1`,
      [turnId],
    );
    return rows[0] ? mapTurn(rows[0]) : null;
  }

  async upsertTurn(params: UpsertTurnParams): Promise<TurnRecord> {
    const cols = [
      params.tenantId,
      params.conversationId,
      params.status,
      params.sourceMessageIds,
      params.mergedUserText,
      params.firstMessageAt,
      params.lastMessageAt,
      params.holdUntil ?? null,
      params.releasedAt ?? null,
      params.supersededAt ?? null,
    ];

    if (params.existingTurnId) {
      const { rows } = await this.pg.query<TurnRow>(
        `UPDATE runtime.conversation_turn SET
            business_id = $1::uuid, conversation_id = $2::uuid, status = $3,
            source_message_ids = $4::uuid[], merged_user_text = $5,
            first_message_at = $6, last_message_at = $7, hold_until = $8,
            released_at = $9, superseded_at = $10
          WHERE id = $11
          RETURNING ${TURN_COLUMNS}`,
        [...cols, params.existingTurnId],
      );
      if (!rows[0])
        throw new Error(`update conversation_turn failed (id ${params.existingTurnId})`);
      return mapTurn(rows[0]);
    }

    const { rows } = await this.pg.query<TurnRow>(
      `INSERT INTO runtime.conversation_turn
         (business_id, conversation_id, status, source_message_ids, merged_user_text,
          first_message_at, last_message_at, hold_until, released_at, superseded_at)
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid[],$5,$6,$7,$8,$9,$10)
       RETURNING ${TURN_COLUMNS}`,
      cols,
    );
    if (!rows[0]) throw new Error('insert conversation_turn failed');
    return mapTurn(rows[0]);
  }

  /** Supersede every OTHER active turn for the conversation. */
  async supersedeOtherTurns(conversationId: string, keepTurnId: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.conversation_turn
          SET status = 'superseded', superseded_at = now()
        WHERE conversation_id = $1 AND id <> $2 AND status IN ('pending', 'processing')`,
      [conversationId, keepTurnId],
    );
  }
}
