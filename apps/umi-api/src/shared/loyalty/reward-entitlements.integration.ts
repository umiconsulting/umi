import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LOYALTY_CARD_STATE_SQL } from './card-state.sql';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';
import { PgService } from '../database/pg.service';
import { runWithRequestContext } from '../database/request-context';
import { CashRepository } from '../../modules/cash/cash.repository';
import { CashWriteRepository } from '../../modules/cash/cash-write.repository';
import { CustomersRepository } from '../../modules/customers/customers.repository';
import type { RewardProfile } from './reward-profile';

const worker = new Pool({ connectionString: process.env.DATABASE_URL_WORKER });
const admin = new Pool({ connectionString: process.env.DATABASE_URL_ADMIN });
const userId = randomUUID();
const roleId = randomUUID();
const app = new Pool({ connectionString: process.env.DATABASE_URL_APP });
const merchantId = randomUUID();
const otherMerchantId = randomUUID();
let cardId: string;
let staffId: string;
let historicalCardId: string;
let historicalRedemptionId: string;
let profile: RewardProfile;
let pg: PgService;
async function tx<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await worker.connect();
  try {
    await c.query('BEGIN');
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
async function newCard(total = 0, anchor = 0, earned = 0) {
  const customerId = randomUUID();
  const id = randomUUID();
  await worker.query(
    `INSERT INTO merchant.customer(id,merchant_id,name) VALUES($1,$2,'Test customer')`,
    [customerId, merchantId],
  );
  await worker.query(
    `INSERT INTO merchant.loyalty_card(id,merchant_id,customer_id,card_number,cycle_anchor,rewards_earned) VALUES($1::uuid,$2,$3,$1::text,$4,$5)`,
    [id, merchantId, customerId, anchor, earned],
  );
  if (total)
    await worker.query(
      `INSERT INTO merchant.loyalty_visit(merchant_id,card_id,stamps,source) VALUES($1,$2,$3,'manual_bulk')`,
      [merchantId, id, total],
    );
  return id;
}

describe('single-cycle reward entitlements · real PostgreSQL', () => {
  beforeAll(async () => {
    pg = new PgService({ get: (key: string) => process.env[key] } as unknown as ConfigService<
      AppConfig,
      true
    >);
    await worker.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES($1::uuid,'Cycle test',$1::text),($2::uuid,'Other test',$2::text)`,
      [merchantId, otherMerchantId],
    );
    await worker.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Operator')`, [userId]);
    await worker.query(`INSERT INTO umi.role(id,key,name) VALUES($1::uuid,$1::text,'Test role')`, [
      roleId,
    ]);
    staffId = (
      await worker.query(
        `INSERT INTO merchant.staff(merchant_id,name,user_id,role_id) VALUES($1,'Operator',$2,$3) RETURNING id`,
        [merchantId, userId, roleId],
      )
    ).rows[0].id;
    const base = (
      await worker.query(
        `INSERT INTO merchant.loyalty_reward(merchant_id,name,type,kind,stamps_required) VALUES($1,'Base snapshot','stamps_free_item','standard',7) RETURNING id`,
        [merchantId],
      )
    ).rows[0].id;
    const top = (
      await worker.query(
        `INSERT INTO merchant.loyalty_reward(merchant_id,name,type,kind,stamps_required) VALUES($1,'Top snapshot','stamps_free_item','upgrade',9) RETURNING id`,
        [merchantId],
      )
    ).rows[0].id;
    profile = {
      visitsRequired: 9,
      rewardName: 'Top snapshot',
      rewardDescription: null,
      redemptionConfigId: top,
      baseTier: {
        visitsRequired: 7,
        rewardName: 'Base snapshot',
        rewardDescription: null,
        configId: base,
      },
    };
    cardId = await newCard(25, 0, 3);
    historicalCardId = await newCard(12, 0, 2);
    historicalRedemptionId = (
      await worker.query(
        `INSERT INTO merchant.loyalty_redemption(merchant_id,card_id,reward_id,reason,staff_id) VALUES($1,$2,$3,'stamps',$4) RETURNING id`,
        [merchantId, historicalCardId, top, staffId],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await worker.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [merchantId, otherMerchantId],
    ]);
    await worker.query(`DELETE FROM umi."user" WHERE id=$1`, [userId]);
    await worker.query(`DELETE FROM umi.role WHERE id=$1`, [roleId]);
    await Promise.all([worker.end(), app.end(), admin.end(), pg.onModuleDestroy()]);
  });
  it('installs the disabled policy and forced tenant isolation', async () => {
    const result = await worker.query(
      `SELECT to_regclass('merchant.loyalty_reward_entitlement')::text AS table_name`,
    );
    expect(result.rows[0].table_name).toBe('merchant.loyalty_reward_entitlement');
    const { getRewardExpiryPolicy } = await import('./reward-entitlements');
    expect(await tx((c) => getRewardExpiryPolicy(c, merchantId))).toEqual({
      mode: 'accumulate',
      days: null,
      startedAt: null,
    });
    const r = await worker.query(
      `SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='merchant.loyalty_reward_entitlement'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  it.runIf(process.env.REWARD_MIGRATION_RERUN === '1')(
    'runs the canonical SQL twice through pg without psql commands',
    async () => {
      const sql = readFileSync(
        resolve(
          process.cwd(),
          '../../supabase/migrations/20261007000000_stamp_reward_entitlements.sql',
        ),
        'utf8',
      );
      await admin.query(sql);
      await admin.query(sql);
      expect(
        (
          await worker.query(
            `SELECT count(*)::int n FROM merchant.loyalty_reward_policy WHERE merchant_id=$1`,
            [merchantId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );
  it('activation preserves legacy units, normalizes absolute anchors, and keeps deadlines on rerun', async () => {
    await worker.query(`SELECT merchant.activate_single_cycle_reward_policy($1,30)`, [merchantId]);
    let state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    expect(state.visits_this_cycle).toBe(7);
    expect(state.cycle_anchor).toBe(18);
    expect(state.pending_rewards).toBe(4);
    expect(state.legacy_pending_rewards).toBe(3);
    const initial = (
      await worker.query(
        `SELECT id,eligible_at,expires_at FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1 AND card_id=$2 ORDER BY id`,
        [merchantId, cardId],
      )
    ).rows;
    expect(initial.filter((r) => r.eligible_at === null)).toHaveLength(4);
    await worker.query(`SELECT merchant.activate_single_cycle_reward_policy($1,30)`, [merchantId]);
    expect(
      (
        await worker.query(
          `SELECT id,eligible_at,expires_at FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1 AND card_id=$2 ORDER BY id`,
          [merchantId, cardId],
        )
      ).rows,
    ).toEqual(initial);
    state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    expect(state.visit_blocked_reason).toBe('REDEMPTION_REQUIRED');
    expect(state.base_reward_blocked_by_history).toBe(true);
  });
  it('visit 7 opens one unit, visit 9 upgrades its snapshot and preserves its deadline', async () => {
    const { syncCycleReward } = await import('./reward-entitlements');
    const id = await newCard(7);
    const a = await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: 7, cycleAnchor: 0, profile }),
    );
    expect(a.changed).toBe(true);
    const before = (
      await worker.query(`SELECT * FROM merchant.loyalty_reward_entitlement WHERE id=$1`, [
        a.entitlementId,
      ])
    ).rows[0];
    await worker.query(
      `INSERT INTO merchant.loyalty_visit(merchant_id,card_id,stamps,source) VALUES($1,$2,1,'manual_bulk')`,
      [merchantId, id],
    );
    await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: 8, cycleAnchor: 0, profile }),
    );
    await worker.query(
      `INSERT INTO merchant.loyalty_visit(merchant_id,card_id,stamps,source) VALUES($1,$2,1,'manual_bulk')`,
      [merchantId, id],
    );
    await tx((c) =>
      syncCycleReward(c, {
        merchantId,
        cardId: id,
        lifetimeTotal: 9,
        cycleAnchor: 0,
        profile: { ...profile, rewardName: 'Changed config' },
      }),
    );
    const after = (
      await worker.query(`SELECT * FROM merchant.loyalty_reward_entitlement WHERE card_id=$1`, [id])
    ).rows;
    expect(after).toHaveLength(1);
    expect(after[0].expires_at).toEqual(before.expires_at);
    expect(after[0].eligible_at).toEqual(before.eligible_at);
    expect(after[0].tier).toBe('top');
    expect(after[0].top_reward_name).toBe('Top snapshot');
    expect(
      (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, id])).rows[0].visits_this_cycle,
    ).toBe(9);
  });
  it.each([7, 8, 9])('redemption at %i consumes the cycle without carryover', async (total) => {
    const { syncCycleReward, redeemRewardEntitlements } = await import('./reward-entitlements');
    const id = await newCard(total);
    await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: total, cycleAnchor: 0, profile }),
    );
    const result = await tx((c) =>
      redeemRewardEntitlements(c, {
        merchantId,
        cardId: id,
        quantity: 1,
        staffId,
        externalReceiptNumber: 'TEST-1',
        selection: total === 9 ? 'cycle_top' : 'cycle_base',
      }),
    );
    expect(result.quantity).toBe(1);
    expect(result.items[0].rewardName).toBe(total === 9 ? 'Top snapshot' : 'Base snapshot');
    const state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, id])).rows[0];
    expect(state.visits_this_cycle).toBe(0);
    expect(state.total_visits).toBe(total);
    expect(state.pending_rewards).toBe(0);
  });
  it('expiry reads zero before cleanup and advances the same live cycle anchor', async () => {
    const { syncCycleReward, expireCycleReward } = await import('./reward-entitlements');
    const id = await newCard(8);
    await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: 8, cycleAnchor: 0, profile }),
    );
    // A fixture clock shift uses the table owner after the immutable trigger is disabled for this transaction.
    const ac = await admin.connect();
    try {
      await ac.query('BEGIN');
      await ac.query(`SET LOCAL session_replication_role=replica`);
      await ac.query(
        `UPDATE merchant.loyalty_reward_entitlement SET expires_at=clock_timestamp() WHERE card_id=$1`,
        [id],
      );
      await ac.query('COMMIT');
    } finally {
      ac.release();
    }
    const before = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, id])).rows[0];
    expect(before.visits_this_cycle).toBe(0);
    expect(before.pending_rewards).toBe(0);
    expect(await tx((c) => expireCycleReward(c, merchantId, id))).toEqual({
      changed: true,
      units: 1,
    });
    expect(
      (await worker.query(`SELECT cycle_anchor FROM merchant.loyalty_card WHERE id=$1`, [id]))
        .rows[0].cycle_anchor,
    ).toBe(8);
    expect(await tx((c) => expireCycleReward(c, merchantId, id))).toEqual({
      changed: false,
      units: 0,
    });
  });
  it('recovery keeps the original expiry and later cycle progress', async () => {
    const { syncCycleReward, redeemRewardEntitlements, restoreRewardEntitlement } =
      await import('./reward-entitlements');
    const id = await newCard(7);
    await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: 7, cycleAnchor: 0, profile }),
    );
    const r = await tx((c) =>
      redeemRewardEntitlements(c, {
        merchantId,
        cardId: id,
        quantity: 1,
        staffId,
        externalReceiptNumber: 'RECOVERY',
        selection: 'cycle_base',
      }),
    );
    await worker.query(
      `INSERT INTO merchant.loyalty_visit(merchant_id,card_id,stamps,source) VALUES($1,$2,3,'manual_bulk')`,
      [merchantId, id],
    );
    expect(await tx((c) => restoreRewardEntitlement(c, merchantId, r.redemptionIds[0]))).toEqual({
      linked: true,
      expired: false,
      changed: true,
    });
    expect(await tx((c) => restoreRewardEntitlement(c, merchantId, r.redemptionIds[0]))).toEqual({
      linked: true,
      expired: false,
      changed: false,
    });
    const state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, id])).rows[0];
    expect(state.visits_this_cycle).toBe(3);
    expect(state.legacy_pending_rewards).toBe(1);
    expect(state.visit_blocked_reason).toBe('REDEMPTION_REQUIRED');
  });
  it('all card readers and metrics use the effective unexpired count', async () => {
    const expected = (
      await worker.query(
        `SELECT COALESCE(sum(rs.pending_rewards),0)::int n FROM merchant.loyalty_card c CROSS JOIN LATERAL merchant.loyalty_reward_card_state(c.merchant_id,c.id) rs WHERE c.merchant_id=$1 AND c.status='active'`,
        [merchantId],
      )
    ).rows[0].n;
    await runWithRequestContext(
      { merchantId, userId: null, requestId: 'reward-reader-test' },
      async () => {
        const cash = new CashRepository(pg);
        expect((await cash.stats(merchantId, new Date())).pending.sum).toBe(expected);
        const list = await cash.adminCustomers(merchantId, {
          search: '',
          sort: 'visits',
          limit: 1000,
          skip: 0,
        });
        const listed = list.rows.find((r) => r.cardId === cardId);
        expect(listed?.pendingRewards).toBe(4);
        expect(listed?.visitsThisCycle).toBe(7);
        expect(listed?.reward_policy).toBe('single_cycle');
        const exportRows = await cash.adminExportRows(merchantId, 'America/Mazatlan');
        expect(exportRows.find((r) => r.cardNumber === cardId)?.pendingRewards).toBe(4);
        const write = await new CashWriteRepository(pg).findCard(merchantId, cardId);
        expect(write?.pending_rewards).toBe(4);
        expect(write?.visits_this_cycle).toBe(7);
        const customer = (
          await worker.query(`SELECT customer_id FROM merchant.loyalty_card WHERE id=$1`, [cardId])
        ).rows[0].customer_id;
        const detail = await new CustomersRepository(pg).cash(merchantId, customer);
        expect(detail?.pending_rewards).toBe(4);
        expect(detail?.reward_policy).toBe('single_cycle');
      },
    );
  });
  it('preserves visits one to six without an entitlement or deadline', async () => {
    const { syncCycleReward } = await import('./reward-entitlements');
    for (const total of [1, 6]) {
      const id = await newCard(total);
      expect(
        await tx((c) =>
          syncCycleReward(c, {
            merchantId,
            cardId: id,
            lifetimeTotal: total,
            cycleAnchor: 0,
            profile,
          }),
        ),
      ).toEqual({ changed: false, entitlementId: null });
      const state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, id])).rows[0];
      expect(state.visits_this_cycle).toBe(total);
      expect(state.next_reward_expires_at).toBeNull();
      expect(state.pending_rewards).toBe(0);
    }
  });
  it('rejects changes to eligibility, deadline, and tier terms', async () => {
    const unit = (
      await worker.query(
        `SELECT id FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1 LIMIT 1`,
        [merchantId],
      )
    ).rows[0].id;
    for (const assignment of [
      "expires_at=expires_at+interval '1 day'",
      'eligible_at=clock_timestamp()',
      "base_reward_name='Changed'",
    ]) {
      await expect(
        worker.query(
          `UPDATE merchant.loyalty_reward_entitlement SET ${assignment} WHERE merchant_id=$1 AND id=$2`,
          [merchantId, unit],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
  it('keeps the enabled anchor and open snapshot through a configuration save', async () => {
    const before = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    await runWithRequestContext({ merchantId, userId: null, requestId: 'config-test' }, () =>
      new CashRepository(pg).upsertRewardConfig(merchantId, merchantId, {
        visitsRequired: 7,
        rewardName: 'New base',
        rewardDescription: null,
        rewardCostCentavos: 0,
        upgrade: {
          visitsRequired: 9,
          rewardName: 'New top',
          rewardDescription: null,
          rewardCostCentavos: 0,
        },
      }),
    );
    const after = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    expect(after.cycle_anchor).toBe(before.cycle_anchor);
    expect(after.reward_name).toBe(before.reward_name);
    expect(after.next_reward_expires_at).toEqual(before.next_reward_expires_at);
  });
  it('requires earlier historical obligations before the base cycle without a partial write', async () => {
    const { redeemRewardEntitlements } = await import('./reward-entitlements');
    const before = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    await expect(
      tx((c) =>
        redeemRewardEntitlements(c, {
          merchantId,
          cardId,
          quantity: 1,
          staffId,
          externalReceiptNumber: 'ORDER',
          selection: 'cycle_base',
        }),
      ),
    ).rejects.toThrow('Redeem historical rewards first');
    const after = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, cardId])).rows[0];
    expect(after.pending_rewards).toBe(before.pending_rewards);
    expect(after.cycle_anchor).toBe(before.cycle_anchor);
  });
  it('imports standing historical redemption IDs and restores the same original unit', async () => {
    const { restoreRewardEntitlement } = await import('./reward-entitlements');
    const before = (
      await worker.query(
        `SELECT e.id,e.eligible_at,e.expires_at FROM merchant.loyalty_reward_redemption_link l JOIN merchant.loyalty_reward_entitlement e ON e.merchant_id=l.merchant_id AND e.id=l.entitlement_id WHERE l.merchant_id=$1 AND l.redemption_id=$2`,
        [merchantId, historicalRedemptionId],
      )
    ).rows[0];
    expect(before.eligible_at).toBeNull();
    expect(
      await tx((c) => restoreRewardEntitlement(c, merchantId, historicalRedemptionId)),
    ).toEqual({ linked: true, expired: false, changed: true });
    const after = (
      await worker.query(
        `SELECT id,expires_at,recovery FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [before.id],
      )
    ).rows[0];
    expect(after.expires_at).toEqual(before.expires_at);
    expect(after.recovery).toBe(true);
    const state = (await worker.query(LOYALTY_CARD_STATE_SQL, [merchantId, historicalCardId]))
      .rows[0];
    expect(state.visits_this_cycle).toBe(3);
    expect(state.pending_rewards).toBe(2);
    expect(
      (
        await worker.query(`SELECT id FROM merchant.loyalty_redemption WHERE id=$1`, [
          historicalRedemptionId,
        ])
      ).rows[0].id,
    ).toBe(historicalRedemptionId);
  });
  it('uses the database clock after a transaction starts and a deadline passes', async () => {
    const { syncCycleReward, expireCycleReward } = await import('./reward-entitlements');
    const id = await newCard(7);
    await tx((c) =>
      syncCycleReward(c, { merchantId, cardId: id, lifetimeTotal: 7, cycleAnchor: 0, profile }),
    );
    await tx(async (c) => {
      await c.query(`SELECT now()`);
      const ac = await admin.connect();
      try {
        await ac.query('BEGIN');
        await ac.query('SET LOCAL session_replication_role=replica');
        await ac.query(
          `UPDATE merchant.loyalty_reward_entitlement SET expires_at=clock_timestamp()+interval '10 milliseconds' WHERE merchant_id=$1 AND card_id=$2`,
          [merchantId, id],
        );
        await ac.query('COMMIT');
      } finally {
        ac.release();
      }
      await c.query(`SELECT pg_sleep(0.03)`);
      await c.query(
        `SELECT id FROM merchant.loyalty_card WHERE merchant_id=$1 AND id=$2 FOR UPDATE`,
        [merchantId, id],
      );
      expect(await expireCycleReward(c, merchantId, id)).toEqual({ changed: true, units: 1 });
    });
    const unit = (
      await worker.query(
        `SELECT expired_at,pass_refresh_requested_at FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1 AND card_id=$2`,
        [merchantId, id],
      )
    ).rows[0];
    expect(unit.expired_at).toBeInstanceOf(Date);
    expect(unit.pass_refresh_requested_at).toBeInstanceOf(Date);
  });
  it('RLS hides another merchant and tenant references reject grafts', async () => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_merchant',$1,true)`, [otherMerchantId]);
      expect(
        (
          await c.query(`SELECT * FROM merchant.loyalty_reward_entitlement WHERE card_id=$1`, [
            cardId,
          ])
        ).rows,
      ).toHaveLength(0);
      await expect(
        c.query(
          `INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,expires_at,base_reward_name,top_reward_name,base_visits_required,top_visits_required) VALUES($1,$2,'legacy',clock_timestamp()+interval '30 days','x','x',7,9)`,
          [merchantId, cardId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    await expect(
      worker.query(
        `INSERT INTO merchant.loyalty_reward_entitlement(merchant_id,card_id,source,expires_at,base_reward_name,top_reward_name,base_visits_required,top_visits_required) VALUES($1,$2,'legacy',clock_timestamp()+interval '30 days','x','x',7,9)`,
        [otherMerchantId, cardId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
