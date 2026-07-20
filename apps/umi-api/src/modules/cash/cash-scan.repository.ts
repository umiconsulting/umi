import { Injectable, NotFoundException } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface RewardConfig {
  id: string;
  visits_required: number;
  reward_name: string | null;
}

export interface ScanTenantConfig {
  name: string;
  timezone: string | null;
  lifecycleCopy: unknown;
  birthdayRewardName: string | null;
}

export interface PerformScanInput {
  tenantId: string;
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

export interface ScannedCard {
  total_visits: number;
  visits_this_cycle: number;
  pending_rewards: number;
  balance_cents: number;
  card_number: string;
}

/**
 * Scan reads + the atomic visit/redeem/birthday mutation. Scan touches loyalty
 * STATE only (visits/rewards/birthday) — never money, so it must NOT write the
 * card_ledger.
 *
 * DERIVED-STATE MODEL (canonical rebuild v2): `tenant.loyalty_card` is identity-only —
 * the old total_visits / visits_this_cycle / pending_rewards / balance_cents
 * caches are GONE. They are computed from the event tables on read:
 *   total_visits       = COUNT(tenant.loyalty_visit)
 *   visits_this_cycle  = total_visits % visits_required
 *   pending_rewards    = floor(total_visits / visits_required)
 *                          − COUNT(tenant.loyalty_redemption)
 *   balance_cents      = COALESCE(SUM(tenant.loyalty_stored_value_ledger.delta), 0)
 * where visits_required is the tenant's active tenant.loyalty_reward (default 10).
 * The scan mutation therefore only appends the visit / reward_redemption rows
 * (which it already did) and rotates the QR token — no cache to update.
 */
@Injectable()
export class CashScanRepository {
  constructor(private readonly pg: PgService) {}

  async activeRewardConfig(tenantId: string): Promise<RewardConfig | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<RewardConfig>(
        `SELECT id::text, visits_required, reward_name
         FROM tenant.loyalty_reward
         WHERE business_id = $1::uuid AND is_active = true
         ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
        [tenantId],
      ),
    );
    return rows[0] ?? null;
  }

  async tenantConfig(tenantId: string): Promise<ScanTenantConfig | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<Row>(
        `SELECT t.name, t.timezone,
                s.branding->'lifecycle_copy' AS lifecycle_copy,
                s.birthday_reward_name AS birthday_reward_name
         FROM tenant.business AS t
         LEFT JOIN tenant.loyalty_program AS s ON s.business_id = t.id
         WHERE t.id = $1::uuid LIMIT 1`,
        [tenantId],
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
  async recentVisitWithin(
    tenantId: string,
    cardId: string,
    seconds: number,
  ): Promise<boolean> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query(
        `SELECT 1 FROM tenant.loyalty_visit
         WHERE business_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= now() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [tenantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  /** A visit since tenant-timezone local midnight (1-per-day guard). DST-safe. */
  async visitedToday(
    tenantId: string,
    cardId: string,
    tz: string,
  ): Promise<boolean> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query(
        `SELECT 1 FROM tenant.loyalty_visit
         WHERE business_id=$1::uuid AND card_id=$2::uuid
           AND occurred_at >= (date_trunc('day', now() AT TIME ZONE $3) AT TIME ZONE $3)
         LIMIT 1`,
        [tenantId, cardId, tz],
      ),
    );
    return rows.length > 0;
  }

