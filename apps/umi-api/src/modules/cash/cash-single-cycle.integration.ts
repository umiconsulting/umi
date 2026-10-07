import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ScanResponse } from '@umi/contract';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { CashScanRepository } from './cash-scan.repository';
import { CashScanService } from './cash-scan.service';
import { CashWriteRepository } from './cash-write.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { IntegrityRepository } from '../integrity/integrity.repository';

const admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN });
const merchantId = randomUUID();
const userId = randomUUID();
const roleId = randomUUID();
let staffId: string;
let pg: PgService;
let repo: CashScanRepository;
let service: CashScanService;
let seeded = false;
const wallet = { refreshCard: vi.fn().mockResolvedValue(undefined) };
const asMerchant = <T>(work: () => Promise<T>) =>
  runWithRequestContext({ merchantId, userId, requestId: 'cycle-operations' }, work);
async function card(stamps = 0) {
  const customerId = randomUUID();
  const cardId = randomUUID();
  await pg.query(
    `INSERT INTO merchant.customer(id,merchant_id,name) VALUES($1,$2,'Fixture customer')`,
    [customerId, merchantId],
  );
  await pg.query(
    `INSERT INTO merchant.loyalty_card(id,merchant_id,customer_id,card_number) VALUES($1::uuid,$2,$3,$1::text)`,
    [cardId, merchantId, customerId],
  );
  if (stamps)
    await asMerchant(() =>
      repo.creditSeals({
        merchantId,
        cardId,
        staffMemberId: staffId,
        seals: stamps,
        note: null,
        idempotencyKey: randomUUID(),
        momentMessage: null,
      }),
    );
  await pg.query(
    `UPDATE merchant.loyalty_visit SET occurred_at=clock_timestamp()-interval '2 days' WHERE card_id=$1`,
    [cardId],
  );
  return cardId;
}
const scan = (
  id: string,
  action: string,
  key = randomUUID(),
  quantity = 1,
  receipt = 'FIXTURE-RECEIPT',
) =>
  asMerchant(() =>
    service.scan(merchantId, userId, {
      qrPayload: id,
      action,
      idempotencyKey: key,
      redeemQuantity: quantity,
      externalReceiptNumber: receipt,
    }),
  );
const credits = (id: string, seals: number, key = randomUUID()) =>
  asMerchant(() =>
    repo.creditSeals({
      merchantId,
      cardId: id,
      staffMemberId: staffId,
      seals,
      note: null,
      idempotencyKey: key,
      momentMessage: null,
    }),
  );

