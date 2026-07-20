import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { AppConfig } from '../config/config.schema';
import { getRequestContext } from './request-context';

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
    this.app.on('error', (err) =>
      this.logger.error(`app pool error: ${err.message}`, err.stack),
    );
    this.worker.on('error', (err) =>
      this.logger.error(`worker pool error: ${err.message}`, err.stack),
    );
  }

  async onModuleInit(): Promise<void> {
    // Fail fast if either pool can't reach Postgres (don't claim both are
    // ready when only one was verified).
    await Promise.all([
      this.app.query('SELECT 1'),
      this.worker.query('SELECT 1'),
    ]);

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

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.app.end(), this.worker.end()]);
  }

  /** Service/background query on the BYPASSRLS worker pool. */
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    return this.worker.query<T>(text, params as unknown[]);
  }

  /**
   * Run `work` in a transaction on the umi_app pool, with RLS context taken
   * from the current request (AsyncLocalStorage). `set_config(..., true)` is
   * transaction-scoped, mirroring `SET LOCAL` but parameterized.
   */
  async withTenant<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const ctx = getRequestContext();
    if (!ctx?.tenantId) {
      throw new Error(
        'withTenant() requires a request tenant context (set by AuthGuard).',
      );
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
      await client.query('SELECT set_config($1, $2, true)', [
        'app.user_id',
        userId ?? '',
      ]);
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
