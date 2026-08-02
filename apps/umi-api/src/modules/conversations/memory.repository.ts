import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Memory + semantic-search queries over `merchant.message` and `merchant.customer_fact`
 * (build-v3). Two rebinds from the old `comms.*` model:
 *   * semantic search: `comms.messages` → `merchant.message` (`role → sender`,
 *     `content → body`); the body embedding lives in `runtime.message_embedding`,
 *     joined at query time, and the person join moves to
 *     `merchant.conversation.customer_id`.
 *   * customer facts: the single `comms.customer_preferences.facts` jsonb blob is
 *     RE-GRAINED to atomic `merchant.customer_fact` rows (one row per fact key,
 *     `source='preferences'`), with typed `key` / `value` columns — no metadata
 *     junk-drawer. The public blob contract is preserved — reads reconstruct the
 *     object, and the write REPLACES the preference set (matching the old
 *     wholesale-overwrite upsert) atomically.
 *
 * The `personId` argument carries `merchant.customer.id` (build-v3). Worker pool,
 * explicit merchant predicates. The legacy `search_customer_messages` /
 * `search_similar_messages` RPCs are not on canonical, so cosine is direct here.
 */

/** Preference facts are stored one-per-row under this `customer_fact.source`. */
const PREFERENCES_SOURCE = 'preferences';

export interface SemanticRow {
  role: string;
  content: string;
  similarity: number;
  created_at: string | null;
  conversation_id: string | null;
}

@Injectable()
export class MemoryRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Customer facts, reconstructed from the atomic `merchant.customer_fact` rows
   * (`source='preferences'`) back into the blob shape the prompt builder expects.
   * Each row carries a typed `key` / `value jsonb`, so the object round-trips
   * exactly. Returns null when the customer has no preference facts.
   */
  async getCustomerFacts(
    merchantId: string,
    personId: string,
  ): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pg.query<{
      key: string;
      value: unknown;
    }>(
      `SELECT key, value
         FROM merchant.customer_fact
        WHERE customer_id = $1 AND merchant_id = $2 AND source = $3
        ORDER BY created_at`,
      [personId, merchantId, PREFERENCES_SOURCE],
    );
    if (rows.length === 0) return null;
    const facts: Record<string, unknown> = {};
    for (const row of rows) {
      facts[row.key] = row.value;
    }
    return facts;
  }

  /**
   * Customer-wide semantic search: cosine over every message belonging to this
   * customer, across conversations, excluding the most-recent `excludeRecent` in
   * the current conversation. Mirrors the legacy `search_customer_messages` RPC.
   */
  async searchCustomerMessages(params: {
    merchantId: string;
    personId: string;
    currentConversationId: string;
    embedding: number[];
    limit: number;
    excludeRecent: number;
    roles: string[];
  }): Promise<SemanticRow[]> {
    const { rows } = await this.pg.query<SemanticRow>(
      `WITH recent AS (
         SELECT id FROM merchant.message
          WHERE conversation_id = $3
          ORDER BY created_at DESC
          LIMIT $6
       )
       SELECT CASE m.sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                            WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(m.body, '') AS content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (me.embedding <=> $4::vector) AS similarity
         FROM merchant.message m
         JOIN merchant.conversation c ON c.id = m.conversation_id
         JOIN runtime.message_embedding me ON me.message_id = m.id
        WHERE c.customer_id = $2
          AND c.merchant_id = $1
          AND m.sender = ANY($5)
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY me.embedding <=> $4::vector
        LIMIT $7`,
      [
        params.merchantId,
        params.personId,
        params.currentConversationId,
        JSON.stringify(params.embedding),
        params.roles,
        params.excludeRecent,
        params.limit,
      ],
    );
    return rows;
  }

  /** Conversation-scoped semantic search (fallback). */
  async searchSimilarMessages(params: {
    conversationId: string;
    embedding: number[];
    limit: number;
    excludeRecent: number;
  }): Promise<SemanticRow[]> {
    const { rows } = await this.pg.query<SemanticRow>(
      `WITH recent AS (
         SELECT id FROM merchant.message
          WHERE conversation_id = $1
          ORDER BY created_at DESC
          LIMIT $3
       )
       SELECT CASE m.sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                            WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(m.body, '') AS content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (me.embedding <=> $2::vector) AS similarity
         FROM merchant.message m
         JOIN runtime.message_embedding me ON me.message_id = m.id
        WHERE m.conversation_id = $1
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY me.embedding <=> $2::vector
        LIMIT $4`,
      [params.conversationId, JSON.stringify(params.embedding), params.excludeRecent, params.limit],
    );
    return rows;
  }

  /**
   * Merge-write the customer facts: REPLACE the customer's `preferences` facts
   * with the incoming set (matching the old wholesale-overwrite upsert of
   * `comms.customer_preferences.facts`). Delete + re-insert runs in one worker
   * transaction so two concurrent extract-facts jobs can't interleave into a
   * partial set. Each fact key becomes one `merchant.customer_fact` row with typed
   * `key` / `value jsonb` — the unique `(merchant_id, customer_id, source, key)`
   * keeps a key single-valued.
   */
  async upsertCustomerFacts(
    merchantId: string,
    personId: string,
    facts: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.workerTx(async (client) => {
      await client.query(
        `DELETE FROM merchant.customer_fact
          WHERE merchant_id = $1 AND customer_id = $2 AND source = $3`,
        [merchantId, personId, PREFERENCES_SOURCE],
      );
      for (const [key, value] of Object.entries(facts)) {
        await client.query(
          `INSERT INTO merchant.customer_fact
             (merchant_id, customer_id, source, key, value)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [merchantId, personId, PREFERENCES_SOURCE, key, JSON.stringify(value ?? null)],
        );
      }
    });
  }
}
