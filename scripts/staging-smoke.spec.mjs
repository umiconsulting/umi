import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS, parseArgs, validateApiHealthPayload } from './staging-smoke.mjs';

test('parseArgs applies staging defaults and CLI overrides cleanly', () => {
  const opts = parseArgs(['--', '--shots', '/tmp/shots', '--include-landing', '--json'], {});
  assert.equal(opts.apiUrl, DEFAULTS.apiUrl);
  assert.equal(opts.dashboardUrl, DEFAULTS.dashboardUrl);
  assert.equal(opts.shotsDir, '/tmp/shots');
  assert.equal(opts.includeLanding, true);
  assert.equal(opts.asJson, true);
});

test('parseArgs rejects unknown flags', () => {
  assert.throws(() => parseArgs(['--unknown-flag'], {}), /Unknown option/);
});

test('validateApiHealthPayload accepts healthy staging payload', () => {
  const issues = validateApiHealthPayload(
    {
      status: 'ok',
      db: true,
      redis: true,
      schema: { current: 'build-v3-79', expected: 'build-v3-79', compatible: true },
    },
    { gitCommit: '17c47117', contractVersion: '2.50.0' },
  );
  assert.deepEqual(issues, []);
});

test('validateApiHealthPayload catches unhealthy db, redis, or incompatible schema', () => {
  const issues = validateApiHealthPayload(
    {
      status: 'degraded',
      db: false,
      redis: true,
      schema: { current: 'build-v3-78', expected: 'build-v3-79', compatible: false },
    },
    { gitCommit: '', contractVersion: '2.50.0' },
  );
  assert.equal(issues.length, 4);
});
