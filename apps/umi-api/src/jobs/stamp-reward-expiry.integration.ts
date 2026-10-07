import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { restoreRewardEntitlement } from '../shared/loyalty/reward-entitlements';
import {
  StampRewardExpiryProcessor,
  STAMP_REWARD_REMINDER_TOPIC,
  type ReminderGroup,
} from './stamp-reward-expiry.processor';

const pool = new Pool({ connectionString: process.env.DATABASE_URL_WORKER });
const merchants: string[] = [];
const fixturePhone = '+15005550006';
async function tx<T>(work: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
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
function processor(
  options: {
    refresh?: () => Promise<boolean>;
    send?: (input: { to: string; body: string }) => Promise<{ sid: string } | null>;
    enabled?: boolean;
  } = {},
) {
  return new StampRewardExpiryProcessor(
    { worker: pool, workerTx: tx } as never,
    { refresh: options.refresh ?? (async () => true) } as never,
    { sendWhatsAppMessage: options.send ?? (async () => ({ sid: 'fixture-sid' })) } as never,
    { get: () => options.enabled ?? true } as never,
  );
}
async function card(visits = 8, enabled = true) {
  const merchantId = randomUUID();
  merchants.push(merchantId);
  await pool.query(
    `INSERT INTO merchant.merchant(id,name,handle,timezone) VALUES($1::uuid,'Fixture cafe',$1::text,'America/Mazatlan')`,
    [merchantId],
  );
  await pool.query(
    `INSERT INTO merchant.loyalty_reward_policy(merchant_id,mode,expiry_days,started_at) VALUES($1,$2,30,clock_timestamp())`,
    [merchantId, enabled ? 'single_cycle' : 'accumulate'],
  );
  const customerId = (
    await pool.query(
      `INSERT INTO merchant.customer(merchant_id,name) VALUES($1,'Fixture customer') RETURNING id`,
      [merchantId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO merchant.contact(merchant_id,customer_id,channel_id,raw_phone_number,normalized_value)
    SELECT $1,$2,id,$3,$3 FROM umi.channel_type WHERE key='phone'`,
    [merchantId, customerId, fixturePhone],
  );
  const cardId = (
    await pool.query(
      `INSERT INTO merchant.loyalty_card(merchant_id,customer_id,cycle_anchor) VALUES($1,$2,0) RETURNING id`,
      [merchantId, customerId],
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO merchant.loyalty_visit(merchant_id,card_id,stamps,source) VALUES($1,$2,$3,'manual_bulk')`,
    [merchantId, cardId, visits],
  );
  return { merchantId, cardId };
}
async function unit(
  target: { merchantId: string; cardId: string },
  source: 'cycle' | 'legacy',
  deadline: string,
  tier: 'base' | 'top' = 'base',
) {
  const row = await pool.query(
    `INSERT INTO merchant.loyalty_reward_entitlement
    (merchant_id,card_id,source,cycle_anchor,eligible_at,expires_at,base_reward_name,top_reward_name,base_visits_required,top_visits_required,tier)
    VALUES($1,$2,$3,0,clock_timestamp()-interval '30 days',$4::timestamptz,'Base snapshot','Upper snapshot',7,9,$5) RETURNING id`,
    [target.merchantId, target.cardId, source, deadline, tier],
  );
  return row.rows[0].id as string;
}
async function redeemFixtureUnit(target: { merchantId: string; cardId: string }, unitId: string) {
  const redemptionId = (
    await pool.query(
      `INSERT INTO merchant.loyalty_redemption(merchant_id,card_id,reason) VALUES($1,$2,'stamps') RETURNING id`,
      [target.merchantId, target.cardId],
    )
  ).rows[0].id as string;
  await pool.query(
    `INSERT INTO merchant.loyalty_reward_redemption_link(merchant_id,redemption_id,entitlement_id,claimed_tier) VALUES($1,$2,$3,'base')`,
    [target.merchantId, redemptionId, unitId],
  );
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=clock_timestamp() WHERE id=$1`,
    [unitId],
  );
  return redemptionId;
}
async function restoreFixtureUnit(
  target: { merchantId: string; cardId: string },
  redemptionId: string,
) {
  return tx(async (c) => {
    await c.query(`SELECT id FROM merchant.loyalty_card WHERE id=$1 FOR UPDATE`, [target.cardId]);
    return restoreRewardEntitlement(c, target.merchantId, redemptionId);
  });
}

async function deadline(expression: string) {
  return (await pool.query(`SELECT (${expression})::text AS at`)).rows[0].at as string;
}
async function queued(target: { merchantId: string; cardId: string }): Promise<ReminderGroup> {
  const row = await pool.query(
    `SELECT payload FROM runtime.outbox_event WHERE merchant_id=$1 AND topic=$2`,
    [target.merchantId, STAMP_REWARD_REMINDER_TOPIC],
  );
  expect(row.rows).toHaveLength(1);
  return row.rows[0].payload;
}
beforeAll(async () => {
  await pool.query(
    `INSERT INTO umi.channel_type(key,name,supports_outbound) VALUES('phone','Phone',true) ON CONFLICT(key) DO NOTHING`,
  );
});
afterAll(async () => {
  await pool.query(`DELETE FROM merchant.merchant WHERE id=ANY($1::uuid[])`, [merchants]);
  await pool.end();
});

it('resets an expired cycle and keeps a failed wallet refresh durable across repeated sweeps', async () => {
  const target = await card();
  const id = await unit(target, 'cycle', await deadline(`clock_timestamp()-interval '1 second'`));
  const failed = processor({ refresh: async () => false });
  expect((await failed.sweep()).expiredUnits).toBe(1);
  expect((await failed.sweep()).expiredUnits).toBe(0);
  const pending = (
    await pool.query(
      `SELECT expired_at,pass_refresh_requested_at,pass_refreshed_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
      [id],
    )
  ).rows[0];
  expect(pending.expired_at).not.toBeNull();
  expect(pending.pass_refresh_requested_at).not.toBeNull();
  expect(pending.pass_refreshed_at).toBeNull();
  expect(
    (
      await pool.query(`SELECT cycle_anchor FROM merchant.loyalty_card WHERE id=$1`, [
        target.cardId,
      ])
    ).rows[0].cycle_anchor,
  ).toBe(8);
  const success = processor();
  expect((await success.sweep()).refreshedCards).toBeGreaterThanOrEqual(1);
  expect(
    (
      await pool.query(
        `SELECT pass_refreshed_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [id],
      )
    ).rows[0].pass_refreshed_at,
  ).not.toBeNull();
  expect((await success.sweep()).refreshedCards).toBe(0);
});

it('expires legacy units and touches the card while it preserves partial progress', async () => {
  const target = await card(3);
  const before = (
    await pool.query(
      `SELECT updated_at::text AS updated_at FROM merchant.loyalty_card WHERE id=$1`,
      [target.cardId],
    )
  ).rows[0].updated_at;
  await unit(target, 'legacy', await deadline(`clock_timestamp()-interval '1 second'`));
  expect((await processor().sweep()).expiredUnits).toBe(1);
  const after = (
    await pool.query(
      `SELECT cycle_anchor,updated_at > $2::timestamptz AS touched FROM merchant.loyalty_card WHERE id=$1`,
      [target.cardId, before],
    )
  ).rows[0];
  expect(after.cycle_anchor).toBe(0);
  expect(after.touched).toBe(true);
});

it('keeps disabled policy cards unchanged', async () => {
  const target = await card(8, false);
  const id = await unit(target, 'cycle', await deadline(`clock_timestamp()-interval '1 second'`));
  await processor().sweep();
  expect(
    (
      await pool.query(`SELECT expired_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`, [
        id,
      ])
    ).rows[0].expired_at,
  ).toBeNull();
});

it('groups mixed rewards into one outbox event and sends the group once', async () => {
  const target = await card();
  const at = await deadline(`clock_timestamp()+interval '7 days'-interval '1 minute'`);
  await unit(target, 'cycle', at);
  await unit(target, 'legacy', at);
  await unit(target, 'legacy', at, 'top');
  const delivered: { to: string; body: string }[] = [];
  const p = processor({
    send: async (input) => {
      delivered.push(input);
      return { sid: 'fixture-sid' };
    },
  });
  expect((await p.sweep()).queuedReminders).toBe(1);
  expect((await p.sweep()).queuedReminders).toBe(0);
  const group = await queued(target);
  expect(await p.deliverReminder(group)).toBe(true);
  expect(await p.deliverReminder(group)).toBe(false);
  expect(delivered).toHaveLength(1);
  expect(delivered[0].to).toBe(fixturePhone);
  expect(delivered[0].body).toContain('2 × Base snapshot');
  expect(delivered[0].body).toContain('1 × Upper snapshot');
  expect(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM merchant.loyalty_reward_entitlement WHERE card_id=$1 AND reminder_sent_at IS NOT NULL`,
        [target.cardId],
      )
    ).rows[0].n,
  ).toBe(3);
});

