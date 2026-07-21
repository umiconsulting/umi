import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Memory + semantic-search queries over `tenant.message` and `tenant.customer_note`
 * (build-v2). Two rebinds from the old `comms.*` model:
 *   * semantic search: `comms.messages` → `tenant.message` (`role → sender`,
 *     `content → body`, `embedding → body_embedding`); the person join moves to
 *     `tenant.conversation.customer_id`.
 *   * customer facts: the single `comms.customer_preferences.facts` jsonb blob is
 *     RE-GRAINED to atomic `tenant.customer_note` rows (one row per fact key,
 *     `source='preferences'`). The public blob contract is preserved — reads
 *     reconstruct the object, and the write REPLACES the preference set (matching
 *     the old wholesale-overwrite upsert) atomically.
 *
 * The `personId` argument carries `tenant.customer.id` (build-v2). Worker pool,
 * explicit tenant predicates. The legacy `search_customer_messages` /
 * `search_similar_messages` RPCs are not on canonical, so cosine is direct here.
 */

/** Preference facts are stored one-per-row under this `customer_note.source`. */
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
   * Customer facts, reconstructed from the atomic `tenant.customer_note` rows
   * (`source='preferences'`) back into the blob shape the prompt builder expects.
   * Each note carries its original `{key, value}` in `metadata`, so the object
   * round-trips exactly. Returns null when the customer has no preference notes.
   */
  async getCustomerFacts(
    tenantId: string,
    personId: string,
  ): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pg.query<{
      key: string | null;
      value: unknown;
    }>(
      `SELECT metadata->>'key' AS key, metadata->'value' AS value
         FROM tenant.customer_note
        WHERE customer_id = $1 AND business_id = $2 AND source = $3
        ORDER BY created_at`,
      [personId, tenantId, PREFERENCES_SOURCE],
    );
    if (rows.length === 0) return null;
    const facts: Record<string, unknown> = {};
    for (const row of rows) {
      if (row.key != null) facts[row.key] = row.value;
    }
    return facts;
  }

  /**
   * Customer-wide semantic search: cosine over every message belonging to this
   * customer, across conversations, excluding the most-recent `excludeRecent` in
   * the current conversation. Mirrors the legacy `search_customer_messages` RPC.
   */
  async searchCustomerMessages(params: {
    tenantId: string;
    personId: string;
    currentConversationId: string;
    embedding: number[];
    limit: number;
    excludeRecent: number;
    roles: string[];
  }): Promise<SemanticRow[]> {
    const { rows } = await this.pg.query<SemanticRow>(
      `WITH recent AS (
         SELECT id FROM tenant.message
          WHERE conversation_id = $3
          ORDER BY created_at DESC
          LIMIT $6
       )
       SELECT CASE m.sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                            WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(m.body, '') AS content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (m.body_embedding <=> $4::vector) AS similarity
         FROM tenant.message m
         JOIN tenant.conversation c ON c.id = m.conversation_id
        WHERE c.customer_id = $2
          AND m.business_id = $1
          AND m.body_embedding IS NOT NULL
          AND m.sender = ANY($5)
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY m.body_embedding <=> $4::vector
        LIMIT $7`,
      [
        params.tenantId,
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
         SELECT id FROM tenant.message
          WHERE conversation_id = $1
          ORDER BY created_at DESC
          LIMIT $3
       )
       SELECT CASE m.sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                            WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(m.body, '') AS content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (m.body_embedding <=> $2::vector) AS similarity
         FROM tenant.message m
        WHERE m.conversation_id = $1
          AND m.body_embedding IS NOT NULL
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY m.body_embedding <=> $2::vector
        LIMIT $4`,
      [
        params.conversationId,
        JSON.stringify(params.embedding),
        params.excludeRecent,
        params.limit,
      ],
    );
    return rows;
  }

  /**
   * Merge-write the customer facts: REPLACE the customer's `preferences` notes
   * with the incoming set (matching the old wholesale-overwrite upsert of
   * `comms.customer_preferences.facts`). Delete + re-insert runs in one worker
   * transaction so two concurrent extract-facts jobs can't interleave into a
   * partial set. Each fact key becomes one `tenant.customer_note` row, with the
   * original `{key, value}` preserved in `metadata` for an exact round-trip.
   */
  async upsertCustomerFacts(
    tenantId: string,
    personId: string,
    facts: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.workerTx(async (client) => {
      await client.query(
        `DELETE FROM tenant.customer_note
          WHERE business_id = $1 AND customer_id = $2 AND source = $3`,
        [tenantId, personId, PREFERENCES_SOURCE],
      );
      for (const [key, value] of Object.entries(facts)) {
        const valueText =
          typeof value === 'string' ? value : JSON.stringify(value);
        await client.query(
          `INSERT INTO tenant.customer_note
             (business_id, customer_id, fact, source, metadata)
           VALUES ($1, $2, $3, $4, jsonb_build_object('key', $5::text, 'value', $6::jsonb))`,
          [
            tenantId,
            personId,
            `${key}: ${valueText}`,
            PREFERENCES_SOURCE,
            key,
            JSON.stringify(value ?? null),
          ],
        );
      }
    });
  }
}
