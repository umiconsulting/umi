import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface CustomerListQuery {
  page: number;
  limit: number;
  search: string;
  filter: string;
  contactId: string;
  contactUuid: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

/**
 * Customer 360 reads (build-v2). Tenant-scoped → umi_app pool via `withTenant`
 * (RLS). The 9-schema identity graph collapses:
 *   * the row entity is `tenant.customer` (`c`); its `contact_id` anchors the
 *     identity spine (`tenant.contact` / `tenant.contact_identity`), while cards,
 *     conversations, orders and notes key on `customer_id = c.id`.
 *   * reachability (`normalized_phone`/`email`) is DERIVED from
 *     `tenant.contact_identity` (+ `tenant.channel` for the "kind"), not cached
 *     columns; loyalty totals derive (visits=COUNT(visit), balance=SUM(card_ledger)).
 *   * `comms.memory_items` → `tenant.customer_note`; `core.contact_merge_candidates`
 *     → `tenant.contact_identity` probabilistic matches (`match_type='probabilistic'`)
 *     + `tenant.contact.merge_state`.
 *   * DROPPED: `observability.data_quality_findings` (not in build-v2 — deferred to
 *     OTel — and observability is sealed from umi_app); the admin conversation
 *     list's `current_state` (moved to the sealed `runtime.conversation_state`).
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly pg: PgService) {}

  /** The platform customer list (one lateral-join rollup per customer). */
  async listCustomers(
    tenantId: string,
    q: CustomerListQuery,
  ): Promise<{ rows: Row[]; total: number }> {
    const like = `%${q.search}%`;
    const skip = (q.page - 1) * q.limit;
    return this.pg.withTenant(async (c) => {
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
             last_touch.last_touch_at
           FROM tenant.customer AS c
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = c.contact_id
               AND ch.key IN ('phone', 'whatsapp')
               AND ci.normalized_value IS NOT NULL
             ORDER BY CASE WHEN ch.key = 'phone' THEN 0 ELSE 1 END, ci.first_seen_at ASC
             LIMIT 1
           ) AS phone_identity ON true
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = c.contact_id
               AND ch.key = 'email' AND ci.normalized_value IS NOT NULL
             ORDER BY ci.first_seen_at ASC
             LIMIT 1
           ) AS email_identity ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', ci.id::text,
                 'identity_type', ch.key,
                 'identity_value', ci.display_value,
                 'normalized_value', ci.normalized_value,
                 'verification_status', CASE WHEN ci.verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END
               )
               ORDER BY ch.key, ci.first_seen_at
             ) AS items
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = c.contact_id
           ) AS identities ON true
           LEFT JOIN LATERAL (
             SELECT
               count(lc.id) AS loyalty_count,
               COALESCE((SELECT count(*) FROM tenant.loyalty_visit v
                 WHERE v.tenant_id = c.tenant_id
                   AND v.card_id IN (SELECT id FROM tenant.loyalty_card WHERE tenant_id = c.tenant_id AND customer_id = c.id)), 0) AS total_visits,
               COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l
                 WHERE l.tenant_id = c.tenant_id
                   AND l.card_id IN (SELECT id FROM tenant.loyalty_card WHERE tenant_id = c.tenant_id AND customer_id = c.id)), 0) AS wallet_balance_cents,
               -- Intentionally 0: tenant.loyalty_gift_card has no customer FK (it links to a
               -- person only via recipient email/phone PII, or via redeemed_card_id
               -- once redeemed), so a per-customer active-gift-card count can't be
               -- derived off this card-keyed lateral without fuzzy PII matching —
               -- out of scope for the rename sweep. giftCards.active is card-balance
               -- driven; gift-card attribution is a follow-up (PR4 writers).
               0 AS gift_card_count,
               max(lc.updated_at) AS last_cash_at
             FROM tenant.loyalty_card AS lc
             WHERE lc.tenant_id = c.tenant_id AND lc.customer_id = c.id
           ) AS cash_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(cv.id) AS conversation_count,
               count(cv.id) FILTER (WHERE cv.status IN ('open', 'pending', 'active')) AS active_conversations,
               max(cv.last_message_at) AS last_conversation_at
             FROM tenant.conversation AS cv
             WHERE cv.tenant_id = c.tenant_id AND cv.customer_id = c.id
           ) AS conversation_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(o.id) AS orders_count,
               COALESCE(sum(o.total_cents), 0) AS total_spend_cents,
               max(COALESCE(o.placed_at, o.created_at)) AS last_order_at
             FROM tenant."order" AS o
             WHERE o.tenant_id = c.tenant_id AND o.customer_id = c.id
           ) AS order_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(cn.id) AS memory_count, max(cn.updated_at) AS last_memory_at
             FROM tenant.customer_note AS cn
             WHERE cn.tenant_id = c.tenant_id AND cn.customer_id = c.id
           ) AS memory_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(mc.id) AS merge_candidate_count, max(mc.first_seen_at) AS last_merge_at
             FROM tenant.contact_identity AS mc
             WHERE mc.tenant_id = c.tenant_id AND mc.contact_id = c.contact_id
               AND mc.match_type = 'probabilistic'
           ) AS merge_summary ON true
           LEFT JOIN LATERAL (
             SELECT max(ts) AS last_touch_at
             FROM (VALUES
               (c.updated_at),
               (cash_summary.last_cash_at),
               (conversation_summary.last_conversation_at),
               (order_summary.last_order_at),
               (memory_summary.last_memory_at),
               (merge_summary.last_merge_at)
             ) AS touch(ts)
           ) AS last_touch ON true
           WHERE c.tenant_id = $1::uuid
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
           ORDER BY last_touch.last_touch_at DESC NULLS LAST, c.created_at DESC
           LIMIT $7 OFFSET $8`,
          [tenantId, q.contactId, q.contactUuid, q.filter, q.search, like, q.limit, skip],
        )
      ).rows;

      const total = (
        await c.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM tenant.customer AS c
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = c.contact_id
               AND ch.key IN ('phone', 'whatsapp')
               AND ci.normalized_value IS NOT NULL
             LIMIT 1
           ) AS phone_identity ON true
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = c.contact_id
               AND ch.key = 'email' AND ci.normalized_value IS NOT NULL
             LIMIT 1
           ) AS email_identity ON true
           WHERE c.tenant_id = $1::uuid
             AND ($2 = '' OR c.id = $3::uuid)
             AND (
               $4 = ''
               OR ($4 = 'whatsapp' AND EXISTS (SELECT 1 FROM tenant.conversation AS cv WHERE cv.tenant_id = c.tenant_id AND cv.customer_id = c.id))
               OR ($4 = 'cash' AND EXISTS (SELECT 1 FROM tenant.loyalty_card AS ca WHERE ca.tenant_id = c.tenant_id AND ca.customer_id = c.id))
               OR ($4 = 'memory' AND EXISTS (SELECT 1 FROM tenant.customer_note AS cn WHERE cn.tenant_id = c.tenant_id AND cn.customer_id = c.id))
               OR ($4 = 'review' AND EXISTS (SELECT 1 FROM tenant.contact_identity AS mc WHERE mc.tenant_id = c.tenant_id AND mc.contact_id = c.contact_id AND mc.match_type = 'probabilistic'))
             )
             AND (
               $5 = ''
               OR c.name ILIKE $6
               OR phone_identity.normalized_value ILIKE $6
               OR email_identity.normalized_value ILIKE $6
             )`,
          [tenantId, q.contactId, q.contactUuid, q.filter, q.search, like],
        )
      ).rows[0]?.count;

      return { rows, total: Number(total ?? rows.length) };
    });
  }

  async timeline(tenantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT * FROM (
           SELECT 'whatsapp_message' AS type, m.id::text AS id, m.created_at AS occurred_at, m.sender AS label, COALESCE(m.body, '') AS detail, 'conversaflow' AS product
           FROM tenant.message AS m
           JOIN tenant.conversation AS cv ON cv.id = m.conversation_id
           WHERE cv.customer_id = $1::uuid AND m.tenant_id = $2::uuid
           UNION ALL
           SELECT 'order' AS type, o.id::text AS id, COALESCE(o.placed_at, o.created_at) AS occurred_at, o.status AS label, COALESCE(o.source_transaction_id, o.id::text) AS detail, 'orders' AS product
           FROM tenant."order" AS o
           WHERE o.customer_id = $1::uuid AND o.tenant_id = $2::uuid
           UNION ALL
           SELECT 'memory' AS type, cn.id::text AS id, cn.updated_at AS occurred_at, COALESCE(cn.source, 'note') AS label, COALESCE(cn.fact, '') AS detail, 'conversaflow' AS product
           FROM tenant.customer_note AS cn
           WHERE cn.customer_id = $1::uuid AND cn.tenant_id = $2::uuid
         ) AS timeline
         ORDER BY occurred_at DESC
         LIMIT 80`,
        [contactId, tenantId],
      ),
    );
    return rows;
  }

  async conversations(tenantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT
           cv.id::text,
           cv.status,
           cv.created_at AS opened_at,
           NULL::timestamptz AS closed_at,
           cv.last_message_at AS updated_at,
           cv.metadata,
           count(m.id)::int AS "messageCount",
           max(m.created_at) AS "lastMessageAt"
         FROM tenant.conversation AS cv
         LEFT JOIN tenant.message AS m ON m.conversation_id = cv.id
         WHERE cv.customer_id = $1::uuid AND cv.tenant_id = $2::uuid
         GROUP BY cv.tenant_id, cv.id
         ORDER BY cv.last_message_at DESC NULLS LAST
         LIMIT 40`,
        [contactId, tenantId],
      ),
    );
    return rows;
  }

  async orders(tenantId: string, contactId: string): Promise<Row[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT
           o.id::text,
           o.source_transaction_id AS order_number,
           o.order_type AS source_product,
           o.status,
           ch.key AS channel,
           o.total_cents,
           o.placed_at,
           o.created_at,
           o.updated_at
         FROM tenant."order" AS o
         LEFT JOIN tenant.channel AS ch ON ch.id = o.channel_id
         WHERE o.customer_id = $1::uuid AND o.tenant_id = $2::uuid
         ORDER BY COALESCE(o.placed_at, o.created_at) DESC
         LIMIT 40`,
        [contactId, tenantId],
      ),
    );
    return rows;
  }

  async cash(tenantId: string, contactId: string): Promise<Row | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        // Loyalty state DERIVED (no account layer): the customer's active card +
        // balance=SUM(card_ledger), visits=COUNT(visit), cycle/pending vs the rule.
        `WITH vr AS (
           SELECT COALESCE((SELECT visits_required FROM tenant.loyalty_reward
             WHERE tenant_id = $2::uuid AND is_active
             ORDER BY activated_at DESC NULLS LAST LIMIT 1), 10) AS n
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
         FROM tenant.loyalty_card AS lc
         JOIN tenant.customer AS cu ON cu.tenant_id = lc.tenant_id AND cu.id = lc.customer_id
         CROSS JOIN vr
         CROSS JOIN LATERAL (
           SELECT
             (SELECT count(*) FROM tenant.loyalty_visit v WHERE v.tenant_id = lc.tenant_id AND v.card_id = lc.id) AS total_visits,
             (SELECT count(*) FROM tenant.loyalty_redemption r WHERE r.tenant_id = lc.tenant_id AND r.card_id = lc.id) AS redemptions,
             COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l WHERE l.tenant_id = lc.tenant_id AND l.card_id = lc.id), 0) AS balance_cents
         ) AS agg
         WHERE lc.customer_id = $1::uuid AND lc.tenant_id = $2::uuid
         ORDER BY lc.created_at DESC
         LIMIT 1`,
        [contactId, tenantId],
      ),
    );
    return rows[0] ?? null;
  }

  /** Tenant-wide conversation list (admin view). */
  async conversationsList(
    tenantId: string,
    limit: number,
    skip: number,
  ): Promise<{ rows: Row[]; total: number }> {
    return this.pg.withTenant(async (c) => {
      const rows = (
        await c.query<Row>(
          // current_state MOVED to the sealed runtime.conversation_state (not
          // readable on the umi_app pool) — dropped from this owner list; the
          // durable summary + thread attributes remain. customerName from
          // tenant.customer, customerPhone from the identity spine.
          `SELECT
             c.id::text,
             c.status,
             NULL::text AS "currentState",
             COALESCE(c.summary, c.metadata->>'summary') AS summary,
             c.created_at AS "createdAt",
             co.name AS "customerName",
             ph.normalized_value AS "customerPhone",
             count(m.id)::int AS "messageCount",
             max(m.created_at) AS "lastMessageAt"
           FROM tenant.conversation AS c
           LEFT JOIN tenant.customer AS co ON co.tenant_id = c.tenant_id AND co.id = c.customer_id
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM tenant.contact_identity AS ci
             JOIN tenant.channel AS ch ON ch.id = ci.channel_id
             WHERE ci.tenant_id = co.tenant_id AND ci.contact_id = co.contact_id
               AND ch.normalization_rule = 'e164' AND ci.normalized_value IS NOT NULL
             ORDER BY ci.is_primary DESC, ci.last_seen_at DESC LIMIT 1
           ) AS ph ON true
           LEFT JOIN tenant.message AS m ON m.conversation_id = c.id
           WHERE c.tenant_id = $1::uuid
           GROUP BY c.tenant_id, c.id, co.tenant_id, co.id, ph.normalized_value
           ORDER BY COALESCE(max(m.created_at), c.created_at) DESC
           OFFSET $2 LIMIT $3`,
          [tenantId, skip, limit],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS total FROM tenant.conversation WHERE tenant_id = $1::uuid`,
          [tenantId],
        )
      ).rows[0]?.total;
      return { rows, total: Number(total ?? 0) };
    });
  }

  async identity(
    tenantId: string,
    contactId: string,
  ): Promise<{ identities: Row[]; candidates: Row[]; findings: Row[] }> {
    return this.pg.withTenant(async (c) => {
      const [identities, candidates] = await Promise.all([
        c.query<Row>(
          // Reachability rows for the customer's contact. `kind` recovered from
          // the global channel catalog. String verification contract preserved.
          `SELECT ci.id::text, ch.key AS identity_type, ci.display_value AS identity_value,
                  ci.normalized_value,
                  CASE WHEN ci.verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END AS verification_status,
                  ci.metadata, ci.first_seen_at AS created_at
           FROM tenant.contact_identity AS ci
           JOIN tenant.channel AS ch ON ch.id = ci.channel_id
           JOIN tenant.customer AS cu ON cu.tenant_id = ci.tenant_id AND cu.contact_id = ci.contact_id
           WHERE cu.id = $1::uuid AND ci.tenant_id = $2::uuid
           ORDER BY ch.key, ci.first_seen_at`,
          [contactId, tenantId],
        ),
        c.query<Row>(
          // Merge candidates: the contact's PROBABILISTIC identities (the folded
          // contact_merge_candidates signal). No left/right person pairs any more —
          // the merge model is per-contact (contact.merge_state) + soft matches.
          `SELECT ci.id::text, NULL::text AS left_person_id, NULL::text AS right_person_id,
                  ci.match_type, ci.confidence, ci.metadata AS detail,
                  ci.first_seen_at AS created_at, NULL::timestamptz AS resolved_at
           FROM tenant.contact_identity AS ci
           JOIN tenant.customer AS cu ON cu.tenant_id = ci.tenant_id AND cu.contact_id = ci.contact_id
           WHERE cu.id = $1::uuid AND ci.tenant_id = $2::uuid
             AND ci.match_type = 'probabilistic'
           ORDER BY ci.first_seen_at DESC
           LIMIT 20`,
          [contactId, tenantId],
        ),
      ]);
      return {
        identities: identities.rows,
        candidates: candidates.rows,
        // data_quality_findings is deferred to OTel (not in build-v2) — no source.
        findings: [],
      };
    });
  }
}
