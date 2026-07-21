import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { MessageRunItem } from './turn.types';

/**
 * Queries for `runtime.conversation_turn` (the turn-integrity / debounce machinery)
 * + the trailing-user-run read over `tenant.message`. Ported from `_shared/turns.ts`
 * and rebound to canonical columns (preflight §2). Worker pool — the WhatsApp path
 * is unauthenticated.
 *
 * ⚠️ Status vocabulary rebind: canonical `status ∈ pending|processing|completed|
 * failed|superseded`. The legacy `buffering`/`released` states both map to
 * `pending`; `released_at` (NOT NULL) distinguishes a released turn from one still
 * buffering. `findActiveTurn`/`supersedeOtherTurns` therefore key on
 * `status IN ('pending','processing')`.
 */

/** Canonical turn status. */
export type TurnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'superseded';

export interface TurnRecord {
  id: string;
  status: TurnStatus;
  sourceMessageIds: string[];
  mergedUserText: string;
  integrityDecision: string | null;
  integrityReason: string | null;
  baseStateVersion: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  holdUntil: string | null;
  releasedAt: string | null;
  processedAt: string | null;
}

interface TurnRow {
  id: string;
  status: TurnStatus;
  source_message_ids: string[] | null;
  merged_user_text: string | null;
  integrity_decision: string | null;
  integrity_reason: string | null;
  base_state_version: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  hold_until: string | null;
  released_at: string | null;
  processed_at: string | null;
}

const TURN_COLUMNS = `id::text, status, source_message_ids, merged_user_text,
  integrity_decision, integrity_reason, base_state_version::text,
  first_message_at, last_message_at, hold_until, released_at, processed_at`;

function mapTurn(row: TurnRow): TurnRecord {
  return {
    id: row.id,
    status: row.status,
    sourceMessageIds: row.source_message_ids ?? [],
    mergedUserText: row.merged_user_text ?? '',
    integrityDecision: row.integrity_decision,
    integrityReason: row.integrity_reason,
    baseStateVersion: Number(row.base_state_version ?? 0),
    firstMessageAt: row.first_message_at,
    lastMessageAt: row.last_message_at,
    holdUntil: row.hold_until,
    releasedAt: row.released_at,
    processedAt: row.processed_at,
  };
}

export interface UpsertTurnParams {
  existingTurnId?: string | null;
  tenantId: string;
  conversationId: string;
  personId: string;
  status: TurnStatus;
  sourceMessageIds: string[];
  mergedUserText: string;
  integrityDecision: string;
  integrityReason: string;
  baseStateVersion: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  holdUntil?: string | null;
  releasedAt?: string | null;
  extractedIntent?: Record<string, unknown> | null;
  reconciledAction?: Record<string, unknown> | null;
  assistantMessageId?: string | null;
  processedAt?: string | null;
  supersededAt?: string | null;
}

@Injectable()
export class ConversationTurnsRepository {
  constructor(private readonly pg: PgService) {}

  /** Trailing run of consecutive user messages (stops at the first assistant). */
  async getTrailingUserRun(
    conversationId: string,
    limit = 20,
  ): Promise<MessageRunItem[]> {
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
      params.personId,
      params.status,
      params.sourceMessageIds,
      params.mergedUserText,
      params.integrityDecision,
      params.integrityReason,
      params.baseStateVersion,
      params.firstMessageAt,
      params.lastMessageAt,
      params.holdUntil ?? null,
      params.releasedAt ?? null,
      params.extractedIntent != null ? JSON.stringify(params.extractedIntent) : null,
      params.reconciledAction != null ? JSON.stringify(params.reconciledAction) : null,
      params.assistantMessageId ?? null,
      params.processedAt ?? null,
      params.supersededAt ?? null,
    ];

    if (params.existingTurnId) {
      const { rows } = await this.pg.query<TurnRow>(
        `UPDATE runtime.conversation_turn SET
            business_id = $1::uuid, conversation_id = $2::uuid, person_id = $3::uuid,
            status = $4, source_message_ids = $5::uuid[], merged_user_text = $6,
            integrity_decision = $7, integrity_reason = $8, base_state_version = $9,
            first_message_at = $10, last_message_at = $11, hold_until = $12,
            released_at = $13, extracted_intent = $14::jsonb,
            reconciled_action = $15::jsonb, assistant_message_id = $16,
            processed_at = $17, superseded_at = $18
          WHERE id = $19
          RETURNING ${TURN_COLUMNS}`,
        [...cols, params.existingTurnId],
      );
      if (!rows[0]) throw new Error(`update conversation_turn failed (id ${params.existingTurnId})`);
      return mapTurn(rows[0]);
    }

    const { rows } = await this.pg.query<TurnRow>(
      `INSERT INTO runtime.conversation_turn
         (business_id, conversation_id, person_id, status, source_message_ids,
          merged_user_text, integrity_decision, integrity_reason, base_state_version,
          first_message_at, last_message_at, hold_until, released_at, extracted_intent,
          reconciled_action, assistant_message_id, processed_at, superseded_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid[],$6,$7,$8,$9,$10,$11,$12,$13,
               $14::jsonb,$15::jsonb,$16,$17,$18)
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
          SET status = 'superseded',
              integrity_decision = 'cancel',
              integrity_reason = 'superseded_by_newer_turn',
              superseded_at = now()
        WHERE conversation_id = $1 AND id <> $2 AND status IN ('pending', 'processing')`,
      [conversationId, keepTurnId],
    );
  }
}