  async recentRedemptionWithin(
    tenantId: string,
    cardId: string,
    seconds: number,
  ): Promise<boolean> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query(
        `SELECT 1 FROM tenant.loyalty_redemption
         WHERE business_id=$1::uuid AND card_id=$2::uuid
           AND redeemed_at >= now() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [tenantId, cardId, String(seconds)],
      ),
    );
    return rows.length > 0;
  }

  async activeBirthdayReward(
    tenantId: string,
    cardId: string,
  ): Promise<{ id: string } | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM tenant.birthday_reward
         WHERE business_id=$1::uuid AND card_id=$2::uuid
           AND status='active' AND expires_at >= now()
         ORDER BY issued_at DESC LIMIT 1`,
        [tenantId, cardId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Best-effort after-hours check against tenant.open_hours in tenant tz.
   * Returns true when closed/no row for the local weekday or outside opens..closes.
   */
  async isAfterHours(tenantId: string, tz: string): Promise<boolean> {
    try {
      const { rows } = await this.pg.withTenant((c) =>
        c.query<Row>(
          `WITH n AS (
             SELECT (now() AT TIME ZONE $2) AS lt
           )
           SELECT oh.is_closed,
                  (SELECT lt::time FROM n) AS now_time,
                  oh.opens_at, oh.closes_at
           FROM tenant.open_hours oh, n
           WHERE oh.business_id=$1::uuid
             AND oh.day_of_week = extract(dow FROM (SELECT lt FROM n))::int
           LIMIT 1`,
          [tenantId, tz],
        ),
      );
      const r = rows[0];
      if (!r) return true; // no row for today → treat as closed (matches cash)
      if (r.is_closed) return true;
      return r.now_time < r.opens_at || r.now_time >= r.closes_at;
    } catch {
      return false; // non-blocking informational flag
    }
  }

  /**
   * Apply the selected actions in one transaction (BIRTHDAY → REDEEM → VISIT),
   * rotate the QR token, then RE-DERIVE the card summary from the event tables
   * (no caches on tenant.loyalty_card). The visit / reward_redemption inserts are the
   * source of truth the derive reads back.
   */
  async performScan(input: PerformScanInput): Promise<ScannedCard> {
    return this.pg.withTenant(async (c) => {
      if (input.doBirthday && input.birthdayRewardId) {
        await c.query(
          `UPDATE tenant.birthday_reward SET status='redeemed', redeemed_at=now()
           WHERE business_id=$1::uuid AND id=$2::uuid`,
          [input.tenantId, input.birthdayRewardId],
        );
      }
      if (input.doRedeem && input.rewardConfigId) {
        await c.query(
          `INSERT INTO tenant.loyalty_redemption
             (business_id, card_id, reward_rule_id, staff_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
          [input.tenantId, input.cardId, input.rewardConfigId, input.staffMemberId],
        );
      }
      if (input.doVisit) {
        await c.query(
          `INSERT INTO tenant.loyalty_visit (business_id, card_id, staff_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [input.tenantId, input.cardId, input.staffMemberId],
        );
      }
      // Rotate the QR token; stamp the lifecycle moment message on a visit. No
      // cache columns to touch — visit/reward counts + balance are derived below.
      const upd = await c.query<{ card_number: string }>(
        `UPDATE tenant.loyalty_card SET
           metadata = CASE WHEN $3
             THEN COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
               'lifecycle_message', $4::text,
               'lifecycle_message_updated_at', $5::text)
             ELSE metadata END,
           qr_token = $6, qr_issued_at = now(), updated_at = now()
         WHERE business_id=$1::uuid AND id=$2::uuid
         RETURNING card_number`,
        [
          input.tenantId,
          input.cardId,
          input.doVisit,
          input.momentMessage,
          input.momentMessage ? new Date().toISOString() : null,
          input.newQrToken,
        ],
      );
      // No row → card vanished mid-scan or is RLS-filtered; surface a clear 404
      // instead of returning undefined (which callers read as ScannedCard).
      if (!upd.rows[0]) throw new NotFoundException('card_not_found');

      // Derived summary (identity-only card): visits_this_cycle = visits % threshold;
      // pending = floor(visits/threshold) − redemptions; balance = SUM(ledger).
      // reward_rule.visits_required has CHECK (> 0), default 10 → no div-by-zero.
      const { rows } = await c.query<ScannedCard>(
        `WITH vr AS (
           SELECT COALESCE((
             SELECT visits_required FROM tenant.loyalty_reward
             WHERE business_id=$1::uuid AND is_active
             ORDER BY activated_at DESC NULLS LAST LIMIT 1), 10) AS n
         ),
         tv  AS (SELECT COUNT(*)::int AS n FROM tenant.loyalty_visit
                  WHERE business_id=$1::uuid AND card_id=$2::uuid),
         rr  AS (SELECT COUNT(*)::int AS n FROM tenant.loyalty_redemption
                  WHERE business_id=$1::uuid AND card_id=$2::uuid),
         bal AS (SELECT COALESCE(SUM(delta),0)::int AS n FROM tenant.loyalty_stored_value_ledger
                  WHERE business_id=$1::uuid AND card_id=$2::uuid)
         SELECT $3::text            AS card_number,
                tv.n                AS total_visits,
                (tv.n % vr.n)       AS visits_this_cycle,
                (tv.n / vr.n - rr.n) AS pending_rewards,
                bal.n               AS balance_cents
         FROM vr, tv, rr, bal`,
        [input.tenantId, input.cardId, upd.rows[0].card_number],
      );
      return rows[0];
    });
  }
}
