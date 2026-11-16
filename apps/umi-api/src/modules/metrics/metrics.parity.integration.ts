import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { MetricsId, MetricsQueryInput } from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { seedSalesAnalysis } from '../../../test/integration/sales-analysis-fixture';
import {
  loadLegacyCase,
  type LegacySalesSummary,
} from '../../../test/integration/legacy-sales-oracle';
import { MetricsRepository } from './metrics.repository';

/**
 * Parity between the new catalogue and the frozen legacy sales summary.
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
  legacy: LegacySalesSummary;
  legacyAliases: Record<string, string>;
}

async function readBoth(
  metrics: MetricsRepository,
  userId: string,
  merchantId: string,
  locationId: string | null,
  asOf: string,
  caseId: string,
  query: MetricsQueryInput = { metrics: MIGRATED, dimensions: [], range: 'last_7_days' },
): Promise<ParityResult> {
  const [fresh, frozen] = await Promise.all([
    metrics.read(userId, merchantId, locationId, query, asOf),
    Promise.resolve(loadLegacyCase(caseId)),
  ]);
  return { fresh, legacy: frozen.response, legacyAliases: frozen.productAliases };
}

function legacyUnitsPerTicket(itemsSold: number, orders: number): number | null {
  if (orders === 0) return null;
  return Math.floor((itemsSold * 20000 + orders) / (2 * orders)) / 10000;
}

function fixtureAliases(ids: { bread: string; coffee: string; foreignProduct: string }) {
  return {
    [ids.bread]: 'bread',
    [ids.coffee]: 'coffee',
    [ids.foreignProduct]: 'foreign',
  };
}

function expectTotalsParity({ fresh, legacy }: ParityResult) {
  const values = fresh.totals?.values;
  const totals = legacy.totals;
  expect(values?.net_sales).toBe(totals.netSalesMinorUnits);
  expect(values?.orders).toBe(totals.orders);
  expect(values?.average_ticket).toBe(totals.averageTicketMinorUnits);
  expect(values?.items_sold).toBe(totals.itemsSold);
  expect(values?.units_per_ticket).toBe(legacyUnitsPerTicket(totals.itemsSold, totals.orders));
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

function expectMixParity(
  { fresh, legacy, legacyAliases }: ParityResult,
  freshAliases: Record<string, string> = {},
) {
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
  const key = (row: { productId: string | null }, aliases: Record<string, string>) => {
    const id = text(row.productId);
    return id ? (aliases[id] ?? id) : '';
  };
  const mapFresh = (item: {
    productId: string | null;
    productName: string;
    category: string | null;
    units: number;
    merchandiseMinorUnits: number;
  }) => ({
    productId: key(item, freshAliases),
    productName: item.productName,
    category: item.category,
    units: item.units,
    netMinorUnits: item.merchandiseMinorUnits,
  });
  const mapLegacy = (item: {
    productId: string | null;
    productName: string;
    category: string | null;
    units: number;
    netMinorUnits: number;
  }) => ({
    productId: key(item, legacyAliases),
    productName: item.productName,
    category: item.category,
    units: item.units,
    netMinorUnits: item.netMinorUnits,
  });
  expect(
    [...products.items]
      .map(mapFresh)
      .sort((left, right) => left.productId.localeCompare(right.productId)),
  ).toEqual(
    [...legacy.productMix]
      .map(mapLegacy)
      .sort((left, right) => left.productId.localeCompare(right.productId)),
  );
}

describe('parity with the frozen legacy summary on the golden fixture', () => {
  let pg: PgService;
  let metrics: MetricsRepository;
  let ids: Awaited<ReturnType<typeof seedSalesAnalysis>>;
  let user: AuthUser;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Both database URLs are required');
    pg = new PgService(configFrom(process.env));
    await pg.onModuleInit();
    ids = await seedSalesAnalysis(pg.worker);
    metrics = new MetricsRepository(pg);
    user = { id: ids.user, email: null, sessionId: ids.session, deviceId: null };
  });

  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('agrees on all fourteen migrated values for all locations', async () => {
    const result = await readBoth(
      metrics,
      user.id,
      ids.merchant,
      null,
      '2026-11-04',
      'fixture-a-all',
    );
    expectTotalsParity(result);
    expectMixParity(result, fixtureAliases(ids));
  });

  it('agrees on all fourteen migrated values for one location', async () => {
    const result = await readBoth(
      metrics,
      user.id,
      ids.merchant,
      ids.location,
      '2026-11-04',
      'fixture-a-centro',
    );
    expectTotalsParity(result);
    expectMixParity(result, fixtureAliases(ids));
  });

  it('agrees on the day series as rows', async () => {
    const { fresh, legacy: old } = await readBoth(
      metrics,
      user.id,
      ids.merchant,
      null,
      '2026-11-04',
      'fixture-a-day-series',
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

  it('compares a non-empty payment mix as a multiset', async () => {
    const result = await readBoth(
      metrics,
      user.id,
      ids.merchant,
      ids.location,
      '2026-11-04',
      'fixture-a-payment',
    );
    const payment = result.fresh.totals?.values.payment_mix as {
      items: { method: string; amountMinorUnits: number }[];
    };
    expect(payment.items).toHaveLength(2);
    expect(result.legacy.paymentMix).toHaveLength(2);
    expect(payment.items.map(paymentKey).sort()).toEqual(
      result.legacy.paymentMix.map(paymentKey).sort(),
    );
    expect(new Set(payment.items.map(paymentKey))).toEqual(new Set(['cash:19500', 'wallet:5000']));
  });
});

describe('parity with the frozen legacy summary on the I1 METRIC fixture', () => {
  let pg: PgService | null = null;
  let metrics: MetricsRepository | null = null;
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
    const result = await readBoth(
      metrics!,
      metricUser,
      merchant,
      null,
      '2026-11-04',
      'fixture-b-i1',
    );
    expectTotalsParity(result);
    expectMixParity(result);
    expect(result.legacy.totals.netSalesMinorUnits).toBe(49500);
  });
});
