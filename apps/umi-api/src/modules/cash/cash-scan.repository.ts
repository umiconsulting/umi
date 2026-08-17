import { Injectable, NotFoundException } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { isOpenAt, parseOpenHours } from '../business-hours/open-hours';
import { WEEKDAY_INDEX } from '../../shared/format/weekday';
import { LOYALTY_CARD_STATE_SQL, type LoyaltyCardState } from '../../shared/loyalty/card-state.sql';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface RewardConfig {
  id: string;
  visits_required: number;
  reward_name: string | null;
}

export interface ScanMerchantConfig {
  name: string;
  timezone: string | null;
  lifecycleCopy: unknown;
  birthdayRewardName: string | null;
}

export interface PerformScanInput {
  merchantId: string;
  cardId: string;
  staffMemberId: string | null;
  doBirthday: boolean;
  birthdayRewardId: string | null;
  doRedeem: boolean;
  rewardConfigId: string | null;
  doVisit: boolean;
  earnedReward: boolean;
  newVisitsThisCycle: number;
  momentMessage: string | null;
  newQrToken: string;
}

/**
 * What a scan reports back. It is the shared derived state, unchanged — the
 * register and the wallet pass must never disagree about these numbers.
 */
export type ScannedCard = LoyaltyCardState;

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

  async activeRewardConfig(merchantId: string): Promise<RewardConfig | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<RewardConfig>(
        `SELECT id::text, stamps_required AS visits_required, name AS reward_name
         FROM merchant.loyalty_reward
         WHERE merchant_id = $1::uuid AND active = true AND type = 'stamps_free_item'
         ORDER BY created_at DESC NULLS LAST LIMIT 1`,
        [merchantId],
      ),
    );
    return rows[0] ?? null;
  }

  async merchantConfig(merchantId: string): Promise<ScanMerchantConfig | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT t.name, t.timezone,
                s.lifecycle_copy AS lifecycle_copy,
                s.birthday_reward_name AS birthday_reward_name
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
    };
  }

  /** A visit within the last `seconds` (wallet 60s replay guard). */
  async recentVisitWithin(merchantId: string, cardId: string, seconds: number): Promise<boolean> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= now() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [merchantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  /** A visit since merchant-timezone local midnight (1-per-day guard). DST-safe. */
  async visitedToday(merchantId: string, cardId: string, tz: string): Promise<boolean> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_visit
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)
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
           AND occurred_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)
         ORDER BY occurred_at DESC
         LIMIT 1`,
        [merchantId, cardId, tz],
      ),
    );
    return rows[0]?.occurred_at ?? null;
  }

  async recentRedemptionWithin(
    merchantId: string,
    cardId: string,
    seconds: number,
  ): Promise<boolean> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query(
        `SELECT 1 FROM merchant.loyalty_redemption
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= now() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [merchantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  async activeBirthdayReward(merchantId: string, cardId: string): Promise<{ id: string } | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM merchant.loyalty_birthday_grant
         WHERE merchant_id=$1::uuid AND card_id=$2::uuid
           AND status='active' AND expires_at >= now()
         ORDER BY issued_at DESC LIMIT 1`,
        [merchantId, cardId],
      ),
    );
    return rows[0] ?? null;
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
  async isAfterHours(merchantId: string, tz: string): Promise<boolean> {
    try {
      const rows = await this.pg.withMerchant((c) =>
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
  async performScan(input: PerformScanInput): Promise<ScannedCard> {
    return this.pg.withMerchant(async (c) => {
      if (input.doBirthday && input.birthdayRewardId) {
        await c.query(
          `UPDATE merchant.loyalty_birthday_grant SET status='redeemed', redeemed_at=now()
           WHERE merchant_id=$1::uuid AND id=$2::uuid`,
          [input.merchantId, input.birthdayRewardId],
        );
      }
      if (input.doRedeem && input.rewardConfigId) {
        await c.query(
          `INSERT INTO merchant.loyalty_redemption
             (merchant_id, card_id, reward_id, reason, staff_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'stamps', $4::uuid)`,
          [input.merchantId, input.cardId, input.rewardConfigId, input.staffMemberId],
        );
      }
      if (input.doVisit) {
        await c.query(
          `INSERT INTO merchant.loyalty_visit (merchant_id, card_id, staff_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [input.merchantId, input.cardId, input.staffMemberId],
        );
      }
      // Rotate the QR token; stamp the lifecycle moment message on a visit. No
      // cache columns to touch — visit/reward counts + balance are derived below.
      const upd = await c.query<{ card_number: string }>(
        `UPDATE merchant.loyalty_card SET
           lifecycle_message    = CASE WHEN $3 THEN $4::text ELSE lifecycle_message END,
           lifecycle_message_at = CASE WHEN $3 THEN now()    ELSE lifecycle_message_at END,
           qr_token = $5, qr_issued_at = now(), updated_at = now()
         WHERE merchant_id=$1::uuid AND id=$2::uuid
         RETURNING card_number`,
        [input.merchantId, input.cardId, input.doVisit, input.momentMessage, input.newQrToken],
      );
      // No row → card vanished mid-scan or is RLS-filtered; surface a clear 404
      // instead of returning undefined (which callers read as ScannedCard).
      if (!upd.rows[0]) throw new NotFoundException('card_not_found');

      // Derived summary (identity-only card). The formula lives in one place
      // because the wallet pass shows the same four numbers to the same customer
      // at the same moment — see shared/loyalty/card-state.sql.ts.
      const { rows } = await c.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [
        input.merchantId,
        input.cardId,
      ]);
      return rows[0];
    });
  }
}