describe('single cycle scan operations · PostgreSQL and RLS', () => {
  beforeAll(async () => {
    const env = {
      DATABASE_URL_APP: process.env.DATABASE_URL_APP,
      DATABASE_URL_WORKER: process.env.DATABASE_URL_WORKER,
    };
    pg = new PgService({
      get: (key: string) => env[key as keyof typeof env],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    repo = new CashScanRepository(pg);
    service = new CashScanService(
      { verifyQRPayload: async () => null, generateRandomToken: randomUUID } as never,
      new CashWriteRepository(pg),
      repo,
      wallet as never,
      { send: vi.fn() } as never,
      new IntegrityService(new IntegrityRepository(pg)),
    );
    seeded = true;
    await pg.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES($1::uuid,'Cycle operations',$1::text)`,
      [merchantId],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_program(merchant_id,multi_seal_enabled) VALUES($1,true)`,
      [merchantId],
    );
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Fixture operator')`, [userId]);
    await pg.query(`INSERT INTO umi.role(id,key,name) VALUES($1::uuid,$1::text,'Fixture role')`, [
      roleId,
    ]);
    staffId = (
      await pg.query(
        `INSERT INTO merchant.staff(merchant_id,user_id,role_id,name) VALUES($1,$2,$3,'Fixture operator') RETURNING id`,
        [merchantId, userId, roleId],
      )
    ).rows[0].id;
    await pg.query(
      `INSERT INTO merchant.loyalty_reward(merchant_id,name,type,kind,stamps_required) VALUES($1,'Base fixture','stamps_free_item','standard',7),($1,'Top fixture','stamps_free_item','upgrade',9)`,
      [merchantId],
    );
    await pg.query(`SELECT merchant.activate_single_cycle_reward_policy($1,30)`, [merchantId]);
  });
  afterAll(async () => {
    if (seeded) {
      await pg.query(`DELETE FROM merchant.loyalty_reward_redemption_link WHERE merchant_id=$1`, [
        merchantId,
      ]);
      await pg.query(`DELETE FROM merchant.business_command WHERE merchant_id=$1`, [merchantId]);
      await pg.query(`DELETE FROM merchant.merchant WHERE id=$1`, [merchantId]);
      await pg.query(`DELETE FROM umi."user" WHERE id=$1`, [userId]);
      await pg.query(`DELETE FROM umi.role WHERE id=$1`, [roleId]);
    }
    await pg?.onModuleDestroy();
    await admin.end();
  });
  it('opens one reward on visit seven and keeps its deadline through nine', async () => {
    const id = await card(6);
    const seven = await scan(id, 'VISIT');
    expect(ScanResponse.parse(seven)).toEqual(seven);
    expect(seven.card.visitsThisCycle).toBe(7);
    expect(seven.card.pendingRewards).toBe(1);
    expect(seven.rewardEarned).toBe(true);
    const deadline = seven.card.nextRewardExpiresAt;
    await pg.query(
      `UPDATE merchant.loyalty_visit SET occurred_at=clock_timestamp()-interval '2 days' WHERE card_id=$1`,
      [id],
    );
    const eight = await scan(id, 'VISIT');
    expect(eight.card.nextRewardExpiresAt).toBe(deadline);
    expect(eight.card.pendingRewards).toBe(1);
    await pg.query(
      `UPDATE merchant.loyalty_visit SET occurred_at=clock_timestamp()-interval '2 days' WHERE card_id=$1`,
      [id],
    );
    const nine = await scan(id, 'VISIT');
    expect(nine.card.visitsThisCycle).toBe(9);
    expect(nine.card.pendingRewards).toBe(1);
    expect(nine.card.nextRewardExpiresAt).toBe(deadline);
    expect(nine.card.visitBlockedReason).toBe('REDEMPTION_REQUIRED');
    await expect(scan(id, 'VISIT')).rejects.toThrow();
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_reward_entitlement WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it.each([
    [7, 'REDEEM_BASE', 0, 'Base fixture'],
    [8, 'REDEEM_BASE', 1, 'Base fixture'],
    [9, 'REDEEM_BASE', 2, 'Base fixture'],
    [9, 'REDEEM', 0, 'Top fixture'],
  ] as const)(
    'redeems %i visits with %s and retains %i',
    async (stamps, action, remaining, name) => {
      const id = await card(stamps);
      const preview = await asMerchant(() =>
        service.preview(merchantId, userId, { qrPayload: id }),
      );
      expect(preview.card.baseReward?.canRedeem).toBe(true);
      const r = await scan(id, action);
      expect(ScanResponse.parse(r)).toEqual(r);
      expect(r.card.visitsThisCycle).toBe(remaining);
      expect(r.card.pendingRewards).toBe(0);
      expect(r.redemption).toMatchObject({
        quantity: 1,
        remainingRewards: 0,
        externalReceiptNumber: 'FIXTURE-RECEIPT',
        operator: { id: staffId, name: 'Fixture operator' },
        items: [{ rewardName: name, quantity: 1 }],
      });
    },
  );
  it('returns the original response on replay after later progress without effects', async () => {
    const id = await card(9);
    const key = randomUUID();
    const first = await scan(id, 'REDEEM_BASE', key);
    expect(first.card.visitsThisCycle).toBe(2);
    await credits(id, 2);
    wallet.refreshCard.mockClear();
    const retry = await scan(id, 'REDEEM_BASE', key);
    expect(retry).toEqual({ ...first, redemption: { ...first.redemption, replayed: true } });
    expect(wallet.refreshCard).not.toHaveBeenCalled();
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_redemption WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(scan(id, 'REDEEM_BASE', key, 1, 'CHANGED')).rejects.toThrow(
      'different command fingerprint',
    );
    await expect(scan(id, 'REDEEM_BASE', key, 2)).rejects.toThrow('different command fingerprint');
    await expect(scan(id, 'REDEEM', key)).rejects.toThrow('different command fingerprint');
    await expect(scan(await card(7), 'REDEEM_BASE', key)).rejects.toThrow(
      'different command fingerprint',
    );
    await expect(
      asMerchant(() =>
        service.scan(merchantId, randomUUID(), {
          qrPayload: id,
          action: 'REDEEM_BASE',
          idempotencyKey: key,
          redeemQuantity: 1,
          externalReceiptNumber: 'FIXTURE-RECEIPT',
        }),
      ),
    ).rejects.toThrow('different command fingerprint');
  });
  it('serializes two credits at eight and rejects excess without a partial write', async () => {
    const id = await card(8);
    await expect(credits(id, 2)).rejects.toThrow();
    const outcomes = await Promise.allSettled([credits(id, 1), credits(id, 1)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await pg.query(
          `SELECT SUM(stamps)::int AS n FROM merchant.loyalty_visit WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(9);
  });
  it('serializes two visits using the same card row lock as bulk credits', async () => {
    const id = await card(8);
    const outcomes = await Promise.allSettled([scan(id, 'VISIT'), credits(id, 1)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await pg.query(
          `SELECT SUM(stamps)::int AS n FROM merchant.loyalty_visit WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(9);
  });
  it('serializes concurrent redemption and cannot consume twice', async () => {
    const id = await card(9);
    const outcomes = await Promise.allSettled([scan(id, 'REDEEM_BASE'), scan(id, 'REDEEM')]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = outcomes.find((r) => r.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Expected one redemption');
    const rewardName = winner.value.redemption?.items[0].rewardName;
    expect(['Base fixture', 'Top fixture']).toContain(rewardName);
    expect(winner.value.card.visitsThisCycle).toBe(rewardName === 'Base fixture' ? 2 : 0);
    expect(winner.value.card.pendingRewards).toBe(0);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_redemption WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rolls back the entitlement and command if a later card write fails', async () => {
    const id = await card(7);
    const key = randomUUID();
    const other = await card();
    await pg.query(
      `UPDATE merchant.loyalty_card SET qr_token='forced-token-conflict' WHERE id=$1`,
      [other],
    );
    const bad = new CashScanService(
      {
        verifyQRPayload: async () => null,
        generateRandomToken: () => 'forced-token-conflict',
      } as never,
      new CashWriteRepository(pg),
      repo,
      wallet as never,
      { send: vi.fn() } as never,
      new IntegrityService(new IntegrityRepository(pg)),
    );
    await expect(
      asMerchant(() =>
        bad.scan(merchantId, userId, {
          qrPayload: id,
          action: 'REDEEM_BASE',
          externalReceiptNumber: 'ROLLBACK',
          idempotencyKey: key,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_redemption WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.business_command WHERE merchant_id=$1 AND idempotency_key=$2`,
          [merchantId, key],
        )
      ).rows[0].n,
    ).toBe(0);
    const r = await scan(id, 'REDEEM_BASE', key);
    expect(r.card.pendingRewards).toBe(0);
  });
  it('restores the original deadline and preserves later progress on reversal', async () => {
    const id = await card(9);
    const before = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    await scan(id, 'REDEEM_BASE');
    await credits(id, 3);
    const redemptionId = (
      await pg.query(`SELECT id FROM merchant.loyalty_redemption WHERE card_id=$1`, [id])
    ).rows[0].id;
    await pg.query(
      `UPDATE merchant.loyalty_reward SET name='Changed standard' WHERE merchant_id=$1 AND kind='standard'`,
      [merchantId],
    );
    const r = await asMerchant(() => service.revertRedemption(merchantId, userId, redemptionId));
    await pg.query(
      `UPDATE merchant.loyalty_reward SET name='Base fixture' WHERE merchant_id=$1 AND kind='standard'`,
      [merchantId],
    );
    expect(r.message).toContain('Base fixture');
    expect(r.pendingRewards).toBe(1);
    const state = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    expect(state.card.visitsThisCycle).toBe(5);
    expect(state.card.nextRewardExpiresAt).toBe(before.card.nextRewardExpiresAt);
    expect(state.card.legacyPendingRewards).toBe(1);
    await expect(scan(id, 'VISIT')).rejects.toThrow();
    const again = await asMerchant(() =>
      service.revertRedemption(merchantId, userId, redemptionId),
    );
    expect(again).toEqual(r);
    await pg.query(
      `UPDATE merchant.loyalty_redemption SET occurred_at=clock_timestamp()-interval '40 seconds' WHERE id=$1`,
      [redemptionId],
    );
    const recovery = await scan(id, 'REDEEM');
    expect(recovery.card.visitsThisCycle).toBe(5);
    expect(recovery.redemption?.items).toEqual([{ rewardName: 'Base fixture', quantity: 1 }]);
    expect(recovery.message).toContain('Base fixture');
    expect(
      (await pg.query(`SELECT lifecycle_message FROM merchant.loyalty_card WHERE id=$1`, [id]))
        .rows[0].lifecycle_message,
    ).toContain('Base fixture');
  });

  it('checks the daily visit limit after concurrent callers acquire the lock', async () => {
    const id = await card();
    const results = await Promise.allSettled([scan(id, 'VISIT'), scan(id, 'VISIT')]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await pg.query(
          `SELECT SUM(stamps)::int AS n FROM merchant.loyalty_visit WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('rejects source-key reuse with a changed quantity or card', async () => {
    const id = await card();
    const other = await card();
    const key = randomUUID();
    await credits(id, 2, key);
    await expect(credits(id, 3, key)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await expect(credits(other, 2, key)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('keeps the seven/nine policy while the card has a custom reward override', async () => {
    const id = await card();
    const override = (
      await pg.query(
        `INSERT INTO merchant.loyalty_reward(merchant_id,name,type,kind,stamps_required,active)
      VALUES($1,'Custom Capuccino','stamps_free_item','override',2,false) RETURNING id`,
        [merchantId],
      )
    ).rows[0].id;
    await pg.query(`UPDATE merchant.loyalty_card SET reward_override_id=$2 WHERE id=$1`, [
      id,
      override,
    ]);
    const seven = await credits(id, 7);
    expect(seven.card.visits_required).toBe(9);
    const preview = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    expect(preview.card.baseReward?.rewardName).toBe('Custom Capuccino');
    expect(preview.card.baseReward?.canRedeem).toBe(true);
    expect(preview.card.visitsRequired).toBe(9);
    await expect(scan(id, 'REDEEM')).rejects.toThrow();
    const redeemed = await scan(id, 'REDEEM_BASE');
    expect(redeemed.redemption?.items).toEqual([{ rewardName: 'Custom Capuccino', quantity: 1 }]);
    expect(redeemed.card.visitsThisCycle).toBe(0);
  });

  it('returns both callers the same committed command during a simultaneous retry', async () => {
    const id = await card(7);
    const key = randomUUID();
    wallet.refreshCard.mockClear();
    const results = await Promise.all([scan(id, 'REDEEM_BASE', key), scan(id, 'REDEEM_BASE', key)]);
    expect(results.map((result) => result.redemption?.replayed).sort()).toEqual([false, true]);
    expect(results[0].redemption?.operationId).toBe(results[1].redemption?.operationId);
    expect(wallet.refreshCard).toHaveBeenCalledTimes(1);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_redemption WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('expires the cycle under the scan lock before it applies a new visit', async () => {
    const id = await card(8);
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL session_replication_role=replica');
      await c.query(
        `UPDATE merchant.loyalty_reward_entitlement SET expires_at=clock_timestamp() WHERE card_id=$1`,
        [id],
      );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    const preview = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    expect(preview.card.visitsThisCycle).toBe(0);
    expect(preview.card.pendingRewards).toBe(0);
    const result = await scan(id, 'VISIT');
    expect(result.card.visitsThisCycle).toBe(1);
    expect(result.card.pendingRewards).toBe(0);
    expect(result.card.nextRewardExpiresAt).toBeNull();
    expect(
      (await pg.query(`SELECT cycle_anchor FROM merchant.loyalty_card WHERE id=$1`, [id])).rows[0]
        .cycle_anchor,
    ).toBe(8);
  });

  it('redeems a mixed legacy backlog with quantity two and preserves partial progress', async () => {
    const id = await card(3);
    const configs = (
      await pg.query(
        `SELECT id,kind FROM merchant.loyalty_reward WHERE merchant_id=$1 AND kind IN ('standard','upgrade')`,
        [merchantId],
      )
    ).rows;
    const baseId = configs.find((config) => config.kind === 'standard')!.id;
    const topId = configs.find((config) => config.kind === 'upgrade')!.id;
    await pg.query(
      `INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,activated_at,expires_at,tier,base_reward_id,top_reward_id,base_reward_name,top_reward_name,base_visits_required,top_visits_required)
      VALUES($1,$2,'legacy',clock_timestamp(),clock_timestamp()+interval '30 days','base',$3,$4,'Legacy base','Legacy top',7,9),
            ($1,$2,'legacy',clock_timestamp(),clock_timestamp()+interval '30 days','top',$3,$4,'Legacy base','Legacy top',7,9)`,
      [merchantId, id, baseId, topId],
    );
    await expect(scan(id, 'VISIT')).rejects.toThrow();
    await expect(scan(id, 'REDEEM', randomUUID(), 3)).rejects.toThrow();
    const result = await scan(id, 'REDEEM', randomUUID(), 2);
    expect(result.redemption?.quantity).toBe(2);
    expect(result.redemption?.items).toEqual([
      { rewardName: 'Legacy base', quantity: 1 },
      { rewardName: 'Legacy top', quantity: 1 },
    ]);
    expect(result.card.pendingRewards).toBe(0);
    expect(result.card.visitsThisCycle).toBe(3);
    expect(result.message).toContain('Legacy base');
    expect(result.message).toContain('Legacy top');
  });
  it('serializes birthday claims while the stamp reward still requires redemption', async () => {
    const id = await card(9);
    await pg.query(
      `INSERT INTO merchant.loyalty_birthday_grant(merchant_id,card_id,year,expires_at)
      VALUES($1,$2,2026,clock_timestamp()+interval '1 day')`,
      [merchantId, id],
    );
    const outcomes = await Promise.allSettled([
      scan(id, 'BIRTHDAY_REDEEM'),
      scan(id, 'BIRTHDAY_REDEEM'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const preview = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    expect(preview.card.visitsThisCycle).toBe(9);
    expect(preview.card.pendingRewards).toBe(1);
    expect(preview.card.visitBlockedReason).toBe('REDEMPTION_REQUIRED');
    expect(preview.birthdayReward).toBeNull();
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS n FROM merchant.loyalty_stored_value_ledger WHERE card_id=$1`,
          [id],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('redeems an earlier historical unit before the current base cycle', async () => {
    const id = await card(7);
    await pg.query(
      `INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,activated_at,expires_at,tier,base_reward_name,top_reward_name,base_visits_required,top_visits_required)
      VALUES($1,$2,'legacy',clock_timestamp(),clock_timestamp()+interval '1 day','base','Earlier legacy','Earlier legacy',7,9)`,
      [merchantId, id],
    );
    const preview = await asMerchant(() => service.preview(merchantId, userId, { qrPayload: id }));
    expect(preview.card.baseReward?.canRedeem).toBe(false);
    expect(preview.card.baseReward?.ready).toBe(false);
    await expect(scan(id, 'REDEEM_BASE')).rejects.toThrow('Redeem historical rewards first');
    const first = await scan(id, 'REDEEM');
    expect(first.redemption?.items).toEqual([{ rewardName: 'Earlier legacy', quantity: 1 }]);
    expect(first.card.visitsThisCycle).toBe(7);
    expect(first.card.pendingRewards).toBe(1);
    await pg.query(
      `UPDATE merchant.loyalty_redemption SET occurred_at=clock_timestamp()-interval '40 seconds' WHERE card_id=$1`,
      [id],
    );
    const second = await scan(id, 'REDEEM_BASE');
    expect(second.card.visitsThisCycle).toBe(0);
    expect(second.card.pendingRewards).toBe(0);
  });
});
