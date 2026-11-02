import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableStateEntry } from '../dist/index.js';

const occupied = {
  tableId: '00000000-0000-4000-8000-000000000001',
  state: 'served',
  seatedAt: '2026-11-02T18:00:00.000Z',
  partySize: 2,
  groupId: null,
};

test('a paid table remains occupied and accepts the payment time', () => {
  const table = TableStateEntry.parse({ ...occupied, paidAt: '2026-11-02T18:10:00.000Z' });
  assert.equal(table.state, 'served');
  assert.equal(table.partySize, 2);
  assert.equal(table.paidAt, '2026-11-02T18:10:00.000Z');
});

test('table snapshots from an older client still parse without a payment time', () => {
  assert.equal(TableStateEntry.safeParse(occupied).success, true);
});

test('a free table cannot carry a payment from a previous visit', () => {
  for (const state of ['open', 'dirty']) {
    assert.equal(
      TableStateEntry.safeParse({
        ...occupied,
        state,
        seatedAt: null,
        partySize: null,
        paidAt: '2026-11-02T18:10:00.000Z',
      }).success,
      false,
    );
  }
});
