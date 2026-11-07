const { performance } = require('node:perf_hooks');
const { writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { analyzePurchases } = require(
  process.env.UMI_ANALYSIS_MODULE ||
    resolve(__dirname, '../../apps/umi-api/dist/modules/dashboard-operations/sales-analysis.js'),
);
const query = {
  from: '2026-10-01',
  to: '2026-10-31',
  refundView: 'sale_result',
  basketUnit: 'ticket',
};
const outcomes = [];
for (const [tickets, products, refunds] of [
  [300, 4, 0],
  [20000, 4, 0],
  [10000, 50, 0],
  [10000, 4, 20],
  [1000, 400, 0],
]) {
  const sales = Array.from({ length: tickets }, (_, i) => ({
    id: `sale-${i}`,
    locationId: 'one',
    locationName: 'One',
    day: '2026-10-15',
    hour: '12',
    weekday: '4',
    visitId: null,
    merchandiseMinorUnits: products * 1000,
    tipsMinorUnits: 0,
    discountsMinorUnits: 0,
    legacyDiscount: false,
    lines: Array.from({ length: products }, (_, j) => ({
      id: `line-${j}`,
      productId: `product-${j}`,
      name: `Product ${j}`,
      quantity: refunds ? refunds + 1 : 1,
    })),
    refunds: Array.from({ length: refunds }, (_, j) => ({
      id: `refund-${j}`,
      day: '2026-10-15',
      hour: '12',
      weekday: '4',
      merchandiseMinorUnits: 1,
      tipsMinorUnits: 0,
      quantities: Array.from({ length: products }, (_, k) => ({
        lineId: `line-${k}`,
        quantity: 1,
      })),
    })),
  }));
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const report = analyzePurchases(sales, query, []);
  const ms = performance.now() - start;
  const after = process.memoryUsage();
  outcomes.push({
    tickets,
    products,
    refunds,
    ms,
    reportHash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
    heapDelta: after.heapUsed - before.heapUsed,
    rss: after.rss,
    coverage: report.coverage,
    totals: report.totals,
  });
  console.log(JSON.stringify(outcomes.at(-1)));
}
writeFileSync(
  process.env.UMI_BENCH_OUTPUT || '/tmp/umi-dashboard-performance/analysis-baseline.json',
  JSON.stringify(outcomes, null, 2),
);

if (
  process.env.UMI_BENCH_MAX_MS &&
  outcomes.some((row) => row.ms > Number(process.env.UMI_BENCH_MAX_MS))
) {
  console.error('Sales analysis exceeded the selected CPU budget');
  process.exitCode = 1;
}
