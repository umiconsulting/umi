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
 * STATE only (visits/rewards/birthday) — never money, so it must NOT call
 * applyWalletDelta or write points_ledger/wallet_transactions/balances.
 * Ported from umi-cash scan/route.ts; reward-cycle math is computed in the
 * service and applied here.
 */
@Injectable()
export class CashScanRepository {
  constructor(private readonly pg: PgService) {}

  async activeRewardConfig(tenantId: string): Promise<RewardConfig | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<RewardConfig>(
        `SELECT id::text, visits_required, reward_name
         FROM loyalty.reward_configs
         WHERE tenant_id = $1::uuid AND is_active = true
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
                p.branding->'lifecycle_copy' AS lifecycle_copy,
                p.birthday_reward_name AS birthday_reward_name
         FROM core.tenants AS t
         LEFT JOIN loyalty.programs AS p ON p.tenant_id = t.id
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
        `SELECT 1 FROM loyalty.visit_events
         WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid
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
        `SELECT 1 FROM loyalty.visit_events
         WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid
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
        `SELECT 1 FROM loyalty.reward_redemptions
         WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid
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
        `SELECT id::text FROM loyalty.birthday_rewards
         WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid
           AND status='active' AND expires_at >= now()
         ORDER BY issued_at DESC LIMIT 1`,
        [tenantId, cardId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Best-effort after-hours check against ops.business_hours in tenant tz.
   * Returns true when closed/no row for the local weekday or outside opens..closes.
   */
  async isAfterHours(tenantId: string, tz: string): Promise<boolean> {
    try {
      const { rows } = await this.pg.withTenant((c) =>
        c.query<Row>(
          `WITH n AS (
             SELECT (now() AT TIME ZONE $2) AS lt
           )
           SELECT bh.is_closed,
                  (SELECT lt::time FROM n) AS now_time,
                  bh.opens_at, bh.closes_at
           FROM ops.business_hours bh, n
           WHERE bh.tenant_id=$1::uuid
             AND bh.day_of_week = extract(dow FROM (SELECT lt FROM n))::int
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
   * then rotate the QR token. Returns the re-read card summary.
   */
  async performScan(input: PerformScanInput): Promise<ScannedCard> {
    return this.pg.withTenant(async (c) => {
      if (input.doBirthday && input.birthdayRewardId) {
        await c.query(
          `UPDATE loyalty.birthday_rewards SET status='redeemed', redeemed_at=now()
           WHERE tenant_id=$1::uuid AND id=$2::uuid`,
          [input.tenantId, input.birthdayRewardId],
        );
      }
      if (input.doRedeem && input.rewardConfigId) {
        await c.query(
          `INSERT INTO loyalty.reward_redemptions
             (tenant_id, loyalty_card_id, reward_config_id, staff_member_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
          [input.tenantId, input.cardId, input.rewardConfigId, input.staffMemberId],
        );
      }
      if (input.doVisit) {
        await c.query(
          `INSERT INTO loyalty.visit_events (tenant_id, loyalty_card_id, staff_member_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          [input.tenantId, input.cardId, input.staffMemberId],
        );
      }
      // One combined card update: cycle fields only on visit; pending_rewards
      // applies BOTH deltas (−1 redeem, +1 earn) so a threshold {REDEEM,VISIT}
      // nets to keep the freshly-earned reward; QR token always rotates.
      const { rows } = await c.query<ScannedCard>(
        `UPDATE loyalty.cards SET
           total_visits = total_visits + (CASE WHEN $3 THEN 1 ELSE 0 END),
           visits_this_cycle = CASE WHEN $3 THEN (CASE WHEN $4 THEN 0 ELSE $5 END) ELSE visits_this_cycle END,
           pending_rewards = pending_rewards
             - (CASE WHEN $6 THEN 1 ELSE 0 END)
             + (CASE WHEN $3 AND $4 THEN 1 ELSE 0 END),
           metadata = CASE WHEN $3
             THEN COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
               'lifecycle_message', $7::text,
               'lifecycle_message_updated_at', $8::text)
             ELSE metadata END,
           qr_token = $9, qr_issued_at = now(), updated_at = now()
         WHERE tenant_id=$1::uuid AND id=$2::uuid
         RETURNING total_visits, visits_this_cycle, pending_rewards, balance_cents, card_number`,
        [
          input.tenantId,
          input.cardId,
          input.doVisit,
          input.earnedReward,
          input.newVisitsThisCycle,
          input.doRedeem,
          input.momentMessage,
          input.momentMessage ? new Date().toISOString() : null,
          input.newQrToken,
        ],
      );
      // No row → card vanished mid-scan or is RLS-filtered; surface a clear 404
      // instead of returning undefined (which callers read as ScannedCard).
      if (!rows[0]) throw new NotFoundException('card_not_found');
      return rows[0];
    });
  }
}
