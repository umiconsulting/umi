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
 * Customer 360 reads. All tenant-scoped → run on the umi_app pool via
 * `withTenant` (RLS) with explicit `tenant_id` predicates. SQL ported from
 * server.js. The **list** keeps its single lateral-join rollup (the efficient
 * paginated path — decomposing it per-row would be N+1); the **detail** view is
 * decomposed into per-domain loaders (timeline/conversations/orders/cash/identity)
 * per spec §7.2.
 */
@Injectable()
export class CustomersRepository {
  constructor(private readonly pg: PgService) {}

  /** The platform customer list (one lateral-join rollup per person). */
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
             c.display_name,
             c.normalized_phone AS phone,
             c.normalized_email AS email,
             c.created_at,
             c.updated_at,
             COALESCE(phone_identity.normalized_value, c.normalized_phone) AS normalized_phone,
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
             COALESCE(quality_summary.data_quality_count, 0)::int AS data_quality_count,
             COALESCE(merge_summary.merge_candidate_count, 0)::int AS merge_candidate_count,
             last_touch.last_touch_at
           FROM core.people AS c
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM core.contact_methods AS ci
             WHERE ci.person_id = c.id
               AND ci.kind IN ('phone', 'whatsapp')
               AND ci.normalized_value IS NOT NULL
             ORDER BY CASE WHEN ci.kind = 'phone' THEN 0 ELSE 1 END, ci.created_at ASC
             LIMIT 1
           ) AS phone_identity ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', ci.id::text,
                 'identity_type', ci.kind,
                 'identity_value', ci.display_value,
                 'normalized_value', ci.normalized_value,
                 'verification_status', CASE WHEN ci.verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END
               )
               ORDER BY ci.kind, ci.created_at
             ) AS items
             FROM core.contact_methods AS ci
             WHERE ci.person_id = c.id
           ) AS identities ON true
           LEFT JOIN LATERAL (
             SELECT
               count(la.id) AS loyalty_count,
               COALESCE(sum(lc.total_visits), 0) AS total_visits,
               COALESCE(sum(lc.balance_cents), 0) AS wallet_balance_cents,
               0 AS gift_card_count,
               max(GREATEST(lc.updated_at, la.updated_at)) AS last_cash_at
             FROM loyalty.accounts AS la
             LEFT JOIN loyalty.cards AS lc ON lc.account_id = la.id
             WHERE la.person_id = c.id
           ) AS cash_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(cv.id) AS conversation_count,
               count(cv.id) FILTER (WHERE cv.status IN ('open', 'pending', 'active')) AS active_conversations,
               max(cv.last_message_at) AS last_conversation_at
             FROM comms.conversations AS cv
             WHERE cv.person_id = c.id
           ) AS conversation_summary ON true
           LEFT JOIN LATERAL (
             SELECT
               count(o.id) AS orders_count,
               COALESCE(sum(o.total_cents), 0) AS total_spend_cents,
               max(COALESCE(o.placed_at, o.created_at)) AS last_order_at
             FROM ops.orders AS o
             WHERE o.person_id = c.id
           ) AS order_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(mi.id) AS memory_count, max(mi.updated_at) AS last_memory_at
             FROM comms.memory_items AS mi
             WHERE mi.person_id = c.id
           ) AS memory_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(dq.id) AS data_quality_count, max(dq.created_at) AS last_quality_at
             FROM observability.data_quality_findings AS dq
             WHERE dq.tenant_id = c.tenant_id
               AND dq.resolved_at IS NULL
               AND dq.subject_id = c.id::text
           ) AS quality_summary ON true
           LEFT JOIN LATERAL (
             SELECT count(mc.id) AS merge_candidate_count, max(mc.created_at) AS last_merge_at
             FROM core.contact_merge_candidates AS mc
             WHERE mc.tenant_id = c.tenant_id
               AND mc.confidence IN ('candidate', 'high')
               AND (mc.left_person_id = c.id OR mc.right_person_id = c.id)
           ) AS merge_summary ON true
           LEFT JOIN LATERAL (
             SELECT max(ts) AS last_touch_at
             FROM (VALUES
               (c.updated_at),
               (cash_summary.last_cash_at),
               (conversation_summary.last_conversation_at),
               (order_summary.last_order_at),
               (memory_summary.last_memory_at),
               (quality_summary.last_quality_at),
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
               OR ($4 = 'review' AND (COALESCE(quality_summary.data_quality_count, 0) > 0 OR COALESCE(merge_summary.merge_candidate_count, 0) > 0))
             )
             AND (
               $5 = ''
               OR c.display_name ILIKE $6
               OR c.normalized_phone ILIKE $6
               OR c.normalized_email ILIKE $6
               OR phone_identity.normalized_value ILIKE $6
             )
           ORDER BY last_touch.last_touch_at DESC NULLS LAST, c.created_at DESC
           LIMIT $7 OFFSET $8`,
          [tenantId, q.contactId, q.contactUuid, q.filter, q.search, like, q.limit, skip],
        )
      ).rows;

      const total = (
        await c.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM core.people AS c
           LEFT JOIN LATERAL (
             SELECT ci.normalized_value
             FROM core.contact_methods AS ci
             WHERE ci.person_id = c.id
               AND ci.kind IN ('phone', 'whatsapp')
               AND ci.normalized_value IS NOT NULL
             LIMIT 1
           ) AS phone_identity ON true
           WHERE c.tenant_id = $1::uuid
             AND ($2 = '' OR c.id = $3::uuid)
             AND (
               $4 = ''
               OR ($4 = 'whatsapp' AND EXISTS (SELECT 1 FROM comms.conversations AS cv WHERE cv.person_id = c.id))
               OR ($4 = 'cash' AND EXISTS (SELECT 1 FROM loyalty.accounts AS la WHERE la.person_id = c.id))
               OR ($4 = 'memory' AND EXISTS (SELECT 1 FROM comms.memory_items AS mi WHERE mi.person_id = c.id))
               OR ($4 = 'review' AND (
                 EXISTS (SELECT 1 FROM observability.data_quality_findings AS dq WHERE dq.tenant_id = c.tenant_id AND dq.resolved_at IS NULL AND dq.subject_id = c.id::text)
                 OR EXISTS (SELECT 1 FROM core.contact_merge_candidates AS mc WHERE mc.tenant_id = c.tenant_id AND mc.confidence IN ('candidate', 'high') AND (mc.left_person_id = c.id OR mc.right_person_id = c.id))
               ))
             )
             AND (
               $5 = ''
               OR c.display_name ILIKE $6
               OR c.normalized_phone ILIKE $6
               OR c.normalized_email ILIKE $6
               OR phone_identity.normalized_value ILIKE $6
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
           SELECT 'whatsapp_message' AS type, m.id::text AS id, m.created_at AS occurred_at, m.role AS label, COALESCE(m.content, '') AS detail, 'conversaflow' AS product
           FROM comms.messages AS m
           JOIN comms.conversations AS cv ON cv.id = m.conversation_id
           WHERE cv.person_id = $1::uuid AND m.tenant_id = $2::uuid
           UNION ALL
           SELECT 'order' AS type, o.id::text AS id, COALESCE(o.placed_at, o.created_at) AS occurred_at, o.status AS label, COALESCE(o.source_transaction_id, o.id::text) AS detail, 'orders' AS product
           FROM ops.orders AS o
           WHERE o.person_id = $1::uuid AND o.tenant_id = $2::uuid
           UNION ALL
           SELECT 'memory' AS type, mi.id::text AS id, mi.updated_at AS occurred_at, mi.memory_type AS label, COALESCE(mi.content, '') AS detail, 'conversaflow' AS product
           FROM comms.memory_items AS mi
           WHERE mi.person_id = $1::uuid AND mi.tenant_id = $2::uuid
           UNION ALL
           SELECT 'data_quality' AS type, dq.id::text AS id, dq.created_at AS occurred_at, dq.severity AS label, dq.check_name AS detail, 'data' AS product
           FROM observability.data_quality_findings AS dq
           WHERE dq.tenant_id = $2::uuid AND dq.subject_id = $3
         ) AS timeline
         ORDER BY occurred_at DESC
         LIMIT 80`,
        [contactId, tenantId, contactId],
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
         FROM comms.conversations AS cv
         LEFT JOIN comms.messages AS m ON m.conversation_id = cv.id
         WHERE cv.person_id = $1::uuid AND cv.tenant_id = $2::uuid
         GROUP BY cv.id
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
           id::text,
           source_transaction_id AS order_number,
           source AS source_product,
           status,
           channel,
           total_cents,
           placed_at,
           created_at,
           updated_at
         FROM ops.orders
         WHERE person_id = $1::uuid AND tenant_id = $2::uuid
         ORDER BY COALESCE(placed_at, created_at) DESC
         LIMIT 40`,
        [contactId, tenantId],
      ),
    );
    return rows;
  }

  async cash(tenantId: string, contactId: string): Promise<Row | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT
           la.id::text AS "loyaltyAccountId",
           la.status,
           lc.id::text AS "loyaltyCardId",
           lc.card_number,
           lc.balance_cents,
           lc.total_visits,
           lc.visits_this_cycle,
           lc.pending_rewards,
           lc.created_at,
           lc.updated_at
         FROM loyalty.accounts AS la
         LEFT JOIN loyalty.cards AS lc ON lc.account_id = la.id
         WHERE la.person_id = $1::uuid AND la.tenant_id = $2::uuid
         ORDER BY la.created_at DESC
         LIMIT 1`,
        [contactId, tenantId],
      ),
    );
    return rows[0] ?? null;
  }

  /** Tenant-wide conversation list (admin view, comms.* + core.people). */
  async conversationsList(
    tenantId: string,
    limit: number,
    skip: number,
  ): Promise<{ rows: Row[]; total: number }> {
    return this.pg.withTenant(async (c) => {
      const rows = (
        await c.query<Row>(
          // Bound to the CANONICAL columns (server.js's c.opened_at / co.phone
          // don't exist on comms.conversations / core.people — its own
          // /admin/conversations query would 500; caught by the live read-path
          // verification). created_at + normalized_phone + the real
          // current_state/summary columns.
          `SELECT
             c.id::text,
             c.status,
             c.current_state AS "currentState",
             COALESCE(c.summary, c.metadata->>'summary') AS summary,
             c.created_at AS "createdAt",
             co.display_name AS "customerName",
             co.normalized_phone AS "customerPhone",
             count(m.id)::int AS "messageCount",
             max(m.created_at) AS "lastMessageAt"
           FROM comms.conversations AS c
           LEFT JOIN core.people AS co ON co.id = c.person_id
           LEFT JOIN comms.messages AS m ON m.conversation_id = c.id
           WHERE c.tenant_id = $1::uuid
           GROUP BY c.id, co.id
           ORDER BY COALESCE(max(m.created_at), c.created_at) DESC
           OFFSET $2 LIMIT $3`,
          [tenantId, skip, limit],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS total FROM comms.conversations WHERE tenant_id = $1::uuid`,
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
      const [identities, candidates, findings] = await Promise.all([
        c.query<Row>(
          // String contract ('verified'/'unverified') matches the customers-list
          // shape (server.js line 724); a raw boolean here diverged from it.
          `SELECT id::text, kind AS identity_type, display_value AS identity_value, normalized_value,
                  CASE WHEN verified_at IS NOT NULL THEN 'verified' ELSE 'unverified' END AS verification_status,
                  metadata, created_at
           FROM core.contact_methods
           WHERE person_id = $1::uuid AND tenant_id = $2::uuid
           ORDER BY kind, created_at`,
          [contactId, tenantId],
        ),
        c.query<Row>(
          `SELECT id::text, left_person_id::text, right_person_id::text, match_type, confidence, detail, created_at, resolved_at
           FROM core.contact_merge_candidates
           WHERE tenant_id = $2::uuid
             AND (left_person_id = $1::uuid OR right_person_id = $1::uuid)
           ORDER BY created_at DESC
           LIMIT 20`,
          [contactId, tenantId],
        ),
        c.query<Row>(
          `SELECT id::text, severity, check_name AS finding_key, detail,
                  CASE WHEN resolved_at IS NULL THEN 'open' ELSE 'resolved' END AS status,
                  created_at, resolved_at
           FROM observability.data_quality_findings
           WHERE tenant_id = $2::uuid AND subject_id = $1
           ORDER BY created_at DESC
           LIMIT 20`,
          [contactId, tenantId],
        ),
      ]);
      return {
        identities: identities.rows,
        candidates: candidates.rows,
        findings: findings.rows,
      };
    });
  }
}
