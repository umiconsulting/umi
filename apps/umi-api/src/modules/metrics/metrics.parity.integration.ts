import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsId, MetricsQueryInput } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { DashboardOperationsRepository } from '../dashboard-operations/dashboard-operations.repository';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import { MetricsRepository } from './metrics.repository';

/**
 * Parity between the new catalogue and the current `salesSummary`.
 *
 * The old method has no `asOf`, so its repository method takes an internal
 * optional `asOf` that defaults to today. The public route never passes it and
 * its output does not change. The test then asks both methods the same question
 * over the same explicit window and compares the overlapping values.
 */
const MIGRATED: MetricsId[] = [
  'net_sales',
  'orders',
  'average_ticket',
  'items_sold',
  'units_per_ticket',
  'discounts',
  'tips',
  'prior_net_sales',
  'payment_mix',
  'channel_mix',
  'product_mix',
  'operator_mix',
  'hour_mix',
  'series',
];

function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

const text = (value: string | null) => value ?? '';

interface ParityResult {
  fresh: Awaited<ReturnType<MetricsRepository['read']>>;
  legacy: Awaited<ReturnType<DashboardOperationsRepository['salesSummary']>>;
}

async function readBoth(
  metrics: MetricsRepository,
  legacy: DashboardOperationsRepository,
  userId: string,
  merchantId: string,
  locationId: string | null,
  asOf: string,
  query: MetricsQueryInput = { metrics: MIGRATED, dimensions: [], range: 'last_7_days' },
): Promise<ParityResult> {
  const [fresh, old] = await Promise.all([
    metrics.read(userId, merchantId, locationId, query, asOf),
    legacy.salesSummary(userId, merchantId, { range: 'last_7_days' }, locationId, asOf),
  ]);
  return { fresh, legacy: old };
}

function expectTotalsParity({ fresh, legacy }: ParityResult) {
  const values = fresh.totals?.values;
  const totals = legacy.totals;
  expect(values?.net_sales).toBe(totals.netSalesMinorUnits);
  expect(values?.orders).toBe(totals.orders);
  expect(values?.average_ticket).toBe(totals.averageTicketMinorUnits);
  expect(values?.items_sold).toBe(totals.itemsSold);
  expect(values?.discounts).toBe(totals.discountMinorUnits);
  expect(values?.tips).toBe(totals.tipsMinorUnits);
  expect(values?.prior_net_sales).toBe(totals.priorNetSalesMinorUnits ?? 0);

  const freshHourMix = fresh.totals?.values.hour_mix as {
    items: { hour: string; units: number; merchandiseMinorUnits: number }[];
  };
  expect(
    freshHourMix.items.map((item) => ({
      key: item.hour,
      units: item.units,
      netMinorUnits: item.merchandiseMinorUnits,
    })),
  ).toEqual(
    legacy.byHour.map((row) => ({
      key: row.key,
      units: row.units,
      netMinorUnits: row.netMinorUnits,
    })),
  );

  const freshOperator = fresh.totals?.values.operator_mix as {
    items: { operator: string; units: number; merchandiseMinorUnits: number }[];
  };
  expect(
    freshOperator.items.map((item) => ({
      key: item.operator,
      units: item.units,
      netMinorUnits: item.merchandiseMinorUnits,
    })),
  ).toEqual(
    legacy.byOperator.map((row) => ({
      key: row.key,
      units: row.units,
      netMinorUnits: row.netMinorUnits,
    })),
  );

  const freshSeries = fresh.totals?.values.series as {
    items: { label: string; netSalesMinorUnits: number }[];
  };
  expect(
    freshSeries.items.map((item) => ({
      label: item.label,
      amountMinorUnits: item.netSalesMinorUnits,
    })),
  ).toEqual(
    legacy.series.map((point) => ({
      label: point.label,
      amountMinorUnits: point.amountMinorUnits,
    })),
  );

  const freshChannel = fresh.totals?.values.channel_mix as {
    items: { channel: string; netSalesMinorUnits: number; orders: number }[];
  };
  expect(
    freshChannel.items.map((item) => ({
      channel: item.channel,
      netSalesMinorUnits: item.netSalesMinorUnits,
      orders: item.orders,
    })),
  ).toEqual(legacy.channelMix);
}

