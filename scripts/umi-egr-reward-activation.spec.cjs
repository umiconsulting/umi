const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { before, beforeEach, afterEach, after, test } = require('node:test');
const { Client } = require('../apps/umi-api/node_modules/pg');

const merchantId = 'a13905a2-0319-4cc1-cacf-eee47b75e309';
const otherId = '11111111-1111-1111-1111-111111111111';
const migration = readFileSync(
  path.join(
    __dirname,
    '../supabase/migrations/20261011000000_activate_elgranribera_single_cycle_rewards.sql',
  ),
  'utf8',
);
let client;
let connection;
let fixtureCreated = false;

before(async () => {
  const database = process.env.EGR_ACTIVATION_TEST_DATABASE;
  assert.match(database || '', /^umi_egr_activation_test_[a-z0-9_]+$/);
  connection = {
    host: '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: 'postgres',
    password: process.env.PGPASSWORD,
    database,
  };
  client = new Client(connection);
  await client.connect();
  assert.equal(
    (await client.query("SELECT current_setting('server_version_num')::int / 10000 AS major"))
      .rows[0].major,
    17,
  );
  assert.equal(
    (await client.query("SELECT to_regnamespace('merchant') IS NULL AS empty")).rows[0].empty,
    true,
  );
  // The real migration runs against a small fixture for the existing routine contract.
  // The release rehearsal verifies the routine against the restored canonical schema.
  await client.query(`CREATE SCHEMA merchant;
    CREATE TABLE merchant.merchant(id uuid PRIMARY KEY, handle text UNIQUE NOT NULL);
    CREATE TABLE merchant.loyalty_reward_policy(
      merchant_id uuid PRIMARY KEY REFERENCES merchant.merchant,
      mode text NOT NULL, expiry_days integer, started_at timestamptz);
    CREATE TABLE merchant.activation_calls(merchant_id uuid, days integer);
    CREATE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM merchant.loyalty_reward_policy WHERE merchant_id=p_merchant) THEN RETURN; END IF;
      INSERT INTO merchant.loyalty_reward_policy VALUES(p_merchant,'single_cycle',p_days,clock_timestamp());
      INSERT INTO merchant.activation_calls VALUES(p_merchant,p_days);
    END $$;`);
  fixtureCreated = true;
});
beforeEach(async () => {
  await client.query('BEGIN');
});
afterEach(async () => {
  await client.query('ROLLBACK');
});
after(async () => {
  if (client) {
    if (fixtureCreated) await client.query('DROP SCHEMA merchant CASCADE');
    await client.end();
  }
});

async function seed(id = merchantId, handle = 'elgranribera') {
  await client.query('INSERT INTO merchant.merchant VALUES($1,$2)', [id, handle]);
}
async function rejectsWithoutMutation(pattern) {
  await client.query('SAVEPOINT activation');
  await assert.rejects(client.query(migration), pattern);
  await client.query('ROLLBACK TO SAVEPOINT activation');
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
    0,
  );
}

test('activates only the exact EGR identity with a 30-day policy', async () => {
  await seed();
  await seed(otherId, 'another-cafe');
  await client.query(migration);
  assert.deepEqual(
    (
      await client.query(
        'SELECT merchant_id,mode,expiry_days,started_at IS NOT NULL AS started FROM merchant.loyalty_reward_policy',
      )
    ).rows,
    [{ merchant_id: merchantId, mode: 'single_cycle', expiry_days: 30, started: true }],
  );
  assert.deepEqual((await client.query('SELECT * FROM merchant.activation_calls')).rows, [
    { merchant_id: merchantId, days: 30 },
  ]);
});

test('preserves the first policy timestamp and avoids repeat activation', async () => {
  await seed();
  await client.query(migration);
  const before = (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows;
  await client.query(migration);
  assert.deepEqual(
    (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows,
    before,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
    1,
  );
});

test('skips a clean test environment without either EGR identity', async () => {
  await seed(otherId, 'ci-rehearsal');
  await client.query(migration);
  await client.query(migration);
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0].n,
    0,
  );
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
    0,
  );
  assert.deepEqual((await client.query('SELECT id FROM merchant.merchant')).rows, [
    { id: otherId },
  ]);
});

