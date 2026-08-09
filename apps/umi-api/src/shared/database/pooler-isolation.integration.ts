import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';

/**
 * D3 live-DB assertion (SECURITY_GATE.md §4) — the RLS merchant scope does NOT
 * survive a pooled connection's reuse.
 *
 * WHY THIS GATE EXISTS. Supabase fronts the database with Supavisor in
 * TRANSACTION pooling mode, and the backend keeps its own `pg.Pool` besides. A
 * physical connection is therefore handed to one merchant's request, returned,
 * and handed to a DIFFERENT merchant's request moments later. Every RLS policy
 * in build-v3 reads `umi.current_merchant()`, which reads the GUC. If that GUC
 * outlives the transaction that set it, the next request on the same connection
 * inherits a stale scope and reads ANOTHER CAFÉ'S ROWS — with no error, no
 * permission denied, and nothing in a log to show for it.
 *
 * The single character that prevents this is the `true` in
 * `set_config(name, value, true)` at `pg.service.ts:266` — `true` means
 * transaction-local, the parameterized form of `SET LOCAL`. Flipping it to
 * `false` compiles, passes every unit test, passes RLS tests that use one
 * merchant, and silently cross-wires production.
 *
 * So this file does not merely assert that today's code is correct. It also
 * proves the LEAK IS REAL on the same connection (`the defect this gate exists
 * for`, below), so the gate is known to be capable of failing.
 *
 * Note on `pg_backend_pid()`: locally each pool connection is a direct backend,
 * so the pid identifies the physical connection and reuse is observable. Behind
 * Supavisor the pid reflects the pooler's own leg — which is exactly why the
 * transaction-scoping must be enforced in code and proven here, rather than
 * assumed from the deployment topology.
 *
 * See vitest.integration.config.ts + test/integration/harness-roles.sql for setup.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

/** The GUC build-v3's RLS policies actually read. */
const SCOPE_GUC = 'app.current_merchant';

