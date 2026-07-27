import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { roleToSender } from './message-vocab';

/**
 * Queries for `tenant.message` (build-v3; was `comms.messages`). Column rebind:
 * `role → sender`, `content → body`. The message has NO business_id — it scopes to
 * the tenant via its `conversation`; body embeddings live in a sibling
 * `runtime.message_embedding` row, not on the message. Reads that feed the prompt
 * still expose `{ role, content }` via aliases so callers stay put.
 *
 * Runs on the worker pool (unauthenticated WhatsApp path). The insert uses plain
 * `query` (autocommit) — NOT a transaction — so a unique-violation on a duplicate
 * provider_message_id doesn't poison an open transaction; we detect SQLSTATE 23505
 * and return the 'DUPLICATE' sentinel exactly like the edge function (FT-01).
 */

/** Sentinel returned when the insert hit the provider_message_id unique constraint. */
export const DUPLICATE_MESSAGE = 'DUPLICATE';

export interface RecentMessage {
  role: string;
  content: string;
}

@Injectable()
export class MessagesRepository {
  private readonly logger = new Logger(MessagesRepository.name);

  constructor(private readonly pg: PgService) {}

  /**
   * Insert a message (embedding filled async by enrichment). Ordering is by
   * `created_at` — there is no `message_index`. Returns the new id, the `DUPLICATE`
   * sentinel if `providerMessageId` was already ingested, or null on any other failure.
   */
  async insertMessage(params: {
    tenantId: string; // accepted for call-site symmetry; the message scopes via conversation
    conversationId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    providerMessageId?: string | null;
  }): Promise<string | null> {
    try {
      const { rows } = await this.pg.query<{ id: string }>(
        `INSERT INTO tenant.message
           (conversation_id, sender, body, provider_message_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          params.conversationId,
          roleToSender(params.role),
          params.content,
          params.providerMessageId ?? null,
        ],
      );
      return rows[0]?.id ?? null;
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      // The provider_message_id partial-unique signals a re-delivered webhook.
      if (e.code === '23505' && e.constraint === 'message_provider_message_id_uidx') {
        this.logger.log(
          `message_already_processed provider_message_id=${params.providerMessageId}`,
        );
        return DUPLICATE_MESSAGE;
      }
      this.logger.error(
        `insert_message_error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Recent messages, newest first (the caller reverses to chronological order). */
  async getRecentMessages(conversationId: string, limit: number): Promise<RecentMessage[]> {
    const { rows } = await this.pg.query<RecentMessage>(
      `SELECT CASE sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                          WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(body, '') AS content
         FROM tenant.message
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [conversationId, limit],
    );
    return rows;
  }

  /** Older messages beyond the recent window (for rolling summaries). Newest-first. */
  async getOlderMessages(
    conversationId: string,
    skip: number,
    take: number,
  ): Promise<RecentMessage[]> {
    const { rows } = await this.pg.query<RecentMessage>(
      `SELECT CASE sender WHEN 'customer' THEN 'user' WHEN 'bot' THEN 'assistant'
                          WHEN 'staff' THEN 'assistant' ELSE 'system' END AS role,
              COALESCE(body, '') AS content
         FROM tenant.message
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        OFFSET $2 LIMIT $3`,
      [conversationId, skip, take],
    );
    return rows;
  }

  /** Messages with no embedding row yet (embed.backfill). Tenant-scoped if given. */
  async listNeedingEmbedding(
    limit: number,
    tenantId?: string,
  ): Promise<Array<{ id: string; content: string }>> {
    const { rows } = await this.pg.query<{ id: string; content: string }>(
      `SELECT m.id::text, COALESCE(m.body, '') AS content
         FROM tenant.message m
         JOIN tenant.conversation c ON c.id = m.conversation_id
    LEFT JOIN runtime.message_embedding me ON me.message_id = m.id
        WHERE me.message_id IS NULL
          AND m.body IS NOT NULL
          AND ($2::uuid IS NULL OR c.business_id = $2::uuid)
        LIMIT $1`,
      [limit, tenantId ?? null],
    );
    return rows;
  }

  async countMessages(conversationId: string): Promise<number> {
    const { rows } = await this.pg.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tenant.message WHERE conversation_id = $1`,
      [conversationId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /** RAG-02: persist a message embedding after async generation (enrichment).
   *  Embeddings are a sibling row in runtime.message_embedding, upserted per message. */
  async updateEmbedding(messageId: string, embedding: number[], model: string): Promise<void> {
    await this.pg.query(
      `INSERT INTO runtime.message_embedding (message_id, embedding, model)
       VALUES ($1, $2::vector, $3)
       ON CONFLICT (message_id) DO UPDATE
         SET embedding = EXCLUDED.embedding, model = EXCLUDED.model`,
      [messageId, JSON.stringify(embedding), model],
    );
  }
}
