import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { ConversationRecord, DraftCart } from './conversation.types';

/**
 * Queries for `comms.conversations` — the per-conversation state machine.
 * Rebound to canonical columns (preflight §2): `customer_id → person_id`,
 * `business_id → tenant_id`, `opened_at → created_at`,
 * `updated_at → last_message_at`. `state_version` / `draft_cart_version` are the
 * optimistic-lock (CAS) cursors.
 *
 * Worker pool (unauthenticated WhatsApp path), explicit tenant predicates.
 */

interface ConversationRow {
  id: string;
  tenant_id: string;
  person_id: string;
  order_id: string | null;
  status: string;
  current_state: string;
  summary: string | null;
  draft_cart: DraftCart | null;
  draft_cart_version: string;
  pending_clarification: Record<string, unknown> | null;
  state_version: string;
}

const SELECT_COLUMNS = `id::text, tenant_id::text, person_id::text, order_id::text,
  status, current_state, summary, draft_cart, draft_cart_version::text,
  pending_clarification, state_version::text`;

function mapRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    personId: row.person_id,
    orderId: row.order_id,
    status: row.status,
    currentState: row.current_state,
    summary: row.summary,
    draftCart: row.draft_cart,
    draftCartVersion: Number(row.draft_cart_version),
    pendingClarification: row.pending_clarification,
    stateVersion: Number(row.state_version),
  };
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Find the most recent non-closed conversation for a person, or create one.
   * New conversations start at `current_state='initial'`, `status='open'`,
   * version cursors at 0. Returns the record + total message count.
   */
  async getOrCreateConversation(
    tenantId: string,
    personId: string,
  ): Promise<{ conversation: ConversationRecord; messageCount: number }> {
    const existing = await this.pg.query<ConversationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM comms.conversations
        WHERE person_id = $1
          AND tenant_id = $2
          AND status IN ('open', 'active', 'pending')
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [personId, tenantId],
    );

    if (existing.rows[0]) {
      const conversation = mapRow(existing.rows[0]);
      const count = await this.pg.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM comms.messages WHERE conversation_id = $1`,
        [conversation.id],
      );
      return { conversation, messageCount: Number(count.rows[0]?.n ?? 0) };
    }

    const created = await this.pg.query<ConversationRow>(
      `INSERT INTO comms.conversations
         (tenant_id, person_id, current_state, status, state_version, draft_cart_version, last_message_at)
       VALUES ($1, $2, 'initial', 'open', 0, 0, now())
       RETURNING ${SELECT_COLUMNS}`,
      [tenantId, personId],
    );
    if (!created.rows[0]) {
      throw new Error('Failed to create conversation');
    }
    return { conversation: mapRow(created.rows[0]), messageCount: 0 };
  }

  async loadById(conversationId: string): Promise<ConversationRecord | null> {
    const { rows } = await this.pg.query<ConversationRow>(
      `SELECT ${SELECT_COLUMNS} FROM comms.conversations WHERE id = $1`,
      [conversationId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Optimistic-lock state update (CAS on `state_version`). Patches any of
   * current_state / summary / pending_clarification / status / order_id, bumps
   * the version, and touches `last_message_at`. Returns the new version, or null
   * if another writer advanced the version first (the caller retries/rebases).
   */
  async updateStateCas(
    conversationId: string,
    expectedStateVersion: number,
    patch: {
      currentState?: string;
      summary?: string | null;
      pendingClarification?: Record<string, unknown> | null;
      status?: string;
      orderId?: string | null;
    },
  ): Promise<number | null> {
    const { rows } = await this.pg.query<{ state_version: string }>(
      `UPDATE comms.conversations
          SET current_state         = COALESCE($3, current_state),
              summary               = CASE WHEN $4::boolean THEN $5 ELSE summary END,
              pending_clarification = CASE WHEN $6::boolean THEN $7::jsonb ELSE pending_clarification END,
              status                = COALESCE($8, status),
              order_id              = CASE WHEN $9::boolean THEN $10::uuid ELSE order_id END,
              state_version         = state_version + 1,
              last_message_at       = now()
        WHERE id = $1 AND state_version = $2
        RETURNING state_version::text`,
      [
        conversationId,
        expectedStateVersion,
        patch.currentState ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'summary'),
        patch.summary ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'pendingClarification'),
        patch.pendingClarification != null
          ? JSON.stringify(patch.pendingClarification)
          : null,
        patch.status ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'orderId'),
        patch.orderId ?? null,
      ],
    );
    return rows[0] ? Number(rows[0].state_version) : null;
  }

  /** Optimistic-lock draft-cart update (CAS on `draft_cart_version`). */
  async updateDraftCartCas(
    conversationId: string,
    expectedCartVersion: number,
    draftCart: DraftCart | null,
  ): Promise<number | null> {
    const { rows } = await this.pg.query<{ draft_cart_version: string }>(
      `UPDATE comms.conversations
          SET draft_cart         = $3::jsonb,
              draft_cart_version = draft_cart_version + 1,
              last_message_at    = now()
        WHERE id = $1 AND draft_cart_version = $2
        RETURNING draft_cart_version::text`,
      [
        conversationId,
        expectedCartVersion,
        draftCart != null ? JSON.stringify(draftCart) : null,
      ],
    );
    return rows[0] ? Number(rows[0].draft_cart_version) : null;
  }

  async setSummary(conversationId: string, summary: string): Promise<void> {
    await this.pg.query(
      `UPDATE comms.conversations SET summary = $2 WHERE id = $1`,
      [conversationId, summary],
    );
  }

  async touch(conversationId: string): Promise<void> {
    await this.pg.query(
      `UPDATE comms.conversations SET last_message_at = now() WHERE id = $1`,
      [conversationId],
    );
  }
}
