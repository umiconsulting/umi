import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsQueryInput } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import { MetricsRepository } from './metrics.repository';
import { MetricsService } from './metrics.service';

/**
 * Two fixtures live on the local cluster:
 *
 *   A. The golden fixture this suite seeds. It is the `sales-analysis-fixture.ts`
 *      set: 3 sales, 4 lines, one 9,000 partial refund.
 *   B. The I1 METRIC fixture in `umi_i1_exec_2f52a6d5`: 4 sales, 7 lines, two
 *      refunds whose exception dates are 2026-11-03 and 2026-11-06. The sale dates
 *      are 2026-11-02 and 2026-11-04; the refund must follow the sale date.
 */

function configFrom(env: Record<string, string | undefined>) {
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

const query = (overrides: Partial<MetricsQueryInput> = {}): MetricsQueryInput => ({
  metrics: ['net_sales', 'orders'],
  dimensions: [],
  range: 'last_7_days',
  ...overrides,
});

const allFifteen: MetricsQueryInput = {
  metrics: [
    'net_sales',
    'orders',
    'average_ticket',
    'items_sold',
    'units_per_ticket',
    'discounts',
    'tips',
    'prior_net_sales',
    'refunds',
    'payment_mix',
    'channel_mix',
    'product_mix',
    'operator_mix',
    'hour_mix',
    'series',
  ],
  dimensions: [],
  range: 'last_7_days',
};

describe('semantic analytics against PostgreSQL with RLS', () => {
  let pg: PgService;
  let repository: MetricsRepository;
  let service: MetricsService;
  let ids: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let second: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let user: AuthUser;
  let access: MerchantAccess;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    ids = await seedSalesAnalysis(pg.worker);
    second = await seedSalesAnalysis(pg.worker);
    repository = new MetricsRepository(pg);
    service = new MetricsService(repository);
    user = { id: ids.user, email: null, sessionId: ids.session, deviceId: null };
    access = {
      merchantId: ids.merchant,
      locationId: null,
      name: 'Test',
      handle: null,
      timezone: 'America/Mazatlan',
      membershipId: ids.staff,
      role: 'owner',
      roles: ['owner'],
      permissions: ['sale.lifecycle'],
    };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('pins all fifteen metrics against the golden fixture', async () => {
    const result = await repository.read(
      user.id,
      access.merchantId,
      null,
      allFifteen,
      '2026-11-04',
    );
    expect(result.period).toEqual({
      range: 'last_7_days',
      start: '2026-10-29',
      end: '2026-11-04',
      bucket: 'day',
      comparison: { start: '2026-10-22', end: '2026-10-28' },
    });
    expect(result.coverage).toEqual({
      sources: [
        'pos_committed_sale',
        'receipt_snapshot',
        'pos_cart_line',
        'pos_sale_exception',
        'pos_tender_fact',
        'customer_value_tender_allocation',
        'product',
        'product_category',
        'cash_shift',
        'staff',
      ],
      committedOnly: true,
      refundsIncluded: true,
    });
    expect(result.truncated).toBe(false);

    const values = result.totals?.values;
    expect(values).toMatchObject({
      net_sales: 37500,
      orders: 3,
      average_ticket: 12500,
      items_sold: 4,
      units_per_ticket: 1.3333,
      discounts: 4000,
      tips: 1500,
      prior_net_sales: 0,
      refunds: 9000,
    });

    const productItems = (
      values?.product_mix as {
        items: { productId: string; units: number; merchandiseMinorUnits: number }[];
      }
    ).items;
    expect(
      productItems
        .map((item) => ({
          id: item.productId,
          units: item.units,
          merch: item.merchandiseMinorUnits,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [
        { id: ids.bread, units: 2, merch: 20000 },
        { id: ids.coffee, units: 2, merch: 20000 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    expect(values?.channel_mix).toEqual({
      items: [{ channel: 'walk_in', netSalesMinorUnits: 37500, orders: 3 }],
      truncated: false,
      limit: 8,
      totalItems: 1,
      total: { netSalesMinorUnits: 37500, orders: 3 },
    });
    expect(values?.operator_mix).toEqual({
      items: [{ operator: '—', units: 4, merchandiseMinorUnits: 40000 }],
      truncated: false,
      limit: 100,
      totalItems: 1,
      total: { units: 4, merchandiseMinorUnits: 40000 },
    });
    expect(values?.hour_mix).toEqual({
      items: [
        { hour: '04', units: 1, merchandiseMinorUnits: 10000 },
        { hour: '10', units: 2, merchandiseMinorUnits: 20000 },
        { hour: '11', units: 1, merchandiseMinorUnits: 10000 },
      ],
      truncated: false,
      limit: 24,
      totalItems: 3,
      total: { units: 4, merchandiseMinorUnits: 40000 },
    });
    expect(values?.series).toEqual({
      items: [
        { label: '2026-11-02', netSalesMinorUnits: 28500 },
        { label: '2026-11-04', netSalesMinorUnits: 9000 },
      ],
      truncated: false,
      limit: 31,
      totalItems: 2,
      total: { netSalesMinorUnits: 37500 },
    });
    expect(values?.payment_mix).toEqual({
      items: [],
      truncated: false,
      limit: 8,
      totalItems: 0,
      total: { amountMinorUnits: 0 },
    });
  });

  it('returns rows by day and merges the line and refund families', async () => {
    const result = await repository.read(
      user.id,
      access.merchantId,
      null,
      query({ metrics: ['net_sales', 'orders', 'items_sold', 'refunds'], dimensions: ['day'] }),
      '2026-11-04',
    );
    expect(result.rows).toEqual([
      {
        dimensions: { day: '2026-11-02' },
        values: { net_sales: 28500, orders: 2, items_sold: 3, refunds: 9000 },
      },
      {
        dimensions: { day: '2026-11-04' },
        values: { net_sales: 9000, orders: 1, items_sold: 1, refunds: 0 },
      },
    ]);
    expect(result.rowsTotal).toBeUndefined();
  });

  it('returns rows by product id for items sold', async () => {
    const result = await repository.read(
      user.id,
      access.merchantId,
      null,
      query({ metrics: ['items_sold'], dimensions: ['product'] }),
      '2026-11-04',
    );
    expect(
      result.rows
        ?.map((row) => ({ id: row.dimensions.product, units: row.values.items_sold }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [
        { id: ids.bread, units: 2 },
        { id: ids.coffee, units: 2 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it('returns rows by hour from committed_at, not from the business date', async () => {
    const result = await repository.read(
      user.id,
      access.merchantId,
      null,
      query({ metrics: ['net_sales', 'orders'], dimensions: ['hour'] }),
      '2026-11-04',
    );
    expect(result.rows).toEqual([
      { dimensions: { hour: '04' }, values: { net_sales: 9000, orders: 1 } },
      { dimensions: { hour: '10' }, values: { net_sales: 19500, orders: 1 } },
      { dimensions: { hour: '11' }, values: { net_sales: 9000, orders: 1 } },
    ]);
  });

  it('cuts rows at the limit and reports the count before the cut', async () => {
    const result = await repository.read(
      user.id,
      access.merchantId,
      null,
      query({ metrics: ['net_sales'], dimensions: ['day'], limit: 1 }),
      '2026-11-04',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rowsTotal).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('refuses a caller without sale.lifecycle', async () => {
    let response: unknown = null;
    try {
      await service.query(user, { ...access, permissions: [] }, query());
    } catch (error) {
      response = (error as { getResponse?: () => unknown }).getResponse?.();
    }
    expect(response).toEqual({ code: 'PERMISSION_DENIED' });
  });

  it('refuses a location outside the caller scope before reading', async () => {
    let response: unknown = null;
    try {
      await service.query(
        user,
        { ...access, locationId: ids.location },
        query({ locationId: ids.branch }),
      );
    } catch (error) {
      response = (error as { getResponse?: () => unknown }).getResponse?.();
    }
    expect(response).toEqual({ code: 'LOCATION_SCOPE_VIOLATION' });
  });

  it('keeps the merchant behind the RLS scope, not the request body', async () => {
    // A second complete fixture exists now. A merchant-scoped read must return
    // only its own three sales, not six.
    const first = await repository.read(user.id, ids.merchant, null, query(), '2026-11-04');
    const other = await repository.read(second.user, second.merchant, null, query(), '2026-11-04');
    expect(first.totals?.values).toEqual({ net_sales: 37500, orders: 3 });
    expect(other.totals?.values).toEqual({ net_sales: 37500, orders: 3 });
  });

  it('filters by location without changing the merchant total', async () => {
    const branch = await repository.read(
      user.id,
      access.merchantId,
      ids.branch,
      query(),
      '2026-11-04',
    );
    expect(branch.totals?.values).toEqual({ net_sales: 9000, orders: 1 });
    expect(branch.scope.locationId).toBe(ids.branch);
  });
});

describe('I1 METRIC fixture cross-check', () => {
  let pg: PgService | null = null;
  let repository: MetricsRepository | null = null;
  let available = false;

  const merchant = '55555555-5555-4555-8555-000000000001';
  const metricUser = '11111111-1111-4111-8111-000000000041';
  const appUrl =
    process.env.METRICS_I1_APP_DATABASE_URL ??
    'postgresql://api_login:i1_local_api@127.0.0.1:5543/umi_i1_exec_2f52a6d5';
  const workerUrl =
    process.env.METRICS_I1_WORKER_DATABASE_URL ??
    'postgresql://worker_login:i1_local_worker@127.0.0.1:5543/umi_i1_exec_2f52a6d5';

  beforeAll(async () => {
    try {
      pg = new PgService(configFrom({ DATABASE_URL_APP: appUrl, DATABASE_URL_WORKER: workerUrl }));
      await pg.onModuleInit();
      repository = new MetricsRepository(pg);
      available = true;
    } catch {
      available = false;
    }
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('pins the second golden fixture, including sale-date refunds', async (context) => {
    if (!available) {
      context.skip();
      return;
    }
    const result = await repository!.read(metricUser, merchant, null, allFifteen, '2026-11-04');
    const values = result.totals?.values;
    expect(values).toMatchObject({
      net_sales: 49500,
      orders: 4,
      average_ticket: 12375,
      items_sold: 7,
      units_per_ticket: 1.75,
      discounts: 3000,
      tips: 2500,
      prior_net_sales: 0,
      // 17,000 on the 2026-11-02 sale plus 7,000 on the 2026-11-04 sale. The
      // exception dates are 2026-11-03 and 2026-11-06. Using the exception date
      // would report 17,000 or 0.
      refunds: 24000,
    });
    expect(values?.channel_mix).toEqual({
      items: [{ channel: 'walk_in', netSalesMinorUnits: 49500, orders: 4 }],
      truncated: false,
      limit: 8,
      totalItems: 1,
      total: { netSalesMinorUnits: 49500, orders: 4 },
    });
    expect(values?.operator_mix).toEqual({
      items: [{ operator: '—', units: 7, merchandiseMinorUnits: 50000 }],
      truncated: false,
      limit: 100,
      totalItems: 1,
      total: { units: 7, merchandiseMinorUnits: 50000 },
    });
    expect(values?.hour_mix).toEqual({
      items: [
        { hour: '02', units: 1, merchandiseMinorUnits: 8000 },
        { hour: '09', units: 2, merchandiseMinorUnits: 16000 },
        { hour: '11', units: 3, merchandiseMinorUnits: 18000 },
        { hour: '12', units: 1, merchandiseMinorUnits: 8000 },
      ],
      truncated: false,
      limit: 24,
      totalItems: 4,
      total: { units: 7, merchandiseMinorUnits: 50000 },
    });
    expect(values?.series).toEqual({
      items: [
        { label: '2026-11-02', netSalesMinorUnits: 27000 },
        { label: '2026-11-04', netSalesMinorUnits: 22500 },
      ],
      truncated: false,
      limit: 31,
      totalItems: 2,
      total: { netSalesMinorUnits: 49500 },
    });
    const products = (
      values?.product_mix as {
        items: { productName: string; units: number; merchandiseMinorUnits: number }[];
      }
    ).items;
    expect(
      products
        .map((item) => ({
          name: item.productName,
          units: item.units,
          merch: item.merchandiseMinorUnits,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { name: 'Café americano', units: 5, merch: 40000 },
      { name: 'Concha', units: 2, merch: 10000 },
    ]);
    expect(values?.payment_mix).toEqual({
      items: [],
      truncated: false,
      limit: 8,
      totalItems: 0,
      total: { amountMinorUnits: 0 },
    });
  });
});
