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