test('rejects the EGR UUID with a different handle', async () => {
  await seed(merchantId, 'another-cafe');
  await rejectsWithoutMutation(/identity/i);
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0].n,
    0,
  );
});

test('rejects the EGR UUID with a null handle', async () => {
  await client.query('ALTER TABLE merchant.merchant ALTER COLUMN handle DROP NOT NULL');
  await seed(merchantId, null);
  await rejectsWithoutMutation(/identity/i);
});

test('rejects the EGR handle with a different UUID', async () => {
  await seed(otherId);
  await rejectsWithoutMutation(/identity/i);
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0].n,
    0,
  );
});

test('rejects EGR identities split across two merchants', async () => {
  await seed(merchantId, 'another-cafe');
  await seed(otherId);
  await rejectsWithoutMutation(/identity/i);
});

test('rejects activation before the base reward routine exists', async () => {
  await seed();
  await client.query('DROP FUNCTION merchant.activate_single_cycle_reward_policy(uuid,integer)');
  await rejectsWithoutMutation(/base reward schema/i);
});

test('rejects an existing policy that has a different expiry', async () => {
  await seed();
  await client.query(
    "INSERT INTO merchant.loyalty_reward_policy VALUES($1,'single_cycle',60,'2026-10-01T00:00:00Z')",
    [merchantId],
  );
  const before = (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows;
  await rejectsWithoutMutation(/30.day policy/i);
  assert.deepEqual(
    (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows,
    before,
  );
});

test('rejects a routine that returns without an active policy', async () => {
  await seed();
  await client.query(`CREATE OR REPLACE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$`);
  await rejectsWithoutMutation(/30.day policy/i);
});

test('rejects an existing policy with the wrong mode or no activation time', async () => {
  await seed();
  for (const [mode, started] of [
    ['accumulate', '2026-10-01T00:00:00Z'],
    ['single_cycle', null],
  ]) {
    await client.query('INSERT INTO merchant.loyalty_reward_policy VALUES($1,$2,30,$3)', [
      merchantId,
      mode,
      started,
    ]);
    await rejectsWithoutMutation(/30.day policy/i);
    await client.query('DELETE FROM merchant.loyalty_reward_policy');
  }
});

test('rolls back partial activation when the routine raises', async () => {
  await seed();
  await client.query(`CREATE OR REPLACE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO merchant.loyalty_reward_policy VALUES(p_merchant,'single_cycle',p_days,clock_timestamp());
      RAISE EXCEPTION 'activation fixture failure';
    END $$`);
  await rejectsWithoutMutation(/activation fixture failure/);
  assert.equal(
    (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0].n,
    0,
  );
});

test('keeps the identity row locked until activation finishes', async () => {
  await seed();
  await client.query(`CREATE OR REPLACE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      PERFORM pg_advisory_xact_lock(20261011);
      INSERT INTO merchant.loyalty_reward_policy VALUES(p_merchant,'single_cycle',p_days,clock_timestamp());
    END $$`);
  await client.query('COMMIT');
  const blocker = new Client(connection);
  const observer = new Client(connection);
  let activation;
  try {
    await blocker.connect();
    await observer.connect();
    await blocker.query('SELECT pg_advisory_lock(20261011)');
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    activation = client.query(migration);
    const deadline = Date.now() + 5000;
    while (true) {
      const { rows } = await observer.query(
        "SELECT wait_event='advisory' AS waiting FROM pg_stat_activity WHERE pid=$1",
        [pid],
      );
      if (rows[0].waiting) break;
      assert.ok(Date.now() < deadline, 'activation must reach the routine');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await assert.rejects(
      observer.query('SELECT * FROM merchant.merchant WHERE id=$1 FOR UPDATE NOWAIT', [merchantId]),
      (error) => error.code === '55P03',
    );
  } finally {
    await blocker.end();
    try {
      if (activation) await activation;
    } finally {
      await observer.end();
      await client.query('BEGIN');
    }
  }
});
