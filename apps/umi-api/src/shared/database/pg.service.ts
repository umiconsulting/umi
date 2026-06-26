import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  readonly app: Pool;
  readonly worker: Pool;

  constructor(config: ConfigService<AppConfig, true>) {
    this.app = new Pool({
      connectionString: config.get('DATABASE_URL_APP', { infer: true }),
    });
    this.worker = new Pool({
      connectionString: config.get('DATABASE_URL_WORKER', { infer: true }),
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
    this.logger.log('Postgres pools ready (umi_app, umi_worker)');
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
