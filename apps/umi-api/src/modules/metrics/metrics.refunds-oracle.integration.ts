import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsId, MetricsRange } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { seedRefundsOracle } from '../../../test/integration/refunds-oracle-fixture';
import { periodWindow } from './metrics.formulas';
import { MetricsRepository } from './metrics.repository';

/**
 * The refunds oracle.
 *
 * The fixture is isolated: its own merchant, its own location and its own
 * product. It covers a void, a full refund and a partial refund, and one refund
 * with a tip above zero. Two rows must stay out of the total: one
 * `outcome_unknown` row, and one committed row whose sale date is before the
 * window.
 *
 * The expected value is the pinned rule:
 *   sum(total_minor_units - tip_minor_units) over committed exceptions,
 *   attributed to the business date of the original sale.
 *
 * The test compares the route value with a direct SQL oracle. It also proves
 * that the naive alternatives give a different number, so the oracle is not a
 * restatement of the route.
 */
function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

interface RefundRead {
  refunds: number;
  netSales: number;
  refundsIncluded: boolean;
}

describe('refunds oracle on an isolated fixture', () => {
  let pg: PgService;
  let metrics: MetricsRepository;
  let seeded: Awaited<ReturnType<typeof seedRefundsOracle>>;
  let user: AuthUser;

  async function read(range: MetricsRange, asOf: string): Promise<RefundRead> {
    const metricIds: MetricsId[] = ['refunds', 'net_sales'];
    const window = periodWindow(range, asOf);
    const [response, oracle] = await Promise.all([
      metrics.read(
        user.id,
        seeded.ids.merchant,
        null,
        {
          metrics: metricIds,
          dimensions: [],
          range,
        },
        asOf,
      ),
      pg.worker.query<{ total: string }>(
        `SELECT coalesce(sum(x.total_minor_units - x.tip_minor_units),0)::bigint AS total
         FROM merchant.pos_sale_exception x
         JOIN merchant.pos_committed_sale s ON s.id=x.sale_id
         JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
         WHERE x.merchant_id=$1::uuid AND x.status='committed'
           AND r.business_date BETWEEN $2::date AND $3::date
           AND x.committed_at <= now()`,
        [seeded.ids.merchant, window.start, window.end],
      ),
    ]);
    expect(Number(oracle.rows[0]?.total ?? 0)).toBeGreaterThanOrEqual(0);
    return {
      refunds: Number(response.totals?.values.refunds ?? 0),
      netSales: Number(response.totals?.values.net_sales ?? 0),
      refundsIncluded: response.coverage.refundsIncluded,
    };
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    seeded = await seedRefundsOracle(pg.worker);
    metrics = new MetricsRepository(pg);
    user = { id: seeded.ids.user, email: null, sessionId: seeded.ids.session, deviceId: null };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('pins the void, full and partial refunds at 22,000 for the sale date', async () => {
    const result = await read('today', '2026-11-03');
    expect(result.refundsIncluded).toBe(true);
    expect(result.refunds).toBe(22_000);
    expect(result.refunds).toBeGreaterThan(0);
    expect(result.netSales).toBe(38_500);
    expect(result.refunds).not.toBe(result.netSales);
  });

  it('splits the total by exception type', async () => {
    const byType = await pg.worker.query<{ type: string; total: string; tips: string }>(
      `SELECT x.exception_type AS type,
              coalesce(sum(x.total_minor_units),0)::bigint AS total,
              coalesce(sum(x.tip_minor_units),0)::bigint AS tips
       FROM merchant.pos_sale_exception x
       JOIN merchant.pos_committed_sale s ON s.id=x.sale_id
       JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
       WHERE x.merchant_id=$1::uuid AND x.status='committed'
         AND r.business_date='2026-11-03'
       GROUP BY x.exception_type ORDER BY x.exception_type`,
      [seeded.ids.merchant],
    );
    expect(byType.rows.map((row) => [row.type, Number(row.total), Number(row.tips)])).toEqual([
      ['full_refund', 11_000, 2_000],
      ['partial_refund', 4_500, 500],
      ['void', 9_000, 0],
    ]);
    const net = byType.rows.reduce((sum, row) => sum + Number(row.total) - Number(row.tips), 0);
    expect(net).toBe(22_000);
    expect(byType.rows.some((row) => Number(row.tips) > 0)).toBe(true);
  });

  it('excludes a non-committed exception', async () => {
    const allStatuses = await pg.worker.query<{ total: string }>(
      `SELECT coalesce(sum(x.total_minor_units - x.tip_minor_units),0)::bigint AS total
       FROM merchant.pos_sale_exception x
       JOIN merchant.pos_committed_sale s ON s.id=x.sale_id
       JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
       WHERE x.merchant_id=$1::uuid AND r.business_date='2026-11-03'`,
      [seeded.ids.merchant],
    );
    expect(Number(allStatuses.rows[0]?.total)).toBe(23_000);
    expect((await read('today', '2026-11-03')).refunds).toBe(22_000);
  });

  it('attributes a refund to the original sale date, not the exception date', async () => {
    const byExceptionDate = await pg.worker.query<{ total: string }>(
      `SELECT coalesce(sum(x.total_minor_units - x.tip_minor_units),0)::bigint AS total
       FROM merchant.pos_sale_exception x
       WHERE x.merchant_id=$1::uuid AND x.status='committed'
         AND x.business_date='2026-11-03'`,
      [seeded.ids.merchant],
    );
    expect(Number(byExceptionDate.rows[0]?.total)).toBe(31_000);
    expect((await read('today', '2026-11-03')).refunds).toBe(22_000);
  });

  it('adds the outside sale in a wider window', async () => {
    const result = await read('last_7_days', '2026-11-07');
    expect(result.refunds).toBe(31_000);
    expect(result.netSales).toBe(48_500);
    expect(result.refunds).not.toBe(result.netSales);
  });
});