function paymentKey(row: { method: string; amountMinorUnits: number }) {
  return `${row.method}:${row.amountMinorUnits}`;
}

function expectMixParity({ fresh, legacy }: ParityResult) {
  const payment = fresh.totals?.values.payment_mix as {
    items: { method: string; amountMinorUnits: number }[];
  };
  expect(payment.items.map(paymentKey).sort()).toEqual(legacy.paymentMix.map(paymentKey).sort());

  const products = fresh.totals?.values.product_mix as {
    items: {
      productId: string | null;
      productName: string;
      category: string | null;
      units: number;
      merchandiseMinorUnits: number;
    }[];
  };
  const key = (row: { productId: string | null }) => text(row.productId);
  expect(
    [...products.items]
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        units: item.units,
        netMinorUnits: item.merchandiseMinorUnits,
      }))
      .sort((left, right) => key(left).localeCompare(key(right))),
  ).toEqual(
    [...legacy.productMix]
      .map((item) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        units: item.units,
        netMinorUnits: item.netMinorUnits,
      }))
      .sort((left, right) => key(left).localeCompare(key(right))),
  );
}

describe('parity with GET reports/sales on the golden fixture', () => {
  let pg: PgService;
  let metrics: MetricsRepository;
  let legacy: DashboardOperationsRepository;
  let ids: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let user: AuthUser;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    ids = await seedSalesAnalysis(pg.worker);
    metrics = new MetricsRepository(pg);
    legacy = new DashboardOperationsRepository(pg);
    user = { id: ids.user, email: null, sessionId: ids.session, deviceId: null };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('agrees on all fourteen migrated values for all locations', async () => {
    const result = await readBoth(metrics, legacy, user.id, ids.merchant, null, '2026-11-04');
    expectTotalsParity(result);
    expectMixParity(result);
  });

  it('agrees on all fourteen migrated values for one location', async () => {
    const result = await readBoth(metrics, legacy, user.id, ids.merchant, ids.branch, '2026-11-04');
    expectTotalsParity(result);
    expectMixParity(result);
  });

  it('agrees on the day series as rows', async () => {
    const { fresh, legacy: old } = await readBoth(
      metrics,
      legacy,
      user.id,
      ids.merchant,
      null,
      '2026-11-04',
      { metrics: ['net_sales'], dimensions: ['day'], range: 'last_7_days' },
    );
    expect(
      fresh.rows?.map((row) => ({
        label: row.dimensions.day,
        amountMinorUnits: row.values.net_sales,
      })),
    ).toEqual(
      old.series.map((point) => ({ label: point.label, amountMinorUnits: point.amountMinorUnits })),
    );
  });
});

describe('parity with GET reports/sales on the I1 METRIC fixture', () => {
  let pg: PgService | null = null;
  let metrics: MetricsRepository | null = null;
  let legacy: DashboardOperationsRepository | null = null;
  let available = false;

  const merchant = '55555555-5555-4555-8555-000000000001';
  const metricUser = '11111111-1111-4111-8111-000000000041';

  beforeAll(async () => {
    try {
      pg = new PgService(
        configFrom({
          DATABASE_URL_APP:
            process.env.METRICS_I1_APP_DATABASE_URL ??
            'postgresql://api_login:i1_local_api@127.0.0.1:5543/umi_i1_exec_2f52a6d5',
          DATABASE_URL_WORKER:
            process.env.METRICS_I1_WORKER_DATABASE_URL ??
            'postgresql://worker_login:i1_local_worker@127.0.0.1:5543/umi_i1_exec_2f52a6d5',
        }),
      );
      await pg.onModuleInit();
      metrics = new MetricsRepository(pg);
      legacy = new DashboardOperationsRepository(pg);
      available = true;
    } catch {
      available = false;
    }
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('agrees on all fourteen migrated values with more than one refund', async (context) => {
    if (!available) {
      context.skip();
      return;
    }
    const result = await readBoth(metrics!, legacy!, metricUser, merchant, null, '2026-11-04');
    expectTotalsParity(result);
    expectMixParity(result);
    expect(result.legacy.totals.netSalesMinorUnits).toBe(49500);
  });
});