it('queues a restored unsent unit after its deadline group already completed', async () => {
  const target = await card();
  const at = await deadline(`clock_timestamp()+interval '6 days'`);
  await unit(target, 'legacy', at);
  const restoredId = await unit(target, 'legacy', at, 'top');
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=clock_timestamp() WHERE id=$1`,
    [restoredId],
  );
  const bodies: string[] = [];
  const p = processor({
    send: async (input) => {
      bodies.push(input.body);
      return { sid: 'fixture-restored-group' };
    },
  });
  expect((await p.sweep()).queuedReminders).toBe(1);
  const group = await queued(target);
  expect(await p.deliverReminder(group)).toBe(true);
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=NULL,recovery=true,recovery_tier='base' WHERE id=$1`,
    [restoredId],
  );
  expect((await p.sweep()).queuedReminders).toBe(1);
  expect((await p.sweep()).queuedReminders).toBe(0);
  expect(
    (
      await pool.query(
        `SELECT count(*)::int AS n FROM runtime.outbox_event WHERE merchant_id=$1 AND topic=$2`,
        [target.merchantId, STAMP_REWARD_REMINDER_TOPIC],
      )
    ).rows[0].n,
  ).toBe(2);
  expect(await p.deliverReminder(group)).toBe(true);
  expect(await p.deliverReminder(group)).toBe(false);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toContain('1 × Base snapshot');
  expect(
    (
      await pool.query(
        `SELECT reminder_sent_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [restoredId],
      )
    ).rows[0].reminder_sent_at,
  ).not.toBeNull();
});

it.each([false, true])(
  'requeues restored members after completed delivery: all redeemed=%s',
  async (allRedeemed) => {
    const target = await card();
    const at = await deadline(`clock_timestamp()+interval '6 days'`);
    const first = await unit(target, 'legacy', at);
    const second = await unit(target, 'legacy', at);
    const bodies: string[] = [];
    const p = processor({
      send: async (input) => {
        bodies.push(input.body);
        return { sid: 'fixture-generation' };
      },
    });
    expect((await p.sweep()).queuedReminders).toBe(1);
    const group = await queued(target);
    const secondClaim = await redeemFixtureUnit(target, second);
    const firstClaim = allRedeemed ? await redeemFixtureUnit(target, first) : null;
    expect(await p.deliverReminder(group)).toBe(!allRedeemed);
    await restoreFixtureUnit(target, secondClaim);
    if (firstClaim) await restoreFixtureUnit(target, firstClaim);
    expect((await p.sweep()).queuedReminders).toBe(1);
    expect((await p.sweep()).queuedReminders).toBe(0);
    expect(await p.deliverReminder(group)).toBe(true);
    expect(await p.deliverReminder(group)).toBe(false);
    expect(bodies).toHaveLength(allRedeemed ? 1 : 2);
    expect(bodies.at(-1)).toContain(`${allRedeemed ? 2 : 1} × Base snapshot`);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM runtime.outbox_event WHERE merchant_id=$1 AND topic=$2`,
          [target.merchantId, STAMP_REWARD_REMINDER_TOPIC],
        )
      ).rows[0].n,
    ).toBe(2);
  },
);

