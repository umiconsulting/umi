// Realtime channel names guard. Zero-dep entry: the dashboard imports it in the
// browser, and the Vercel build of that app installs no zod. Run against the BUILT
// dist, so run `pnpm --filter @umi/contract build` first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const channels = require('../dist/realtime-channels.cjs');
const root = require('../dist/index.cjs');

test('channel names are byte-exact to the gateways', () => {
  assert.equal(channels.REALTIME_NAMESPACE, '/rt');
  assert.equal(channels.REALTIME_EVENT_PAIRING_CHANGED, 'device.pairing.changed');
  assert.equal(channels.pairingRoom('p1'), 'pairing:p1');
  assert.equal(channels.DASHBOARD_REALTIME_NAMESPACE, '/rt/dashboard');
  assert.equal(channels.DASHBOARD_EVENT_DEVICES_CHANGED, 'dashboard.devices.changed');
  assert.equal(channels.dashboardRoom('m1'), 'dashboard:m1');
});

test('the package root re-exports the same names (API surface unchanged)', () => {
  // tsup builds each entry without splitting, so functions are separate copies:
  // compare strings by value and functions by output.
  for (const key of Object.keys(channels)) {
    const value = channels[key];
    if (typeof value === 'function') assert.equal(root[key]('x'), value('x'), key);
    else assert.equal(root[key], value, key);
  }
});

test('realtime-channels entry is zod-free (dashboard bundle constraint)', () => {
  const src = readFileSync(new URL('../dist/realtime-channels.cjs', import.meta.url), 'utf8');
  assert.equal(/require\(['"]zod['"]\)/.test(src), false);
});
