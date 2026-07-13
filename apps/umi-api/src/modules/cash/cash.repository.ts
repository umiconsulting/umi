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
 * `tenant.contact_identity`.
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
         LEFT JOIN tenant.loyalty_program AS p  ON p.tenant_id = t.id
         LEFT JOIN tenant.business          AS ob ON ob.tenant_id = t.id
         WHERE t.id = $1::uuid
         LIMIT 1`,
        [tenantId],
      ),
    );
    return rows[0] ?? null;
  }

  async updateTenantName(tenantId: string, name: string): Promise<void> {
    await this.pg.withTenant((c) =>
      c.query(
        `UPDATE tenant.business SET name = $2, updated_at = now() WHERE id = $1::uuid`,
        [tenantId, name],
      ),
    );
  }

  async updateProgram(
    tenantId: string,
    patch: { cardPrefix?: string; passStyle?: string; brandingPatch: Record<string, unknown> },
  ): Promise<void> {
    await this.pg.withTenant((c) =>
      c.query(
        `UPDATE tenant.loyalty_program
         SET card_prefix = COALESCE($2, card_prefix),
             pass_style  = COALESCE($3, pass_style),
             branding    = COALESCE(branding, '{}'::jsonb) || $4::jsonb,
             updated_at  = now()
         WHERE tenant_id = $1::uuid`,
        [
          tenantId,
          patch.cardPrefix ?? null,
          patch.passStyle ?? null,
          JSON.stringify(patch.brandingPatch),
        ],
      ),
    );
  }

  async stats(tenantId: string, dayStart: Date): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      const [visits, topups, pending] = await Promise.all([
        c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_visit
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, dayStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n, COALESCE(sum(delta), 0)::bigint AS sum
           FROM tenant.loyalty_stored_value_ledger
           WHERE tenant_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [tenantId, dayStart],
        ),
        // pending rewards across all active cards = Σ max(visits/n − redemptions, 0)
        c.query<Row>(
          `WITH vr AS (
             SELECT COALESCE((SELECT visits_required FROM tenant.loyalty_reward
               WHERE tenant_id = $1::uuid AND is_active
               ORDER BY activated_at DESC NULLS LAST LIMIT 1), 10) AS n
           )
           SELECT COALESCE(sum(pend), 0)::int AS sum FROM (
             SELECT (
               (SELECT count(*) FROM tenant.loyalty_visit v
                 WHERE v.tenant_id = c.tenant_id AND v.card_id = c.id) / (SELECT n FROM vr)
               - (SELECT count(*) FROM tenant.loyalty_redemption r
                   WHERE r.tenant_id = c.tenant_id AND r.card_id = c.id)
             ) AS pend
             FROM tenant.loyalty_card c
             WHERE c.tenant_id = $1::uuid AND c.status = 'active'
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
        recentVisits, topCards, recentUsers, balanceRow,
        topupsRow, rewardsRow, activeRow, totalsRow, activeRewardConfigRow,
      ] = await Promise.all([
        c.query<Row>(
          `SELECT occurred_at AS "scannedAt" FROM tenant.loyalty_visit
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT ca.customer_id::text AS "userId", cu.name AS name,
                  ca.card_number AS "cardNumber",
                  agg.total_visits::int   AS "totalVisits",
                  agg.balance_cents::int  AS "balanceCentavos"
           FROM tenant.loyalty_card AS ca
           LEFT JOIN tenant.customer AS cu ON cu.tenant_id = ca.tenant_id AND cu.id = ca.customer_id
           CROSS JOIN LATERAL (
             SELECT
               (SELECT count(*) FROM tenant.loyalty_visit v
                 WHERE v.tenant_id = ca.tenant_id AND v.card_id = ca.id) AS total_visits,
               COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l
                 WHERE l.tenant_id = ca.tenant_id AND l.card_id = ca.id), 0) AS balance_cents
           ) AS agg
           WHERE ca.tenant_id = $1::uuid
           ORDER BY agg.total_visits DESC NULLS LAST LIMIT 10`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT created_at AS "createdAt" FROM tenant.customer
           WHERE tenant_id = $1::uuid AND created_at >= $2`,
          [tenantId, w.eightWeeksAgo],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM tenant.loyalty_stored_value_ledger
           WHERE tenant_id = $1::uuid`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM tenant.loyalty_stored_value_ledger
           WHERE tenant_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_redemption
           WHERE tenant_id = $1::uuid AND redeemed_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(DISTINCT card_id)::int AS n FROM tenant.loyalty_visit
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT
             (SELECT count(*)::int FROM tenant.customer WHERE tenant_id = $1::uuid) AS "totalCustomers",
             (SELECT COALESCE(sum(abs(delta)), 0)::bigint FROM tenant.loyalty_stored_value_ledger
                WHERE tenant_id = $1::uuid AND reason = 'purchase') AS "totalRevenueCentavos",
             (SELECT count(*)::bigint FROM tenant.loyalty_visit
                WHERE tenant_id = $1::uuid) AS "totalAllTimeVisits"`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT visits_required AS "visitsRequired", reward_cost_cents AS "rewardCostCentavos"
           FROM tenant.loyalty_reward
           WHERE tenant_id = $1::uuid AND is_active = true
           ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
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
      opts.sort === 'visits' ? 'total_visits DESC NULLS LAST'
      : opts.sort === 'balance' ? 'balance_cents DESC NULLS LAST'
      : opts.sort === 'inactive' ? 'last_visit ASC NULLS FIRST'
      : opts.sort === 'ltv' ? 'ltv_centavos DESC NULLS LAST'
      : 'created_at DESC';
    // The per-customer derived projection (balance/visits/cycle/pending/ltv from the
    // ledgers; phone/email from the identity spine). One active card per customer.
    const CUST_CTE = `
      vr AS (
        SELECT COALESCE((SELECT visits_required FROM tenant.loyalty_reward
          WHERE tenant_id = $1::uuid AND is_active
          ORDER BY activated_at DESC NULLS LAST LIMIT 1), 10) AS n
      ),
      cust AS (
        SELECT
          cu.id, cu.name, cu.created_at, cu.contact_id,
          c.id AS card_id, c.card_number,
          COALESCE((SELECT sum(l.delta) FROM tenant.loyalty_stored_value_ledger l
            WHERE l.tenant_id = cu.tenant_id AND l.card_id = c.id), 0)::bigint          AS balance_cents,
          (SELECT count(*) FROM tenant.loyalty_visit v
            WHERE v.tenant_id = cu.tenant_id AND v.card_id = c.id)::int                 AS total_visits,
          (SELECT count(*) FROM tenant.loyalty_redemption r
            WHERE r.tenant_id = cu.tenant_id AND r.card_id = c.id)::int                 AS redemptions,
          (SELECT max(v.occurred_at) FROM tenant.loyalty_visit v
            WHERE v.tenant_id = cu.tenant_id AND v.card_id = c.id)                       AS last_visit,
          COALESCE((SELECT sum(abs(l.delta)) FROM tenant.loyalty_stored_value_ledger l
            WHERE l.tenant_id = cu.tenant_id AND l.card_id = c.id AND l.reason = 'purchase'), 0)::bigint AS ltv_centavos,
          (SELECT ci.normalized_value FROM tenant.contact_identity ci
             JOIN tenant.channel ch ON ch.id = ci.channel_id
            WHERE ci.tenant_id = cu.tenant_id AND ci.contact_id = cu.contact_id
              AND ch.normalization_rule = 'e164'
            ORDER BY ci.is_primary DESC, ci.last_seen_at DESC LIMIT 1)                   AS phone,
          (SELECT ci.normalized_value FROM tenant.contact_identity ci
             JOIN tenant.channel ch ON ch.id = ci.channel_id
            WHERE ci.tenant_id = cu.tenant_id AND ci.contact_id = cu.contact_id
              AND ch.key = 'email'
            ORDER BY ci.is_primary DESC, ci.last_seen_at DESC LIMIT 1)                   AS email
        FROM tenant.customer cu
        LEFT JOIN tenant.loyalty_card c
          ON c.tenant_id = cu.tenant_id AND c.customer_id = cu.id AND c.status = 'active'
        WHERE cu.tenant_id = $1::uuid
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
    const select = `
      id::text, tenant_id::text AS "tenantId", NULL::text AS "programId",
      visits_required AS "visitsRequired", reward_name AS "rewardName",
      reward_description AS "rewardDescription", reward_cost_cents AS "rewardCostCentavos",
      is_active AS "isActive", activated_at AS "activatedAt", created_at AS "createdAt"`;
    return this.pg.withTenant(async (c) => {
      const [active, history] = await Promise.all([
        c.query<Row>(
          `SELECT ${select} FROM tenant.loyalty_reward
           WHERE tenant_id = $1::uuid AND is_active = true
           ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT ${select} FROM tenant.loyalty_reward
           WHERE tenant_id = $1::uuid AND is_active = false
           ORDER BY activated_at DESC NULLS LAST LIMIT 10`,
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
    data: { visitsRequired: number; rewardName: string; rewardDescription: string | null; rewardCostCentavos: number },
  ): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      // Serialize concurrent reward-rule saves per tenant so the
      // deactivate-then-insert can't interleave into two is_active=true rows.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `reward_config:${tenantId}`,
      ]);
      await c.query(
        `UPDATE tenant.loyalty_reward SET is_active = false
         WHERE tenant_id = $1::uuid AND is_active = true`,
        [tenantId],
      );
      const { rows } = await c.query<Row>(
        `INSERT INTO tenant.loyalty_reward
           (tenant_id, visits_required, reward_name, reward_description, reward_cost_cents, is_active, activated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, true, now())
         RETURNING id::text, tenant_id::text AS "tenantId", NULL::text AS "programId",
                   visits_required AS "visitsRequired", reward_name AS "rewardName",
                   reward_description AS "rewardDescription", reward_cost_cents AS "rewardCostCentavos",
                   is_active AS "isActive", activated_at AS "activatedAt"`,
        [tenantId, data.visitsRequired, data.rewardName, data.rewardDescription, data.rewardCostCentavos],
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
           WHERE tenant_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [tenantId, limit, skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS n FROM tenant.loyalty_gift_card WHERE tenant_id = $1::uuid`,
          [tenantId],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }
}