it('reminds the restored selected tier rather than the original upgraded tier', async () => {
  const target = await card();
  const at = await deadline(`clock_timestamp()+interval '6 days'`);
  const id = await unit(target, 'legacy', at, 'top');
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET recovery=true,recovery_tier='base' WHERE id=$1`,
    [id],
  );
  const bodies: string[] = [];
  const p = processor({
    send: async (input) => {
      bodies.push(input.body);
      return { sid: 'fixture-recovery' };
    },
  });
  await p.sweep();
  await p.deliverReminder(await queued(target));
  expect(bodies[0]).toContain('1 × Base snapshot');
  expect(bodies[0]).not.toContain('Upper snapshot');
});

it('retries a failed delivery and rechecks redemption before it sends', async () => {
  const target = await card();
  const id = await unit(target, 'cycle', await deadline(`clock_timestamp()+interval '6 days'`));
  const fail = processor({ send: async () => null });
  await fail.sweep();
  const group = await queued(target);
  await expect(fail.deliverReminder(group)).rejects.toThrow('delivery failed');
  expect(
    (
      await pool.query(
        `SELECT reminder_sent_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [id],
      )
    ).rows[0].reminder_sent_at,
  ).toBeNull();
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET redeemed_at=clock_timestamp() WHERE id=$1`,
    [id],
  );
  let sends = 0;
  const retry = processor({
    send: async () => {
      sends++;
      return { sid: 'fixture-sid' };
    },
  });
  expect(await retry.deliverReminder(group)).toBe(false);
  expect(sends).toBe(0);
});

it('serializes delivery without a card row lock across provider I/O', async () => {
  const target = await card();
  await unit(target, 'cycle', await deadline(`clock_timestamp()+interval '6 days'`));
  let release!: () => void;
  let entered!: () => void;
  const providerStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const providerContinue = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sends = 0;
  const p = processor({
    send: async () => {
      sends++;
      entered();
      await providerContinue;
      return { sid: 'fixture-sid' };
    },
  });
  await p.sweep();
  const group = await queued(target);
  const first = p.deliverReminder(group);
  await providerStarted;
  try {
    await expect(p.deliverReminder(group)).rejects.toThrow('already in progress');
    await tx(async (c) => {
      await c.query(`SELECT id FROM merchant.loyalty_card WHERE id=$1 FOR UPDATE NOWAIT`, [
        target.cardId,
      ]);
    });
  } finally {
    release();
  }
  expect(await first).toBe(true);
  expect(await p.deliverReminder(group)).toBe(false);
  expect(sends).toBe(1);
});

it('waits until seven days remain and honors the reminder delivery flag', async () => {
  const target = await card();
  await unit(target, 'cycle', await deadline(`clock_timestamp()+interval '8 days'`));
  expect((await processor().sweep()).queuedReminders).toBe(0);
  const due = await card();
  await unit(due, 'cycle', await deadline(`clock_timestamp()+interval '6 days'`));
  await processor().sweep();
  const group = await queued(due);
  let sends = 0;
  const disabled = processor({
    enabled: false,
    send: async () => {
      sends++;
      return { sid: 'fixture-sid' };
    },
  });
  expect(await disabled.deliverReminder(group)).toBe(false);
  expect(sends).toBe(0);
});

it('prioritizes new expirations over failed refreshes in a bounded sweep', async () => {
  const targets = [await card(), await card()].sort((a, b) =>
    a.merchantId.localeCompare(b.merchantId),
  );
  const old = await unit(
    targets[0],
    'legacy',
    await deadline(`clock_timestamp()-interval '1 second'`),
  );
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET expired_at=clock_timestamp(),pass_refresh_requested_at=clock_timestamp() WHERE id=$1`,
    [old],
  );
  await unit(targets[1], 'cycle', await deadline(`clock_timestamp()-interval '1 second'`));
  expect((await processor({ refresh: async () => false }).sweep(1)).expiredUnits).toBe(1);
});

