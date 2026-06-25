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
 * Cash read surface + admin-config writes (loyalty.reward_configs, branding).
 * Customer-facing wallet/ledger writes live in cash-write.repository. All
 * tenant-scoped → withTenant. SQL ported from server.js; `wallet_transactions.type`
 * is lowercase (`topup`/`purchase`) to match the live data (umi-cash convention).
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
         FROM core.tenants AS t
         LEFT JOIN loyalty.programs AS p  ON p.tenant_id = t.id
         LEFT JOIN ops.businesses   AS ob ON ob.tenant_id = t.id
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
        `UPDATE core.tenants SET name = $2, updated_at = now() WHERE id = $1::uuid`,
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
        `UPDATE loyalty.programs
         SET card_prefix = COALESCE($2, card_prefix),
             pass_style  = COALESCE($3, pass_style),
             branding    = branding || $4::jsonb,
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
          `SELECT count(*)::int AS n FROM loyalty.visit_events
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, dayStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n, COALESCE(sum(amount_cents), 0)::bigint AS sum
           FROM loyalty.wallet_transactions
           WHERE tenant_id = $1::uuid AND type = 'topup' AND created_at >= $2`,
          [tenantId, dayStart],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(pending_rewards), 0)::int AS sum FROM loyalty.cards
           WHERE tenant_id = $1::uuid AND pending_rewards > 0`,
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
          `SELECT occurred_at AS "scannedAt" FROM loyalty.visit_events
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT a.person_id::text AS "userId", pe.display_name AS name,
                  ca.card_number AS "cardNumber", ca.total_visits AS "totalVisits",
                  ca.balance_cents AS "balanceCentavos"
           FROM loyalty.cards AS ca
           JOIN loyalty.accounts AS a ON a.id = ca.account_id
           LEFT JOIN core.people AS pe ON pe.id = a.person_id
           WHERE ca.tenant_id = $1::uuid
           ORDER BY ca.total_visits DESC NULLS LAST LIMIT 10`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT created_at AS "createdAt" FROM core.people
           WHERE tenant_id = $1::uuid AND created_at >= $2`,
          [tenantId, w.eightWeeksAgo],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(balance_cents), 0)::bigint AS sum FROM loyalty.cards
           WHERE tenant_id = $1::uuid`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(amount_cents), 0)::bigint AS sum FROM loyalty.wallet_transactions
           WHERE tenant_id = $1::uuid AND type = 'topup' AND created_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n FROM loyalty.reward_redemptions
           WHERE tenant_id = $1::uuid AND redeemed_at >= $2`,
          [tenantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(DISTINCT loyalty_card_id)::int AS n FROM loyalty.visit_events
           WHERE tenant_id = $1::uuid AND occurred_at >= $2`,
          [tenantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT
             (SELECT count(*)::int FROM core.people WHERE tenant_id = $1::uuid) AS "totalCustomers",
             (SELECT COALESCE(sum(abs(amount_cents)), 0)::bigint FROM loyalty.wallet_transactions
                WHERE tenant_id = $1::uuid AND type = 'purchase') AS "totalRevenueCentavos",
             (SELECT COALESCE(sum(total_visits), 0)::bigint FROM loyalty.cards
                WHERE tenant_id = $1::uuid) AS "totalAllTimeVisits"`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT visits_required AS "visitsRequired", reward_cost_cents AS "rewardCostCentavos"
           FROM loyalty.reward_configs
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
      opts.sort === 'visits' ? 'c.total_visits DESC NULLS LAST'
      : opts.sort === 'balance' ? 'c.balance_cents DESC NULLS LAST'
      : opts.sort === 'inactive' ? 'lv.last_visit ASC NULLS FIRST'
      : opts.sort === 'ltv' ? 'ltv.ltv_centavos DESC NULLS LAST'
      : 'pe.created_at DESC';
    return this.pg.withTenant(async (c) => {
      const rows = (
        await c.query<Row>(
          `SELECT
             pe.id::text AS id, pe.display_name AS name,
             pe.normalized_phone AS phone, pe.normalized_email AS email,
             pe.created_at AS "createdAt",
             c.id::text AS "cardId", c.card_number AS "cardNumber",
             c.balance_cents AS "balanceCentavos", c.total_visits AS "totalVisits",
             c.visits_this_cycle AS "visitsThisCycle", c.pending_rewards AS "pendingRewards",
             lv.last_visit AS "lastVisit",
             COALESCE(ltv.ltv_centavos, 0)::bigint AS "ltvCentavos"
           FROM core.people AS pe
           LEFT JOIN loyalty.accounts AS a ON a.person_id = pe.id AND a.tenant_id = pe.tenant_id
           LEFT JOIN loyalty.cards    AS c ON c.account_id = a.id
           LEFT JOIN LATERAL (
             SELECT max(occurred_at) AS last_visit
             FROM loyalty.visit_events ve WHERE ve.loyalty_card_id = c.id
           ) AS lv ON true
           LEFT JOIN LATERAL (
             SELECT COALESCE(sum(abs(amount_cents)), 0) AS ltv_centavos
             FROM loyalty.wallet_transactions wt WHERE wt.loyalty_card_id = c.id AND wt.type = 'purchase'
           ) AS ltv ON true
           WHERE pe.tenant_id = $1::uuid AND (
             $2 = '' OR pe.display_name ILIKE $3 OR pe.normalized_phone ILIKE $3
             OR pe.normalized_email ILIKE $3 OR c.card_number ILIKE $3
           )
           ORDER BY ${order}
           LIMIT $4 OFFSET $5`,
          [tenantId, opts.search, like, opts.limit, opts.skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(DISTINCT pe.id)::int AS n
           FROM core.people AS pe
           LEFT JOIN loyalty.accounts AS a ON a.person_id = pe.id AND a.tenant_id = pe.tenant_id
           LEFT JOIN loyalty.cards    AS c ON c.account_id = a.id
           WHERE pe.tenant_id = $1::uuid AND (
             $2 = '' OR pe.display_name ILIKE $3 OR pe.normalized_phone ILIKE $3
             OR pe.normalized_email ILIKE $3 OR c.card_number ILIKE $3
           )`,
          [tenantId, opts.search, like],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }

  async rewardConfig(tenantId: string): Promise<{ active: Row[]; history: Row[] }> {
    const select = `
      id::text, tenant_id::text AS "tenantId", program_id::text AS "programId",
      visits_required AS "visitsRequired", reward_name AS "rewardName",
      reward_description AS "rewardDescription", reward_cost_cents AS "rewardCostCentavos",
      is_active AS "isActive", activated_at AS "activatedAt", created_at AS "createdAt"`;
    return this.pg.withTenant(async (c) => {
      const [active, history] = await Promise.all([
        c.query<Row>(
          `SELECT ${select} FROM loyalty.reward_configs
           WHERE tenant_id = $1::uuid AND is_active = true
           ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
          [tenantId],
        ),
        c.query<Row>(
          `SELECT ${select} FROM loyalty.reward_configs
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
    programId: string,
    data: { visitsRequired: number; rewardName: string; rewardDescription: string | null; rewardCostCentavos: number },
  ): Promise<Row> {
    return this.pg.withTenant(async (c) => {
      await c.query(
        `UPDATE loyalty.reward_configs SET is_active = false
         WHERE tenant_id = $1::uuid AND is_active = true`,
        [tenantId],
      );
      const { rows } = await c.query<Row>(
        `INSERT INTO loyalty.reward_configs
           (tenant_id, program_id, visits_required, reward_name, reward_description, reward_cost_cents, is_active, activated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, true, now())
         RETURNING id::text, tenant_id::text AS "tenantId", program_id::text AS "programId",
                   visits_required AS "visitsRequired", reward_name AS "rewardName",
                   reward_description AS "rewardDescription", reward_cost_cents AS "rewardCostCentavos",
                   is_active AS "isActive", activated_at AS "activatedAt"`,
        [tenantId, programId, data.visitsRequired, data.rewardName, data.rewardDescription, data.rewardCostCentavos],
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
           FROM loyalty.gift_cards
           WHERE tenant_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [tenantId, limit, skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS n FROM loyalty.gift_cards WHERE tenant_id = $1::uuid`,
          [tenantId],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }
}
