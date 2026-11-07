import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SalesAnalysisQuery, SalesAnalysisGroupWrite, SalesAnalysisGroup } from '../dist/index.js';

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
