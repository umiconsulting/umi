import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CancelSaleRequest,
  CancelSaleReason,
  CancelCarriedOverAccountsRequest,
} = require('../dist/index.cjs');

const id = '00000000-0000-4000-8000-000000000001';
const base = {
  locationId: id,
  operatorSessionId: id,
  idempotencyKey: id,
  expectedVersion: 1,
};

// Plan §8.3: a cancellation asks for a TYPED reason, not free text — the legacy
// till's free text produced 16 of 17 cancellations saying "prueba".

test('a cancellation names a reason from the fixed list', () => {
  for (const reasonCode of CancelSaleReason.options) {
    assert.ok(CancelSaleRequest.safeParse({ ...base, reasonCode }).success, reasonCode);
  }
});

test('free text alone is not a reason', () => {
  assert.equal(CancelSaleRequest.safeParse({ ...base, reason: 'prueba' }).success, false);
});

test('an invented code is not a reason', () => {
  assert.equal(CancelSaleRequest.safeParse({ ...base, reasonCode: 'because' }).success, false);
});

test('the note is optional; the code is not', () => {
  assert.equal(CancelSaleRequest.parse({ ...base, reasonCode: 'other' }).reason, null);
  assert.equal(
    CancelSaleRequest.parse({ ...base, reasonCode: 'other', reason: 'se fue' }).reason,
    'se fue',
  );
});

test('carried-over cancellation requires selected versions and a reason', () => {
  const input = {
    locationId: id,
    operatorSessionId: id,
    idempotencyKey: id,
    reasonCode: 'other',
    reason: 'Cierre manual de un día anterior',
    accounts: [{ cartId: id, expectedVersion: 2 }],
  };
  assert.ok(CancelCarriedOverAccountsRequest.safeParse(input).success);
  assert.equal(
    CancelCarriedOverAccountsRequest.safeParse({ ...input, accounts: [] }).success,
    false,
  );
  assert.equal(
    CancelCarriedOverAccountsRequest.safeParse({ ...input, reason: null }).success,
    false,
  );
  assert.equal(
    CancelCarriedOverAccountsRequest.safeParse({
      ...input,
      accounts: [input.accounts[0], input.accounts[0]],
    }).success,
    false,
  );
});
