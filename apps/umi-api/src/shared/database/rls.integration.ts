import { isProductStatusActive } from '@umi/contract';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthRepository } from '../../modules/auth/auth.repository';
import { TenantsRepository } from '../../modules/tenants/tenants.repository';
import type { AppConfig } from '../config/config.schema';
import { PgService } from './pg.service';

/**
 * Live-DB integration harness — closes gate item H1 ("no test exercises real RLS").
 *
 * Boots the actual two-pool `PgService` against a local build-v3 database and
 * proves, through the SAME code path the request handlers use (`runWithTenant`,
 * `query`, the raw `app` pool), the security invariants the mocked unit tests
 * cannot reach:
 *   - the `api` pool fails CLOSED with no tenant scope (0 rows, not an error),
 *   - RLS scopes every read to the current business and blocks cross-tenant reads,
 *   - credential columns + the auth substrate are unreadable on the `api` pool,
 *   - the `worker` pool bypasses RLS and reaches the auth substrate,
 *   - `umi.effective_entitlement` returns exactly the provisioned modules per café.
 *
 * See vitest.integration.config.ts + test/integration/harness-roles.sql for setup.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

/** Minimal ConfigService stand-in — PgService only calls `.get(key, {infer})`. */
function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined, // local plaintext; TLS is exercised by prod config
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

describe('build-v3 RLS · live-DB harness', () => {
  let pg: PgService;
  let idByName: Map<string, string>;
  let workerBusinessCount = 0;

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
      );
    }
    // Business ids come from the BYPASSRLS worker pool — never from an RLS-scoped
    // read (a scoped read of the id it needs to set the scope is the bootstrap trap).
    const { rows } = await pg.query<{ id: string; name: string }>(
      'select id, name from tenant.business',
    );
    idByName = new Map(rows.map((r) => [r.name, r.id]));
    workerBusinessCount = rows.length;
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  const id = (name: string): string => {
    const v = idByName.get(name);
    if (!v) throw new Error(`fixture business "${name}" not found in umi_backfill_v3`);
    return v;
  };

  it('worker pool bypasses RLS (sees every tenant + the auth substrate)', async () => {
    expect(workerBusinessCount).toBeGreaterThanOrEqual(2);
    const users = await pg.query<{ n: number }>('select count(*)::int n from umi.user');
    expect(users.rows[0].n).toBeGreaterThan(0);
    const creds = await pg.query<{ n: number }>(
      'select count(*)::int n from umi.user where password_hash is not null',
    );
    expect(creds.rows[0].n).toBeGreaterThan(0); // strong scrypt logins survived
  });

  it('api pool fails CLOSED with no tenant scope (0 rows, no error)', async () => {
    const c = await pg.app.connect();
    try {
      const { rows } = await c.query<{ n: number }>('select count(*)::int n from tenant.business');
      expect(rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('RLS scopes tenant.business to exactly the current business', async () => {
    const r = await pg.runWithTenant(id('Kalala Café'), null, (c) =>
      c.query<{ n: number; names: string }>(
        "select count(*)::int n, string_agg(name, ',') names from tenant.business",
      ),
    );
    expect(r.rows[0].n).toBe(1);
    expect(r.rows[0].names).toBe('Kalala Café');
  });

  it('RLS blocks cross-tenant reads (every visible customer belongs to the scope)', async () => {
    const r = await pg.runWithTenant(id('Kalala Café'), null, (c) =>
      c.query<{ total: number; own: number }>(
        'select count(*)::int total, count(*) filter (where business_id = $1)::int own from tenant.customer',
        [id('Kalala Café')],
      ),
    );
    // No foreign rows leak in: the total visible set equals the scope's own rows.
    expect(r.rows[0].total).toBe(r.rows[0].own);
  });

  it('api pool cannot read credential columns on umi.user', async () => {
    const c = await pg.app.connect();
    try {
      await expect(c.query('select password_hash from umi.user limit 1')).rejects.toThrow(
        /permission denied/i,
      );
      // ...but identity columns are readable (not secret).
      const ok = await c.query('select id, email from umi.user limit 1');
      expect(ok.rows.length).toBeGreaterThan(0);
    } finally {
      c.release();
    }
  });

  it('api pool has zero privilege on the runtime auth substrate', async () => {
    const c = await pg.app.connect();
    try {
      await expect(c.query('select count(*) from runtime.password_reset_token')).rejects.toThrow(
        /permission denied/i,
      );
      await expect(c.query('select count(*) from runtime.session')).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      c.release();
    }
  });

  it('umi.effective_entitlement returns exactly the provisioned modules per café', async () => {
    const modulesFor = async (business: string): Promise<string[]> => {
      const r = await pg.runWithTenant(id(business), null, (c) =>
        c.query<{ feature_key: string }>(
          'select feature_key from umi.effective_entitlement where enabled order by feature_key',
        ),
      );
      return r.rows.map((x) => x.feature_key);
    };
    // Active cafés match product_instances; canceled cafés are empty (honor billing status).
    expect(await modulesFor('Kalala Café')).toEqual(['cash', 'conversaflow', 'dashboard', 'kds']);
    expect(await modulesFor('El Gran Ribera')).toEqual(['cash', 'dashboard']);
    expect(await modulesFor('Néctar Café')).toEqual([]);
  });

  it('AuthRepository.productStatus gates off the entitlement view (worker pool)', async () => {
    const auth = new AuthRepository(pg);
    // The café's real subscription status, straight from the source of truth.
    const sub = await pg.query<{ status: string }>(
      'select status from umi.subscription where business_id = $1',
      [id('Kalala Café')],
    );
    const kalalaStatus = sub.rows[0].status;
    // Each entitled feature resolves to the café's ACTUAL status (proves the
    // join to umi.subscription), and that status grants access…
    for (const feature of ['cash', 'kds'] as const) {
      const status = await auth.productStatus(id('Kalala Café'), feature);
      expect(status, `${feature} status`).toBe(kalalaStatus);
      expect(isProductStatusActive(status), `${feature} active`).toBe(true);
    }
    // …a feature the café isn't entitled to → null → EntitlementGuard 403s…
    expect(await auth.productStatus(id('El Gran Ribera'), 'kds')).toBeNull();
    // …and a canceled café is absent from the view entirely (fails closed).
    expect(await auth.productStatus(id('Néctar Café'), 'cash')).toBeNull();
  });

  it('TenantsRepository.loadProducts mirrors the entitlement view per café', async () => {
    const tenants = new TenantsRepository(pg);
    const kalala = await tenants.loadProducts(id('Kalala Café'));
    expect(Object.keys(kalala).sort()).toEqual(['cash', 'conversaflow', 'dashboard', 'kds']);
    // Every returned product carries an access-granting status (the capabilities
    // map the dashboard consumes never contains an inactive product).
    for (const [key, product] of Object.entries(kalala)) {
      expect(isProductStatusActive(product.status), `${key} status`).toBe(true);
    }
    // capabilities read and per-request gating share one source → can't disagree.
    expect(await tenants.loadProducts(id('Néctar Café'))).toEqual({});
  });
});
