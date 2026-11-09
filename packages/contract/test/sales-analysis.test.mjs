import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SalesAnalysis,
  SalesAnalysisQuery,
  SalesAnalysisGroupWrite,
  SalesAnalysisGroup,
} from '../dist/index.js';

test('analysis accepts bounded calendar dates and defaults to ticket sale results', () => {
  const query = SalesAnalysisQuery.parse({ from: '2024-11-06', to: '2026-11-06' });
  assert.equal(query.refundView, 'sale_result');
  assert.equal(query.basketUnit, 'ticket');
  assert.equal(
    SalesAnalysisQuery.safeParse({ from: '2024-11-05', to: '2026-11-06' }).success,
    false,
  );
});

test('analysis refuses invalid, reversed and unknown query fields', () => {
  for (const query of [
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-11-06', to: '2026-11-05' },
    { from: '2026-11-01', to: '2026-11-06', refundView: 'estimate' },
    { from: '2026-11-01', to: '2026-11-06', merchantId: 'other' },
  ])
    assert.equal(SalesAnalysisQuery.safeParse(query).success, false);
});

test('group writes require unique products and an integer version', () => {
  const product = '11111111-1111-4111-8111-111111111111';
  const input = { name: ' Desayuno ', productIds: [product], expectedVersion: 0 };
  assert.equal(SalesAnalysisGroupWrite.parse(input).name, 'Desayuno');
  assert.equal(
    SalesAnalysisGroupWrite.safeParse({ ...input, productIds: [product, product] }).success,
    false,
  );
  assert.equal(SalesAnalysisGroupWrite.safeParse({ ...input, productIds: [] }).success, false);
  assert.equal(
    SalesAnalysisGroupWrite.safeParse({ ...input, expectedVersion: 1.2 }).success,
    false,
  );
  assert.equal(
    SalesAnalysisGroup.safeParse({
      id: product,
      name: 'Archived products',
      productIds: [],
      version: 1,
    }).success,
    true,
  );
});

const analysisId = '11111111-1111-4111-8111-111111111111';
const analysisMetrics = {
  tickets: 1,
  units: 1,
  merchandiseMinorUnits: 1000,
  refundsMinorUnits: 0,
  netMinorUnits: 1000,
  averageTicketMinorUnits: 1000,
  unitsPerTicket: 1,
  tipsMinorUnits: 0,
  discountsMinorUnits: 0,
};
const analysisBaskets = {
  coverage: {
    baskets: 1,
    ticketsWithVisit: 0,
    ticketsWithoutVisit: 1,
    ticketsWithoutProducts: 0,
    refundedUnits: 0,
    legacyDiscountTickets: 0,
    pairsAvailable: 0,
    categoriesUseCurrentCatalog: true,
  },
  unitsDistribution: [{ units: 1, tickets: 1 }],
  pairs: [],
  selectedGroups: {
    a: null,
    b: null,
    basketsWithA: 0,
    basketsWithB: 0,
    basketsWithBoth: 0,
    support: null,
    confidenceAtoB: null,
    lift: null,
    overlappingProducts: 0,
  },
};
const analysisBase = {
  merchantId: analysisId,
  locationId: null,
  from: '2026-11-01',
  to: '2026-11-02',
  timezone: 'America/Mazatlan',
  currency: 'MXN',
  refundView: 'sale_result',
  basketUnit: 'ticket',
  capturedAt: '2026-11-02T12:00:00.000Z',
  firstSaleDate: '2026-11-01',
  totals: analysisMetrics,
  byHour: [],
  byDay: [],
  byWeekday: [],
  byMonth: [],
  byLocation: [],
};

test('a 2.53.0 success payload passes without basketState when all basket fields exist', () => {
  assert.equal(SalesAnalysis.safeParse({ ...analysisBase, ...analysisBaskets }).success, true);
});

test('basketState complete requires all four fields and code null', () => {
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      ...analysisBaskets,
      basketState: { state: 'complete', code: null },
    }).success,
    true,
  );
  const { pairs: _pairs, ...withoutPairs } = analysisBaskets;
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      ...withoutPairs,
      basketState: { state: 'complete', code: null },
    }).success,
    false,
  );
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      ...analysisBaskets,
      basketState: { state: 'complete', code: 'BASKETS_TOO_COMPLEX' },
    }).success,
    false,
  );
});

test('basketState unavailable requires code BASKETS_TOO_COMPLEX and no basket fields', () => {
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      basketState: { state: 'unavailable', code: 'BASKETS_TOO_COMPLEX' },
    }).success,
    true,
  );
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      ...analysisBaskets,
      basketState: { state: 'unavailable', code: 'BASKETS_TOO_COMPLEX' },
    }).success,
    false,
  );
  assert.equal(
    SalesAnalysis.safeParse({
      ...analysisBase,
      basketState: { state: 'unavailable', code: null },
    }).success,
    false,
  );
});

test('an absent basketState cannot hide a missing basket field', () => {
  const { coverage: _coverage, ...withoutCoverage } = analysisBaskets;
  assert.equal(SalesAnalysis.safeParse({ ...analysisBase, ...withoutCoverage }).success, false);
});
