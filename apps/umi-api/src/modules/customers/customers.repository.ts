import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface CustomerListQuery {
  limit: number;
  search: string;
  filter: string;
  contactId: string;
  contactUuid: string;
  cursorTs: string | null;
  cursorId: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

/**
 * Customer 360 reads (build-v3). Merchant-scoped → umi_app pool via `withMerchant`
 * (RLS). build-v3 collapses the identity spine to two tables:
 *   * the row entity is `merchant.customer` (`c`); its per-channel reachability lives
 *     in `merchant.contact` (`contact.customer_id → customer.id`, inverted from the old
 *     `contact_id` link). Cards, conversations, orders and facts key on `customer_id = c.id`.
 *   * reachability (`normalized_phone`/`email`) is DERIVED from `merchant.contact`
 *     (+ `umi.channel_type` for the "kind" via `ch.key`), not cached columns; loyalty
 *     totals derive (visits=COUNT(visit), balance=SUM(card_ledger)); an order's total is
 *     the derived `merchant.order_total` view.
 *   * customer facts → `merchant.customer_fact` (the CDP "memory" atom, was the misnamed
 *     `customer_note`).
 *   * NO SOURCE in build-v3 (returned as 0/empty, like gift_card): merge candidates
 *     (`contact_merge_candidates` was a dead detector — dedup is `customer.merged_into_id`)
 *     and `data_quality_findings` (deferred to OTel). The admin conversation list's
 *     `current_state` is gone (the live FSM was deleted in the conversation convergence).
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * The platform customer list (one lateral-join rollup per customer). Keyset-paged
   * on the indexed `(last_activity_at, id)` — no OFFSET, and no COUNT: the frontend
   * pages with `nextCursor`, and `limit + 1` reveals whether more rows remain.
   */
  async listCustomers(
    merchantId: string,
    q: CustomerListQuery,
  ): Promise<{ rows: Row[]; nextCursor: { ts: string; id: string } | null }> {
    const like = `%${q.search}%`;
    return this.pg.withMerchant(async (c) => {
      const rows = (
        await c.query<Row>(
          `SELECT
             c.id::text,
             c.name AS display_name,
             phone_identity.normalized_value AS phone,
             email_identity.normalized_value AS email,
             c.created_at,
             c.updated_at,
             phone_identity.normalized_value AS normalized_phone,
             COALESCE(identities.items, '[]'::jsonb) AS identities,
             COALESCE(cash_summary.loyalty_count, 0)::int AS loyalty_count,
             COALESCE(cash_summary.total_visits, 0)::int AS total_visits,
             COALESCE(cash_summary.wallet_balance_cents, 0)::int AS wallet_balance_cents,
             COALESCE(cash_summary.gift_card_count, 0)::int AS gift_card_count,
             COALESCE(conversation_summary.conversation_count, 0)::int AS conversation_count,
             COALESCE(conversation_summary.active_conversations, 0)::int AS active_conversations,
             COALESCE(order_summary.orders_count, 0)::int AS orders_count,
             COALESCE(order_summary.total_spend_cents, 0)::int AS total_spend_cents,
             COALESCE(memory_summary.memory_count, 0)::int AS memory_count,
             0::int AS data_quality_count,
             COALESCE(merge_summary.merge_candidate_count, 0)::int AS merge_candidate_count,
             c.last_activity_at AS last_touch_at,
             c.last_activity_at::text AS activity_cursor
           FROM merchant.customer AS c
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM merchant.contact AS ci
             JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
             WHERE ci.merchant_id = c.merchant_id AND ci.customer_id = c.id
               AND ch.key IN ('phone', 'whatsapp')
               AND ci.normalized_value IS NOT NULL
             ORDER BY CASE WHEN ch.key = 'phone' THEN 0 ELSE 1 END, ci.created_at ASC
             LIMIT 1
           ) AS phone_identity ON true
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM merchant.contact AS ci
             JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
             WHERE ci.merchant_id = c.merchant_id AND ci.customer_id = c.id
               AND ch.key = 'email' AND ci.normalized_value IS NOT NULL
             ORDER BY ci.created_at ASC
             LIMIT 1
           ) AS email_identity ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', ci.id::text,
                 'identity_type', ch.key,
                 'identity_value', COALESCE(ci.raw_phone_number, ci.raw_value),
                 'normalized_value', ci.normalized_value,
                 'verification_status', CASE WHEN ci.verified THEN 'verified' ELSE 'unverified' END
               )
               ORDER BY ch.key, ci.created_at
             ) AS items
             FROM merchant.contact AS ci
             JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
             WHERE ci.merchant_id = c.merchant_id AND ci.customer_id = c.id
           ) AS identities ON true
           LEFT JOIN LATERAL (
             SELECT
               count(lc.id) AS loyalty_count,
               COALESCE((SELECT sum(v.stamps) FROM merchant.loyalty_visit v
                 WHERE v.merchant_id = c.merchant_id
                   AND v.card_id IN (SELECT id FROM merchant.loyalty_card WHERE merchant_id = c.merchant_id AND customer_id = c.id)), 0) AS total_visits,
               COALESCE((SELECT sum(l.delta) FROM merchant.loyalty_stored_value_ledger l
                 WHERE l.merchant_id = c.merchant_id
                   AND l.card_id IN (SELECT id FROM merchant.loyalty_card WHERE merchant_id = c.merchant_id AND customer_id = c.id)), 0) AS wallet_balance_cents,
               -- Intentionally 0: merchant.loyalty_gift_card has no customer FK (it links to a
               -- person only via recipient email/phone PII, or via redeemed_card_id
               -- once redeemed), so a per-customer active-gift-card count can't be
               -- derived off this card-keyed lateral without fuzzy PII matching —
               -- out of scope for the rename sweep. giftCards.active is card-balance
               -- driven; gift-card attribution is a follow-up (PR4 writers).
               0 AS gift_card_count,
               max(lc.updated_at) AS last_cash_at
             FROM merchant.loyalty_card AS lc
             WHERE lc.merchant_id = c.merchant_id AND lc.customer_id = c.id
           ) AS cash_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(cv.id) AS conversation_count,
               count(cv.id) FILTER (WHERE cv.status IN ('open', 'pending', 'active')) AS active_conversations,
               max(cv.last_message_at) AS last_conversation_at
             FROM merchant.conversation AS cv
             WHERE cv.merchant_id = c.merchant_id AND cv.customer_id = c.id
           ) AS conversation_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(o.id) AS orders_count,
               COALESCE(sum(ot.total), 0) AS total_spend_cents,
               max(o.created_at) AS last_order_at
             FROM merchant.customer_order AS o
             LEFT JOIN merchant.order_total AS ot ON ot.order_id = o.id
             WHERE o.merchant_id = c.merchant_id AND o.customer_id = c.id
           ) AS order_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(cn.id) AS memory_count, max(cn.updated_at) AS last_memory_at
             FROM merchant.customer_fact AS cn
             WHERE cn.merchant_id = c.merchant_id AND cn.customer_id = c.id
           ) AS memory_summary ON true
           LEFT JOIN LATERAL (
             -- No merge-candidate source in build-v3 (contact_merge_candidates was a dead
             -- detector; dedup is now customer.merged_into_id). 0, like gift_card/data_quality.
             SELECT 0 AS merge_candidate_count, NULL::timestamptz AS last_merge_at
           ) AS merge_summary ON true
           WHERE c.merchant_id = $1::uuid
             AND ($2 = '' OR c.id = $3::uuid)
             AND (
               $4 = ''
               OR ($4 = 'whatsapp' AND COALESCE(conversation_summary.conversation_count, 0) > 0)
               OR ($4 = 'cash' AND COALESCE(cash_summary.loyalty_count, 0) > 0)
               OR ($4 = 'memory' AND COALESCE(memory_summary.memory_count, 0) > 0)
               OR ($4 = 'review' AND COALESCE(merge_summary.merge_candidate_count, 0) > 0)
             )
             AND (
               $5 = ''
               OR c.name ILIKE $6
               OR phone_identity.normalized_value ILIKE $6
               OR email_identity.normalized_value ILIKE $6
             )
             AND (
               $8::timestamptz IS NULL
               OR (c.last_activity_at, c.id) < ($8::timestamptz, $9::uuid)
             )
           ORDER BY c.last_activity_at DESC, c.id DESC
           LIMIT $7`,
          [
            merchantId,
            q.contactId,
            q.contactUuid,
            q.filter,
            q.search,
            like,
            q.limit + 1,
            q.cursorTs,
            q.cursorId,
          ],
        )
      ).rows;

      const hasMore = rows.length > q.limit;
      const page = hasMore ? rows.slice(0, q.limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last ? { ts: String(last.activity_cursor), id: String(last.id) } : null;
      return { rows: page, nextCursor };
    });
  }

  /** A plain merchant-scoped count for the insights header (no laterals, no COUNT-over-rollup). */
  async countCustomers(merchantId: string): Promise<number> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM merchant.customer WHERE merchant_id = $1::uuid`,
        [merchantId],
      ),
    );
    return Number(rows[0]?.count ?? 0);
  }

  async timeline(merchantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        // WhatsApp messages are intentionally excluded: the full transcript now
        // lives in its own tab, so the Overview activity feed stays a summary of
        // orders and memory instead of flooding with every chat line.
        `SELECT * FROM (
           SELECT 'order' AS type, o.id::text AS id, o.created_at AS occurred_at, o.status AS label, o.id::text AS detail, 'orders' AS product
           FROM merchant.customer_order AS o
           WHERE o.customer_id = $1::uuid AND o.merchant_id = $2::uuid
           UNION ALL
           SELECT 'memory' AS type, cn.id::text AS id, cn.updated_at AS occurred_at, cn.source AS label, cn.key || ': ' || COALESCE(cn.value #>> '{}', cn.value::text) AS detail, 'conversaflow' AS product
           FROM merchant.customer_fact AS cn
           WHERE cn.customer_id = $1::uuid AND cn.merchant_id = $2::uuid
         ) AS timeline
         ORDER BY occurred_at DESC
         LIMIT 80`,
        [contactId, merchantId],
      ),
    );
    return rows;
  }

  async conversations(merchantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           cv.id::text,
           cv.status,
           cv.created_at AS opened_at,
           NULL::timestamptz AS closed_at,
           cv.last_message_at AS updated_at,
           NULL::jsonb AS metadata,
           count(m.id)::int AS "messageCount",
           max(m.created_at) AS "lastMessageAt"
         FROM merchant.conversation AS cv
         LEFT JOIN merchant.message AS m ON m.conversation_id = cv.id
         WHERE cv.customer_id = $1::uuid AND cv.merchant_id = $2::uuid
         GROUP BY cv.merchant_id, cv.id
         ORDER BY cv.last_message_at DESC NULLS LAST
         LIMIT 40`,
        [contactId, merchantId],
      ),
    );
    return rows;
  }

  /**
   * One conversation's message thread (the transcript), newest-first for keyset
   * paging. RLS: `merchant.message` is parent-scoped through `merchant.conversation`
   * (90_rls.sql: message → conversation via conversation_id), so the join to `cv`
   * both enforces merchant isolation and pins the thread to this customer. Ordered
   * by `occurred_at` (the real message time, not the ingest `created_at`) with `id`
   * as the keyset tiebreaker. `occurred_cursor` is Postgres's own full-precision
   * text render of `occurred_at`, so the cursor round-trips without millisecond
   * truncation dropping or repeating a boundary message.
   */
  async messages(
    merchantId: string,
    contactId: string,
    conversationId: string,
    cursor: { occurredAt: string; id: string } | null,
    limit: number,
  ): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           m.id::text,
           m.direction,
           m.sender,
           m.body,
           m.delivery_status,
           m.occurred_at,
           m.occurred_at::text AS occurred_cursor,
           m.created_at
         FROM merchant.message AS m
         JOIN merchant.conversation AS cv ON cv.id = m.conversation_id
         WHERE cv.id = $1::uuid
           AND cv.merchant_id = $2::uuid
           AND cv.customer_id = $3::uuid
           AND (
             $4::timestamptz IS NULL
             OR (m.occurred_at, m.id) < ($4::timestamptz, $5::uuid)
           )
         ORDER BY m.occurred_at DESC, m.id DESC
         LIMIT $6`,
        [
          conversationId,
          merchantId,
          contactId,
          cursor?.occurredAt ?? null,
          cursor?.id ?? null,
          limit,
        ],
      ),
    );
    return rows;
  }

  async orders(merchantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           o.id::text,
           o.id::text AS order_number,
           o.source AS source_product,
           o.status,
           o.source AS channel,
           ot.total AS total_cents,
           o.created_at AS placed_at,
           o.created_at,
           o.updated_at
         FROM merchant.customer_order AS o
         LEFT JOIN merchant.order_total AS ot ON ot.order_id = o.id
         WHERE o.customer_id = $1::uuid AND o.merchant_id = $2::uuid
         ORDER BY o.created_at DESC
         LIMIT 40`,
        [contactId, merchantId],
      ),
    );
    return rows;
  }

  async cash(merchantId: string, contactId: string): Promise<Row | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        // Loyalty state DERIVED (no account layer): the customer's active card +
        // balance=SUM(card_ledger), visits=COUNT(visit), cycle/pending vs the rule.
        `WITH vr AS (
           SELECT COALESCE((SELECT stamps_required FROM merchant.loyalty_reward
             WHERE merchant_id = $2::uuid AND active AND type = 'stamps_free_item'
             ORDER BY created_at DESC NULLS LAST LIMIT 1), 10) AS n
         )
         SELECT
           lc.customer_id::text AS "loyaltyAccountId",
           cu.loyalty_status    AS status,
           lc.id::text          AS "loyaltyCardId",
           lc.card_number,
           agg.balance_cents::int                        AS balance_cents,
           agg.total_visits::int                         AS total_visits,
           (agg.total_visits % vr.n)::int                AS visits_this_cycle,
           (agg.total_visits / vr.n - agg.redemptions)::int AS pending_rewards,
           lc.created_at,
           lc.updated_at
         FROM merchant.loyalty_card AS lc
         JOIN merchant.customer AS cu ON cu.merchant_id = lc.merchant_id AND cu.id = lc.customer_id
         CROSS JOIN vr
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COALESCE(sum(v.stamps), 0) FROM merchant.loyalty_visit v WHERE v.merchant_id = lc.merchant_id AND v.card_id = lc.id) AS total_visits,
             (SELECT count(*) FROM merchant.loyalty_redemption r WHERE r.merchant_id = lc.merchant_id AND r.card_id = lc.id) AS redemptions,
             COALESCE((SELECT sum(l.delta) FROM merchant.loyalty_stored_value_ledger l WHERE l.merchant_id = lc.merchant_id AND l.card_id = lc.id), 0) AS balance_cents
         ) AS agg
         WHERE lc.customer_id = $1::uuid AND lc.merchant_id = $2::uuid
         ORDER BY lc.created_at DESC
         LIMIT 1`,
        [contactId, merchantId],
      ),
    );
    return rows[0] ?? null;
  }

  /** Merchant-wide conversation list (admin view). */
  async conversationsList(
    merchantId: string,
    limit: number,
    skip: number,
  ): Promise<{ rows: Row[]; total: number }> {
    return this.pg.withMerchant(async (c) => {
      const rows = (
        await c.query<Row>(
          // current_state MOVED to the sealed runtime.conversation_state (not
          // readable on the umi_app pool) — dropped from this owner list; the
          // durable summary + thread attributes remain. customerName from
          // merchant.customer, customerPhone from the identity spine.
          `SELECT
             c.id::text,
             c.status,
             NULL::text AS "currentState",
             c.summary AS summary,
             c.created_at AS "createdAt",
             co.name AS "customerName",
             ph.normalized_value AS "customerPhone",
             count(m.id)::int AS "messageCount",
             max(m.created_at) AS "lastMessageAt"
           FROM merchant.conversation AS c
           LEFT JOIN merchant.customer AS co ON co.merchant_id = c.merchant_id AND co.id = c.customer_id
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM merchant.contact AS ci
             JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
             WHERE ci.merchant_id = co.merchant_id AND ci.customer_id = co.id
               AND ch.key IN ('phone', 'whatsapp') AND ci.normalized_value IS NOT NULL
             ORDER BY ci.is_primary DESC, ci.updated_at DESC LIMIT 1
           ) AS ph ON true
           LEFT JOIN merchant.message AS m ON m.conversation_id = c.id
           WHERE c.merchant_id = $1::uuid
           GROUP BY c.merchant_id, c.id, co.merchant_id, co.id, ph.normalized_value
           ORDER BY COALESCE(max(m.created_at), c.created_at) DESC
           OFFSET $2 LIMIT $3`,
          [merchantId, skip, limit],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS total FROM merchant.conversation WHERE merchant_id = $1::uuid`,
          [merchantId],
        )
      ).rows[0]?.total;
      return { rows, total: Number(total ?? 0) };
    });
  }

  /**
   * The triage queue: open conversations whose most recent message is from the
   * customer — i.e. the customer is waiting on a reply. The AI's own escalation
   * state lives in the sealed `runtime.conversation_state` (not readable on the
   * umi_app pool), so "needs attention" is derived from readable signals only.
   * Oldest-waiting first, because that is the most overdue. RLS scopes every table.
   */
  async triage(merchantId: string, limit: number): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           cv.id::text,
           cv.customer_id::text AS customer_id,
           co.name AS customer_name,
           ph.normalized_value AS customer_phone,
           cv.status,
           cv.summary,
           last.sender AS last_sender,
           last.body AS last_message,
           last.occurred_at AS waiting_since
         FROM merchant.conversation AS cv
         JOIN merchant.customer AS co ON co.merchant_id = cv.merchant_id AND co.id = cv.customer_id
         LEFT JOIN LATERAL (
           SELECT m.sender, m.body, m.occurred_at
           FROM merchant.message AS m
           WHERE m.conversation_id = cv.id
           ORDER BY m.occurred_at DESC, m.id DESC
           LIMIT 1
         ) AS last ON true
         LEFT JOIN LATERAL (
           SELECT ci.normalized_value
           FROM merchant.contact AS ci
           JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
           WHERE ci.merchant_id = co.merchant_id AND ci.customer_id = co.id
             AND ch.key IN ('phone', 'whatsapp') AND ci.normalized_value IS NOT NULL
           ORDER BY ci.is_primary DESC, ci.updated_at DESC
           LIMIT 1
         ) AS ph ON true
         WHERE cv.merchant_id = $1::uuid
           AND cv.status = 'open'
           AND last.sender = 'customer'
         ORDER BY last.occurred_at ASC
         LIMIT $2`,
        [merchantId, limit],
      ),
    );
    return rows;
  }

  async identity(
    merchantId: string,
    contactId: string,
  ): Promise<{ identities: Row[]; candidates: Row[]; findings: Row[] }> {
    return this.pg.withMerchant(async (c) => {
      // Reachability rows for the customer's contacts (per-channel). `kind` recovered
      // from the global channel catalog; the string verification contract is preserved.
      const identities = await c.query<Row>(
        `SELECT ci.id::text, ch.key AS identity_type,
                COALESCE(ci.raw_phone_number, ci.raw_value) AS identity_value,
                ci.normalized_value,
                CASE WHEN ci.verified THEN 'verified' ELSE 'unverified' END AS verification_status,
                NULL::jsonb AS metadata, ci.created_at
         FROM merchant.contact AS ci
         JOIN umi.channel_type AS ch ON ch.id = ci.channel_id
         JOIN merchant.customer AS cu ON cu.merchant_id = ci.merchant_id AND cu.id = ci.customer_id
         WHERE cu.id = $1::uuid AND ci.merchant_id = $2::uuid
         ORDER BY ch.key, ci.created_at`,
        [contactId, merchantId],
      );
      return {
        identities: identities.rows,
        // Merge candidates + data-quality findings have no build-v3 source yet (dedup is
        // customer.merged_into_id; findings deferred to OTel) — empty, like gift_card.
        candidates: [],
        findings: [],
      };
    });
  }
}