it('rotates a failed refresh so it cannot block another card refresh', async () => {
  const first = await card();
  const second = await card();
  const older = await unit(
    first,
    'legacy',
    await deadline(`clock_timestamp()-interval '1 second'`),
  );
  const newer = await unit(
    second,
    'legacy',
    await deadline(`clock_timestamp()-interval '1 second'`),
  );
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET expired_at=clock_timestamp(),pass_refresh_requested_at=clock_timestamp()-interval '2 days' WHERE id=$1`,
    [older],
  );
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET expired_at=clock_timestamp(),pass_refresh_requested_at=clock_timestamp()-interval '1 day' WHERE id=$1`,
    [newer],
  );
  // Complete markers from earlier scenarios so this bounded check has two candidates.
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET pass_refreshed_at=clock_timestamp() WHERE merchant_id=ANY($1::uuid[]) AND id<>ALL($2::uuid[])`,
    [merchants, [older, newer]],
  );
  const calls: string[] = [];
  const p = processor({
    refresh: async (...args: unknown[]) => {
      calls.push(String(args[0]));
      return args[0] === second.cardId;
    },
  });
  await p.sweep(1);
  await p.sweep(1);
  expect(calls).toEqual([first.cardId, second.cardId]);
});

it('keeps a new wallet request pending if it arrives during the previous refresh', async () => {
  const target = await card();
  const id = await unit(target, 'legacy', await deadline(`clock_timestamp()-interval '1 second'`));
  await pool.query(
    `UPDATE merchant.loyalty_reward_entitlement SET expired_at=clock_timestamp(),pass_refresh_requested_at=clock_timestamp()-interval '3 days' WHERE id=$1`,
    [id],
  );
  const p = processor({
    refresh: async () => {
      await tx(async (c) => {
        await c.query(`SELECT id FROM merchant.loyalty_card WHERE id=$1 FOR UPDATE`, [
          target.cardId,
        ]);
        await c.query(
          `UPDATE merchant.loyalty_reward_entitlement SET pass_refresh_requested_at=clock_timestamp() WHERE id=$1`,
          [id],
        );
      });
      return true;
    },
  });
  await p.sweep(1);
  expect(
    (
      await pool.query(
        `SELECT pass_refreshed_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [id],
      )
    ).rows[0].pass_refreshed_at,
  ).toBeNull();
  await processor().sweep();
  expect(
    (
      await pool.query(
        `SELECT pass_refreshed_at FROM merchant.loyalty_reward_entitlement WHERE id=$1`,
        [id],
      )
    ).rows[0].pass_refreshed_at,
  ).not.toBeNull();
});
