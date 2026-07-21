import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { roleToSender } from './message-vocab';

/**
 * Queries for `tenant.message` (build-v2; was `comms.messages`). Column rebind:
 * `role → sender`, `content → body`, `embedding → body_embedding`. Reads that feed
 * the prompt still expose `{ role, content }` via aliases so callers stay put.
 *
 * Runs on the worker pool (unauthenticated WhatsApp path). Inserts use plain
 * `query` (autocommit) — NOT a transaction — so a unique-violation on a duplicate
 * MessageSid doesn't poison an open transaction; we detect SQLSTATE 23505 and
 * return the 'DUPLICATE' sentinel exactly like the edge function (FT-01).
 */

/** Sentinel returned when the insert hit the twilio_message_sid unique constraint. */
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
   * Insert a message (embedding NULL, filled async by enrichment). `message_index`
   * is the next per-conversation ordinal. Returns the new id, the `DUPLICATE`
   * sentinel if `twilioMessageSid` already exists, or null on any other failure.
   */
  async insertMessage(params: {
    tenantId: string;
    conversationId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    twilioMessageSid?: string | null;
    intent?: string | null;
  }): Promise<string | null> {
    try {
      const { rows } = await this.pg.query<{ id: string }>(
        `INSERT INTO tenant.message
           (business_id, conversation_id, sender, body, intent, twilio_message_sid, message_index)
         VALUES (
           $1, $2, $3, $4, $5, $6,
           (SELECT COALESCE(MAX(message_index) + 1, 0)
              FROM tenant.message WHERE conversation_id = $2)
         )
         RETURNING id`,
        [
          params.tenantId,
          params.conversationId,
          roleToSender(params.role),
          params.content,
          params.intent ?? null,
          params.twilioMessageSid ?? null,
        ],
      );
      return rows[0]?.id ?? null;
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      // Only the twilio_message_sid partial-unique signals a duplicate webhook.
      // (message_index has no unique index, so its MAX+1 allocation can't 23505 —
      // a concurrent insert at worst shares an index and ordering falls back to
      // created_at.) Narrowing here avoids masking an unrelated 23505 as a dup.
      if (e.code === '23505' && e.constraint === 'tenant_message_twilio_sid_uidx') {
        this.logger.log(`message_already_processed twilio_sid=${params.twilioMessageSid}`);
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

  /** Messages still lacking an embedding (embed.backfill). Tenant-scoped if given. */
  async listNeedingEmbedding(
    limit: number,
    tenantId?: string,
  ): Promise<Array<{ id: string; content: string }>> {
    const { rows } = await this.pg.query<{ id: string; content: string }>(
      `SELECT id::text, COALESCE(body, '') AS content
         FROM tenant.message
        WHERE body_embedding IS NULL
          AND body IS NOT NULL
          AND ($2::uuid IS NULL OR business_id = $2::uuid)
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

  /** RAG-02: persist a message embedding after async generation (enrichment). */
  async updateEmbedding(messageId: string, embedding: number[], model: string): Promise<void> {
    await this.pg.query(
      `UPDATE tenant.message
          SET body_embedding = $2::vector, embedding_model = $3
        WHERE id = $1`,
      [messageId, JSON.stringify(embedding), model],
    );
  }
}
