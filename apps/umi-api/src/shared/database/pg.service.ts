import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/config.schema';
import { getRequestContext } from './request-context';

/** The connected role's D1-relevant attributes, read off `pg_roles`. */
export interface PoolRoleAttributes {
  role: string;
  /** rolsuper — a superuser bypasses RLS and every grant. */
  superuser: boolean;
  /** rolbypassrls — reads/writes ignore RLS policies. */
  bypassrls: boolean;
  /**
   * pg_has_role(current_user, <group>, 'USAGE') — the role can *use* the group's
   * privileges without `SET ROLE`, i.e. it INHERITs them. Stronger than 'MEMBER':
   * a NOINHERIT member holds the grant but not its privileges (D5), so USAGE
   * catches that mis-wiring at boot instead of at the first query.
   */
  inheritsGroup: boolean;
}

/**
 * Pure D1 boot-guard decision (SECURITY_GATE.md §4). Given the role a pool
 * actually connected as, return a human-readable problem, or `null` when the
 * pool is wired correctly. Role ATTRIBUTES (super/bypassrls) never inherit
 * through membership, so they are read off `current_user` itself; `inheritsGroup`
 * uses `pg_has_role(...,'USAGE')`, true only when the role INHERITs the group's
 * privileges (prod/D5 wiring: `api_login IN ROLE api`) — so a correctly-wired
 * login role passes and cutover stays an env change, not a code change. Exported
 * so the guard is unit-testable without a DB.
 */
export function poolRoleProblem(
  pool: 'app' | 'worker',
  group: 'api' | 'worker',
  wantBypassRls: boolean,
  attrs: PoolRoleAttributes | undefined,
): string | null {
  if (!attrs) {
    return `${pool} pool: current_user has no row in pg_roles (cannot verify D1).`;
  }
  const issues: string[] = [];
  if (attrs.superuser) issues.push('role is SUPERUSER');
  if (attrs.bypassrls !== wantBypassRls) {
    issues.push(`rolbypassrls=${attrs.bypassrls} (expected ${wantBypassRls})`);
  }
  if (!attrs.inheritsGroup) {
    issues.push(
      `role does not inherit "${group}" (needs INHERIT membership so its grants are active)`,
    );
  }
  if (issues.length === 0) return null;
  return (
    `${pool} pool role "${attrs.role}" is misconfigured: ${issues.join('; ')}. ` +
    `The ${pool} pool must connect as "${group}" (or an INHERIT member of it) — ` +
    `see SECURITY_GATE.md §4 D1 and test/integration/harness-roles.sql.`
  );
}

/**
 * The single data-access primitive. No ORM (D8) — raw parameterized SQL.
 * Two pools, one per Postgres role — the role is embedded in each connection
 * string (env), so cutover is an env change, not a code change:
 *   - `app`    → RLS-enforced request path   (current: umi_app;   build-v3: api)
 *   - `worker` → BYPASSRLS background/queue   (current: umi_worker; build-v3: worker)
 *
 * Repositories own their SQL; they call `query()` for service work, or
 * `withTenant()` for RLS-scoped reads/writes on the request path.
 */
