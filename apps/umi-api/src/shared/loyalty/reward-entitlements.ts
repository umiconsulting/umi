import { BadRequestException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { RewardProfile } from './reward-profile';

export interface RewardExpiryPolicy {
  mode: 'accumulate' | 'single_cycle';
  days: number | null;
  startedAt: string | null;
}
export interface SyncCycleRewardInput {
  merchantId: string;
  cardId: string;
  lifetimeTotal: number;
  cycleAnchor: number;
  profile: RewardProfile;
}
export interface RedeemRewardEntitlementsInput {
  merchantId: string;
  cardId: string;
  quantity: number;
  staffId: string;
  externalReceiptNumber: string;
  commandId?: string | null;
  selection: 'cycle_base' | 'cycle_top' | 'legacy';
}
export interface RedeemedRewardItem {
  entitlementId: string;
  redemptionId: string;
  rewardName: string;
  isBase: boolean;
  expiresAt: string;
}
export interface RewardEntitlementRedemption {
  quantity: number;
  redemptionIds: string[];
  items: RedeemedRewardItem[];
  redeemedAt: string;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/** Call these helpers in the transaction that holds the card row lock. */
export async function getRewardExpiryPolicy(
  c: PoolClient,
  merchantId: string,
): Promise<RewardExpiryPolicy> {
  const { rows } = await c.query<{
    mode: RewardExpiryPolicy['mode'];
    expiry_days: number | null;
    started_at: Date | null;
  }>(
    `SELECT mode,expiry_days,started_at FROM merchant.loyalty_reward_policy WHERE merchant_id=$1::uuid`,
    [merchantId],
  );
  const row = rows[0];
  return row
    ? {
        mode: row.mode,
        days: row.expiry_days,
        startedAt: row.started_at ? iso(row.started_at) : null,
      }
    : { mode: 'accumulate', days: null, startedAt: null };
}
export async function expireCycleReward(
  c: PoolClient,
  merchantId: string,
  cardId: string,
): Promise<{ changed: boolean; units: number }> {
  if ((await getRewardExpiryPolicy(c, merchantId)).mode !== 'single_cycle')
    return { changed: false, units: 0 };
  const { rows } = await c.query<{
    source: string;
    recovery: boolean;
    cycle_anchor: number | null;
  }>(
    `UPDATE merchant.loyalty_reward_entitlement SET expired_at=clock_timestamp(),pass_refresh_requested_at=clock_timestamp()
      WHERE merchant_id=$1::uuid AND card_id=$2::uuid AND redeemed_at IS NULL AND expired_at IS NULL AND expires_at<=clock_timestamp()
      RETURNING source,recovery,cycle_anchor`,
    [merchantId, cardId],
  );
  for (const unit of rows)
    if (unit.source === 'cycle' && !unit.recovery) {
      await c.query(
        `UPDATE merchant.loyalty_card SET cycle_anchor=(SELECT COALESCE(sum(stamps),0)::int FROM merchant.loyalty_visit WHERE merchant_id=$1::uuid AND card_id=$2::uuid),updated_at=clock_timestamp()
      WHERE merchant_id=$1::uuid AND id=$2::uuid AND cycle_anchor=$3`,
        [merchantId, cardId, unit.cycle_anchor],
      );
    }
  return { changed: rows.length > 0, units: rows.length };
}
export async function syncCycleReward(
  c: PoolClient,
  input: SyncCycleRewardInput,
): Promise<{ changed: boolean; entitlementId: string | null }> {
  const policy = await getRewardExpiryPolicy(c, input.merchantId);
  if (policy.mode !== 'single_cycle') return { changed: false, entitlementId: null };
  await expireCycleReward(c, input.merchantId, input.cardId);
  const { rows: cards } = await c.query<{ cycle_anchor: number; total: number }>(
    `SELECT cycle_anchor,(SELECT COALESCE(sum(stamps),0)::int FROM merchant.loyalty_visit WHERE merchant_id=$1::uuid AND card_id=$2::uuid) total FROM merchant.loyalty_card WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [input.merchantId, input.cardId],
  );
  const card = cards[0];
  if (!card) throw new Error('Card not found');
  const progress = card.total - card.cycle_anchor;
  const { rows: existing } = await c.query<{
    id: string;
    tier: string;
    top_visits_required: number;
  }>(
    `SELECT id::text,tier,top_visits_required FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1::uuid AND card_id=$2::uuid AND source='cycle' AND NOT recovery AND redeemed_at IS NULL AND expired_at IS NULL AND expires_at>clock_timestamp()`,
    [input.merchantId, input.cardId],
  );
  if (existing[0]) {
    const unit = existing[0];
    const changed = progress >= unit.top_visits_required && unit.tier !== 'top';
    if (changed)
      await c.query(
        `UPDATE merchant.loyalty_reward_entitlement SET tier='top' WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [input.merchantId, unit.id],
      );
    return { changed, entitlementId: unit.id };
  }
  const base = input.profile.baseTier;
  if (progress < 7) return { changed: false, entitlementId: null };
  if (progress > 9) throw new BadRequestException('Single cycle capacity exceeded');
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,cycle_anchor,eligible_at,expires_at,tier,base_reward_id,base_reward_name,base_reward_description,base_visits_required,top_reward_id,top_reward_name,top_reward_description,top_visits_required)
    VALUES($1::uuid,$2::uuid,'cycle',$3,statement_timestamp(),statement_timestamp()+make_interval(days=>$4),$5,$6::uuid,$7,$8,$9,$10::uuid,$11,$12,$13) RETURNING id::text`,
    [
      input.merchantId,
      input.cardId,
      card.cycle_anchor,
      policy.days,
      progress >= 9 ? 'top' : 'base',
      base?.configId ?? input.profile.redemptionConfigId,
      base?.rewardName ?? input.profile.rewardName,
      base?.rewardDescription ?? input.profile.rewardDescription,
      7,
      input.profile.redemptionConfigId,
      input.profile.rewardName,
      input.profile.rewardDescription,
      9,
    ],
  );
  await c.query(
    `UPDATE merchant.loyalty_card SET rewards_earned=rewards_earned+1 WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [input.merchantId, input.cardId],
  );
  return { changed: true, entitlementId: rows[0].id };
}
export async function redeemRewardEntitlements(
  c: PoolClient,
  input: RedeemRewardEntitlementsInput,
): Promise<RewardEntitlementRedemption> {
  if ((await getRewardExpiryPolicy(c, input.merchantId)).mode !== 'single_cycle')
    throw new BadRequestException('Single cycle policy is disabled');
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity < 1 ||
    (input.selection !== 'legacy' && input.quantity !== 1)
  )
    throw new BadRequestException('Invalid redemption quantity');
  if (!input.externalReceiptNumber.trim() || !input.staffId)
    throw new BadRequestException('Receipt and staff are required');
  await expireCycleReward(c, input.merchantId, input.cardId);
  const { rows } = await c.query<{
    id: string;
    tier: string;
    source: string;
    recovery: boolean;
    cycle_anchor: number | null;
    expires_at: Date;
    base_reward_id: string | null;
    top_reward_id: string | null;
    base_reward_name: string;
    top_reward_name: string;
  }>(
    `SELECT e.* FROM merchant.loyalty_reward_entitlement e JOIN merchant.loyalty_card ca ON ca.merchant_id=e.merchant_id AND ca.id=e.card_id
      WHERE e.merchant_id=$1::uuid AND e.card_id=$2::uuid AND e.redeemed_at IS NULL AND e.expired_at IS NULL AND e.expires_at>clock_timestamp()
      AND (CASE WHEN $3='legacy' THEN e.source='legacy' OR e.recovery
        WHEN $3='cycle_base' THEN e.source='cycle' AND NOT e.recovery AND e.tier='base' AND e.cycle_anchor=ca.cycle_anchor
        ELSE e.source='legacy' OR e.recovery OR (e.source='cycle' AND NOT e.recovery AND e.tier='top' AND e.cycle_anchor=ca.cycle_anchor) END)
      ORDER BY e.expires_at,e.created_at,e.id LIMIT $4 FOR UPDATE OF e`,
    [input.merchantId, input.cardId, input.selection, input.quantity],
  );
  if (rows.length !== input.quantity)
    throw new BadRequestException('Insufficient unexpired rewards');
  if (input.selection === 'cycle_base') {
    const historical = await c.query<{ blocked: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM merchant.loyalty_reward_entitlement
        WHERE merchant_id=$1::uuid AND card_id=$2::uuid AND (source='legacy' OR recovery)
          AND redeemed_at IS NULL AND expired_at IS NULL AND expires_at>clock_timestamp()
          AND expires_at <= (SELECT expires_at FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1::uuid AND id=$3::uuid)) blocked`,
      [input.merchantId, input.cardId, rows[0].id],
    );
    if (historical.rows[0].blocked)
      throw new BadRequestException('Redeem historical rewards first');
  }
  const redeemedAt = iso((await c.query<{ ts: Date }>(`SELECT clock_timestamp() ts`)).rows[0].ts);
  const items: RedeemedRewardItem[] = [];
  for (const unit of rows) {
    const isBase = unit.tier === 'base';
    const { rows: redemptions } = await c.query<{ id: string }>(
      `INSERT INTO merchant.loyalty_redemption(merchant_id,card_id,reward_id,reason,staff_id,occurred_at,cycle_reset)
      VALUES($1::uuid,$2::uuid,$3::uuid,'stamps',$4::uuid,$5::timestamptz,$6) RETURNING id::text`,
      [
        input.merchantId,
        input.cardId,
        isBase ? unit.base_reward_id : unit.top_reward_id,
        input.staffId,
        redeemedAt,
        unit.source === 'cycle' && !unit.recovery,
      ],
    );
    const redemptionId = redemptions[0].id;
    await c.query(
      `INSERT INTO merchant.loyalty_reward_redemption_link(merchant_id,redemption_id,entitlement_id,command_id,external_receipt_number) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5)`,
      [
        input.merchantId,
        redemptionId,
        unit.id,
        input.commandId ?? null,
        input.externalReceiptNumber,
      ],
    );
    await c.query(
      `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=$3::timestamptz WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [input.merchantId, unit.id, redeemedAt],
    );
    if (unit.source === 'cycle' && !unit.recovery)
      await c.query(
        `UPDATE merchant.loyalty_card SET cycle_anchor=(SELECT COALESCE(sum(stamps),0)::int FROM merchant.loyalty_visit WHERE merchant_id=$1::uuid AND card_id=$2::uuid),updated_at=clock_timestamp() WHERE merchant_id=$1::uuid AND id=$2::uuid AND cycle_anchor=$3`,
        [input.merchantId, input.cardId, unit.cycle_anchor],
      );
    items.push({
      entitlementId: unit.id,
      redemptionId,
      rewardName: isBase ? unit.base_reward_name : unit.top_reward_name,
      isBase,
      expiresAt: iso(unit.expires_at),
    });
  }
  return {
    quantity: items.length,
    redemptionIds: items.map((item) => item.redemptionId),
    items,
    redeemedAt,
  };
}
export async function restoreRewardEntitlement(
  c: PoolClient,
  merchantId: string,
  redemptionId: string,
): Promise<{ linked: boolean; expired: boolean; changed: boolean }> {
  const { rows } = await c.query<{ id: string; restored_at: Date | null; expired: boolean }>(
    `SELECT e.id,l.restored_at,(e.expires_at<=clock_timestamp()) expired FROM merchant.loyalty_reward_redemption_link l JOIN merchant.loyalty_reward_entitlement e ON e.merchant_id=l.merchant_id AND e.id=l.entitlement_id WHERE l.merchant_id=$1::uuid AND l.redemption_id=$2::uuid FOR UPDATE OF l,e`,
    [merchantId, redemptionId],
  );
  const row = rows[0];
  if (!row) return { linked: false, expired: false, changed: false };
  if (row.restored_at) return { linked: true, expired: row.expired, changed: false };
  await c.query(
    `UPDATE merchant.loyalty_reward_redemption_link SET restored_at=clock_timestamp() WHERE merchant_id=$1::uuid AND redemption_id=$2::uuid`,
    [merchantId, redemptionId],
  );
  await c.query(
    `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=NULL,recovery=true,expired_at=CASE WHEN expires_at<=clock_timestamp() THEN clock_timestamp() ELSE NULL END,pass_refresh_requested_at=clock_timestamp() WHERE merchant_id=$1::uuid AND id=$2::uuid`,
    [merchantId, row.id],
  );
  return { linked: true, expired: row.expired, changed: true };
}
