#!/usr/bin/env node
/**
 * Freeze what the register's screens actually receive, so the port can be tested
 * against a recording instead of against somebody's memory of it.
 *
 * `umi-cash-register-parity.mjs` answers "do the two origins agree RIGHT NOW?".
 * This answers "what did umi-cash send on the day we cut over?", and writes the
 * answer to `apps/umi-api/src/modules/cash/register-shapes.json`, which
 * `register-shape.contract.spec.ts` asserts umi-api still matches in CI. Without
 * that file the regression test would compare a port against the port.
 *
 * Sessions are the scarce resource — umi-api allows five register logins per café
 * per fifteen minutes and umi-cash is not more generous — so one run walks every
 * route for the café it is pointed at, and the two cafés are captured in two runs.
 * Ladder and single-tier cafés give different shapes (`upgrade` and `baseReward`
 * appear on one and are null on the other), and both are needed.
 *
 * Usage (credentials never leave the machine; nothing here reads the database):
 *
 *   PARITY_SLUG=kalalacafe PARITY_IDENTIFIER=admin@kalalacafe.mx \
 *     PARITY_PASSWORD=... node scripts/umi-cash-shape-capture.mjs
 *
 * Re-running with a second slug MERGES into the file rather than replacing it:
 * the fixture is the union of every café captured, which is what the spec wants.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shape } from './lib/register-shape.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'apps/umi-api/src/modules/cash/register-shapes.json');

const ORIGIN = process.env.PARITY_LEGACY_ORIGIN ?? 'https://cash.umiconsulting.co';
const SLUG = process.env.PARITY_SLUG;
const IDENTIFIER = process.env.PARITY_IDENTIFIER;
const PASSWORD = process.env.PARITY_PASSWORD;

if (!SLUG || !IDENTIFIER || !PASSWORD) {
  console.error('Set PARITY_SLUG, PARITY_IDENTIFIER and PARITY_PASSWORD.');
  process.exit(2);
}

const login = await fetch(`${ORIGIN}/api/${SLUG}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
const { accessToken } = await login.json().catch(() => ({}));
if (!accessToken) {
  console.error(`login failed on ${ORIGIN}: ${login.status}`);
  process.exit(1);
}

const get = async (path) => {
  const r = await fetch(`${ORIGIN}/api/${SLUG}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return r.json();
};

const ROUTES = [
  '/admin/stats',
  '/admin/settings',
  '/admin/reward-config',
  '/admin/gift-cards',
  // One range is enough: the shape of `?days=7` is the shape of `?days=365`.
  '/admin/analytics?days=7',
];

const captured = {};
for (const route of ROUTES) captured[route] = [...shape(await get(route))].sort();

const customers = await get('/admin/customers?limit=1');
captured['/admin/customers'] = [...shape(customers)].sort();
const id = customers?.customers?.[0]?.id;
captured['/admin/customers/:id'] = [...shape(await get(`/admin/customers/${id}`))].sort();

let existing = {};
try {
  existing = JSON.parse(readFileSync(OUT, 'utf8'));
} catch {
  // First capture for this machine: there is nothing to merge into.
}

// Union, never replace: one café's null `upgrade` must not erase the other's object.
const merged = { ...existing };
for (const [route, paths] of Object.entries(captured)) {
  merged[route] = [...new Set([...(merged[route] ?? []), ...paths])].sort();
}

writeFileSync(OUT, `${JSON.stringify(merged, null, 1)}\n`);
console.log(
  `${SLUG}: ${Object.values(captured).reduce((n, p) => n + p.length, 0)} paths recorded, ` +
    `${Object.values(merged).reduce((n, p) => n + p.length, 0)} in the fixture.`,
);
