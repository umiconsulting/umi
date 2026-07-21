import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { ConversationRecord, DraftCart } from './conversation.types';

/**
 * The per-conversation store. In build-v2 a conversation is SPLIT across two
 * tables:
 *   * `tenant.conversation` — the DURABLE thread (customer_id, status, summary,
 *     order_id, last_message_at). RLS domain, but read/written here on the worker
 *     pool because the WhatsApp path is unauthenticated.
 *   * `runtime.conversation_state` — the LIVE cart/CAS machinery (current_state,
 *     draft_cart, pending_clarification, selected_location_id, and the
 *     optimistic-lock cursors state_version / draft_cart_version). One row per
 *     conversation, keyed (tenant_id, conversation_id).
 *
 * The public {@link ConversationRecord} shape is unchanged — it is a JOIN of the
 * two tables (its `personId` field carries `tenant.conversation.customer_id`).
 * CAS updates target `runtime.conversation_state`; durable attributes
 * (summary/status/order_id) target `tenant.conversation`.
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

// The joined projection: durable columns off `tenant.conversation c`, live-state
// columns off `runtime.conversation_state s` (LEFT JOIN + COALESCE so a thread
// without a state row still maps cleanly).
const SELECT_FIELDS = `c.id::text                                AS id,
  c.tenant_id::text                        AS tenant_id,
  c.customer_id::text                      AS person_id,
  c.order_id::text                         AS order_id,
  c.status                                 AS status,
  c.summary                                AS summary,
  COALESCE(s.current_state, 'initial')     AS current_state,
  s.draft_cart                             AS draft_cart,
  COALESCE(s.draft_cart_version, 0)::text  AS draft_cart_version,
  s.pending_clarification                  AS pending_clarification,
  COALESCE(s.state_version, 0)::text       AS state_version`;

const FROM_JOIN = `FROM tenant.conversation c
  LEFT JOIN runtime.conversation_state s
    ON s.tenant_id = c.tenant_id AND s.conversation_id = c.id`;

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
   * Find the most recent non-closed conversation for a customer, or create one.
   * A new conversation is two INSERTs — the durable `tenant.conversation` thread
   * plus its `runtime.conversation_state` row (current_state='initial', version
   * cursors at 0). Returns the joined record + total message count.
   */
  async getOrCreateConversation(
    tenantId: string,
    personId: string,
  ): Promise<{ conversation: ConversationRecord; messageCount: number }> {
    // There is no partial-unique on open conversations (a customer legitimately
    // has many closed ones + at most one open), so a plain SELECT-then-INSERT
    // races: two simultaneous inbound messages could each create a new open
    // conversation. A transaction-scoped advisory lock keyed on (tenant, customer)
    // makes the find-or-create atomic without a schema change.
    return this.pg.workerTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `conv:${tenantId}:${personId}`,
      ]);

      const existing = await client.query<ConversationRow>(
        `SELECT ${SELECT_FIELDS}
           ${FROM_JOIN}
          WHERE c.customer_id = $1
            AND c.tenant_id = $2
            AND c.status IN ('open', 'active', 'pending')
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT 1`,
        [personId, tenantId],
      );

      if (existing.rows[0]) {
        const conversation = mapRow(existing.rows[0]);
        const count = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM tenant.message WHERE conversation_id = $1`,
          [conversation.id],
        );
        return { conversation, messageCount: Number(count.rows[0]?.n ?? 0) };
      }

      const conv = await client.query<{ id: string }>(
        `INSERT INTO tenant.conversation
           (tenant_id, customer_id, status, last_message_at)
         VALUES ($1, $2, 'open', now())
         RETURNING id::text AS id`,
        [tenantId, personId],
      );
      const conversationId = conv.rows[0]?.id;
      if (!conversationId) {
        throw new Error('Failed to create conversation');
      }

      await client.query(
        `INSERT INTO runtime.conversation_state
           (tenant_id, conversation_id, current_state, state_version, draft_cart_version)
         VALUES ($1, $2, 'initial', 0, 0)
         ON CONFLICT (tenant_id, conversation_id) DO NOTHING`,
        [tenantId, conversationId],
      );

      const created = await client.query<ConversationRow>(
        `SELECT ${SELECT_FIELDS} ${FROM_JOIN}
          WHERE c.id = $1 AND c.tenant_id = $2 LIMIT 1`,
        [conversationId, tenantId],
      );
      if (!created.rows[0]) {
        throw new Error('Failed to create conversation');
      }
      return { conversation: mapRow(created.rows[0]), messageCount: 0 };
    });
  }

  async loadById(conversationId: string): Promise<ConversationRecord | null> {
    const { rows } = await this.pg.query<ConversationRow>(
      `SELECT ${SELECT_FIELDS} ${FROM_JOIN} WHERE c.id = $1`,
      [conversationId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /**
   * Read the durable branch selection for a conversation (worker pool — the
   * WhatsApp path is unauthenticated). Lives on `runtime.conversation_state`
   * (live in-flight state). Only called when BRANCH_RESOLUTION_ENABLED is on and
   * the tenant is multi-branch (Phase 1 branch resolution).
   */
  async getSelectedLocationWorker(
    conversationId: string,
  ): Promise<string | null> {
    const { rows } = await this.pg.query<{ selected_location_id: string | null }>(
      `SELECT selected_location_id::text AS selected_location_id
         FROM runtime.conversation_state WHERE conversation_id = $1`,
      [conversationId],
    );
    return rows[0]?.selected_location_id ?? null;
  }

  /** Persist the customer's chosen branch for the in-flight order (worker pool). */
  async setSelectedLocationWorker(
    conversationId: string,
    locationId: string | null,
  ): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.conversation_state
          SET selected_location_id = $2::uuid,
              updated_at = now()
        WHERE conversation_id = $1`,
      [conversationId, locationId],
    );
  }

  /**
   * Optimistic-lock state update (CAS on `state_version`). The versioned columns
   * (current_state / pending_clarification) live on `runtime.conversation_state`;
   * the durable attributes (summary / status / order_id) live on
   * `tenant.conversation`. Both are patched in one worker transaction, gated on
   * the state-row version. Returns the new version, or null if another writer
   * advanced it first (the caller retries/rebases).
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
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<{ state_version: string }>(
        `UPDATE runtime.conversation_state
            SET current_state         = COALESCE($2, current_state),
                pending_clarification = CASE WHEN $3::boolean THEN $4::jsonb ELSE pending_clarification END,
                state_version         = state_version + 1,
                updated_at            = now()
          WHERE conversation_id = $1 AND state_version = $5
          RETURNING state_version::text`,
        [
          conversationId,
          patch.currentState ?? null,
          Object.prototype.hasOwnProperty.call(patch, 'pendingClarification'),
          patch.pendingClarification != null
            ? JSON.stringify(patch.pendingClarification)
            : null,
          expectedStateVersion,
        ],
      );
      if (!rows[0]) return null; // CAS lost — another writer advanced the version.

      await client.query(
        `UPDATE tenant.conversation
            SET summary         = CASE WHEN $2::boolean THEN $3 ELSE summary END,
                status          = COALESCE($4, status),
                order_id        = CASE WHEN $5::boolean THEN $6::uuid ELSE order_id END,
                last_message_at = now()
          WHERE id = $1`,
        [
          conversationId,
          Object.prototype.hasOwnProperty.call(patch, 'summary'),
          patch.summary ?? null,
          patch.status ?? null,
          Object.prototype.hasOwnProperty.call(patch, 'orderId'),
          patch.orderId ?? null,
        ],
      );
      return Number(rows[0].state_version);
    });
  }

  /** Optimistic-lock draft-cart update (CAS on `draft_cart_version`). */
  async updateDraftCartCas(
    conversationId: string,
    expectedCartVersion: number,
    draftCart: DraftCart | null,
  ): Promise<number | null> {
    const { rows } = await this.pg.query<{ draft_cart_version: string }>(
      `UPDATE runtime.conversation_state
          SET draft_cart         = $3::jsonb,
              draft_cart_version = draft_cart_version + 1,
              updated_at         = now()
        WHERE conversation_id = $1 AND draft_cart_version = $2
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
      `UPDATE tenant.conversation SET summary = $2 WHERE id = $1`,
      [conversationId, summary],
    );
  }

  async touch(conversationId: string): Promise<void> {
    await this.pg.query(
      `UPDATE tenant.conversation SET last_message_at = now() WHERE id = $1`,
      [conversationId],
    );
  }
}
