import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { ConversationRecord, DraftCart } from './conversation.types';

/**
 * The per-conversation store. A conversation is the DURABLE thread
 * (`merchant.conversation` — customer_id, status, summary, last_message_at) plus its
 * IN-FLIGHT cart (`runtime.conversation_cart` — the DraftCart + selected location,
 * last-write-wins). The FSM is gone: no `current_state`, no version cursors, no CAS.
 *
 * Read/written here on the worker pool because the WhatsApp path is unauthenticated.
 * The `personId` field carries `merchant.conversation.customer_id`.
 */

interface ConversationRow {
  id: string;
  merchant_id: string;
  person_id: string;
  status: string;
  summary: string | null;
  draft_cart: DraftCart | null;
}

// Durable columns off `merchant.conversation c`; the in-flight cart off
// `runtime.conversation_cart k` (LEFT JOIN so a thread with no cart maps cleanly).
const SELECT_FIELDS = `c.id::text            AS id,
  c.merchant_id::text  AS merchant_id,
  c.customer_id::text  AS person_id,
  c.status             AS status,
  c.summary            AS summary,
  k.cart               AS draft_cart`;

const FROM_JOIN = `FROM merchant.conversation c
  LEFT JOIN runtime.conversation_cart k ON k.conversation_id = c.id`;

function mapRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
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
   * A new conversation is a single INSERT into the durable `merchant.conversation`
   * thread — the `runtime.conversation_cart` row is created lazily on the first
   * cart write. Returns the joined record + total message count.
   */
  async getOrCreateConversation(
    merchantId: string,
    personId: string,
  ): Promise<{ conversation: ConversationRecord; messageCount: number }> {
    // There is no partial-unique on open conversations (a customer legitimately
    // has many closed ones + at most one open), so a plain SELECT-then-INSERT
    // races: two simultaneous inbound messages could each create a new open
    // conversation. A transaction-scoped advisory lock keyed on (merchant, customer)
    // makes the find-or-create atomic without a schema change.
    return this.pg.workerTx(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `conv:${merchantId}:${personId}`,
      ]);

      const existing = await client.query<ConversationRow>(
        `SELECT ${SELECT_FIELDS}
           ${FROM_JOIN}
          WHERE c.customer_id = $1
            AND c.merchant_id = $2
            AND c.status IN ('open', 'active', 'pending')
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT 1`,
        [personId, merchantId],
      );

      if (existing.rows[0]) {
        const conversation = mapRow(existing.rows[0]);
        const count = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM merchant.message WHERE conversation_id = $1`,
          [conversation.id],
        );
        return { conversation, messageCount: Number(count.rows[0]?.n ?? 0) };
      }

      const conv = await client.query<{ id: string }>(
        `INSERT INTO merchant.conversation
           (merchant_id, customer_id, channel_id, status, last_message_at)
         VALUES ($1, $2, (SELECT id FROM umi.channel_type WHERE key = 'whatsapp'), 'open', now())
         RETURNING id::text AS id`,
        [merchantId, personId],
      );
      const conversationId = conv.rows[0]?.id;
      if (!conversationId) {
        throw new Error('Failed to create conversation');
      }

      const created = await client.query<ConversationRow>(
        `SELECT ${SELECT_FIELDS} ${FROM_JOIN}
          WHERE c.id = $1 AND c.merchant_id = $2 LIMIT 1`,
        [conversationId, merchantId],
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
   * Read the location chosen for the in-flight order (worker pool). Lives on
   * `runtime.conversation_cart` — it is an attribute of the order being built, asked
   * at checkout and captured onto `customer_order` at confirmation.
   */
  async getSelectedLocationWorker(conversationId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ selected_location_id: string | null }>(
      `SELECT selected_location_id::text AS selected_location_id
         FROM runtime.conversation_cart WHERE conversation_id = $1`,
      [conversationId],
    );
    return rows[0]?.selected_location_id ?? null;
  }

  /** Persist the customer's chosen location for the in-flight order (worker pool).
   *  merchant_id is derived from the conversation, so callers pass only the location. */
  async setSelectedLocationWorker(
    conversationId: string,
    locationId: string | null,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.conversation_cart (conversation_id, merchant_id, selected_location_id)
       SELECT $1, cv.merchant_id, $2::uuid FROM merchant.conversation cv WHERE cv.id = $1
       ON CONFLICT (conversation_id) DO UPDATE
         SET selected_location_id = EXCLUDED.selected_location_id, updated_at = now()`,
      [conversationId, locationId],
    );
  }

  /**
   * Last-write-wins cart write (replaces the old CAS). Upserts the in-flight cart;
   * merchant_id is derived from the conversation. Pass `null` to clear the cart
   * (e.g. at confirmation, once it has materialized into a `customer_order`).
   */
  async setDraftCart(conversationId: string, draftCart: DraftCart | null): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.conversation_cart (conversation_id, merchant_id, cart)
       SELECT $1, cv.merchant_id, $2::jsonb FROM merchant.conversation cv WHERE cv.id = $1
       ON CONFLICT (conversation_id) DO UPDATE
         SET cart = EXCLUDED.cart, updated_at = now()`,
      [conversationId, draftCart != null ? JSON.stringify(draftCart) : null],
    );
  }

  async setSummary(conversationId: string, summary: string): Promise<void> {
    await this.pg.query(`UPDATE merchant.conversation SET summary = $2 WHERE id = $1`, [
      conversationId,
      summary,
    ]);
  }

  async touch(conversationId: string): Promise<void> {
    await this.pg.query(`UPDATE merchant.conversation SET last_message_at = now() WHERE id = $1`, [
      conversationId,
    ]);
  }
}
