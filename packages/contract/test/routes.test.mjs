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
  assert.equal(routes.auth.pos.pinLogin, '/api/v1/auth/pos/pin-login');
});

test('me + merchant-scoped route builders', () => {
  assert.equal(routes.me.merchants, '/api/me/merchants');
  assert.equal(routes.merchants.base('abc'), '/api/merchants/abc');
  assert.equal(routes.merchants.capabilities('abc'), '/api/merchants/abc/capabilities');
  assert.equal(routes.merchants.settings('abc'), '/api/merchants/abc/settings');
  assert.equal(routes.cash.stats('abc'), '/api/merchants/abc/cash/stats');
});

test('merchant role routes are byte-exact', () => {
  assert.equal(routes.roles.list('abc'), '/api/merchants/abc/roles');
  assert.equal(routes.roles.create('abc'), '/api/merchants/abc/roles');
  assert.equal(routes.roles.update('abc', 'role-1'), '/api/merchants/abc/roles/role-1');
  assert.equal(
    routes.roles.archive('abc', 'role-1', 4),
    '/api/merchants/abc/roles/role-1?expectedRevision=4',
  );
});

test('merchant id is URL-encoded (matches data.jsx _merchantPath)', () => {
  assert.equal(routes.merchants.base('a b'), '/api/merchants/a%20b');
  assert.equal(routes.cash.stats('a/b'), `/api/merchants/${encodeURIComponent('a/b')}/cash/stats`);
});

test('dashboard device enrollment routes match the versioned controller', () => {
  assert.equal(
    routes.devices.beginEnrollment('abc'),
    '/api/v1/merchants/abc/devices/enrollment',
  );
  assert.equal(
    routes.devices.enrollmentRequests('abc'),
    '/api/v1/merchants/abc/devices/enrollment-requests',
  );
  assert.equal(
    routes.devices.approveEnrollment('abc', 'request-1'),
    '/api/v1/merchants/abc/devices/enrollment-requests/request-1/approve',
  );
  assert.equal(
    routes.devices.denyEnrollment('abc', 'request-1'),
    '/api/v1/merchants/abc/devices/enrollment-requests/request-1/deny',
  );
});

test('cash merchant-scoped routes (dashboard surface)', () => {
  assert.equal(routes.cash.analytics('abc'), '/api/merchants/abc/cash/analytics');
  assert.equal(routes.cash.customers('abc'), '/api/merchants/abc/cash/customers');
  assert.equal(routes.cash.members('abc'), '/api/merchants/abc/cash/members');
  assert.equal(routes.cash.giftCards('abc'), '/api/merchants/abc/cash/gift-cards');
  assert.equal(routes.cash.rewardConfig('abc'), '/api/merchants/abc/cash/reward-config');
});

test('cash routes addressed by merchant reference (umi-cash surface) — byte-exact to controllers', () => {
  assert.equal(routes.cash.byRef.scan('cafe'), '/api/cafe/admin/scan');
  assert.equal(routes.cash.byRef.topup('cafe'), '/api/cafe/admin/topup');
  assert.equal(routes.cash.byRef.purchase('cafe'), '/api/cafe/admin/purchase');
  assert.equal(routes.cash.byRef.giftCards('cafe'), '/api/cafe/admin/gift-cards');
  assert.equal(routes.cash.byRef.settings('cafe'), '/api/cafe/admin/settings');
  assert.equal(routes.cash.byRef.rewardConfig('cafe'), '/api/cafe/admin/reward-config');
  assert.equal(routes.cash.byRef.stats('cafe'), '/api/cafe/admin/stats');
  assert.equal(routes.cash.byRef.analytics('cafe'), '/api/cafe/admin/analytics');
  assert.equal(routes.cash.byRef.registerMember('cafe'), '/api/cafe/customers');
  assert.equal(routes.cash.byRef.gift('cafe', 'GIFT-1'), '/api/cafe/gift/GIFT-1');
});

test('routes entry is zod-free (dashboard bundle constraint)', () => {
  // /routes is advertised as importing nothing — the dashboard consumes it to
  // keep zod out of the browser bundle. Guard against a future zod import.
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../dist/routes.cjs'), 'utf8');
  assert.equal(/require\(['"]zod['"]\)/.test(src), false);
});

test('merchant reference + gift code are URL-encoded', () => {
  assert.equal(routes.cash.byRef.scan('a b'), '/api/a%20b/admin/scan');
  assert.equal(routes.cash.byRef.gift('a/b', 'c d'), '/api/a%2Fb/gift/c%20d');
});

test('routes.auth.mfaVerify names the second half of the login', () => {
  // The server has carried this route since the MFA port; the table never
  // declared it, so no client could reach it without a path literal.
  assert.equal(routes.auth.mfaVerify, '/api/auth/local/mfa/verify');
});
