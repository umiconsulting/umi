import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface AnalyticsWindows {
  thirtyDaysAgo: Date;
  eightWeeksAgo: Date;
  monthStart: Date;
}

/**
 * Cash read surface + admin-config writes (build-v2). All tenant-scoped →
 * withTenant. DERIVE MODEL: there are no `balance_cents` / `total_visits` /
 * `visits_this_cycle` / `pending_rewards` caches — balance = SUM(card_ledger.delta),
 * visits = COUNT(visit), cycle = visits % visits_required, pending = visits /
 * visits_required − redemptions. The old `loyalty.wallet_transactions` (topup /
 * purchase) is gone: topups = card_ledger reason='topup', revenue = |delta| where
 * reason='purchase'. Loyalty is program-less (config in `tenant.loyalty_program`,
 * one reward threshold in `tenant.loyalty_reward`). Identity phone/email come from
 * `tenant.contact` (flat: channel_id + normalized_value -> customer).
 */
@Injectable()
export class CashRepository {
  constructor(private readonly pg: PgService) {}

  /** Branding/program composite for settings (server.js getTenant), by id. */
  async branding(tenantId: string): Promise<Row | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT
           t.id::text, t.slug, t.name, t.timezone, t.status,
           ob.city,
           p.id::text                     AS "programId",
           p.card_prefix                  AS "cardPrefix",
           p.pass_style                   AS "passStyle",
           p.self_registration            AS "selfRegistration",
           p.topup_enabled                AS "topupEnabled",
           p.birthday_reward_enabled      AS "birthdayRewardEnabled",
           p.birthday_reward_name         AS "birthdayRewardName",
           p.branding->>'primary_color'   AS "primaryColor",
           p.branding->>'secondary_color' AS "secondaryColor",
           p.branding->>'logo_url'        AS "logoUrl",
           p.branding->>'strip_image_url' AS "stripImageUrl",
           p.branding->>'promo_message'   AS "promoMessage",
           p.branding->>'promo_starts_at' AS "promoStartsAt",
           p.branding->>'promo_ends_at'   AS "promoEndsAt",
           p.branding->>'promo_days'      AS "promoDays"
         FROM tenant.business AS t
         LEFT JOIN tenant.loyalty_program AS p  ON p.business_id = t.id
         LEFT JOIN tenant.business          AS ob ON ob.business_id = t.id
         WHERE t.id = $1::uuid
         LIMIT 1`,
        [tenantId],
      ),
    );
    return rows[0] ?? null;
  }

  async updateTenantName(tenantId: string, name: string): Promise<void> {
    await this.pg.withTenant((c) =>
      c.query(`UPDATE tenant.business SET name = $2, updated_at = now() WHERE id = $1::uuid`, [
        tenantId,
        name,
      ]),
    );
  }

  async updateProgram(tenantId: string, patch: Record<string, unknown>): Promise<void> {
    // One column-keyed jsonb patch, fixed columns: a key PRESENT in the patch is written
    // (present-but-null clears the column), an ABSENT key is left untouched. The statement
    // stays STATIC (preflight can PREPARE it) while preserving the settings form's
    // partial-update + clear-a-field semantics the old branding jsonb merge had.
    await this.pg.withTenant((c) =>
      c.query(
        `UPDATE tenant.loyalty_program p SET
           card_prefix             = CASE WHEN pt.j ? 'card_prefix'             THEN pt.j->>'card_prefix'                     ELSE p.card_prefix END,
           pass_style              = CASE WHEN pt.j ? 'pass_style'              THEN pt.j->>'pass_style'                      ELSE p.pass_style END,
           birthday_reward_enabled = CASE WHEN pt.j ? 'birthday_reward_enabled' THEN (pt.j->>'birthday_reward_enabled')::boolean ELSE p.birthday_reward_enabled END,
           birthday_reward_name    = CASE WHEN pt.j ? 'birthday_reward_name'    THEN pt.j->>'birthday_reward_name'            ELSE p.birthday_reward_name END,
           primary_color           = CASE WHEN pt.j ? 'primary_color'           THEN pt.j->>'primary_color'                   ELSE p.primary_color END,
           secondary_color         = CASE WHEN pt.j ? 'secondary_color'         THEN pt.j->>'secondary_color'                 ELSE p.secondary_color END,
           logo_url                = CASE WHEN pt.j ? 'logo_url'                THEN pt.j->>'logo_url'                        ELSE p.logo_url END,
           strip_image_url         = CASE WHEN pt.j ? 'strip_image_url'         THEN pt.j->>'strip_image_url'                 ELSE p.strip_image_url END,
           promo_message           = CASE WHEN pt.j ? 'promo_message'           THEN pt.j->>'promo_message'                   ELSE p.promo_message END,
           promo_starts_at         = CASE WHEN pt.j ? 'promo_starts_at'         THEN (pt.j->>'promo_starts_at')::timestamptz  ELSE p.promo_starts_at END,
           promo_ends_at           = CASE WHEN pt.j ? 'promo_ends_at'           THEN (pt.j->>'promo_ends_at')::timestamptz    ELSE p.promo_ends_at END,
           promo_days              = CASE WHEN pt.j ? 'promo_days'              THEN pt.j->>'promo_days'                      ELSE p.promo_days END,
           lifecycle_copy          = CASE WHEN pt.j ? 'lifecycle_copy'          THEN pt.j->'lifecycle_copy'                   ELSE p.lifecycle_copy END,
           updated_at              = now()
         FROM (SELECT $2::jsonb AS j) pt
         WHERE p.business_id = $1::uuid`,
        [tenantId, JSON.stringify(patch)],
      ),
    );
  }

  async stats(tenantId: string, dayStart: Date): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      const [visits, topups, pending] = await Promise.all([
        c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_visit
           WHERE business_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, dayStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n, COALESCE(sum(delta), 0)::bigint AS sum
           FROM tenant.loyalty_stored_value_ledger
           WHERE business_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [tenantId, dayStart],
        ),
        // pending rewards across all active cards = Σ max(visits/n − redemptions, 0)
        c.query<Row>(
          `WITH vr AS (
             SELECT COALESCE((SELECT stamps_required FROM tenant.loyalty_reward
               WHERE business_id = $1::uuid AND active AND type = 'stamps_free_item'
               ORDER BY created_at DESC NULLS LAST LIMIT 1), 10) AS n
           )
           SELECT COALESCE(sum(pend), 0)::int AS sum FROM (
             SELECT (
               (SELECT count(*) FROM tenant.loyalty_visit v
                 WHERE v.business_id = c.business_id AND v.card_id = c.id) / (SELECT n FROM vr)
               - (SELECT count(*) FROM tenant.loyalty_redemption r
                   WHERE r.business_id = c.business_id AND r.card_id = c.id)
             ) AS pend
             FROM tenant.loyalty_card c
             WHERE c.business_id = $1::uuid AND c.status = 'active'
           ) s WHERE pend > 0`,
          [tenantId],
        ),
      ]);
      return {
        visits: visits.rows[0],
        topups: topups.rows[0],
        pending: pending.rows[0],
      };
    });
  }

  async analytics(tenantId: string, w: AnalyticsWindows): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      const [
        recentVisits,
        topCards,
        recentUsers,
        balanceRow,
        topupsRow,
        rewardsRow,
        activeRow,
        totalsRow,
        activeRewardConfigRow,
      ] = await Promise.all([
        c.query<Row>(
          `SELECT occurred_at AS "scannedAt" FROM tenant.loyalty_visit
           WHERE business_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT ca.customer_id::text AS "userId", cu.name AS name,
                  ca.card_number AS "cardNumber",
                  agg.total_visits::int   AS "totalVisits",
                  agg.balance_cents::int  AS "balanceCentavos"
           FROM tenant.loyalty_card AS ca
           LEFT JOIN tenant.customer AS cu ON cu.business_id = ca.business_id AND cu.id = ca.customer_id
           CROSS JOIN LATERAL (
             SELECT
               (SELECT count(*) FROM tenant.loyalty_visit v
                 WHERE v.business_id = ca.business_id AND v.card_id = ca.id) AS total_visits,
               COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l
                 WHERE l.business_id = ca.business_id AND l.card_id = ca.id), 0) AS balance_cents
           ) AS agg
           WHERE ca.business_id = $1::uuid
           ORDER BY agg.total_visits DESC NULLS LAST LIMIT 10`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT created_at AS "createdAt" FROM tenant.customer
           WHERE business_id = $1::uuid AND created_at >= $2`,
          [tenantId, w.eightWeeksAgo],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM tenant.loyalty_stored_value_ledger
           WHERE business_id = $1::uuid`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM tenant.loyalty_stored_value_ledger
           WHERE business_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_redemption
           WHERE business_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(DISTINCT card_id)::int AS n FROM tenant.loyalty_visit
           WHERE business_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT
             (SELECT count(*)::int FROM tenant.customer WHERE business_id = $1::uuid) AS "totalCustomers",
             (SELECT COALESCE(sum(abs(delta)), 0)::bigint FROM tenant.loyalty_stored_value_ledger
                WHERE business_id = $1::uuid AND reason = 'purchase') AS "totalRevenueCentavos",
             (SELECT count(*)::bigint FROM tenant.loyalty_visit
                WHERE business_id = $1::uuid) AS "totalAllTimeVisits"`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT stamps_required AS "visitsRequired", value AS "rewardCostCentavos"
           FROM tenant.loyalty_reward
           WHERE business_id = $1::uuid AND active = true AND type = 'stamps_free_item'
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [tenantId],
        ),
      ]);
      return {
        recentVisits: recentVisits.rows,
        topCards: topCards.rows,
        recentUsers: recentUsers.rows,
        balanceRow: balanceRow.rows,
        topupsRow: topupsRow.rows,
        rewardsRow: rewardsRow.rows,
        activeRow: activeRow.rows,
        totalsRow: totalsRow.rows,
        activeRewardConfigRow: activeRewardConfigRow.rows,
      };
    });
  }

  async adminCustomers(
    tenantId: string,
    opts: { search: string; sort: string; limit: number; skip: number },
  ): Promise<{ rows: Row[]; total: number }> {
    const like = `%${opts.search}%`;
    const order =
      opts.sort === 'visits'
        ? 'total_visits DESC NULLS LAST'
        : opts.sort === 'balance'
          ? 'balance_cents DESC NULLS LAST'
          : opts.sort === 'inactive'
            ? 'last_visit ASC NULLS FIRST'
            : opts.sort === 'ltv'
              ? 'ltv_centavos DESC NULLS LAST'
              : 'created_at DESC';
    // The per-customer derived projection (balance/visits/cycle/pending/ltv from the
    // ledgers; phone/email from the identity spine). One active card per customer.
    const CUST_CTE = `
      vr AS (
        SELECT COALESCE((SELECT stamps_required FROM tenant.loyalty_reward
          WHERE business_id = $1::uuid AND active AND type = 'stamps_free_item'
          ORDER BY created_at DESC NULLS LAST LIMIT 1), 10) AS n
      ),
      cust AS (
        SELECT
          cu.id, cu.name, cu.created_at,
          c.id AS card_id, c.card_number,
          COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l
            WHERE l.business_id = cu.business_id AND l.card_id = c.id), 0)::bigint          AS balance_cents,
          (SELECT count(*) FROM tenant.loyalty_visit v
            WHERE v.business_id = cu.business_id AND v.card_id = c.id)::int                 AS total_visits,
          (SELECT count(*) FROM tenant.loyalty_redemption r
            WHERE r.business_id = cu.business_id AND r.card_id = c.id)::int                 AS redemptions,
          (SELECT max(v.occurred_at) FROM tenant.loyalty_visit v
            WHERE v.business_id = cu.business_id AND v.card_id = c.id)                       AS last_visit,
          COALESCE((SELECT sum(abs(l.delta)) FROM tenant.loyalty_stored_value_ledger l
            WHERE l.business_id = cu.business_id AND l.card_id = c.id AND l.reason = 'purchase'), 0)::bigint AS ltv_centavos,
          (SELECT ct.normalized_value FROM tenant.contact ct
             JOIN umi.channel_type ch ON ch.id = ct.channel_id
            WHERE ct.business_id = cu.business_id AND ct.customer_id = cu.id
              AND ch.key IN ('phone', 'whatsapp', 'sms')
            ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1)                     AS phone,
          (SELECT ct.normalized_value FROM tenant.contact ct
             JOIN umi.channel_type ch ON ch.id = ct.channel_id
            WHERE ct.business_id = cu.business_id AND ct.customer_id = cu.id
              AND ch.key = 'email'
            ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1)                     AS email
        FROM tenant.customer cu
        LEFT JOIN tenant.loyalty_card c
          ON c.business_id = cu.business_id AND c.customer_id = cu.id AND c.status = 'active'
        WHERE cu.business_id = $1::uuid
      )`;
    const filter = `($2 = '' OR name ILIKE $3 OR phone ILIKE $3 OR email ILIKE $3 OR card_number ILIKE $3)`;
    return this.pg.withTenant(async (c) => {
      const rows = (
        await c.query<Row>(
          `WITH ${CUST_CTE}, vr_n AS (SELECT n FROM vr)
           SELECT id::text AS id, name, phone, email, created_at AS "createdAt",
                  card_id::text AS "cardId", card_number AS "cardNumber",
                  balance_cents AS "balanceCentavos", total_visits AS "totalVisits",
                  (total_visits % (SELECT n FROM vr_n))::int                       AS "visitsThisCycle",
                  (total_visits / (SELECT n FROM vr_n) - redemptions)::int         AS "pendingRewards",
                  last_visit AS "lastVisit", ltv_centavos AS "ltvCentavos"
           FROM cust
           WHERE ${filter}
           ORDER BY ${order}
           LIMIT $4 OFFSET $5`,
          [tenantId, opts.search, like, opts.limit, opts.skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `WITH ${CUST_CTE}
           SELECT count(*)::int AS n FROM cust WHERE ${filter}`,
          [tenantId, opts.search, like],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }

  async rewardConfig(tenantId: string): Promise<{ active: Row[]; history: Row[] }> {
    // Maps build-v3's loyalty_reward onto the frozen umi-cash response names.
    // activated_at was dropped — each config save inserts a NEW row, so created_at
    // IS the activation moment; both "activatedAt" and "createdAt" read from it.
    const select = `
      id::text, business_id::text AS "tenantId", NULL::text AS "programId",
      stamps_required AS "visitsRequired", name AS "rewardName",
      description AS "rewardDescription", value AS "rewardCostCentavos",
      active AS "isActive", created_at AS "activatedAt", created_at AS "createdAt"`;
    return this.pg.withTenant(async (c) => {
      const [active, history] = await Promise.all([
        c.query<Row>(
          `SELECT ${select} FROM tenant.loyalty_reward
           WHERE business_id = $1::uuid AND active = true AND type = 'stamps_free_item'
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT ${select} FROM tenant.loyalty_reward
           WHERE business_id = $1::uuid AND active = false AND type = 'stamps_free_item'
           ORDER BY created_at DESC NULLS LAST LIMIT 10`,
          [tenantId],
        ),
      ]);
      return { active: active.rows, history: history.rows };
    });
  }

  /** Admin-config write (not the inert customer-facing path) — see preflight §4. */
  async upsertRewardConfig(
    tenantId: string,
    _programId: string,
    data: {
      visitsRequired: number;
      rewardName: string;
      rewardDescription: string | null;
      rewardCostCentavos: number;
    },
  ): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      // Serialize concurrent reward-rule saves per tenant so the
      // deactivate-then-insert can't interleave into two is_active=true rows.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reward_config:${tenantId}`]);
      await c.query(
        `UPDATE tenant.loyalty_reward SET active = false
         WHERE business_id = $1::uuid AND active = true AND type = 'stamps_free_item'`,
        [tenantId],
      );
      const { rows } = await c.query<Row>(
        `INSERT INTO tenant.loyalty_reward
           (business_id, type, stamps_required, name, description, value, active)
         VALUES ($1::uuid, 'stamps_free_item', $2, $3, $4, $5, true)
         RETURNING id::text, business_id::text AS "tenantId", NULL::text AS "programId",
                   stamps_required AS "visitsRequired", name AS "rewardName",
                   description AS "rewardDescription", value AS "rewardCostCentavos",
                   active AS "isActive", created_at AS "activatedAt"`,
        [
          tenantId,
          data.visitsRequired,
          data.rewardName,
          data.rewardDescription,
          data.rewardCostCentavos,
        ],
      );
      return rows[0];
    });
  }

  async giftCards(
    tenantId: string,
    limit: number,
    skip: number,
  ): Promise<{ rows: Row[]; total: number }> {
    return this.pg.withTenant(async (c) => {
      const rows = (
        await c.query<Row>(
          `SELECT id::text, code, amount_cents AS "amountCentavos", sender_name AS "senderName",
                  recipient_name AS "recipientName", recipient_email AS "recipientEmail",
                  recipient_phone AS "recipientPhone", message,
                  (redeemed_at IS NOT NULL) AS "isRedeemed",
                  redeemed_at AS "redeemedAt", expires_at AS "expiresAt", created_at AS "createdAt"
           FROM tenant.loyalty_gift_card
           WHERE business_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [tenantId, limit, skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_gift_card WHERE business_id = $1::uuid`,
          [tenantId],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }
}
