import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { ConversationRecord, DraftCart } from './conversation.types';

/**
 * The per-conversation store. A conversation is the DURABLE thread
 * (`tenant.conversation` — customer_id, status, summary, last_message_at) plus its
 * IN-FLIGHT cart (`runtime.conversation_cart` — the DraftCart + selected branch,
 * last-write-wins). The FSM is gone: no `current_state`, no version cursors, no CAS.
 *
 * Read/written here on the worker pool because the WhatsApp path is unauthenticated.
 * The `personId` field carries `tenant.conversation.customer_id`.
 */

interface ConversationRow {
  id: string;
  business_id: string;
  person_id: string;
  status: string;
  summary: string | null;
  draft_cart: DraftCart | null;
}

// Durable columns off `tenant.conversation c`; the in-flight cart off
// `runtime.conversation_cart k` (LEFT JOIN so a thread with no cart maps cleanly).
const SELECT_FIELDS = `c.id::text            AS id,
  c.business_id::text  AS business_id,
  c.customer_id::text  AS person_id,
  c.status             AS status,
  c.summary            AS summary,
  k.cart               AS draft_cart`;

const FROM_JOIN = `FROM tenant.conversation c
  LEFT JOIN runtime.conversation_cart k ON k.conversation_id = c.id`;

function mapRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    tenantId: row.business_id,
    personId: row.person_id,
    status: row.status,
    summary: row.summary,
    draftCart: row.draft_cart,
  };
}

@Injectable()
export class ConversationsRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Find the most recent non-closed conversation for a customer, or create one.
   * A new conversation is a single INSERT into the durable `tenant.conversation`
   * thread — the `runtime.conversation_cart` row is created lazily on the first
   * cart write. Returns the joined record + total message count.
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
            AND c.business_id = $2
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
           (business_id, customer_id, channel_id, status, last_message_at)
         VALUES ($1, $2, (SELECT id FROM umi.channel_type WHERE key = 'whatsapp'), 'open', now())
         RETURNING id::text AS id`,
        [tenantId, personId],
      );
      const conversationId = conv.rows[0]?.id;
      if (!conversationId) {
        throw new Error('Failed to create conversation');
      }

      const created = await client.query<ConversationRow>(
        `SELECT ${SELECT_FIELDS} ${FROM_JOIN}
          WHERE c.id = $1 AND c.business_id = $2 LIMIT 1`,
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
   * Read the branch chosen for the in-flight order (worker pool). Lives on
   * `runtime.conversation_cart` — it is an attribute of the order being built, asked
   * at checkout and captured onto `customer_order` at confirmation.
   */
  async getSelectedLocationWorker(conversationId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ selected_branch_id: string | null }>(
      `SELECT selected_branch_id::text AS selected_branch_id
         FROM runtime.conversation_cart WHERE conversation_id = $1`,
      [conversationId],
    );
    return rows[0]?.selected_branch_id ?? null;
  }

  /** Persist the customer's chosen branch for the in-flight order (worker pool).
   *  business_id is derived from the conversation, so callers pass only the branch. */
  async setSelectedLocationWorker(
    conversationId: string,
    locationId: string | null,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.conversation_cart (conversation_id, business_id, selected_branch_id)
       SELECT $1, cv.business_id, $2::uuid FROM tenant.conversation cv WHERE cv.id = $1
       ON CONFLICT (conversation_id) DO UPDATE
         SET selected_branch_id = EXCLUDED.selected_branch_id, updated_at = now()`,
      [conversationId, locationId],
    );
  }

  /**
   * Last-write-wins cart write (replaces the old CAS). Upserts the in-flight cart;
   * business_id is derived from the conversation. Pass `null` to clear the cart
   * (e.g. at confirmation, once it has materialized into a `customer_order`).
   */
  async setDraftCart(conversationId: string, draftCart: DraftCart | null): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.conversation_cart (conversation_id, business_id, cart)
       SELECT $1, cv.business_id, $2::jsonb FROM tenant.conversation cv WHERE cv.id = $1
       ON CONFLICT (conversation_id) DO UPDATE
         SET cart = EXCLUDED.cart, updated_at = now()`,
      [conversationId, draftCart != null ? JSON.stringify(draftCart) : null],
    );
  }

  async setSummary(conversationId: string, summary: string): Promise<void> {
    await this.pg.query(`UPDATE tenant.conversation SET summary = $2 WHERE id = $1`, [
      conversationId,
      summary,
    ]);
  }

  async touch(conversationId: string): Promise<void> {
    await this.pg.query(`UPDATE tenant.conversation SET last_message_at = now() WHERE id = $1`, [
      conversationId,
    ]);
  }
}
