import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { isOpenAt, parseOpenHours } from '../business-hours/open-hours';
import { WEEKDAY_INDEX } from '../../shared/format/weekday';
import { LOYALTY_CARD_STATE_SQL, type LoyaltyCardState } from '../../shared/loyalty/card-state.sql';
import {
  ACTIVE_LADDER_ROWS_SQL,
  CARD_OVERRIDE_ROW_SQL,
} from '../../shared/loyalty/reward-config.sql';
import {
  expireCycleReward,
  syncCycleReward,
  redeemRewardEntitlements,
  restoreRewardEntitlement,
} from '../../shared/loyalty/reward-entitlements';
import { resolveRewardProfile } from '../../shared/loyalty/reward-profile';
import type { RewardConfigRow } from '../../shared/loyalty/reward-profile';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface RewardConfig {
  id: string;
  visits_required: number;
  reward_name: string | null;
  /** Café-authored copy, shown to the customer on her own card page. */
  reward_description: string | null;
}

export interface ScanMerchantConfig {
  name: string;
  timezone: string | null;
  lifecycleCopy: unknown;
  birthdayRewardName: string | null;
  /** May staff credit more than one stamp in one action? See `seals()`. */
  multiSealEnabled: boolean;
}

export interface CreditSealsInput {
  merchantId: string;
  cardId: string;
  staffMemberId: string;
  seals: number;
  note: string | null;
  idempotencyKey: string | null;
  /**
   * The lifecycle moment this credit leaves on the card, rendered by the service.
   * Written on EVERY applied credit — the legacy seals route did, and the moment is
   * the pass's only notification channel. Null clears a stale one.
   */
  momentMessage: string | null;
}

export interface CreditSealsResult {
  /** The key had already been used: nothing was written this time. */
  replayed: boolean;
  /** Cycle position BEFORE the credit — the only input the reward maths needs. */
  cycleBefore: number;
  visitsRequired: number;
  card: ScannedCard;
}

export interface PerformScanInput {
  merchantId: string;
  cardId: string;
  staffMemberId: string | null;
  doBirthday: boolean;
  birthdayRewardId: string | null;
  doRedeem: boolean;
  rewardConfigId: string | null;
  /**
   * The redemption consumed one of the card's pre-ladder banked rewards, so the
   * `pending_tier1` counter comes down by one with it. False when the reward handed
   * over was the top tier (or the café runs no ladder).
   */
  decrementPendingTier1: boolean;
  /**
   * The canje was an EARLY CASH-OUT (`REDEEM_BASE`): the lower tier left the bar
   * before the cycle completed, so the card is torn off — the cycle anchor moves to
   * here and the canje is recorded as `cycle_reset` so it does not consume a banked
   * reward. See 79_cycle_anchor.sql.
   */
  resetCycle: boolean;
  doVisit: boolean;
  earnedReward: boolean;
  newVisitsThisCycle: number;
  momentMessage: string | null;
  newQrToken: string;
  redeemQuantity?: number;
  externalReceiptNumber?: string;
  commandId?: string;
}

/** One canje, as the revert path reads it. */
export interface RedemptionRow {
  id: string;
  cardId: string;
  rewardId: string | null;
  rewardName?: string | null;
  isBase?: boolean | null;
  revertedAt: Date | null;
  /** The canje was an early cash-out (it consumed the cycle, not a banked reward). */
  cycleReset: boolean;
}

/**
 * What a scan reports back. It is the shared derived state, unchanged — the
 * register and the wallet pass must never disagree about these numbers.
 */
export type ScannedCard = LoyaltyCardState & {
  redemptionResult?: Awaited<ReturnType<typeof redeemRewardEntitlements>>;
};
export type LockedScannedCard = ScannedCard & {
  id: string;
  person_id: string | null;
  display_name: string | null;
  normalized_email: string | null;
  qr_token: string | null;
};