@Injectable()
export class PgService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PgService.name);
  private readonly tlsEnforced: boolean;
  readonly app: Pool;
  readonly worker: Pool;

  constructor(config: ConfigService<AppConfig, true>) {
    // verify-full TLS when a CA is provisioned (prod/Supabase); plaintext otherwise
    // (local dev against localhost). rejectUnauthorized:true is the real enforcement —
    // a wrong CA or hostname makes the handshake FAIL at connect. Accept a file path
    // or an inline PEM. Do not set sslmode in the URL; this option governs TLS.
    const caValue = config.get('PGSSLROOTCERT', { infer: true });
    const ssl = caValue
      ? {
          ca: caValue.includes('BEGIN CERTIFICATE') ? caValue : readFileSync(caValue),
          rejectUnauthorized: true,
        }
      : undefined;
    this.tlsEnforced = ssl !== undefined;

    this.app = new Pool({
      connectionString: config.get('DATABASE_URL_APP', { infer: true }),
      ssl,
    });
    this.worker = new Pool({
      connectionString: config.get('DATABASE_URL_WORKER', { infer: true }),
      ssl,
    });
    // pg.Pool emits 'error' for idle clients (DB restart, network drop). Without
    // a listener, that unhandled event would crash the process — log and let the
    // pool replace the client.
    this.app.on('error', (err) => this.logger.error(`app pool error: ${err.message}`, err.stack));
    this.worker.on('error', (err) =>
      this.logger.error(`worker pool error: ${err.message}`, err.stack),
    );
  }

  async onModuleInit(): Promise<void> {
    // Fail fast if either pool can't reach Postgres (don't claim both are
    // ready when only one was verified).
    await Promise.all([this.app.query('SELECT 1'), this.worker.query('SELECT 1')]);

    // D1 boot guard (SECURITY_GATE.md §4) — refuse to boot on a mis-wired
    // DATABASE_URL_*. Runs on every boot (independent of TLS): a role that is
    // superuser or wrongly (non-)BYPASSRLS is a silent privilege escalation the
    // request path would run under, so we assert it here rather than assume it.
    await this.assertPoolRoles();

    if (!this.tlsEnforced) {
      this.logger.log('Postgres pools ready (app + worker roles, no TLS — local/dev)');
      return;
    }
    // TLS is enforced at connect by rejectUnauthorized (a wrong CA/hostname already
    // threw above). Confirm the server also reports SSL on each pool so a silent
    // misconfig surfaces at boot. Through a transaction pooler, pg_stat_ssl can
    // reflect the pooler→db leg, so a false report is a WARNING, not a boot failure —
    // the client→endpoint leg is already verified by the handshake.
    for (const [name, pool] of [
      ['app', this.app],
      ['worker', this.worker],
    ] as const) {
      const { rows } = await pool.query<{ ssl: boolean }>(
        'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      if (!rows[0]?.ssl) {
        this.logger.warn(
          `${name} pool: server reports no SSL on this backend (pooler leg?); ` +
            'client→endpoint TLS is still verified by rejectUnauthorized.',
        );
      }
    }
    this.logger.log('Postgres pools ready (app + worker roles, TLS verify-full)');
  }

  /**
   * D1 boot guard — assert each pool connects as the role build-v3 intends, so a
   * mis-wired `DATABASE_URL_*` aborts boot instead of silently over-privileging
   * the request path:
   *   - app pool    → NOT superuser, NOT BYPASSRLS, member of `api` (RLS confines it).
   *   - worker pool → BYPASSRLS, NOT superuser, member of `worker` (the one machinery pool).
   * `pg_has_role(current_user, <group>, 'USAGE')` on a role that doesn't exist
   * throws — a DB without the `api`/`worker` roles is not build-v3 and must not boot.
   */
  private async assertPoolRoles(): Promise<void> {
    const read = async (
      pool: Pool,
      group: 'api' | 'worker',
    ): Promise<PoolRoleAttributes | undefined> => {
      const { rows } = await pool.query<PoolRoleAttributes>(
        `SELECT current_user::text AS role,
                rolsuper           AS superuser,
                rolbypassrls       AS bypassrls,
                pg_has_role(current_user, $1, 'USAGE') AS "inheritsGroup"
         FROM pg_roles WHERE rolname = current_user`,
        [group],
      );
      return rows[0];
    };
    const [appAttrs, workerAttrs] = await Promise.all([
      read(this.app, 'api'),
      read(this.worker, 'worker'),
    ]);
    const problems = [
      poolRoleProblem('app', 'api', false, appAttrs),
      poolRoleProblem('worker', 'worker', true, workerAttrs),
    ].filter((p): p is string => p !== null);
    if (problems.length > 0) {
      throw new Error(`D1 boot guard — refusing to boot. ${problems.join(' | ')}`);
    }
    this.logger.log('D1 role guard OK (app = RLS-confined api, worker = BYPASSRLS worker)');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.app.end(), this.worker.end()]);
  }

  /** Service/background query on the BYPASSRLS worker pool. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    return this.worker.query<T>(text, params);
  }

  /**
   * Run `work` in a transaction on the umi_app pool, with RLS context taken
   * from the current request (AsyncLocalStorage). `set_config(..., true)` is
   * transaction-scoped, mirroring `SET LOCAL` but parameterized.
   */
  async withTenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const ctx = getRequestContext();
    if (!ctx?.tenantId) {
      throw new Error('withTenant() requires a request tenant context (set by AuthGuard).');
    }
    return this.runWithTenant(ctx.tenantId, ctx.userId, work);
  }

  /** Explicit-tenant variant (for jobs/tests that aren't on the request path). */
  async runWithTenant<T>(
    tenantId: string,
    userId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.app.connect();
    try {
      await client.query('BEGIN');
      // RLS tenant scope. We set BOTH GUC names through the build-v3 transition
      // (expand-contract): `app.tenant_id` is read by the CURRENT prod schema
      // (core.rls_tenant_check), `app.current_business` by build-v3's RLS policies.
      // Setting both keeps the request path correct against either schema; drop
      // app.tenant_id after the build-v3 cutover. Both are transaction-scoped
      // (set_config(..., true) == SET LOCAL), so nothing leaks across pooled reuse.
      await client.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.current_business', $1, true)",
        [tenantId],
      );
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId ?? '']);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      // Guard ROLLBACK: on a broken connection it can throw and mask the real
      // error. Always rethrow the original.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error(
          'ROLLBACK failed',
          rollbackErr instanceof Error ? rollbackErr.stack : String(rollbackErr),
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transaction on the BYPASSRLS worker pool — for service/public operations
   * that have no authenticated member user and so can't satisfy the RLS
   * `can_access_tenant` check (customer self-service: registration, gift
   * redemption). Isolation is enforced by the explicit `business_id = $1`
   * predicate in every query, not by RLS. Never sets app.tenant_id/user_id.
   */
  async workerTx<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.worker.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        this.logger.error(
          'ROLLBACK failed',
          rollbackErr instanceof Error ? rollbackErr.stack : String(rollbackErr),
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async healthCheck(): Promise<boolean> {
    const res = await this.worker.query<{ ok: number }>('SELECT 1 AS ok');
    return res.rows[0]?.ok === 1;
  }
}
