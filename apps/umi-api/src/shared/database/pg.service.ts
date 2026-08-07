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
 * Two pools, one per Postgres role (§11.2):
 *   - `app`    → umi_app    (RLS-enforced; web request path)
 *   - `worker` → umi_worker (BYPASSRLS; background + queue/observability/grow)
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
    // D4 (SECURITY_GATE.md §4) — verify-full TLS to Postgres when a CA is
    // provisioned; plaintext otherwise, which is what local dev against
    // localhost wants. `rejectUnauthorized: true` is the whole point: TLS alone
    // only stops passive reading, and an unverified certificate still lets an
    // interceptor terminate the connection and read everything in clear. It is
    // what makes a wrong CA or a wrong hostname FAIL AT CONNECT rather than
    // succeed quietly.
    //
    // Accepts a path or an inline PEM, so the value can come from a mounted file
    // (how the VPS does it) or straight from the environment.
    //
    // The pools carry the café's whole request path across the public internet:
    // customer phone numbers, orders, loyalty balances, session tokens.
    const caValue = config.get('PGSSLROOTCERT', { infer: true });
    const ssl = caValue
      ? {
          ca: caValue.includes('BEGIN CERTIFICATE')
            ? caValue
            : readFileSync(caValue),
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
      this.logger.log(
        'Postgres pools ready (umi_app, umi_worker — no TLS, local/dev)',
      );
      return;
    }
    // TLS is already enforced at connect: a wrong CA or hostname threw above and
    // the process never got here. This only confirms the SERVER also reports SSL,
    // so a silent misconfiguration surfaces at boot rather than in an audit.
    //
    // A false report is a WARNING, not a boot failure. Production reaches
    // Postgres through Supavisor (transaction pooling), and `pg_stat_ssl`
    // describes the POOLER-to-database leg, not ours. The leg this service is
    // responsible for — VPS to endpoint, the one crossing the public internet —
    // is already proven by the handshake.
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
    this.logger.log(
      'Postgres pools ready (umi_app, umi_worker — TLS verify-full)',
    );
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
      await client.query('SELECT set_config($1, $2, true)', [
        'app.tenant_id',
        tenantId,
      ]);
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
   * redemption). Isolation is enforced by the explicit `tenant_id = $1`
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
