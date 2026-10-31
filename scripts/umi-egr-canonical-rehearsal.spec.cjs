const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { Client } = require('../apps/umi-api/node_modules/pg');

const root = path.resolve(__dirname, '..');
const merchant = 'a13905a2-0319-4cc1-cacf-eee47b75e309';
const other = 'e6f00000-0000-4000-8000-000000000001';
const emptyCard = 'e6f00000-0000-4000-8000-000000000201';
const legacyCard = 'e6f00000-0000-4000-8000-000000000204';
const fixture = 'docs/releases/sql/single-cycle-egr-fixture.sql';
const activation =
  'supabase/migrations/20261011000000_activate_elgranribera_single_cycle_rewards.sql';
const verify = 'docs/releases/sql/single-cycle-verify.sql';

// Bootstrap this dedicated, empty database with 00_run.sh before this suite.
// Keep the final fixture for inspection. Use a new database for each test run.
test('canonical EGR fixture and reviewed activation preserve real reward state', async (t) => {
  const database = process.env.EGR_CANONICAL_TEST_DATABASE;
  assert.match(database || '', /^umi_egr_pilot_fixture_[a-z0-9_]+$/);
  const env = { ...process.env, PGDATABASE: database };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  delete env.PGHOSTADDR;
  const connection = {
    host: env.PGHOST || '127.0.0.1',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'postgres',
    password: env.PGPASSWORD,
    database,
  };
  assert.match(connection.host, /^(127\.0\.0\.1|localhost|::1)$/);
  const client = new Client(connection);
  const psql = (args, input, targetDatabase = database) =>
    spawnSync(
      'psql',
      [
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-h',
        connection.host,
        '-p',
        String(connection.port),
        '-U',
        connection.user,
        '-d',
        targetDatabase,
        ...args,
      ],
      {
        cwd: root,
        env,
        input,
        encoding: 'utf8',
        timeout: 30000,
      },
    );
  const succeeds = (result) =>
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  const rejectsSql = (result, pattern) => {
    assert.equal(result.status, 3, result.stderr || result.error?.message);
    assert.match(result.stderr, pattern);
  };
  const seed = () => psql(['-f', fixture]);
  const check = () => psql(['-v', `merchant_id=${merchant}`, '-f', verify]);
  const activate = () =>
    psql(
      [],
      `BEGIN;\nSET LOCAL umi.reward_policy_activation='elgranribera:20261011000000';\n\\i ${activation}\nCOMMIT;\n`,
    );
  const snapshot = async () =>
    (
      await client.query(`SELECT jsonb_build_object(
    'cards',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM merchant.loyalty_card c),
    'visits',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM merchant.loyalty_visit v),
    'policy',(SELECT jsonb_agg(to_jsonb(p) ORDER BY merchant_id) FROM merchant.loyalty_reward_policy p),
    'units',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM merchant.loyalty_reward_entitlement e),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY card_id) FROM merchant.loyalty_reward_activation_audit a)) state`)
    ).rows[0].state;
  await client.connect();
  try {
    assert.equal(
      (await client.query("SELECT current_setting('server_version_num')::int / 10000 major"))
        .rows[0].major,
      17,
    );
    assert.equal(
      (await client.query('SELECT count(*)::int n FROM merchant.merchant')).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT to_regprocedure('merchant.activate_single_cycle_reward_policy(uuid,integer)') IS NOT NULL ready",
        )
      ).rows[0].ready,
      true,
    );

    await t.test('strict verifier rejects an absent policy through actual psql', () => {
      rejectsSql(check(), /requires an active single_cycle 30-day policy/);
    });
    await t.test('fixture seeds canonical sample state and rejects unsafe database names', () => {
      rejectsSql(psql(['-f', fixture], undefined, 'postgres'), /umi_egr_pilot_fixture_/);
      succeeds(seed());
    });
    // Require all four fixture cards before the state checks.
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int n FROM merchant.loyalty_card WHERE merchant_id=$1',
          [merchant],
        )
      ).rows[0].n,
      4,
    );
    await t.test('fixture rerun preserves pre-activation progress', async () => {
      const before = await snapshot();
      succeeds(seed());
      assert.deepEqual(await snapshot(), before);
    });
    await client.query(
      "INSERT INTO merchant.merchant(id,name,handle) VALUES($1,'Other fixture merchant','egr-other-fixture')",
      [other],
    );
    await client.query(
      "INSERT INTO merchant.loyalty_reward_policy(merchant_id,mode) VALUES($1,'accumulate')",
      [other],
    );
    await client.query(
      "INSERT INTO merchant.customer(id,merchant_id,name) VALUES($1,$1,'Synthetic other fixture')",
      [other],
    );
    await client.query(
      'INSERT INTO merchant.loyalty_card(id,merchant_id,customer_id,rewards_earned) VALUES($1,$1,$1,1)',
      [other],
    );
    await client.query(
      "INSERT INTO merchant.loyalty_visit(merchant_id,card_id,source,stamps) VALUES($1,$1,'manual_bulk',9)",
      [other],
    );
    const otherCardBefore = (
      await client.query(
        'SELECT to_jsonb(c) state FROM merchant.loyalty_card c WHERE merchant_id=$1',
        [other],
      )
    ).rows[0].state;
    const otherBefore = (
      await client.query(
        'SELECT to_jsonb(p) state FROM merchant.loyalty_reward_policy p WHERE merchant_id=$1',
        [other],
      )
    ).rows[0].state;
    await t.test(
      'actual migration requires release opt-in and activates the real 7/9 ladder',
      async () => {
        const denied = psql(['-f', activation]);
        rejectsSql(denied, /reward_policy_activation/);
        assert.equal(
          (
            await client.query(
              'SELECT count(*)::int n FROM merchant.loyalty_reward_policy WHERE merchant_id=$1',
              [merchant],
            )
          ).rows[0].n,
          0,
        );
        succeeds(activate());
        succeeds(check());
        const states = (
          await client.query(
            `SELECT c.card_number,s.visits_this_cycle,s.pending_rewards,s.legacy_pending_rewards,s.cycle_reward_available,s.visit_blocked_reason
        FROM merchant.loyalty_card c CROSS JOIN LATERAL merchant.loyalty_reward_card_state(c.merchant_id,c.id) s
        WHERE c.merchant_id=$1 ORDER BY c.card_number`,
            [merchant],
          )
        ).rows;
        assert.deepEqual(states, [
          {
            card_number: 'EGR-FIXTURE-EMPTY',
            visits_this_cycle: 0,
            pending_rewards: 0,
            legacy_pending_rewards: 0,
            cycle_reward_available: false,
            visit_blocked_reason: null,
          },
          {
            card_number: 'EGR-FIXTURE-LEGACY',
            visits_this_cycle: 0,
            pending_rewards: 2,
            legacy_pending_rewards: 2,
            cycle_reward_available: false,
            visit_blocked_reason: 'REDEMPTION_REQUIRED',
          },
          {
            card_number: 'EGR-FIXTURE-PROGRESS',
            visits_this_cycle: 4,
            pending_rewards: 0,
            legacy_pending_rewards: 0,
            cycle_reward_available: false,
            visit_blocked_reason: null,
          },
          {
            card_number: 'EGR-FIXTURE-READY',
            visits_this_cycle: 7,
            pending_rewards: 1,
            legacy_pending_rewards: 0,
            cycle_reward_available: true,
            visit_blocked_reason: null,
          },
        ]);
        assert.deepEqual(
          (
            await client.query(
              'SELECT previous_anchor,lifetime_total,absolute_anchor,imported_units FROM merchant.loyalty_reward_activation_audit WHERE card_id=$1',
              [legacyCard],
            )
          ).rows,
          [{ previous_anchor: 0, lifetime_total: 18, absolute_anchor: 18, imported_units: 2 }],
        );
        assert.deepEqual(
          (
            await client.query(
              'SELECT to_jsonb(p) state FROM merchant.loyalty_reward_policy p WHERE merchant_id=$1',
              [other],
            )
          ).rows[0].state,
          otherBefore,
        );
        assert.deepEqual(
          (
            await client.query(
              'SELECT to_jsonb(c) state FROM merchant.loyalty_card c WHERE merchant_id=$1',
              [other],
            )
          ).rows[0].state,
          otherCardBefore,
        );
        assert.equal(
          (
            await client.query(
              'SELECT count(*)::int n FROM merchant.loyalty_reward_activation_audit WHERE merchant_id=$1',
              [other],
            )
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await client.query(
              'SELECT count(*)::int n FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1',
              [other],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      'strict verifier rejects a corrupt grace deadline through actual psql',
      async () => {
        const badId = 'e6f00000-0000-4000-8000-000000000999';
        await client.query(
          `INSERT INTO merchant.loyalty_reward_entitlement(id,merchant_id,card_id,source,activated_at,expires_at,
        base_reward_name,top_reward_name,base_visits_required,top_visits_required)
        SELECT $2,p.merchant_id,$3,'legacy',p.started_at,p.started_at+interval '31 days','Invalid fixture deadline','Invalid fixture deadline',7,9
        FROM merchant.loyalty_reward_policy p WHERE merchant_id=$1`,
          [merchant, badId, emptyCard],
        );
        try {
          rejectsSql(check(), /incorrect activation grace deadlines/);
        } finally {
          await client.query('DELETE FROM merchant.loyalty_reward_entitlement WHERE id=$1', [
            badId,
          ]);
        }
        succeeds(check());
      },
    );
    await t.test(
      'strict verifier rejects an incompatible active policy through actual psql',
      async () => {
        await client.query(
          'UPDATE merchant.loyalty_reward_policy SET expiry_days=60 WHERE merchant_id=$1',
          [merchant],
        );
        try {
          rejectsSql(check(), /requires an active single_cycle 30-day policy/);
        } finally {
          await client.query(
            'UPDATE merchant.loyalty_reward_policy SET expiry_days=30 WHERE merchant_id=$1',
            [merchant],
          );
        }
        succeeds(check());
      },
    );
    await t.test(
      'fixture and activation reruns preserve changed cards, policy and deadlines',
      async () => {
        await client.query(
          "UPDATE merchant.loyalty_card SET status='blocked',rewards_earned=rewards_earned+1 WHERE id=$1",
          [emptyCard],
        );
        await client.query(
          "INSERT INTO merchant.loyalty_visit(merchant_id,card_id,source,stamps) VALUES($1,'e6f00000-0000-4000-8000-000000000202','manual',1)",
          [merchant],
        );
        const before = await snapshot();
        succeeds(seed());
        succeeds(activate());
        assert.deepEqual(await snapshot(), before);
        succeeds(check());
      },
    );
    await t.test('fixture rejects an incompatible ladder without partial writes', async () => {
      await client.query(
        "UPDATE merchant.loyalty_reward SET stamps_required=8 WHERE merchant_id=$1 AND kind='standard'",
        [merchant],
      );
      try {
        const before = await snapshot();
        const result = seed();
        rejectsSql(result, /ladder/i);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await client.query(
          "UPDATE merchant.loyalty_reward SET stamps_required=7 WHERE merchant_id=$1 AND kind='standard'",
          [merchant],
        );
      }
      succeeds(seed());
      succeeds(check());
    });
  } finally {
    await client.end();
  }
});
