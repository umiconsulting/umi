// Drift gate for the route table.
//
// `ROUTE_TABLE` is the single author of every path in the platform. This test reads
// the NestJS controllers and proves the table describes routes that actually exist.
// Without it the table is just a document, and a document drifts.
//
// Routes that are declared but not yet served live in PENDING with a reason. The
// test fails if a PENDING route silently starts resolving, so the list cannot rot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTE_TABLE } from '../dist/index.js';

const modulesDir = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../apps/umi-api/src/modules',
);

/**
 * Routes the table declares that no controller serves yet, each with the gate that
 * will serve it. Delete an entry when its handler lands.
 */
const PENDING = new Map([
  // Gate 2.3 — modules/devices
  ['devices.beginEnrollment', 'Gate 2.3: modules/devices'],
  ['devices.completeEnrollment', 'Gate 2.3: modules/devices'],
  ['devices.status', 'Gate 2.3: modules/devices'],
  // Gate 2.3 — POS authentication on modules/auth
  ['auth.posLogin', 'Gate 2.3: auth.controller POS routes'],
  ['auth.posRefresh', 'Gate 2.3: auth.controller POS routes'],
  ['auth.posLogout', 'Gate 2.3: auth.controller POS routes'],
  ['auth.posGlobalLogout', 'Gate 2.3: auth.controller POS routes'],
  ['auth.globalLogout', 'Gate 2.3: auth.controller global logout'],
  // Gate 2.3 — modules/integrity
  ['merchants.audit', 'Gate 2.3: modules/integrity'],
  // Gate 2.3 — the POS surface proper
  ...[
    'pos.entryContext',
    'pos.operatorSessions',
    'pos.operatorLock',
    'pos.operatorEnd',
    'pos.verifyPin',
    'pos.managerApproval',
    'pos.catalogCategories',
    'pos.catalogProducts',
    'pos.catalogProduct',
    'pos.cartCreate',
    'pos.cartGet',
    'pos.cartLines',
    'pos.cartLineUpdate',
    'pos.cartLineRemove',
    'pos.cartPrepare',
    'pos.checkout',
    'pos.checkoutPayment',
    'pos.offlineReplayBegin',
    'pos.offlinePolicy',
    'pos.offlineReplayBatch',
    'pos.offlineReplayCursor',
    'pos.offlineReplayCommand',
    'pos.offlineConflicts',
    'pos.offlineReconcile',
    'pos.offlineReconcileAcknowledge',
    'pos.offlineDiagnostics',
  ].map((id) => [id, 'Gate 2.3: modules/pos-*']),
]);

const METHOD_DECORATOR = /@(Get|Post|Patch|Put|Delete)\(([^)]*)\)/g;
const CONTROLLER_DECORATOR = /@Controller\(([^)]*)\)/g;

/** `'api/pos'` or `['a', 'b']` or empty → the list of path strings it declares. */
const decoratorPaths = (raw) => {
  const trimmed = raw.trim();
  if (trimmed === '') return [''];
  const found = [...trimmed.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1]);
  return found.length > 0 ? found : [''];
};

const join = (base, sub) =>
  `/${[base, sub].filter((part) => part !== '').join('/')}`.replace(/\/{2,}/g, '/');

async function controllerFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await controllerFiles(full)));
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/** Every `"METHOD /path"` the NestJS controllers actually serve. */
async function servedRoutes() {
  const served = new Set();
  for (const file of await controllerFiles(modulesDir)) {
    const source = await readFile(file, 'utf8');
    // Each @Controller opens a section; its method decorators follow until the next.
    const controllers = [...source.matchAll(CONTROLLER_DECORATOR)];
    for (const [index, match] of controllers.entries()) {
      const start = match.index + match[0].length;
      const end = controllers[index + 1]?.index ?? source.length;
      const body = source.slice(start, end);
      for (const base of decoratorPaths(match[1])) {
        for (const method of body.matchAll(METHOD_DECORATOR)) {
          for (const sub of decoratorPaths(method[2])) {
            served.add(`${method[1].toUpperCase()} ${join(base, sub)}`);
          }
        }
      }
    }
  }
  return served;
}

test('every declared route resolves to a live controller handler', async () => {
  const served = await servedRoutes();
  assert.ok(served.size > 20, `parsed only ${served.size} controller routes — parser is broken`);

  const missing = [];
  for (const def of ROUTE_TABLE) {
    if (PENDING.has(def.id)) continue;
    const key = `${def.method} ${def.path}`;
    if (!served.has(key)) missing.push(`${def.id} → ${key}`);
  }
  assert.deepEqual(
    missing,
    [],
    `route table declares paths no controller serves:\n${missing.join('\n')}`,
  );
});

test('the pending list cannot rot — a served route must leave it', async () => {
  const served = await servedRoutes();
  const stale = [];
  for (const [id, reason] of PENDING) {
    const def = ROUTE_TABLE.find((r) => r.id === id);
    assert.ok(def, `PENDING names an id that is not in ROUTE_TABLE: ${id}`);
    if (served.has(`${def.method} ${def.path}`)) stale.push(`${id} (${reason}) now resolves`);
  }
  assert.deepEqual(stale, [], `remove these from PENDING:\n${stale.join('\n')}`);
});

test('no POS or device route is served outside the versioned namespace', async () => {
  const served = await servedRoutes();
  const unversioned = [...served].filter((key) =>
    /^\w+ \/api\/(pos\/|devices\/|auth\/pos\/)/.test(key),
  );
  assert.deepEqual(
    unversioned,
    [],
    `POS and device handlers must live under /api/v1:\n${unversioned.join('\n')}`,
  );
});