describe('D3 · merchant scope never survives a pooled connection', () => {
  let pg: PgService;
  let merchantIds: string[] = [];

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    try {
      await pg.onModuleInit();
    } catch (err) {
      throw new Error(
        `Cannot reach the build-v3 harness DB. Build it and provision roles first:\n` +
          `  PGPORT=5233 docs/migration/build-v3/backfill/00_run_backfill.sh\n` +
          `  psql -p 5233 -d umi_backfill_v3 -f apps/umi-api/test/integration/harness-roles.sql\n` +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    // Ids come off the BYPASSRLS worker pool — an RLS-scoped read of the id you
    // need in order to set the scope is the bootstrap trap.
    const { rows } = await pg.query<{ id: string }>(
      'select id from merchant.merchant order by created_at limit 2',
    );
    merchantIds = rows.map((r) => r.id);
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  /** Backend pid of the app pool's current connection. Identifies the physical connection. */
  const appPid = async (): Promise<number> => {
    const c = await pg.app.connect();
    try {
      const { rows } = await c.query<{ pid: number }>('select pg_backend_pid()::int as pid');
      return rows[0].pid;
    } finally {
      c.release();
    }
  };

  it('reuses the SAME physical connection across checkouts', async () => {
    // Everything below is vacuous unless reuse actually happens. Assert it first,
    // so this file can never pass by testing two unrelated fresh connections.
    expect(merchantIds.length).toBe(2);
    const [a, b, c] = [await appPid(), await appPid(), await appPid()];
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('leaves NO scope behind after a scoped transaction commits', async () => {
    const [merchantA] = merchantIds;
    const pidDuring = await pg.runWithMerchant(merchantA, null, async (client) => {
      const { rows } = await client.query<{ scope: string; pid: number }>(
        `select current_setting($1, true) as scope, pg_backend_pid()::int as pid`,
        [SCOPE_GUC],
      );
      // Inside the transaction the scope IS set — otherwise RLS would be untested.
      expect(rows[0].scope).toBe(merchantA);
      return rows[0].pid;
    });

    const client = await pg.app.connect();
    try {
      const { rows } = await client.query<{ scope: string | null; pid: number }>(
        `select current_setting($1, true) as scope, pg_backend_pid()::int as pid`,
        [SCOPE_GUC],
      );
      expect(rows[0].pid, 'same physical connection').toBe(pidDuring);
      // `current_setting(..., true)` returns null (or empty) for an unset GUC.
      expect(rows[0].scope ?? '').toBe('');
      // And the practical consequence: the reused connection reads NOTHING.
      const counted = await client.query<{ n: number }>(
        'select count(*)::int n from merchant.merchant',
      );
      expect(counted.rows[0].n, 'unscoped read on a reused connection').toBe(0);
    } finally {
      client.release();
    }
  });

  // ⚠️ This test does NOT catch a session-scoped GUC, and that is not an oversight
  // worth fixing — it is the reason the commit/rollback tests above exist. Scoping
  // to B overwrites A's leaked value, so the read is correct either way. Verified by
  // flipping `set_config(..., true)` to `false`: this test still passed while the two
  // above failed. A reviewer who reads only this one would conclude the gate is
  // covered when the actual leak path is untested.
  it('does not bleed merchant A into merchant B on the same connection', async () => {
    const [merchantA, merchantB] = merchantIds;
    const seen = async (merchantId: string): Promise<{ ids: string[]; pid: number }> =>
      pg.runWithMerchant(merchantId, null, async (client) => {
        const { rows } = await client.query<{ id: string; pid: number }>(
          'select id, pg_backend_pid()::int as pid from merchant.merchant',
        );
        return { ids: rows.map((r) => r.id), pid: rows[0]?.pid };
      });

    const first = await seen(merchantA);
    const second = await seen(merchantB);
    expect(second.pid, 'same physical connection').toBe(first.pid);
    expect(first.ids).toEqual([merchantA]);
    expect(second.ids).toEqual([merchantB]);
  });

  it('leaves no scope behind when the transaction ROLLS BACK', async () => {
    // The error path is the one nobody exercises by hand. A ROLLBACK must clear
    // the scope exactly as a COMMIT does — if it did not, every failed request
    // would poison the connection it was using.
    const [merchantA] = merchantIds;
    let pidDuring = 0;
    await expect(
      pg.runWithMerchant(merchantA, null, async (client) => {
        const { rows } = await client.query<{ pid: number }>('select pg_backend_pid()::int as pid');
        pidDuring = rows[0].pid;
        throw new Error('deliberate failure inside the scoped transaction');
      }),
    ).rejects.toThrow(/deliberate failure/);

    const client = await pg.app.connect();
    try {
      const { rows } = await client.query<{ scope: string | null; pid: number }>(
        `select current_setting($1, true) as scope, pg_backend_pid()::int as pid`,
        [SCOPE_GUC],
      );
      expect(rows[0].pid, 'same physical connection').toBe(pidDuring);
      expect(rows[0].scope ?? '').toBe('');
    } finally {
      client.release();
    }
  });

  it('proves the defect this gate exists for: a SESSION-scoped GUC DOES survive reuse', async () => {
    // Red-green. `set_config(..., false)` is the one-character mistake — session
    // scope instead of transaction scope. Here it is, on a real pooled connection,
    // outliving the checkout that set it. This is what the `true` at
    // pg.service.ts:266 is buying, and it is why the assertions above are not
    // merely restating the obvious.
    const [merchantA] = merchantIds;
    const first = await pg.app.connect();
    let pid: number;
    try {
      const { rows } = await first.query<{ pid: number }>('select pg_backend_pid()::int as pid');
      pid = rows[0].pid;
      await first.query('select set_config($1, $2, false)', [SCOPE_GUC, merchantA]);
    } finally {
      first.release();
    }

    const second = await pg.app.connect();
    try {
      const { rows } = await second.query<{ scope: string | null; pid: number }>(
        `select current_setting($1, true) as scope, pg_backend_pid()::int as pid`,
        [SCOPE_GUC],
      );
      expect(rows[0].pid, 'same physical connection').toBe(pid);
      // The leak is REAL: a later, unrelated checkout inherits the earlier scope.
      expect(rows[0].scope).toBe(merchantA);
      // And it would read that café's rows while believing it has no scope at all.
      const counted = await second.query<{ n: number }>(
        'select count(*)::int n from merchant.merchant',
      );
      expect(counted.rows[0].n).toBe(1);
    } finally {
      // Do not hand a poisoned connection back to the pool for the next test file.
      await second.query('select set_config($1, $2, false)', [SCOPE_GUC, '']);
      second.release();
    }
  });
});
