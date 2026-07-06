// Byte-exact route-literal guard. Runs against the BUILT dist (what umi-api
// require()s), so run `pnpm --filter @umi/contract build` first. Zero-dep:
// node's built-in test runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routes } = require('../dist/routes.cjs');

test('auth route literals are byte-exact to the controllers', () => {
  assert.equal(routes.auth.login, '/api/auth/local/login');
  assert.equal(routes.auth.refresh, '/api/auth/local/refresh');
  assert.equal(routes.auth.logout, '/api/auth/local/logout');
  assert.equal(routes.auth.forgotPassword, '/api/auth/local/forgot-password');
  assert.equal(routes.auth.resetPassword, '/api/auth/local/reset-password');
  assert.equal(routes.auth.me, '/api/auth/me');
});

test('me + tenant-scoped route builders', () => {
  assert.equal(routes.me.tenants, '/api/me/tenants');
  assert.equal(routes.tenants.base('abc'), '/api/tenants/abc');
  assert.equal(routes.tenants.capabilities('abc'), '/api/tenants/abc/capabilities');
  assert.equal(routes.tenants.settings('abc'), '/api/tenants/abc/settings');
  assert.equal(routes.cash.stats('abc'), '/api/tenants/abc/cash/stats');
});

test('tenant id is URL-encoded (matches data.jsx _tenantPath)', () => {
  assert.equal(routes.tenants.base('a b'), '/api/tenants/a%20b');
  assert.equal(routes.cash.stats('a/b'), `/api/tenants/${encodeURIComponent('a/b')}/cash/stats`);
});

test('cash tenant-scoped routes (dashboard surface)', () => {
  assert.equal(routes.cash.analytics('abc'), '/api/tenants/abc/cash/analytics');
  assert.equal(routes.cash.customers('abc'), '/api/tenants/abc/cash/customers');
  assert.equal(routes.cash.members('abc'), '/api/tenants/abc/cash/members');
  assert.equal(routes.cash.giftCards('abc'), '/api/tenants/abc/cash/gift-cards');
  assert.equal(routes.cash.rewardConfig('abc'), '/api/tenants/abc/cash/reward-config');
});

test('cash slug-scoped routes (umi-cash surface) — byte-exact to controllers', () => {
  assert.equal(routes.cash.slug.scan('cafe'), '/api/cafe/admin/scan');
  assert.equal(routes.cash.slug.topup('cafe'), '/api/cafe/admin/topup');
  assert.equal(routes.cash.slug.purchase('cafe'), '/api/cafe/admin/purchase');
  assert.equal(routes.cash.slug.giftCards('cafe'), '/api/cafe/admin/gift-cards');
  assert.equal(routes.cash.slug.settings('cafe'), '/api/cafe/admin/settings');
  assert.equal(routes.cash.slug.rewardConfig('cafe'), '/api/cafe/admin/reward-config');
  assert.equal(routes.cash.slug.stats('cafe'), '/api/cafe/admin/stats');
  assert.equal(routes.cash.slug.analytics('cafe'), '/api/cafe/admin/analytics');
  assert.equal(routes.cash.slug.registerMember('cafe'), '/api/cafe/customers');
  assert.equal(routes.cash.slug.gift('cafe', 'GIFT-1'), '/api/cafe/gift/GIFT-1');
});

test('routes entry is zod-free (dashboard bundle constraint)', () => {
  // /routes is advertised as importing nothing — the dashboard consumes it to
  // keep zod out of the browser bundle. Guard against a future zod import.
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../dist/routes.cjs'), 'utf8');
  assert.equal(/require\(['"]zod['"]\)/.test(src), false);
});

test('slug + gift code are URL-encoded', () => {
  assert.equal(routes.cash.slug.scan('a b'), '/api/a%20b/admin/scan');
  assert.equal(routes.cash.slug.gift('a/b', 'c d'), '/api/a%2Fb/gift/c%20d');
});
