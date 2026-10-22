const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { before, beforeEach, afterEach, after, describe, test } = require('node:test');
const { Client } = require('../apps/umi-api/node_modules/pg');

const merchantId = 'a13905a2-0319-4cc1-cacf-eee47b75e309';
const otherId = '11111111-1111-1111-1111-111111111111';
const activationRoutineFixture = `CREATE OR REPLACE FUNCTION merchant.activate_single_cycle_reward_policy(p_merchant uuid,p_days integer)
  RETURNS void LANGUAGE plpgsql AS $$
  DECLARE started timestamptz;
  BEGIN
    IF p_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'Invalid expiry days'; END IF;
    PERFORM 1 FROM merchant.merchant WHERE id=p_merchant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Merchant does not exist'; END IF;
    SELECT started_at INTO started FROM merchant.loyalty_reward_policy WHERE merchant_id=p_merchant;
    IF started IS NOT NULL THEN RETURN; END IF;
    INSERT INTO merchant.loyalty_reward_policy VALUES(p_merchant,'single_cycle',p_days,clock_timestamp())
    ON CONFLICT(merchant_id) DO UPDATE
      SET mode=EXCLUDED.mode,expiry_days=EXCLUDED.expiry_days,started_at=EXCLUDED.started_at;
    INSERT INTO merchant.activation_calls VALUES(p_merchant,p_days);
  END $$;`;
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
let fixtureCommitted = false;

describe('EGR activation migration guards (with a substitute activation routine)', () => {
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
    // These migration guards use the real policy constraints and a substitute activation routine.
    // The substitute models the routine lock, early return, and policy UPSERT only.
    // The release rehearsal verifies the routine against the restored canonical schema.
    await client.query(`CREATE SCHEMA merchant;
    CREATE TABLE merchant.merchant(id uuid PRIMARY KEY, handle text UNIQUE NOT NULL);
    CREATE TABLE merchant.loyalty_reward_policy(
      merchant_id uuid PRIMARY KEY REFERENCES merchant.merchant(id) ON DELETE CASCADE,
      mode text NOT NULL DEFAULT 'accumulate' CHECK (mode IN ('accumulate','single_cycle')),
      expiry_days integer CHECK (expiry_days BETWEEN 1 AND 365),
      started_at timestamptz,
      CHECK (mode <> 'single_cycle' OR (expiry_days IS NOT NULL AND started_at IS NOT NULL)));
    CREATE TABLE merchant.activation_calls(merchant_id uuid, days integer);
    ${activationRoutineFixture}`);
    fixtureCreated = true;
  });
  beforeEach(async () => {
    await client.query('BEGIN');
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    if (fixtureCommitted) {
      await client.query('BEGIN');
      try {
        await client.query(`DELETE FROM merchant.activation_calls;
        DELETE FROM merchant.loyalty_reward_policy;
        DELETE FROM merchant.merchant;
        ${activationRoutineFixture}`);
        await client.query('COMMIT');
        fixtureCommitted = false;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
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
  async function optIn() {
    await client.query("SET LOCAL umi.reward_policy_activation = 'elgranribera:20261011000000'");
  }
  async function activate() {
    await optIn();
    await client.query(migration);
  }
  async function rejectsWithoutMutation(pattern, { authorize = true } = {}) {
    if (authorize) await optIn();
    const before = (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows;
    await client.query('SAVEPOINT activation');
    await assert.rejects(client.query(migration), pattern);
    await client.query('ROLLBACK TO SAVEPOINT activation');
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
      0,
    );
    assert.deepEqual(
      (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows,
      before,
    );
  }

  for (const setting of [undefined, '', 'elgranribera:wrong-release']) {
    test(`rejects target activation without exact release opt-in (${String(setting)})`, async () => {
      await seed();
      if (setting === undefined) {
        assert.equal(
          (
            await client.query(
              "SELECT current_setting('umi.reward_policy_activation',true) AS value",
            )
          ).rows[0].value,
          null,
        );
      } else {
        await client.query("SELECT set_config('umi.reward_policy_activation',$1,true)", [setting]);
      }
      await rejectsWithoutMutation(/reward_policy_activation/i, { authorize: false });
      assert.equal(
        (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0]
          .n,
        0,
      );
    });
  }

  test('activates only the exact EGR identity with a 30-day policy', async () => {
    await seed();
    await seed(otherId, 'another-cafe');
    await activate();
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
    await activate();
    const before = (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows;
    await activate();
    assert.deepEqual(
      (await client.query('SELECT * FROM merchant.loyalty_reward_policy')).rows,
      before,
    );
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
      1,
    );
  });

  test('rejects an empty merchant table and permits activation after EGR is seeded', async () => {
    await rejectsWithoutMutation(/EGR.*absent/i, { authorize: false });
    await rejectsWithoutMutation(/EGR.*absent/i);
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM merchant.loyalty_reward_policy')).rows[0].n,
      0,
    );
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM merchant.activation_calls')).rows[0].n,
      0,
    );
    assert.deepEqual((await client.query('SELECT id FROM merchant.merchant')).rows, []);
    await seed();
    await activate();
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

  test('rejects absent EGR identities in a nonempty merchant table', async () => {
    await seed(otherId, 'ci-rehearsal');
    await rejectsWithoutMutation(/EGR.*absent/i);
  });

  test('accepts exact release opt-in for target activation', async () => {
    await seed();
    await client.query("SET LOCAL umi.reward_policy_activation = 'elgranribera:20261011000000'");
    await client.query(migration);
    assert.deepEqual((await client.query('SELECT * FROM merchant.activation_calls')).rows, [
      { merchant_id: merchantId, days: 30 },
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

  test('rejects an existing accumulate policy that already has an activation time', async () => {
    await seed();
    await client.query(
      "INSERT INTO merchant.loyalty_reward_policy VALUES($1,'accumulate',30,'2026-10-01T00:00:00Z')",
      [merchantId],
    );
    await rejectsWithoutMutation(/30.day policy/i);
  });

  test('activates a pending accumulate policy with no activation time', async () => {
    await seed();
    await client.query(
      "INSERT INTO merchant.loyalty_reward_policy VALUES($1,'accumulate',NULL,NULL)",
      [merchantId],
    );
    await activate();
    assert.deepEqual(
      (
        await client.query(
          'SELECT mode,expiry_days,started_at IS NOT NULL AS started FROM merchant.loyalty_reward_policy',
        )
      ).rows,
      [{ mode: 'single_cycle', expiry_days: 30, started: true }],
    );
    assert.deepEqual((await client.query('SELECT * FROM merchant.activation_calls')).rows, [
      { merchant_id: merchantId, days: 30 },
    ]);
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
    fixtureCommitted = true;
    await client.query('BEGIN');
    await optIn();
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
        observer.query('SELECT * FROM merchant.merchant WHERE id=$1 FOR UPDATE NOWAIT', [
          merchantId,
        ]),
        (error) => error.code === '55P03',
      );
    } finally {
      await blocker.end();
      try {
        if (activation) await activation;
      } finally {
        await observer.end();
      }
    }
  });

  test('can seed and activate after the lock test restores the fixture', async () => {
    for (const table of ['merchant', 'loyalty_reward_policy', 'activation_calls']) {
      assert.equal(
        (await client.query(`SELECT count(*)::int n FROM merchant.${table}`)).rows[0].n,
        0,
      );
    }
    await seed();
    await activate();
    await activate();
    assert.deepEqual((await client.query('SELECT * FROM merchant.activation_calls')).rows, [
      { merchant_id: merchantId, days: 30 },
    ]);
  });
});
