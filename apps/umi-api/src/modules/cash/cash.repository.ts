import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { EFFECTIVE_VISITS_REQUIRED_SQL } from '../../shared/loyalty/card-state.sql';
import {
  ACTIVE_LADDER_ROWS_SQL,
  CARD_OVERRIDE_ROW_SQL,
} from '../../shared/loyalty/reward-config.sql';
import {
  resolveRewardProfile,
  type RewardConfigRow,
  type RewardProfile,
} from '../../shared/loyalty/reward-profile';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface AnalyticsWindows {
  thirtyDaysAgo: Date;
  eightWeeksAgo: Date;
  monthStart: Date;
}

/**
 * Cash read surface + admin-config writes (build-v2). All merchant-scoped →
 * withMerchant. DERIVE MODEL: there are no `balance_cents` / `total_visits` /
 * `visits_this_cycle` / `pending_rewards` caches — balance = SUM(card_ledger.delta),
 * visits = COUNT(visit), cycle = visits % visits_required, pending = visits /
 * visits_required − redemptions. The old `loyalty.wallet_transactions` (topup /
 * purchase) is gone: topups = card_ledger reason='topup', revenue = |delta| where
 * reason='purchase'. Loyalty is program-less (config in `merchant.loyalty_program`,
 * one reward threshold in `merchant.loyalty_reward`). Identity phone/email come from
 * `merchant.contact` (flat: channel_id + normalized_value -> customer).
 */
/**
 * The per-customer derived projection: balance / stamps / cycle / pending / LTV
 * from the ledgers, phone and email from the identity spine. One active card per
 * customer.
 *
 * SHARED by the customer LIST and the CSV EXPORT, because they are the same
 * report at two sizes. Two copies would let the file a cafe downloads disagree
 * with the screen it was downloaded from.
 */
const CUST_CTE = `
      vr AS (
        SELECT COALESCE(${EFFECTIVE_VISITS_REQUIRED_SQL}, 10) AS n
      ),
      cust AS (
        SELECT
          cu.id, cu.name, cu.created_at,
          c.id AS card_id, c.card_number,
          COALESCE((SELECT sum(l.delta) FROM merchant.loyalty_stored_value_ledger l
            WHERE l.merchant_id = cu.merchant_id AND l.card_id = c.id), 0)::bigint          AS balance_cents,
          (SELECT COALESCE(sum(v.stamps), 0) FROM merchant.loyalty_visit v
            WHERE v.merchant_id = cu.merchant_id AND v.card_id = c.id)::int                 AS total_visits,
          (SELECT count(*) FROM merchant.loyalty_redemption r
            WHERE r.merchant_id = cu.merchant_id AND r.card_id = c.id)::int                 AS redemptions,
          (SELECT max(v.occurred_at) FROM merchant.loyalty_visit v
            WHERE v.merchant_id = cu.merchant_id AND v.card_id = c.id)                       AS last_visit,
          COALESCE((SELECT sum(abs(l.delta)) FROM merchant.loyalty_stored_value_ledger l
            WHERE l.merchant_id = cu.merchant_id AND l.card_id = c.id AND l.reason = 'purchase'), 0)::bigint AS ltv_centavos,
          (SELECT ct.normalized_value FROM merchant.contact ct
             JOIN umi.channel_type ch ON ch.id = ct.channel_id
            WHERE ct.merchant_id = cu.merchant_id AND ct.customer_id = cu.id
              AND ch.key IN ('phone', 'whatsapp', 'sms')
            ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1)                     AS phone,
          (SELECT ct.normalized_value FROM merchant.contact ct
             JOIN umi.channel_type ch ON ch.id = ct.channel_id
            WHERE ct.merchant_id = cu.merchant_id AND ct.customer_id = cu.id
              AND ch.key = 'email'
            ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1)                     AS email
        FROM merchant.customer cu
        LEFT JOIN merchant.loyalty_card c
          ON c.merchant_id = cu.merchant_id AND c.customer_id = cu.id AND c.status = 'active'
        WHERE cu.merchant_id = $1::uuid
      )`;