/**
 * Scan reads + the atomic visit/redeem/birthday mutation. Scan touches loyalty
 * STATE only (visits/rewards/birthday) — never money, so it must NOT write the
 * card_ledger.
 *
 * DERIVED-STATE MODEL (canonical rebuild v2): `merchant.loyalty_card` is identity-only —
 * the old total_visits / visits_this_cycle / pending_rewards / balance_cents
 * caches are GONE. They are computed from the event tables on read:
 *   total_visits       = COUNT(merchant.loyalty_visit)
 *   visits_this_cycle  = total_visits % visits_required
 *   pending_rewards    = floor(total_visits / visits_required)
 *                          − COUNT(merchant.loyalty_redemption)
 *   balance_cents      = COALESCE(SUM(merchant.loyalty_stored_value_ledger.delta), 0)
 * where visits_required is the merchant's active merchant.loyalty_reward (default 10).
 * The scan mutation therefore only appends the visit / reward_redemption rows
 * (which it already did) and rotates the QR token — no cache to update.
 */
@Injectable()
export class CashScanRepository {
  constructor(private readonly pg: PgService) {}

  private onClient<T>(
    client: PoolClient | undefined,
    work: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    return client ? work(client) : this.pg.withMerchant(work);
  }

  async withLockedCard<T>(
    merchantId: string,
    cardId: string,
    work: (client: PoolClient, card: LockedScannedCard) => Promise<T>,
    client?: PoolClient,
  ): Promise<T> {
    return this.onClient(client, async (c) => {
      const locked = await c.query<LockedScannedCard>(
        `SELECT lc.id::text, lc.customer_id::text AS person_id, lc.qr_token,
                cu.name AS display_name, NULL::text AS normalized_email
         FROM merchant.loyalty_card lc
         LEFT JOIN merchant.customer cu ON cu.merchant_id=lc.merchant_id AND cu.id=lc.customer_id
         WHERE lc.merchant_id=$1::uuid AND lc.id=$2::uuid FOR UPDATE OF lc`,
        [merchantId, cardId],
      );
      if (!locked.rows[0]) throw new NotFoundException('card_not_found');
      await expireCycleReward(c, merchantId, cardId);
      return work(c, { ...locked.rows[0], ...(await this.cardState(c, merchantId, cardId)) });
    });
  }

  async findScanTarget(
    c: PoolClient,
    merchantId: string,
    identifier: string,
    allowPhone: boolean,
  ): Promise<LockedScannedCard | null> {
    const { rows } = await c.query<LockedScannedCard>(
      `SELECT lc.id::text, lc.card_number, lc.qr_token, lc.customer_id::text AS person_id,
              cu.name AS display_name, NULL::text AS normalized_email
       FROM merchant.loyalty_card lc
       LEFT JOIN merchant.customer cu ON cu.id=lc.customer_id AND cu.merchant_id=lc.merchant_id
       WHERE lc.merchant_id=$1::uuid AND (lc.id::text=$2 OR lc.card_number=$2)
       LIMIT 1`,
      [merchantId, identifier],
    );
    if (rows[0] || !allowPhone) return rows[0] ?? null;
    const phone = await c.query<{ id: string }>(
      `SELECT lc.id::text FROM merchant.contact ct
       JOIN umi.channel_type ch ON ch.id=ct.channel_id
       JOIN merchant.loyalty_card lc ON lc.customer_id=ct.customer_id AND lc.merchant_id=ct.merchant_id
       WHERE ct.merchant_id=$1::uuid AND ct.normalized_value=merchant.normalize_phone($2)
         AND ch.key IN ('phone','whatsapp','sms') AND lc.status='active'
       ORDER BY ct.is_primary DESC, ct.updated_at DESC, lc.created_at LIMIT 1`,
      [merchantId, identifier],
    );
    return phone.rows[0] ? this.findScanTarget(c, merchantId, phone.rows[0].id, false) : null;
  }

  async writeLifecycleMessage(c: PoolClient, merchantId: string, cardId: string, message: string) {
    await c.query(
      `UPDATE merchant.loyalty_card SET lifecycle_message=$3,
      lifecycle_message_at=clock_timestamp(), updated_at=clock_timestamp()
      WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, cardId, message],
    );
  }

  async authenticatedStaff(c: PoolClient, merchantId: string, userId: string) {
    const { rows } = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM merchant.staff WHERE merchant_id=$1::uuid
       AND user_id=$2::uuid AND status='active' LIMIT 1`,
      [merchantId, userId],
    );
    return rows[0] ?? null;
  }

