import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config.schema';
import { PgService, poolRoleProblem, type PoolRoleAttributes } from './pg.service';

/**
 * D1 boot-guard tests (SECURITY_GATE.md §4). The guard is exercised at two
 * levels: the pure `poolRoleProblem` decision, and the full `onModuleInit` wiring
 * with both pools' `query` mocked so no database is touched.
 */

const APP_OK: PoolRoleAttributes = {
  role: 'api_login',
  superuser: false,
  bypassrls: false,
  inheritsGroup: true,
};
const WORKER_OK: PoolRoleAttributes = {
  role: 'worker_login',
  superuser: false,
  bypassrls: true,
  inheritsGroup: true,
};

const created: PgService[] = [];

/**
 * Build a PgService whose two pools answer the role-attribute probe with the
 * given rows (and any other query — e.g. the `SELECT 1` liveness ping — with a
 * trivial row). Real `pg.Pool`s are constructed but never connect, since every
 * `query` is mocked.
 */
function pgWith(
  app: PoolRoleAttributes | undefined,
  worker: PoolRoleAttributes | undefined,
): PgService {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: 'postgresql://api_login:x@127.0.0.1:5599/db',
    DATABASE_URL_WORKER: 'postgresql://worker_login:x@127.0.0.1:5599/db',
    PGSSLROOTCERT: undefined,
  };
  const config = {
    get: (k: string) => env[k],
  } as unknown as ConfigService<AppConfig, true>;

  const pg = new PgService(config);
  const route = (attrs: PoolRoleAttributes | undefined) => async (text: string) =>
    /pg_has_role/i.test(text)
      ? { rows: attrs ? [attrs] : [], rowCount: attrs ? 1 : 0 }
      : { rows: [{ ok: 1 }], rowCount: 1 };
  // `pg.query` is overloaded and one overload takes a callback returning `void`,
  // which is the signature TS resolves here — so an async mock reads as a promise
  // returned into a void position. It is not: vitest hands the promise straight
  // back to PgService, which awaits it. Suppressed narrowly rather than turning
  // the rule off, because elsewhere it catches genuinely dropped async work.
  /* eslint-disable @typescript-eslint/no-misused-promises */
  vi.spyOn(pg.app, 'query').mockImplementation(route(app));
  vi.spyOn(pg.worker, 'query').mockImplementation(route(worker));
  /* eslint-enable @typescript-eslint/no-misused-promises */
  created.push(pg);
  return pg;
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((p) => p.onModuleDestroy()));
  vi.restoreAllMocks();
});

describe('poolRoleProblem — D1 pure decision', () => {
  it('passes a correctly wired app pool (api member, not super, not bypassrls)', () => {
    expect(poolRoleProblem('app', 'api', false, APP_OK)).toBeNull();
  });

  it('passes a correctly wired worker pool (worker member, bypassrls)', () => {
    expect(poolRoleProblem('worker', 'worker', true, WORKER_OK)).toBeNull();
  });

  it('flags a superuser role', () => {
    expect(poolRoleProblem('app', 'api', false, { ...APP_OK, superuser: true })).toMatch(
      /SUPERUSER/,
    );
  });

  it('flags an app pool that BYPASSes RLS', () => {
    expect(poolRoleProblem('app', 'api', false, { ...APP_OK, bypassrls: true })).toMatch(
      /rolbypassrls=true \(expected false\)/,
    );
  });

  it('flags a worker pool that does NOT bypass RLS', () => {
    expect(poolRoleProblem('worker', 'worker', true, { ...WORKER_OK, bypassrls: false })).toMatch(
      /rolbypassrls=false \(expected true\)/,
    );
  });

  it('flags a role that does not inherit its group (NOINHERIT membership)', () => {
    expect(poolRoleProblem('app', 'api', false, { ...APP_OK, inheritsGroup: false })).toMatch(
      /does not inherit "api"/,
    );
  });

  it('flags a missing pg_roles row', () => {
    expect(poolRoleProblem('app', 'api', false, undefined)).toMatch(/no row in pg_roles/);
  });
});

describe('PgService.onModuleInit — D1 boot guard', () => {
  it('boots when both pools are wired correctly', async () => {
    const pg = pgWith(APP_OK, WORKER_OK);
    await expect(pg.onModuleInit()).resolves.toBeUndefined();
  });

  it('refuses to boot when the app pool is a superuser', async () => {
    const pg = pgWith({ ...APP_OK, superuser: true }, WORKER_OK);
    await expect(pg.onModuleInit()).rejects.toThrow(/refusing to boot.*app pool.*SUPERUSER/is);
  });

  it('refuses to boot when the app pool BYPASSes RLS', async () => {
    const pg = pgWith({ ...APP_OK, bypassrls: true }, WORKER_OK);
    await expect(pg.onModuleInit()).rejects.toThrow(/app pool.*rolbypassrls=true/is);
  });

  it('refuses to boot when the app pool does not inherit api', async () => {
    const pg = pgWith({ ...APP_OK, inheritsGroup: false }, WORKER_OK);
    await expect(pg.onModuleInit()).rejects.toThrow(/app pool.*does not inherit "api"/is);
  });

  it('refuses to boot when the worker pool does NOT bypass RLS', async () => {
    const pg = pgWith(APP_OK, { ...WORKER_OK, bypassrls: false });
    await expect(pg.onModuleInit()).rejects.toThrow(/worker pool.*rolbypassrls=false/is);
  });

  it('names BOTH pools when both are mis-wired', async () => {
    const pg = pgWith({ ...APP_OK, superuser: true }, { ...WORKER_OK, bypassrls: false });
    const err = await pg.onModuleInit().catch((e: unknown) => e);
    expect(String(err)).toMatch(/app pool/);
    expect(String(err)).toMatch(/worker pool/);
  });
});
