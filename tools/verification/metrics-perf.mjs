// Gate 1 performance check for the semantic analytics route.
//
// It measures the compiled repository against the local 19k fixture. The script
// reads only. It never writes to the fixture database.
//
//   node tools/verification/metrics-perf.mjs
//
// The database and the credentials come from the I1 environment. The script
// prints every value it used and the number of SQL statements it ran.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const merchantId = '44444444-4444-4444-8444-000000000001';
const locationId = '44444444-4444-4444-8444-000000000011';
const userId = '11111111-1111-4111-8111-000000000048';
const database = process.env.I1_DATABASE ?? 'umi_i1_exec_2f52a6d5';
const port = process.env.I1_PGPORT ?? '5543';
const asOf = process.env.I1_AS_OF ?? '2026-11-08';

process.env.DATABASE_URL_APP =
  process.env.DATABASE_URL_APP ??
  `postgresql://api_login:i1_local_api@127.0.0.1:${port}/${database}`;
process.env.DATABASE_URL_WORKER =
  process.env.DATABASE_URL_WORKER ??
  `postgresql://worker_login:i1_local_worker@127.0.0.1:${port}/${database}`;

const { PgService } = require(resolve('apps/umi-api/dist/shared/database/pg.service.js'));
const { MetricsRepository } = require(
  resolve('apps/umi-api/dist/modules/metrics/metrics.repository.js'),
);
const { DashboardOperationsRepository } = require(
  resolve('apps/umi-api/dist/modules/dashboard-operations/dashboard-operations.repository.js'),
);

const config = { get: (key) => process.env[key] };
const pg = new PgService(config);

const allMetrics = {
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
  range: 'last_30_days',
};

function percentile(sorted, value) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function main() {
  await pg.onModuleInit();
  const metrics = new MetricsRepository(pg);
  const dashboard = new DashboardOperationsRepository(pg);

  const binding = await pg.worker.query(
    `SELECT current_database() AS database,
            count(*)::int AS tickets,
            (SELECT count(*)::int FROM merchant.pos_cart_line cl
              JOIN merchant.pos_committed_sale s2 ON s2.cart_id=cl.cart_id
              WHERE s2.merchant_id=$1::uuid) AS lines,
            min(r.business_date)::text AS "minDate",
            max(r.business_date)::text AS "maxDate",
            count(*) FILTER (WHERE s.location_id=$2::uuid)::int AS "atLocation",
            count(*) FILTER (WHERE s.origin_channel IS NULL)::int AS "nullOriginChannels",
            count(*) FILTER (WHERE s.origin_channel = 'walk_in')::int AS "walkInChannels"
     FROM merchant.pos_committed_sale s
     JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
     WHERE s.merchant_id=$1::uuid`,
    [merchantId, locationId],
  );
  const bound = binding.rows[0];
  const expected = {
    tickets: 19_000,
    lines: 76_000,
    minDate: '2026-10-10',
    maxDate: '2026-11-08',
    atLocation: 19_000,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (bound[key] !== value)
      throw new Error(`Fixture binding failed: ${key}=${bound[key]}, expected ${value}`);
  }

  const today = await pg.worker.query(
    'SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM merchant.merchant WHERE id=$1::uuid',
    [merchantId],
  );
  const todayDate = today.rows[0].today;

  for (let index = 0; index < 5; index += 1) {
    await metrics.read(userId, merchantId, locationId, allMetrics, asOf);
  }

  const samples = [];
  let statementCount = 0;
  let lastResponse = null;
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    const result = await metrics.readWithStats(userId, merchantId, locationId, allMetrics, asOf);
    samples.push(performance.now() - started);
    statementCount = result.statementCount;
    lastResponse = result.response;
  }
  const sorted = [...samples].sort((left, right) => left - right);

  // The same window through the current method: its window starts at today, so
  // `asOf` must be today for the two windows to match.
  const oldStarted = performance.now();
  const legacy = await dashboard.salesSummary(
    userId,
    merchantId,
    { range: 'last_30_days' },
    locationId,
    todayDate,
  );
  const legacyMs = performance.now() - oldStarted;
  const freshStarted = performance.now();
  const freshSameWindow = await metrics.read(userId, merchantId, locationId, allMetrics, todayDate);
  const freshMs = performance.now() - freshStarted;

  const output = {
    capturedAt: new Date().toISOString(),
    environment: {
      database: bound.database,
      port,
      appRole: 'api_login',
      workerRole: 'worker_login',
      source: 'apps/umi-api/dist (nest build)',
    },
    fixture: {
      merchantId,
      locationId,
      tickets: bound.tickets,
      cartLines: bound.lines,
      businessDates: { start: bound.minDate, end: bound.maxDate },
      ticketsAtLocation: bound.atLocation,
      nullOriginChannels: bound.nullOriginChannels,
      walkInChannels: bound.walkInChannels,
      boundAsOf: asOf,
      range: allMetrics.range,
      metrics: allMetrics.metrics,
      dimensions: allMetrics.dimensions,
      window: lastResponse?.period ?? null,
    },
    method: {
      warmups: 5,
      measuredRuns: 20,
      sqlStatementsPerRequest: statementCount,
      timing: 'milliseconds, wall clock around one repository request',
    },
    latencyMs: {
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      max: round(sorted[sorted.length - 1]),
      min: round(sorted[0]),
      samples: samples.map(round),
    },
    totals: lastResponse?.totals?.values ?? null,
    comparisonWithSalesSummary: {
      asOf: todayDate,
      windowStart: freshSameWindow.period.start,
      windowEnd: freshSameWindow.period.end,
      legs: {
        metrics: {
          ms: round(freshMs),
          statements: statementCount,
          totals: {
            net_sales: freshSameWindow.totals?.values.net_sales ?? null,
            orders: freshSameWindow.totals?.values.orders ?? null,
            average_ticket: freshSameWindow.totals?.values.average_ticket ?? null,
            discounts: freshSameWindow.totals?.values.discounts ?? null,
            tips: freshSameWindow.totals?.values.tips ?? null,
            refunds: freshSameWindow.totals?.values.refunds ?? null,
          },
        },
        salesSummary: {
          ms: round(legacyMs),
          totals: legacy.totals,
          windowNote: 'salesSummary has no asOf; with this range its window ends today',
        },
      },
      equal: {
        net_sales: freshSameWindow.totals?.values.net_sales === legacy.totals.netSalesMinorUnits,
        orders: freshSameWindow.totals?.values.orders === legacy.totals.orders,
        average_ticket:
          freshSameWindow.totals?.values.average_ticket === legacy.totals.averageTicketMinorUnits,
        discounts: freshSameWindow.totals?.values.discounts === legacy.totals.discountMinorUnits,
        tips: freshSameWindow.totals?.values.tips === legacy.totals.tipsMinorUnits,
      },
    },
  };

  const text = `${JSON.stringify(output, null, 2)}\n`;
  process.stdout.write(text);
  writeFileSync('docs/verification/2026-11-16-semantic-api-gate1-perf.json', text);
  await pg.onModuleDestroy();
}

main().catch(async (error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  try {
    await pg.onModuleDestroy();
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