  async activeRewardConfig(merchantId: string): Promise<RewardConfig | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<RewardConfig>(
        `SELECT id::text, stamps_required AS visits_required, name AS reward_name,
                description AS reward_description
         FROM merchant.loyalty_reward
         WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
           AND kind = 'standard'
         ORDER BY created_at DESC NULLS LAST LIMIT 1`,
        [merchantId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * The three reward rows that decide what this card is working toward: the café's
   * standard reward, the café's optional `upgrade` tier, and the card's own
   * override. `resolveRewardProfile` turns them into one profile — the same
   * resolution umi-cash ran, and the same one the wallet pass and the admin screens
   * use, so the till and the customer's phone cannot disagree.
   */
  async rewardProfileRows(
    merchantId: string,
    cardId: string,
    client?: PoolClient,
  ): Promise<{
    defaultConfig: RewardConfigRow | null;
    upgradeConfig: RewardConfigRow | null;
    overrideConfig: RewardConfigRow | null;
  }> {
    return this.onClient(client, async (c) => {
      const [rows, override] = await Promise.all([
        c.query<Row>(ACTIVE_LADDER_ROWS_SQL, [merchantId]),
        c.query<Row>(CARD_OVERRIDE_ROW_SQL, [merchantId, cardId]),
      ]);
      // Both statements are ordered newest-first within a kind, and a reward-config
      // save inserts rather than updates.
      return {
        defaultConfig: (rows.rows.find((r) => r.kind === 'standard') as RewardConfigRow) ?? null,
        upgradeConfig: (rows.rows.find((r) => r.kind === 'upgrade') as RewardConfigRow) ?? null,
        overrideConfig: (override.rows[0] as RewardConfigRow) ?? null,
      };
    });
  }

  async merchantConfig(
    merchantId: string,
    client?: PoolClient,
  ): Promise<ScanMerchantConfig | null> {
    const { rows } = await this.onClient(client, (c) =>
      c.query<Row>(
        `SELECT t.name, t.timezone,
                s.lifecycle_copy AS lifecycle_copy,
                s.birthday_reward_name AS birthday_reward_name,
                s.multi_seal_enabled AS multi_seal_enabled
         FROM merchant.merchant AS t
         LEFT JOIN merchant.loyalty_program AS s ON s.merchant_id = t.id
         WHERE t.id = $1::uuid LIMIT 1`,
        [merchantId],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      name: r.name,
      timezone: r.timezone,
      lifecycleCopy: r.lifecycle_copy,
      birthdayRewardName: r.birthday_reward_name,
      // The LEFT JOIN misses for a café with no loyalty program row at all, and
      // a missing program is not permission to bulk-credit. OFF is the safe read.
      multiSealEnabled: r.multi_seal_enabled === true,
    };
  }

  /** A visit within the last `seconds` (wallet 60s replay guard). */
  async recentVisitWithin(
    merchantId: string,
    cardId: string,
    seconds: number,
    client?: PoolClient,
  ): Promise<boolean> {
    const { rows } = await this.onClient(client, (c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= clock_timestamp() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [merchantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  /** A visit since merchant-timezone local midnight (1-per-day guard). DST-safe. */
  async visitedToday(
    merchantId: string,
    cardId: string,
    tz: string,
    client?: PoolClient,
  ): Promise<boolean> {
    const { rows } = await this.onClient(client, (c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= (date_trunc('day', clock_timestamp() AT TIME ZONE $3) AT TIME ZONE $3)
         LIMIT 1`,
        [merchantId, cardId, tz],
      ),
    );
    return rows.length > 0;
  }

  /**
   * The most recent visit today, or null. `visitedToday` answers the same
   * question with a boolean and gates the write; preview shows staff WHEN the
   * card was last stamped, so it needs the timestamp too.
   */
  async lastVisitToday(merchantId: string, cardId: string, tz: string): Promise<Date | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ occurred_at: Date }>(
        `SELECT occurred_at FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= (date_trunc('day', clock_timestamp() AT TIME ZONE $3) AT TIME ZONE $3)
         ORDER BY occurred_at DESC
         LIMIT 1`,
        [merchantId, cardId, tz],
      ),
    );
    return rows[0]?.occurred_at ?? null;
  }

  /**
   * Credit N stamps in ONE interaction ("Agregar sellos"): the catch-up for a
   * customer who arrived from an external loyalty system, whose old stamps we
   * cannot import.
   *
   * ONE ROW, not N. `merchant.loyalty_visit.stamps` carries the magnitude, and
   * the derived state reads `SUM(stamps)` — so a single row worth 8 is worth 8
   * stamps and still one visit. Writing 8 rows would fabricate 8 visits at the
   * same microsecond, which is the history-destroying shape the backfill was
   * corrected away from (20_merchant.sql:697).
   *
   * There is no cache to bump: pending rewards fall out of the same SUM.
   *
   * IDEMPOTENT BY INDEX, not by read-then-write. `loyalty_visit_idem_uq` is a
   * partial unique index on (merchant_id, idempotency_key), so the database — not
   * a prior SELECT — is what makes a double-tap land once. `DO NOTHING` returns
   * no row, and that absence IS the replay signal.
   *
   * The card row is locked first so two concurrent credits on the same card read
   * their cycle position one after the other; otherwise both could read the same
   * "before" and both claim the reward it crossed.
   */
  async creditSeals(input: CreditSealsInput, client?: PoolClient): Promise<CreditSealsResult> {
    if (!Number.isInteger(input.seals) || input.seals < 1 || input.seals > 50)
      throw new BadRequestException('Invalid stamp quantity');
    return this.withLockedCard(
      input.merchantId,
      input.cardId,
      async (c) => {
        const before = await this.cardState(c, input.merchantId, input.cardId);

        const existing = input.idempotencyKey
          ? (
              await c.query<Row>(
                `SELECT card_id::text, staff_id::text, stamps, note FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND idempotency_key=$2`,
                [input.merchantId, input.idempotencyKey],
              )
            ).rows[0]
          : null;
        if (existing) {
          if (
            existing.card_id !== input.cardId ||
            existing.staff_id !== input.staffMemberId ||
            existing.stamps !== input.seals ||
            existing.note !== input.note
          ) {
            throw new ConflictException('IDEMPOTENCY_CONFLICT');
          }
          return {
            replayed: true,
            cycleBefore: before.visits_this_cycle,
            visitsRequired: before.visits_required,
            card: before,
          };
        }
        const enabled = before.reward_policy === 'single_cycle';
        if (enabled) {
          const cfg = await this.merchantConfig(input.merchantId, c);
          if (!cfg?.multiSealEnabled) throw new ForbiddenException('Función no habilitada');
          if (before.visit_blocked_reason || before.visits_this_cycle + input.seals > 9)
            throw new BadRequestException('Credit exceeds the remaining cycle capacity');
        }
        const inserted = await c.query<{ id: string }>(
          `INSERT INTO merchant.loyalty_visit
           (merchant_id, card_id, staff_id, source, stamps, note, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'manual_bulk', $4, $5, $6)
         ON CONFLICT (merchant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING
         RETURNING id`,
          [
            input.merchantId,
            input.cardId,
            input.staffMemberId,
            input.seals,
            input.note,
            input.idempotencyKey,
          ],
        );
        const replayed = inserted.rows.length === 0;
        if (replayed) {
          const row = (
            await c.query<Row>(
              `SELECT card_id::text, staff_id::text, stamps, note FROM merchant.loyalty_visit
             WHERE merchant_id=$1::uuid AND idempotency_key=$2`,
              [input.merchantId, input.idempotencyKey],
            )
          ).rows[0];
          if (
            !row ||
            row.card_id !== input.cardId ||
            row.staff_id !== input.staffMemberId ||
            row.stamps !== input.seals ||
            row.note !== input.note
          ) {
            throw new ConflictException('IDEMPOTENCY_CONFLICT');
          }
        }

        // ⚠️ THE CARD ROW IS TOUCHED ON EVERY APPLIED CREDIT, crossing or not, and that
        // is not bookkeeping. Apple answers `passesUpdatedSince` by comparing the card
        // row; a stamp that leaves `updated_at` alone makes the phone ask "anything
        // new?", hear "no" (204), and show NOTHING — no stamp, and no notification,
        // because a 204 delivers no changeMessage. Reported from a real phone:
        // "intenté agregar un sello y me salió que sí se hizo, pero mi wallet no se
        // actualizó y no me llegó ninguna notificación".
        //
        // A bulk credit crosses the threshold as many times as it must — the one place
        // a single action can complete more than one cycle. Counted as a difference of
        // floors so a credit landing mid-cycle is worth exactly the crossings it added.
        if (!replayed) {
          const crossed = enabled
            ? 0
            : Math.floor(
                (before.total_visits + input.seals - before.cycle_anchor) / before.visits_required,
              ) - Math.floor((before.total_visits - before.cycle_anchor) / before.visits_required);
          await c.query(
            `UPDATE merchant.loyalty_card
              SET rewards_earned = rewards_earned + $3,
                  lifecycle_message = $4::text,
                  lifecycle_message_at = CASE WHEN $4 IS NULL THEN NULL ELSE now() END,
                  updated_at = now()
            WHERE merchant_id = $1::uuid AND id = $2::uuid`,
            [input.merchantId, input.cardId, crossed, input.momentMessage],
          );
        }

        if (enabled && !replayed) {
          const rows = await this.rewardProfileRows(input.merchantId, input.cardId, c);
          await syncCycleReward(c, {
            merchantId: input.merchantId,
            cardId: input.cardId,
            lifetimeTotal: before.total_visits + input.seals,
            cycleAnchor: before.cycle_anchor,
            profile: resolveRewardProfile(
              rows.defaultConfig,
              rows.overrideConfig,
              rows.upgradeConfig,
            ),
          });
        }
        return {
          replayed,
          cycleBefore: before.visits_this_cycle,
          visitsRequired: before.visits_required,
          card: replayed ? before : await this.cardState(c, input.merchantId, input.cardId),
        };
      },
      client,
    );
  }

  /** The shared derived state, on a client already inside a transaction. */
  private async cardState(c: PoolClient, merchantId: string, cardId: string): Promise<ScannedCard> {
    const { rows } = await c.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [merchantId, cardId]);
    if (!rows[0]) throw new NotFoundException({ error: 'Tarjeta no encontrada' });
    return rows[0];
  }

  async recentRedemptionWithin(
    merchantId: string,
    cardId: string,
    seconds: number,
    client?: PoolClient,
  ): Promise<boolean> {
    const { rows } = await this.onClient(client, (c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_redemption
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= clock_timestamp() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [merchantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  async activeBirthdayReward(
    merchantId: string,
    cardId: string,
    client?: PoolClient,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.onClient(client, (c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM merchant.loyalty_birthday_grant
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND status='active' AND expires_at > clock_timestamp()
         ORDER BY issued_at DESC LIMIT 1`,
        [merchantId, cardId],
      ),
    );
    return rows[0] ?? null;
  }

  /** One canje, scoped to the café it was made at. */
  async findRedemption(merchantId: string, redemptionId: string): Promise<RedemptionRow | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<RedemptionRow>(
        `SELECT r.id::text AS id, r.card_id::text AS "cardId", r.reward_id::text AS "rewardId",
                r.reverted_at AS "revertedAt", r.cycle_reset AS "cycleReset",
                CASE WHEN COALESCE(l.claimed_tier, CASE WHEN r.reward_id=e.base_reward_id THEN 'base' ELSE e.tier END)='base'
                     THEN e.base_reward_name ELSE e.top_reward_name END AS "rewardName",
                CASE WHEN e.id IS NOT NULL THEN
                     COALESCE(l.claimed_tier, CASE WHEN r.reward_id=e.base_reward_id THEN 'base' ELSE e.tier END)='base'
                     ELSE NULL END AS "isBase"
           FROM merchant.loyalty_redemption r
           LEFT JOIN merchant.loyalty_reward_redemption_link l ON l.merchant_id=r.merchant_id AND l.redemption_id=r.id
           LEFT JOIN merchant.loyalty_reward_entitlement e ON e.merchant_id=l.merchant_id AND e.id=l.entitlement_id
          WHERE r.merchant_id = $1::uuid AND r.id = $2::uuid`,
        [merchantId, redemptionId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Undo a canje: mark it reverted, and give the customer the reward back.
   *
   * THREE THINGS, and all three are needed for the undo to be an undo:
   *
   *  1. `reverted_at` + who did it. The row STAYS — the bitácora has to show that a
   *     canje happened and was taken back, and the reversal is audited, not erased.
   *  2. The reward comes back by itself: `pending_rewards` derives from the canjes
   *     that still stand (card-state.sql.ts excludes reverted rows), so marking the
   *     row is what restores it. There is no counter to increment here — which is
   *     exactly why that filter had to exist before this route could be ported.
   *  3. `pending_tier1` goes back up when the canje handed over the LOWER tier: the
   *     tag is the record that this card is owed a lower-tier reward.
   *
   * The card row is locked for the transaction so a double-tap, or a scan landing
   * at the same moment, cannot revert twice or credit two rewards.
   */
  async revertRedemption(input: {
    merchantId: string;
    userId?: string;
    redemptionId: string;
    cardId: string;
    staffMemberId: string | null;
    /** The canje handed over the ladder's lower tier, so the tag comes back. */
    restoreBaseTier: boolean;
    /**
     * The canje was an EARLY CASH-OUT. Reverting it hands the customer a BANKED
     * reward back (not a cycle position: the visits it took are gone, and umi-cash
     * made the same choice — "a banked capuccino is the honest restoration").
     */
    restoreEarnedReward: boolean;
    /** The lock-screen line the customer sees: her reward is back. */
    message: string;
  }): Promise<{ alreadyReverted: boolean; card: ScannedCard | null }> {
    return this.withLockedCard(input.merchantId, input.cardId, async (c, before) => {
      if (input.userId) {
        const staff = await this.authenticatedStaff(c, input.merchantId, input.userId);
        if (!staff || staff.id !== input.staffMemberId)
          throw new ForbiddenException('Tu usuario no está registrado como personal');
      }

      const fresh = await c.query<Row>(
        `SELECT reverted_at AS "revertedAt" FROM merchant.loyalty_redemption
          WHERE merchant_id = $1::uuid AND id = $2::uuid AND card_id=$3::uuid
          FOR UPDATE`,
        [input.merchantId, input.redemptionId, input.cardId],
      );
      if (!fresh.rows[0]) throw new NotFoundException('redemption_not_found');
      if (fresh.rows[0].revertedAt) return { alreadyReverted: true, card: before };

      const restored = await restoreRewardEntitlement(c, input.merchantId, input.redemptionId);
      await c.query(
        `UPDATE merchant.loyalty_redemption
            SET reverted_at = now(), reverted_by_staff_id = $3::uuid
          WHERE merchant_id = $1::uuid AND id = $2::uuid`,
        [input.merchantId, input.redemptionId, input.staffMemberId],
      );
      if (before.reward_policy !== 'single_cycle' && !restored.linked && input.restoreBaseTier) {
        await c.query(
          `UPDATE merchant.loyalty_card SET pending_tier1 = pending_tier1 + 1, updated_at = now()
            WHERE merchant_id = $1::uuid AND id = $2::uuid`,
          [input.merchantId, input.cardId],
        );
      }
      // A reverted canje stops counting against pending_rewards by itself (the
      // derivation excludes reverted rows). An early cash-out never counted in the
      // first place, so undoing one has to hand a reward back explicitly.
      if (
        before.reward_policy !== 'single_cycle' &&
        !restored.linked &&
        input.restoreEarnedReward
      ) {
        await c.query(
          `UPDATE merchant.loyalty_card SET rewards_earned = rewards_earned + 1, updated_at = now()
            WHERE merchant_id = $1::uuid AND id = $2::uuid`,
          [input.merchantId, input.cardId],
        );
      }
      await c.query(
        `UPDATE merchant.loyalty_card
            SET lifecycle_message = $3, lifecycle_message_at = now(), updated_at = now()
          WHERE merchant_id = $1::uuid AND id = $2::uuid`,
        [input.merchantId, input.cardId, input.message],
      );

      const { rows } = await c.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [
        input.merchantId,
        input.cardId,
      ]);
      return { alreadyReverted: false, card: rows[0] };
    });
  }

  /**
   * Best-effort after-hours flag for a staff scan, against `merchant.merchant.open_hours`
   * in the café's timezone. True when the café has no hours for the local day, or the
   * scan falls outside them.
   *
   * The evaluation is `open-hours.ts`, the same code the bot and the dashboard use —
   * not a second implementation in SQL. The old version compared `now_time` against
   * `opens_at`/`closes_at` in the query, which quietly could not represent a café open
   * past midnight: `01:00 >= closes_at` is true for every window, so a late scan was
   * always "after hours".
   *
   * SCOPE: the café's hours, not the location's. This endpoint has no location in scope —
   * a staff scan carries a card and a merchant — so a location that keeps its own hours is
   * not consulted here. Worth revisiting when the register carries its device's location.
   */
  async isAfterHours(merchantId: string, tz: string, client?: PoolClient): Promise<boolean> {
    try {
      const rows = await this.onClient(client, (c) =>
        c
          .query<{ open_hours: unknown }>(
            `SELECT open_hours FROM merchant.merchant WHERE id = $1::uuid`,
            [merchantId],
          )
          .then((r) => r.rows),
      );
      if (!rows[0]) return true; // no café → treat as closed, as before
      const hours = parseOpenHours(rows[0].open_hours);
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday: 'long',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        })
          .formatToParts(new Date())
          .map((p) => [p.type, p.value]),
      );
      const dow = WEEKDAY_INDEX[parts.weekday] ?? 0;
      const minutes = (parseInt(parts.hour, 10) % 24) * 60 + parseInt(parts.minute, 10);
      return !isOpenAt(hours, dow, minutes, `${parts.year}-${parts.month}-${parts.day}`);
    } catch {
      return false; // non-blocking informational flag
    }
  }

  /**
   * Apply the selected actions in one transaction (BIRTHDAY → REDEEM → VISIT),
   * rotate the QR token, then RE-DERIVE the card summary from the event tables
   * (no caches on merchant.loyalty_card). The visit / reward_redemption inserts are the
   * source of truth the derive reads back.
   */
  async performScan(input: PerformScanInput, client?: PoolClient): Promise<ScannedCard> {
    return this.withLockedCard(
      input.merchantId,
      input.cardId,
      async (c) => {
        // ONE SCAN AT A TIME PER CARD. The derived numbers used to be pure functions
        // of the events, so two concurrent scans could not corrupt anything the second
        // one had not yet written. The card's anchors are that no longer: this is a
        // read-modify-write, and the same lock the revert path takes keeps a
        // double-tap, a retry and a two-device race from counting a reward twice.

        // State as the transaction sees it, UNDER the lock — not the copy the service
        // read before it. Both anchors ride along in the shared query.
        const before = await this.cardState(c, input.merchantId, input.cardId);

        const enabled = before.reward_policy === 'single_cycle';
        const profileRows = await this.rewardProfileRows(input.merchantId, input.cardId, c);
        const profile = resolveRewardProfile(
          profileRows.defaultConfig,
          profileRows.overrideConfig,
          profileRows.upgradeConfig,
        );
        if (
          enabled &&
          input.doVisit &&
          (before.visit_blocked_reason || before.visits_this_cycle >= 9)
        ) {
          throw new BadRequestException('Redeem the available reward before another visit');
        }
        if (enabled && input.doVisit && input.doRedeem)
          throw new BadRequestException('Separate visit and redemption');
        if (
          enabled &&
          input.doRedeem &&
          (!input.externalReceiptNumber?.trim() || !input.commandId || !input.staffMemberId)
        ) {
          throw new BadRequestException('Receipt, command and staff required');
        }
        let redemptionResult: ScannedCard['redemptionResult'];
        if (enabled && input.doRedeem) {
          const selection = input.resetCycle
            ? 'cycle_base'
            : before.visits_this_cycle >= 9 && (input.redeemQuantity ?? 1) === 1
              ? 'cycle_top'
              : (before.legacy_pending_rewards ?? 0) > 0
                ? 'legacy'
                : 'cycle_top';
          redemptionResult = await redeemRewardEntitlements(c, {
            merchantId: input.merchantId,
            cardId: input.cardId,
            quantity: input.redeemQuantity ?? 1,
            staffId: input.staffMemberId!,
            externalReceiptNumber: input.externalReceiptNumber!,
            commandId: input.commandId,
            selection,
          });
        }
        let cycleAnchor = redemptionResult
          ? (await this.cardState(c, input.merchantId, input.cardId)).cycle_anchor
          : before.cycle_anchor;
        let rewardsEarned = before.rewards_earned;

        if (input.doBirthday && input.birthdayRewardId) {
          const birthday = await c.query(
            `UPDATE merchant.loyalty_birthday_grant SET status='redeemed', redeemed_at=now()
           WHERE merchant_id=$1::uuid AND card_id=$3::uuid AND id=$2::uuid
             AND status='active' AND expires_at > clock_timestamp() RETURNING id`,
            [input.merchantId, input.birthdayRewardId, input.cardId],
          );
          if (!birthday.rows[0]) throw new BadRequestException('No active birthday gift');
        }
        if (!enabled && input.doRedeem && input.rewardConfigId) {
          await c.query(
            `INSERT INTO merchant.loyalty_redemption
             (merchant_id, card_id, reward_id, reason, staff_id, cycle_reset)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'stamps', $4::uuid, $5)`,
            [
              input.merchantId,
              input.cardId,
              input.rewardConfigId,
              input.staffMemberId,
              input.resetCycle,
            ],
          );
        }
        // An EARLY CASH-OUT tears the card off: the cycle restarts here, at the stamp
        // count the customer has reached — which is why the position is not a modulo
        // of the threshold any more, and why this anchor exists at all. Taken before
        // the visit below, exactly as umi-cash ordered it (cycleNow = 0, then the
        // visit lands on the fresh cycle).
        if (!enabled && input.doRedeem && input.resetCycle) {
          cycleAnchor = before.total_visits;
        }
        // Handing over a pre-ladder banked reward retires one tag with it — the
        // counter tracks exactly the rewards that are owed as the LOWER tier, so it
        // must come down as they are handed over. GREATEST(0, …) so a counter that
        // somehow drifted below the truth can never go negative (the column carries a
        // CHECK for that, and a failing scan is worse than a clamped one).
        if (!enabled && input.doRedeem && input.decrementPendingTier1) {
          await c.query(
            `UPDATE merchant.loyalty_card
              SET pending_tier1 = GREATEST(0, pending_tier1 - 1), updated_at = now()
            WHERE merchant_id = $1::uuid AND id = $2::uuid`,
            [input.merchantId, input.cardId],
          );
        }
        if (input.doVisit) {
          await c.query(
            `INSERT INTO merchant.loyalty_visit (merchant_id, card_id, staff_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid)`,
            [input.merchantId, input.cardId, input.staffMemberId],
          );
          // A visit that crosses the threshold COMPLETES a cycle, and nothing in the
          // events records that: umi-cash incremented a cache. `rewards_earned` is
          // that fact, stated. One visit is one stamp, so this is a single crossing at
          // most, but the floor-difference form keeps it honest if the threshold ever
          // shrank under a card.
          const after = before.total_visits + 1;
          if (!enabled)
            rewardsEarned +=
              Math.floor((after - cycleAnchor) / before.visits_required) -
              Math.floor((before.total_visits - cycleAnchor) / before.visits_required);
        }
        // Rotate the QR token; stamp the lifecycle moment message on a visit. No
        // ⚠️ THE MESSAGE IS WRITTEN ON EVERY SCAN, and it may be NULL. umi-cash wrote
        // it unconditionally (`lifecycleMetadata(fresh.metadata, momentMessage)`), and
        // that is what makes the field trustworthy: a scan with no moment CLEARS the
        // previous one, so a "you earned a reward" line from this morning cannot
        // linger on a pass through an afternoon redemption. Writing it only on visits
        // left the redeem-only path (banked OR early cash-out — a real thing the
        // register does) keeping whatever the last visit said. Found by the live
        // rehearsal in REGISTER_FLIP_PARITY.md.
        const upd = await c.query<{ card_number: string }>(
          `UPDATE merchant.loyalty_card SET
           lifecycle_message    = $3::text,
           lifecycle_message_at = CASE WHEN $3 IS NULL THEN NULL ELSE now() END,
           qr_token = $4, qr_issued_at = now(), updated_at = now(),
           cycle_anchor = $5, rewards_earned = $6
         WHERE merchant_id=$1::uuid AND id=$2::uuid
         RETURNING card_number`,
          [
            input.merchantId,
            input.cardId,
            input.momentMessage,
            input.newQrToken,
            cycleAnchor,
            rewardsEarned,
          ],
        );
        // No row → card vanished mid-scan or is RLS-filtered; surface a clear 404
        // instead of returning undefined (which callers read as ScannedCard).
        if (!upd.rows[0]) throw new NotFoundException('card_not_found');
        if (enabled && input.doVisit)
          await syncCycleReward(c, {
            merchantId: input.merchantId,
            cardId: input.cardId,
            lifetimeTotal: before.total_visits + 1,
            cycleAnchor,
            profile,
          });

        // Derived summary. The formula lives in one place
        // because the wallet pass shows the same four numbers to the same customer
        // at the same moment — see shared/loyalty/card-state.sql.ts.
        const { rows } = await c.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [
          input.merchantId,
          input.cardId,
        ]);
        return { ...rows[0], ...(redemptionResult ? { redemptionResult } : {}) };
      },
      client,
    );
  }
}
