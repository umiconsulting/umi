import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Memory + semantic-search queries over `comms.messages` and
 * `comms.customer_preferences` (canonical, preflight §2). The legacy
 * `search_customer_messages` / `search_similar_messages` RPCs are NOT guaranteed
 * on canonical, so semantic search is direct pgvector cosine here (the "direct
 * SQL where no RPC" rule). Worker pool, explicit tenant predicates.
 */

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

  /** Customer facts blob (`comms.customer_preferences.facts`). */
  async getCustomerFacts(
    tenantId: string,
    personId: string,
  ): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pg.query<{ facts: Record<string, unknown> | null }>(
      `SELECT facts
         FROM comms.customer_preferences
        WHERE person_id = $1 AND tenant_id = $2`,
      [personId, tenantId],
    );
    return rows[0]?.facts ?? null;
  }

  /**
   * Customer-wide semantic search: cosine over every message belonging to this
   * person, across conversations, excluding the most-recent `excludeRecent` in
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
         SELECT id FROM comms.messages
          WHERE conversation_id = $3
          ORDER BY created_at DESC
          LIMIT $6
       )
       SELECT m.role,
              m.content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (m.embedding <=> $4::vector) AS similarity
         FROM comms.messages m
         JOIN comms.conversations c ON c.id = m.conversation_id
        WHERE c.person_id = $2
          AND m.tenant_id = $1
          AND m.embedding IS NOT NULL
          AND m.role = ANY($5)
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY m.embedding <=> $4::vector
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
         SELECT id FROM comms.messages
          WHERE conversation_id = $1
          ORDER BY created_at DESC
          LIMIT $3
       )
       SELECT m.role,
              m.content,
              m.created_at,
              m.conversation_id::text AS conversation_id,
              1 - (m.embedding <=> $2::vector) AS similarity
         FROM comms.messages m
        WHERE m.conversation_id = $1
          AND m.embedding IS NOT NULL
          AND m.id NOT IN (SELECT id FROM recent)
        ORDER BY m.embedding <=> $2::vector
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
   * Merge-write the customer facts blob via a single atomic upsert on the
   * `customer_preferences_tenant_id_person_id_key` UNIQUE(tenant_id, person_id),
   * so two concurrent extract-facts jobs can't race a read-then-insert into
   * duplicate/conflicting rows. Used by extract-facts enrichment.
   */
  async upsertCustomerFacts(
    tenantId: string,
    personId: string,
    facts: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO comms.customer_preferences (tenant_id, person_id, facts)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, person_id)
         DO UPDATE SET facts = EXCLUDED.facts, updated_at = now()`,
      [tenantId, personId, JSON.stringify(facts)],
    );
  }
}