@Injectable()
export class CashRepository {
  constructor(private readonly pg: PgService) {}

  /** Branding/program composite for settings (server.js getMerchant), by id. */
  async branding(merchantId: string): Promise<Row | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           t.id::text, t.handle, t.name, t.timezone, t.status,
           t.city,
           -- The program is keyed BY the merchant (merchant_id is its primary key), so
           -- the merchant id IS the program id. Callers only test it for null — "does
           -- this café run loyalty at all" — and the LEFT JOIN keeps that answer honest.
           p.merchant_id::text            AS "programId",
           p.card_prefix                  AS "cardPrefix",
           p.pass_style                   AS "passStyle",
           p.self_registration            AS "selfRegistration",
           p.topup_enabled                AS "topupEnabled",
           p.birthday_reward_enabled      AS "birthdayRewardEnabled",
           p.birthday_reward_name         AS "birthdayRewardName",
           -- Typed columns, not a branding jsonb blob. The blob was replaced when the
           -- program branding layer landed; this reader kept addressing the old shape
           -- and no gate could see it, because a statement reports only its FIRST
           -- unresolved name and a dead join upstream was answering first.
           p.primary_color                AS "primaryColor",
           p.secondary_color              AS "secondaryColor",
           p.logo_url                     AS "logoUrl",
           p.strip_image_url              AS "stripImageUrl",
           p.promo_message                AS "promoMessage",
           p.promo_starts_at              AS "promoStartsAt",
           p.promo_ends_at                AS "promoEndsAt",
           p.promo_days                   AS "promoDays"
         -- city used to come from a second table: ops.businesses, the CHILD row that
         -- carried a tenant's trading details. build-v3 dissolved that child into the
         -- merchant itself, and the rename sweep turned the join into merchant.merchant
         -- joined to merchant.merchant on a column that never existed. Read t.city.
         FROM merchant.merchant AS t
         LEFT JOIN merchant.loyalty_program AS p ON p.merchant_id = t.id
         WHERE t.id = $1::uuid
         LIMIT 1`,
        [merchantId],
      ),
    );
    return rows[0] ?? null;
  }

  async updateMerchantName(merchantId: string, name: string): Promise<void> {
    await this.pg.withMerchant((c) =>
      c.query(`UPDATE merchant.merchant SET name = $2, updated_at = now() WHERE id = $1::uuid`, [
        merchantId,
        name,
      ]),
    );
  }

  async updateProgram(merchantId: string, patch: Record<string, unknown>): Promise<void> {
    // One column-keyed jsonb patch, fixed columns: a key PRESENT in the patch is written
    // (present-but-null clears the column), an ABSENT key is left untouched. The statement
    // stays STATIC (preflight can PREPARE it) while preserving the settings form's
    // partial-update + clear-a-field semantics the old branding jsonb merge had.
    await this.pg.withMerchant((c) =>
      c.query(
        `UPDATE merchant.loyalty_program p SET
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
         WHERE p.merchant_id = $1::uuid`,
        [merchantId, JSON.stringify(patch)],
      ),
    );
  }

  async stats(merchantId: string, dayStart: Date): Promise<Row> {
    return this.pg.withMerchant(async (c) => {
      const [visits, topups, pending] = await Promise.all([
        c.query<Row>(
          // count(*), NOT sum(stamps): this is "how many times did someone come
          // in today", an activity counter. A bulk catch-up credit is ONE
          // interaction worth many stamps. Card progress reads sum(stamps).
          `SELECT count(*)::int AS n FROM merchant.loyalty_visit
           WHERE merchant_id = $1::uuid AND occurred_at >= $2`,
          [merchantId, dayStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n, COALESCE(sum(delta), 0)::bigint AS sum
           FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [merchantId, dayStart],
        ),
        // pending rewards across all active cards = Σ max(visits/n − redemptions, 0)
        c.query<Row>(
          `WITH vr AS (
             SELECT COALESCE(${EFFECTIVE_VISITS_REQUIRED_SQL}, 10) AS n
           )
           SELECT COALESCE(sum(pend), 0)::int AS sum FROM (
             SELECT (
               (SELECT COALESCE(sum(v.stamps), 0) FROM merchant.loyalty_visit v
                 WHERE v.merchant_id = c.merchant_id AND v.card_id = c.id) / (SELECT n FROM vr)
               - (SELECT count(*) FROM merchant.loyalty_redemption r
                   WHERE r.merchant_id = c.merchant_id AND r.card_id = c.id)
             ) AS pend
             FROM merchant.loyalty_card c
             WHERE c.merchant_id = $1::uuid AND c.status = 'active'
           ) s WHERE pend > 0`,
          [merchantId],
        ),
      ]);
      return {
        visits: visits.rows[0],
        topups: topups.rows[0],
        pending: pending.rows[0],
      };
    });
  }

  async analytics(merchantId: string, w: AnalyticsWindows): Promise<Row> {
    return this.pg.withMerchant(async (c) => {
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
        highBalanceRow,
        birthdayRow,
      ] = await Promise.all([
        c.query<Row>(
          `SELECT occurred_at AS "scannedAt" FROM merchant.loyalty_visit
           WHERE merchant_id = $1::uuid AND occurred_at >= $2`,
          [merchantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT ca.customer_id::text AS "userId", cu.name AS name,
                  ca.card_number AS "cardNumber",
                  agg.total_visits::int   AS "totalVisits",
                  agg.balance_cents::int  AS "balanceCentavos"
           FROM merchant.loyalty_card AS ca
           LEFT JOIN merchant.customer AS cu ON cu.merchant_id = ca.merchant_id AND cu.id = ca.customer_id
           CROSS JOIN LATERAL (
             SELECT
               (SELECT COALESCE(sum(v.stamps), 0) FROM merchant.loyalty_visit v
                 WHERE v.merchant_id = ca.merchant_id AND v.card_id = ca.id) AS total_visits,
               COALESCE((SELECT sum(l.delta) FROM merchant.loyalty_stored_value_ledger l
                 WHERE l.merchant_id = ca.merchant_id AND l.card_id = ca.id), 0) AS balance_cents
           ) AS agg
           WHERE ca.merchant_id = $1::uuid
           ORDER BY agg.total_visits DESC NULLS LAST LIMIT 10`,
          [merchantId],
        ),
        c.query<Row>(
          `SELECT created_at AS "createdAt" FROM merchant.customer
           WHERE merchant_id = $1::uuid AND created_at >= $2`,
          [merchantId, w.eightWeeksAgo],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid`,
          [merchantId],
        ),
        c.query<Row>(
          `SELECT COALESCE(sum(delta), 0)::bigint AS sum FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id = $1::uuid AND reason = 'topup' AND created_at >= $2`,
          [merchantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(*)::int AS n FROM merchant.loyalty_redemption
           WHERE merchant_id = $1::uuid AND occurred_at >= $2`,
          [merchantId, w.monthStart],
        ),
        c.query<Row>(
          `SELECT count(DISTINCT card_id)::int AS n FROM merchant.loyalty_visit
           WHERE merchant_id = $1::uuid AND occurred_at >= $2`,
          [merchantId, w.thirtyDaysAgo],
        ),
        c.query<Row>(
          `SELECT
             (SELECT count(*)::int FROM merchant.customer WHERE merchant_id = $1::uuid) AS "totalCustomers",
             (SELECT COALESCE(sum(abs(delta)), 0)::bigint FROM merchant.loyalty_stored_value_ledger
                WHERE merchant_id = $1::uuid AND reason = 'purchase') AS "totalRevenueCentavos",
             -- count(*), NOT sum(stamps): all-time INTERACTIONS. ⚠ This number
             -- changes at the cutover, and the new one is the true one: the old
             -- backfill invented 87 synthetic rows so that count(*) matched a
             -- stamp total, so this read 624 where the customers had actually
             -- come in 537 times.
             (SELECT count(*)::bigint FROM merchant.loyalty_visit
                WHERE merchant_id = $1::uuid) AS "totalAllTimeVisits"`,
          [merchantId],
        ),
        c.query<Row>(
          `SELECT stamps_required AS "visitsRequired", value AS "rewardCostCentavos"
           FROM merchant.loyalty_reward
           WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [merchantId],
        ),
        // Cards whose wallet balance (SUM of the value ledger) is over $1,000.
        // Grouped per card, then counted, so a card with many ledger rows counts once.
        c.query<Row>(
          `SELECT count(*)::int AS n FROM (
             SELECT ca.id, COALESCE(sum(l.delta), 0) AS bal
             FROM merchant.loyalty_card AS ca
             LEFT JOIN merchant.loyalty_stored_value_ledger AS l
               ON l.merchant_id = ca.merchant_id AND l.card_id = ca.id
             WHERE ca.merchant_id = $1::uuid
             GROUP BY ca.id
           ) AS t WHERE t.bal > 100000`,
          [merchantId],
        ),
        // Birthday rewards a customer can still redeem: an 'active' grant whose
        // window has not closed. 'redeemed'/'expired' and past-window grants drop out.
        c.query<Row>(
          `SELECT count(*)::int AS n FROM merchant.loyalty_birthday_grant
           WHERE merchant_id = $1::uuid AND status = 'active' AND expires_at > now()`,
          [merchantId],
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
        highBalanceRow: highBalanceRow.rows,
        birthdayRow: birthdayRow.rows,
      };
    });
  }

  async adminCustomers(
    merchantId: string,
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
    const filter = `($2 = '' OR name ILIKE $3 OR phone ILIKE $3 OR email ILIKE $3 OR card_number ILIKE $3)`;
    return this.pg.withMerchant(async (c) => {
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
          [merchantId, opts.search, like, opts.limit, opts.skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `WITH ${CUST_CTE}
           SELECT count(*)::int AS n FROM cust WHERE ${filter}`,
          [merchantId, opts.search, like],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }

  /**
   * The café's reward ladder, in the shape the frozen umi-cash Rewards screen reads.
   *
   * THREE ANSWERS, NOT ONE. umi-cash kept a ladder as two active rows of
   * `loyalty.reward_configs` distinguished by `kind`: the standard reward (the lower
   * tier, e.g. capuccino at 7) and the optional `upgrade` tier above it (bebida en
   * las rocas at 9). build-v3 carried `kind` verbatim into `merchant.loyalty_reward`
   * and this reader used to ignore it, so the panel drew a ladder as one reward and
   * the second tier was invisible. El Gran Ribera sells that second tier.
   *
   * `history` stays standard-only, exactly as umi-cash's read did: it is the
   * "previous single rewards" list, and retired `upgrade` rows were never in it.
   *
   * `rewardCostCentavos` is cast to a NUMBER here. `value` is a bigint column, so
   * node-postgres hands it back as a string ("0") — umi-cash sent the number 0, and
   * the panel's cost field reads it numerically.
   */
  async rewardConfig(
    merchantId: string,
  ): Promise<{ active: Row[]; upgrade: Row[]; history: Row[] }> {
    // Maps build-v3's loyalty_reward onto the frozen umi-cash response names.
    // activated_at was dropped — each config save inserts a NEW row, so created_at
    // IS the activation moment; both "activatedAt" and "createdAt" read from it.
    const select = `
      id::text, merchant_id::text AS "merchantId", NULL::text AS "programId",
      stamps_required AS "visitsRequired", name AS "rewardName",
      description AS "rewardDescription", value AS "rewardCostCentavos",
      active AS "isActive", created_at AS "activatedAt", created_at AS "createdAt"`;
    const toApi = (r: Row): Row => ({
      ...r,
      rewardCostCentavos: Number(r.rewardCostCentavos ?? 0),
    });
    return this.pg.withMerchant(async (c) => {
      const [active, upgrade, history] = await Promise.all([
        c.query<Row>(
          `SELECT ${select} FROM merchant.loyalty_reward
           WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
             AND kind = 'standard'
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [merchantId],
        ),
        c.query<Row>(
          `SELECT ${select} FROM merchant.loyalty_reward
           WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
             AND kind = 'upgrade'
           ORDER BY created_at DESC NULLS LAST LIMIT 1`,
          [merchantId],
        ),
        c.query<Row>(
          `SELECT ${select} FROM merchant.loyalty_reward
           WHERE merchant_id = $1::uuid AND active = false AND type = 'stamps_free_item'
             AND kind = 'standard'
           ORDER BY created_at DESC NULLS LAST LIMIT 10`,
          [merchantId],
        ),
      ]);
      return {
        active: active.rows.map(toApi),
        upgrade: upgrade.rows.map(toApi),
        history: history.rows.map(toApi),
      };
    });
  }

  /**
   * The three rows `resolveRewardProfile` needs for one card: the café's active
   * standard reward, the café's active `upgrade` tier, and this card's own override.
   *
   * All three live in `merchant.loyalty_reward`, so the ladder and the per-card
   * override are one shape of query rather than three code paths.
   */
  async rewardProfileRows(
    merchantId: string,
    cardId: string | null,
  ): Promise<{
    defaultConfig: Row | null;
    upgradeConfig: Row | null;
    overrideConfig: Row | null;
  }> {
    return this.pg.withMerchant(async (c) => {
      const [rows, override] = await Promise.all([
        c.query<Row>(ACTIVE_LADDER_ROWS_SQL, [merchantId]),
        cardId
          ? c.query<Row>(CARD_OVERRIDE_ROW_SQL, [merchantId, cardId])
          : Promise.resolve({ rows: [] as Row[] }),
      ]);
      // Newest row wins within a kind: this query is already ordered by created_at
      // DESC, and a save inserts rather than updates.
      return {
        defaultConfig: rows.rows.find((r) => r.kind === 'standard') ?? null,
        upgradeConfig: rows.rows.find((r) => r.kind === 'upgrade') ?? null,
        overrideConfig: override.rows[0] ?? null,
      };
    });
  }

  /**
   * Admin-config write (not the inert customer-facing path) — see preflight §4.
   *
   * ⚠️ THE `kind` FILTER IS THE POINT OF THIS FUNCTION. Its first version retired
   * EVERY active reward row and inserted one `kind='standard'` row, so saving the
   * Rewards screen at a café with a ladder silently deleted the upper tier: El Gran
   * Ribera runs 7 = capuccino / 9 = latte o frappe, and a manager opening
   * Settings → Rewards and pressing save would have turned a sold two-tier program
   * into a single one, with no error and no audit. `kind IN ('standard','upgrade')`
   * retires exactly the rows this write replaces and leaves `kind='override'` rows
   * (per-card rewards) alone — they are inactive by design and must survive a
   * café-level save.
   *
   * Ported from umi-cash `admin/reward-config/route.ts` PUT, including the
   * pending-tier tag: turning a ladder ON tags every card that already holds a
   * banked reward, because those rewards were earned under the old single threshold
   * and must be handed over as the LOWER tier first (see
   * shared/loyalty/reward-tiers.ts, `bankedReward`).
   */
  async upsertRewardConfig(
    merchantId: string,
    _programId: string,
    data: {
      visitsRequired: number;
      rewardName: string;
      rewardDescription: string | null;
      rewardCostCentavos: number;
      upgrade: {
        visitsRequired: number;
        rewardName: string;
        rewardDescription: string | null;
        rewardCostCentavos: number;
      } | null;
    },
  ): Promise<Row> {
    const insert = (kind: string) => ({
      text: `INSERT INTO merchant.loyalty_reward
               (merchant_id, type, kind, stamps_required, name, description, value, active)
             VALUES ($1::uuid, 'stamps_free_item', $2, $3, $4, $5, $6, true)
             RETURNING id::text, merchant_id::text AS "merchantId", NULL::text AS "programId",
                       stamps_required AS "visitsRequired", name AS "rewardName",
                       description AS "rewardDescription", value AS "rewardCostCentavos",
                       active AS "isActive", created_at AS "activatedAt"`,
      kind,
    });
    return this.pg.withMerchant(async (c) => {
      // Serialize concurrent reward-rule saves per merchant so the
      // deactivate-then-insert can't interleave into two active rows of one kind.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`reward_config:${merchantId}`]);

      // Read the state the save is replacing BEFORE it is retired: the threshold in
      // force (which sizes the pending-tier tag below) and whether a ladder was
      // already on (an OFF→ON flip is the only time cards get tagged).
      const before = await c.query<Row>(
        `SELECT
           (SELECT stamps_required FROM merchant.loyalty_reward
             WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
               AND kind = 'standard'
             ORDER BY created_at DESC NULLS LAST LIMIT 1) AS n,
           EXISTS (SELECT 1 FROM merchant.loyalty_reward
             WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
               AND kind = 'upgrade') AS "hadUpgrade"`,
        [merchantId],
      );
      const previousThreshold = Number(before.rows[0]?.n ?? 0);
      const hadUpgrade = before.rows[0]?.hadUpgrade === true;

      // Retire the running tiers — every active STANDARD and UPGRADE row. Per-card
      // overrides are inactive and are deliberately not matched here.
      await c.query(
        `UPDATE merchant.loyalty_reward SET active = false, updated_at = now()
         WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
           AND kind IN ('standard','upgrade')`,
        [merchantId],
      );

      const standard = insert('standard');
      const { rows } = await c.query<Row>(standard.text, [
        merchantId,
        standard.kind,
        data.visitsRequired,
        data.rewardName,
        data.rewardDescription,
        data.rewardCostCentavos,
      ]);

      if (data.upgrade) {
        const upgrade = insert('upgrade');
        await c.query(upgrade.text, [
          merchantId,
          upgrade.kind,
          data.upgrade.visitsRequired,
          data.upgrade.rewardName,
          data.upgrade.rewardDescription,
          data.upgrade.rewardCostCentavos,
        ]);

        // Switching a ladder ON: every reward banked so far was earned under the
        // single standard threshold, so it must keep being handed over as the
        // standard reward — not the new upper tier the cycle banks from now on.
        // Re-tagging on a later OFF→ON flip is right too: while the ladder was off
        // every banked reward was, again, the standard one.
        if (!hadUpgrade && previousThreshold > 0) {
          // pending_rewards, derived the way LOYALTY_CARD_STATE_SQL derives it:
          // rewards earned under the threshold that was in force, minus the ones
          // already handed over. umi-cash read this off a cache column; build-v3 has
          // no cache, so it is computed here.
          await c.query(
            `UPDATE merchant.loyalty_card ca
                SET pending_tier1 = d.pending, updated_at = now()
               FROM (
                 SELECT c.id,
                        COALESCE((SELECT SUM(v.stamps) FROM merchant.loyalty_visit v
                                   WHERE v.merchant_id = c.merchant_id AND v.card_id = c.id), 0)::int
                          / $2::int
                        - (SELECT COUNT(*) FROM merchant.loyalty_redemption r
                            WHERE r.merchant_id = c.merchant_id AND r.card_id = c.id) AS pending
                   FROM merchant.loyalty_card c
                  WHERE c.merchant_id = $1::uuid
               ) AS d
              WHERE ca.merchant_id = $1::uuid AND ca.id = d.id AND d.pending > 0`,
            [merchantId, previousThreshold],
          );
        }
      }

      return {
        ...rows[0],
        rewardCostCentavos: Number(rows[0]?.rewardCostCentavos ?? 0),
      };
    });
  }

  async giftCards(
    merchantId: string,
    limit: number,
    skip: number,
  ): Promise<{ rows: Row[]; total: number }> {
    return this.pg.withMerchant(async (c) => {
      const rows = (
        await c.query<Row>(
          `SELECT id::text, masked_code AS code,
                  amount_cents AS "amountCentavos", sender_name AS "senderName",
                  recipient_name AS "recipientName", recipient_email AS "recipientEmail",
                  recipient_phone AS "recipientPhone", message,
                  (redeemed_at IS NOT NULL) AS "isRedeemed",
                  redeemed_at AS "redeemedAt", expires_at AS "expiresAt", created_at AS "createdAt"
           FROM merchant.loyalty_gift_card
           WHERE merchant_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`,
          [merchantId, limit, skip],
        )
      ).rows;
      const total = (
        await c.query<Row>(
          `SELECT count(*)::int AS n FROM merchant.loyalty_gift_card WHERE merchant_id = $1::uuid`,
          [merchantId],
        )
      ).rows[0]?.n;
      return { rows, total: Number(total ?? 0) };
    });
  }

  /**
   * One customer, for the staff detail screen. The identity spine holds the
   * phone and the email — `merchant.customer` carries neither — and the same
   * primary-then-newest rule the list uses picks which one to show.
   *
   * The card is the customer's ACTIVE card, newest first. A customer with no
   * card reads as not found: umi-cash answers `Cliente no encontrado` for both,
   * because a customer without a card has nothing this screen can show.
   */
  async adminCustomerDetail(merchantId: string, customerId: string): Promise<Row | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT cu.id::text AS id, cu.name, cu.birthday, cu.created_at AS "createdAt",
                c.id::text AS "cardId", c.card_number AS "cardNumber",
                c.created_at AS "cardCreatedAt",
                (SELECT ct.normalized_value FROM merchant.contact ct
                   JOIN umi.channel_type ch ON ch.id = ct.channel_id
                  WHERE ct.merchant_id = cu.merchant_id AND ct.customer_id = cu.id
                    AND ch.key IN ('phone', 'whatsapp', 'sms')
                  ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1) AS phone,
                (SELECT ct.normalized_value FROM merchant.contact ct
                   JOIN umi.channel_type ch ON ch.id = ct.channel_id
                  WHERE ct.merchant_id = cu.merchant_id AND ct.customer_id = cu.id
                    AND ch.key = 'email'
                  ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1) AS email
           FROM merchant.customer cu
           JOIN merchant.loyalty_card c
             ON c.merchant_id = cu.merchant_id AND c.customer_id = cu.id AND c.status = 'active'
          WHERE cu.merchant_id = $1::uuid AND cu.id = $2::uuid
          ORDER BY c.created_at DESC
          LIMIT 1`,
        [merchantId, customerId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * What she has spent here, and what she has loaded.
   *
   * Spend is stored as a NEGATIVE delta, so it is summed as an absolute value —
   * the screen shows "lifetime value", not "how far the balance fell".
   */
  async cardMoneyTotals(merchantId: string, cardId: string): Promise<Row> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT COALESCE(sum(abs(delta)) FILTER (WHERE reason = 'purchase'), 0)::bigint AS "ltvCentavos",
                COALESCE(sum(delta)      FILTER (WHERE reason = 'topup'),    0)::bigint AS "topupCentavos"
           FROM merchant.loyalty_stored_value_ledger
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid`,
        [merchantId, cardId],
      ),
    );
    return rows[0] ?? { ltvCentavos: 0, topupCentavos: 0 };
  }

  /**
   * Every customer at this cafe, for the CSV. Same projection as the list — no
   * paging, no search, and the registration date already rendered in the cafe's
   * own timezone.
   *
   * FORMATTED IN SQL on purpose. `toLocaleDateString('es-MX')` in Node renders
   * against the SERVER's clock, so a card created late in the evening in Mexico
   * City exports with the next day's date. `AT TIME ZONE` puts the date in the
   * zone the cafe actually keeps, and `FMDD/FMMM/YYYY` is the unpadded d/m/yyyy
   * that es-MX produces.
   */
  async adminExportRows(merchantId: string, timezone: string): Promise<Row[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `WITH ${CUST_CTE}, vr_n AS (SELECT n FROM vr)
         SELECT name, phone, email, card_number AS "cardNumber",
                balance_cents AS "balanceCentavos",
                total_visits AS "totalVisits",
                (total_visits % (SELECT n FROM vr_n))::int               AS "visitsThisCycle",
                (total_visits / (SELECT n FROM vr_n) - redemptions)::int AS "pendingRewards",
                to_char(created_at AT TIME ZONE $2, 'FMDD/FMMM/YYYY')    AS "registeredOn"
           FROM cust
          ORDER BY created_at DESC`,
        [merchantId, timezone],
      ),
    );
    return rows;
  }
}
