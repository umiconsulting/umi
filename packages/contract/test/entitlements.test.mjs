// Entitlement vocabulary guard. Zero-dep entry, so it must stay zod-free —
// importing it should not pull zod. Run against the BUILT dist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PRODUCT_KEYS, PRODUCT_ACTIVE_STATUSES, isProductStatusActive } = require('../dist/entitlements.cjs');

test('PRODUCT_KEYS = the real gateable products (no observability/landing)', () => {
  assert.deepEqual([...PRODUCT_KEYS], ['cash', 'conversaflow', 'kds', 'dashboard']);
});

test('PRODUCT_ACTIVE_STATUSES matches server.js port', () => {
  assert.ok(PRODUCT_ACTIVE_STATUSES.has('active'));
  assert.ok(PRODUCT_ACTIVE_STATUSES.has('trialing'));
  assert.equal(PRODUCT_ACTIVE_STATUSES.has('past_due'), false);
});

test('isProductStatusActive', () => {
  assert.equal(isProductStatusActive('active'), true);
  assert.equal(isProductStatusActive('trialing'), true);
  assert.equal(isProductStatusActive('canceled'), false);
  assert.equal(isProductStatusActive(null), false);
  assert.equal(isProductStatusActive(undefined), false);
});

test('entitlements entry is zod-free (dashboard bundle constraint)', () => {
  // The built CJS entry must not require zod.
  const src = require('node:fs').readFileSync(require.resolve('../dist/entitlements.cjs'), 'utf8');
  assert.equal(/require\(['"]zod['"]\)/.test(src), false);
});
