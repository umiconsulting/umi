import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/config.schema';
import {
  PgService,
  poolRoleProblem,
  poolLoggingProblem,
  boundedStartupRetry,
  resolveSslOption,
  type PoolRoleAttributes,
  type PoolLoggingPosture,
} from './pg.service';

describe('boundedStartupRetry', () => {
  it('stops after the configured attempt count', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('unavailable'));
    await expect(boundedStartupRetry(operation, 3, 0)).rejects.toThrow('unavailable');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('returns after a later successful attempt', async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error('retry')).mockResolvedValue('ready');
    await expect(boundedStartupRetry(operation, 3, 0)).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

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

describe('poolLoggingProblem — D10 pure decision', () => {
  const posture = (over: Partial<PoolLoggingPosture> = {}): PoolLoggingPosture => ({
    role: 'umi_app',
    logStatement: 'none',
    logMinDurationStatement: -1,
    logParameterMaxLength: -1,
    ...over,
  });

  it('is silent when nothing is logged, even with parameters unrestricted', () => {
    // log_parameter_max_length = -1 means "log parameters IN FULL" — harmless while
    // no statement is logged at all. This is the state umi_app reached on 2026-08-06.
    expect(poolLoggingProblem('app', posture())).toBeNull();
  });

  it('accepts log_statement=ddl — the production cluster default', () => {
    // The request path executes no DDL, so `ddl` logs none of its statements. A check
    // demanding 'none' would report a correct configuration as broken, and the obvious
    // way to satisfy it would destroy the schema-change audit trail for every role.
    expect(poolLoggingProblem('worker', posture({ logStatement: 'ddl' }))).toBeNull();
  });

  it('flags category logging that would carry parameters', () => {
    const p = poolLoggingProblem('app', posture({ logStatement: 'all' }));
    expect(p).toMatch(/BOUND PARAMETERS/);
    expect(p).toMatch(/log_statement=all/);
  });

  it('flags DURATION logging, which log_statement=none does NOT prevent', () => {
    // The independent trigger. Silencing log_statement does nothing about this one:
    // one `log_min_duration_statement = 500ms` during an incident logs the request
    // path again, parameters and all.
    const p = poolLoggingProblem('worker', posture({ logMinDurationStatement: 500 }));
    expect(p).toMatch(/log_min_duration_statement=500ms/);
    expect(p).not.toMatch(/log_statement=/);
  });

  it('is silent when statements ARE logged but parameters never are', () => {
    expect(
      poolLoggingProblem(
        'app',
        posture({ logStatement: 'all', logMinDurationStatement: 0, logParameterMaxLength: 0 }),
      ),
    ).toBeNull();
  });

  it('names both triggers when both fire, and quotes the role to fix', () => {
    const p = poolLoggingProblem(
      'worker',
      posture({ role: 'postgres', logStatement: 'mod', logMinDurationStatement: 250 }),
    );
    expect(p).toMatch(/log_statement=mod and log_min_duration_statement=250ms/);
    expect(p).toMatch(/ALTER ROLE "postgres"/);
  });

  it('reports rather than assumes when the settings cannot be read', () => {
    expect(poolLoggingProblem('app', undefined)).toMatch(/cannot verify D10/);
  });

  it('catches the real production shape: the worker pool connected as postgres', () => {
    // Found 2026-08-06. DATABASE_URL_WORKER connects as `postgres`, not `umi_worker`.
    // umi_app was pinned (log_statement=none, log_min_duration_statement=-1) and is
    // clean; the worker role was never covered, and the auth substrate — every session
    // token and password-reset token, all bound parameters — runs ONLY there (D11).
    // A cluster-wide slow-query enable during an incident exposes exactly those.
    expect(poolLoggingProblem('app', posture({ role: 'umi_app' }))).toBeNull();
    const worker = poolLoggingProblem(
      'worker',
      posture({ role: 'postgres', logStatement: 'ddl', logMinDurationStatement: 500 }),
    );
    expect(worker).toMatch(/worker pool role "postgres"/);
  });
});

/**
 * D4 — how `PGSSLROOTCERT` becomes a `ssl` option.
 *
 * The variable holds one of two things, and the code must tell them apart: a
 * path to the root CA on disk, or the PEM itself. A production boot without it
 * is refused by the config schema, so the unset case here is local development
 * only. This branch had no test.
 */
describe('resolveSslOption', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

  it('passes an inline PEM through, without a read from disk', () => {
    const readFile = vi.fn();
    expect(resolveSslOption(PEM, readFile)).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reads a file path from disk', () => {
    const readFile = vi.fn().mockReturnValue(PEM);
    expect(resolveSslOption('/certs/supabase-ca.crt', readFile)).toEqual({
      ca: PEM,
      rejectUnauthorized: true,
    });
    expect(readFile).toHaveBeenCalledWith('/certs/supabase-ca.crt');
  });

  it('always sets rejectUnauthorized, which is the enforcement', () => {
    // Without it the CA is decoration: node accepts any certificate and the
    // connection is encrypted but unauthenticated, which is the exact failure
    // `sslmode=require` has and this control exists to prevent.
    expect(resolveSslOption(PEM, () => PEM)?.rejectUnauthorized).toBe(true);
  });

  it('gives no ssl option when the variable is unset (local development)', () => {
    expect(resolveSslOption(undefined, () => PEM)).toBeUndefined();
  });

  it('treats an empty value as unset rather than as an empty CA', () => {
    expect(resolveSslOption('', () => PEM)).toBeUndefined();
  });

  it('names the variable when the file cannot be read, instead of a bare ENOENT', () => {
    const readFile = vi.fn().mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open '/certs/gone.crt'");
    });
    expect(() => resolveSslOption('/certs/gone.crt', readFile)).toThrowError(/PGSSLROOTCERT/);
  });
});
