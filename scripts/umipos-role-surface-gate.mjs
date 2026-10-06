#!/usr/bin/env node
/**
 * Workstream C step 4 — "the client hides; the API decides" — as a standing check.
 *
 * For every row of `config/umipos-surface-permissions.json`, log in as the roles
 * that file names and assert the MEASURED HTTP status: `refused` roles must get
 * 401 or 403, `allowed` roles must get 2xx. Nothing is inferred from the guards
 * in the source: the check talks to a running API, because the whole point of the
 * acceptance line is that the deployed API refuses what the client hides.
 *
 * It refuses to pass a row it could not test. A role that cannot sign in is a
 * failure, not a skip; a body-validation 400 or a rate-limit 429 is a failure for
 * both expectations, because neither is the API making a permission decision.
 *
 * Usage:
 *   pnpm check:role-surfaces
 *   node scripts/umipos-role-surface-gate.mjs --roles cashier,admin,owner
 *   node scripts/umipos-role-surface-gate.mjs --json   # machine-readable rows
 *
 * Environment:
 *   UMIPOS_API_BASE_URL   default http://127.0.0.1:4001
 *   UMIPOS_MERCHANT_ID    default the Kalala Café id in the contract
 *   UMIPOS_ROLE_PASSWORD  password for every role login. Unset falls back to the
 *                         LOCAL REHEARSAL default (Umi2026!, the seed password the
 *                         local database gives every seeded user) and says so —
 *                         the fallback is a convenience for this laptop, not a
 *                         claim about any real deployment.
 *
 * The database these roles come from is the local rehearsal copy. A `manager`
 * login does not exist in it out of the box; the contract lists the one the UX
 * sweep left behind, and the script reports roles it could not sign in as rather
 * than quietly dropping them.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = resolve(root, 'config/umipos-surface-permissions.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const baseUrl = (process.env.UMIPOS_API_BASE_URL ?? 'http://127.0.0.1:4001').replace(/\/$/, '');
const merchantId = process.env.UMIPOS_MERCHANT_ID ?? contract.merchant.id;
const localPasswordDefault = 'Umi2026!';
const password = process.env.UMIPOS_ROLE_PASSWORD ?? localPasswordDefault;
const passwordIsFallback = process.env.UMIPOS_ROLE_PASSWORD === undefined;
const jsonOut = flag('--json');
const requestedRoles = option('--roles')
  ? option('--roles')
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean)
  : null;

const REFUSED = new Set([401, 403]);

function fail(message) {
  throw new Error(`Role surface gate failed: ${message}`);
}

/** Expand the contract's placeholders into a real URL for this merchant. */
function url(path) {
  return (
    baseUrl + path.replaceAll('{ref}', contract.merchant.ref).replaceAll('{merchantId}', merchantId)
  );
}

function validateContract() {
  if (contract.schemaVersion !== 1) fail('unsupported schema version.');
  if (!contract.merchant?.id || !contract.merchant?.ref) fail('the contract names no merchant.');
  if (!Array.isArray(contract.surfaces) || contract.surfaces.length === 0) {
    fail('the contract lists no surfaces.');
  }
  const declaredRoles = new Set(contract.roles.map((entry) => entry.role));
  for (const entry of contract.roles) {
    if (!entry.role || !entry.username) fail('a role is missing its role or username.');
    if (!entry.source) fail(`role ${entry.role} does not say where its login comes from.`);
  }
  const ids = new Set();
  for (const surface of contract.surfaces) {
    if (!surface.id) fail('a surface has no id.');
    if (ids.has(surface.id)) fail(`duplicate surface id ${surface.id}.`);
    ids.add(surface.id);
    if (!surface.module) fail(`${surface.id} names no client module.`);
    if (!surface.client?.gate) fail(`${surface.id} does not declare the client's gate.`);
    if (!surface.client?.source) fail(`${surface.id} does not cite the file it was read from.`);
    if (surface.client.gate.length === 0 && !surface.client.gateMode) {
      fail(`${surface.id} declares no gate and no explicit reason.`);
    }
    if (surface.client.gateMode && surface.client.gateMode !== 'any') {
      fail(`${surface.id} uses an unsupported gateMode ${surface.client.gateMode}.`);
    }
    if (!surface.request?.method || !surface.request?.path) {
      fail(`${surface.id} has no HTTP method or path.`);
    }
    if (surface.request.bodyFrom && !ids.has(surface.request.bodyFrom)) {
      fail(`${surface.id} reads its body from unknown surface ${surface.request.bodyFrom}.`);
    }
    const expected = surface.expect ?? {};
    const expectedRoles = Object.keys(expected);
    if (expectedRoles.length === 0) fail(`${surface.id} expects nothing of nobody.`);
    for (const role of expectedRoles) {
      if (!declaredRoles.has(role)) fail(`${surface.id} expects a role ${role} it never declared.`);
      if (expected[role] !== 'refused' && expected[role] !== 'allowed') {
        fail(`${surface.id} expects an unknown outcome "${expected[role]}" for ${role}.`);
      }
    }
  }
}

/** Only the cookie names this API sets; a full jar implementation is not needed. */
function cookieJar() {
  const jar = new Map();
  return {
    absorb(response) {
      const lines = response.headers.getSetCookie?.() ?? [];
      for (const line of lines) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index <= 0) continue;
        jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    cookieHeader() {
      return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    },
    csrf: () => jar.get('umi_csrf'),
  };
}

async function login(username) {
  const jar = cookieJar();
  const response = await fetch(`${baseUrl}/api/auth/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    redirect: 'manual',
  });
  jar.absorb(response);
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    // The error body is read for its message only; a raw dump in the failure list
    // buries the one line that matters.
    let detail = raw.slice(0, 120);
    try {
      const parsed = JSON.parse(raw);
      detail = parsed.error?.message ?? parsed.error?.code ?? detail;
    } catch {
      // not JSON; keep the slice
    }
    // 429 here is almost never the café: /api/auth/local/login allows 20 attempts
    // per 15 minutes per IP (auth.controller.ts), and this check spends one login
    // per role. Re-running it five times in a quarter of an hour exhausts that,
    // not the account. Say so, because "not tested" must not look like a finding.
    const rateLimited =
      response.status === 429
        ? 'login rate-limited (POST /api/auth/local/login allows 20 per 15 min per IP); wait for the window and re-run'
        : null;
    return {
      ok: false,
      status: response.status,
      detail: rateLimited ?? detail,
    };
  }
  return { ok: true, jar };
}

async function measure(session, surface, body) {
  const headers = { cookie: session.jar.cookieHeader() };
  const csrf = session.jar.csrf();
  if (csrf) headers['x-umi-csrf'] = csrf;
  const init = { method: surface.request.method, headers, redirect: 'manual' };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url(surface.request.path), init);
  // Drain so the socket is reusable; the body is not the assertion, the status is.
  await response.text().catch(() => '');
  return response.status;
}

/** The current reward config, so the write row can be an idempotent re-save. */
function rewardConfigBody(readBody) {
  const active = readBody?.active;
  if (!active) return null;
  return {
    visitsRequired: active.visitsRequired,
    rewardName: active.rewardName,
    ...(active.rewardDescription == null ? {} : { rewardDescription: active.rewardDescription }),
    rewardCostCentavos: active.rewardCostCentavos ?? 0,
  };
}

async function readBody(session, surface) {
  const headers = { cookie: session.jar.cookieHeader() };
  const response = await fetch(url(surface.request.path), { headers, redirect: 'manual' });
  if (!response.ok) {
    await response.text().catch(() => '');
    return null;
  }
  return response.json().catch(() => null);
}

async function run() {
  validateContract();
  if (passwordIsFallback) {
    // stderr, so `--json` keeps stdout a single JSON document.
    console.error(
      'note: UMIPOS_ROLE_PASSWORD is unset; using the local rehearsal seed password. ' +
        'Set it for any deployment that is not this laptop.\n',
    );
  }

  const roles = contract.roles.filter(
    (entry) => !requestedRoles || requestedRoles.includes(entry.role),
  );
  if (roles.length === 0) fail(`no contract role matches --roles ${requestedRoles?.join(',')}.`);
  const selected = new Set(roles.map((entry) => entry.role));

  // A run that skips a role must SAY so. `--roles` is for iterating on one row;
  // the acceptance run is the one with no `--roles`, and it must cover every role
  // the contract asserts or the check is not the check.
  const assertedRoles = [...new Set(contract.surfaces.flatMap((s) => Object.keys(s.expect)))];
  const skipped = assertedRoles.filter((role) => !roles.some((entry) => entry.role === role));
  if (skipped.length > 0) {
    if (!requestedRoles) fail(`roles ${skipped.join(', ')} are asserted but not selected.`);
    console.error(
      `warning: partial run — ${skipped.join(', ')} not exercised. ` +
        'This proves nothing about those roles; run `pnpm check:role-surfaces` for the acceptance check.\n',
    );
  }

  const sessions = new Map();
  const logins = [];
  for (const entry of roles) {
    const result = await login(entry.username);
    logins.push({ role: entry.role, username: entry.username, ...result });
    if (result.ok) sessions.set(entry.role, result);
  }

  const rows = [];
  const failures = [];
  for (const surface of contract.surfaces) {
    let body = surface.request.body;
    if (surface.request.bodyFrom) {
      const source = contract.surfaces.find((entry) => entry.id === surface.request.bodyFrom);
      // Read it as the LEAST privileged role that is allowed to read it, so the
      // body we re-save is the café's real configuration and never an invention.
      const readerRole = Object.entries(source.expect).find(
        ([role, outcome]) => outcome === 'allowed' && selected.has(role),
      )?.[0];
      const reader = sessions.get(readerRole);
      if (!reader) {
        failures.push({
          surface: surface.id,
          role: readerRole ?? `body:${surface.request.bodyFrom}`,
          expected: 'allowed',
          actual: 'login failed',
          detail: readerRole
            ? `cannot build an idempotent body for ${surface.id}: ${readerRole} could not sign in`
            : `no role selected by this run may read ${surface.request.bodyFrom}, so the idempotent body for ${surface.id} cannot be built`,
        });
        continue;
      }
      const current = await readBody(reader, source);
      body = rewardConfigBody(current);
      if (!body) {
        failures.push({
          surface: surface.id,
          role: readerRole,
          expected: 'allowed',
          actual: 'unavailable',
          detail: `could not read ${source.id} to build an idempotent body`,
        });
        continue;
      }
    }

    for (const [role, expectation] of Object.entries(surface.expect)) {
      // Not asserted for a role this run did not select — said out loud above.
      if (!selected.has(role)) continue;
      const session = sessions.get(role);
      if (!session) {
        const attempted = logins.find((entry) => entry.role === role);
        failures.push({
          surface: surface.id,
          role,
          expected: expectation,
          actual: `not tested (login ${attempted?.status ?? '?'})`,
          detail: attempted?.detail ?? 'role was not selected',
        });
        continue;
      }
      const status = await measure(session, surface, body);
      const satisfied =
        expectation === 'refused' ? REFUSED.has(status) : status >= 200 && status < 300;
      const row = {
        surface: surface.id,
        module: surface.module,
        method: surface.request.method,
        path: surface.request.path,
        role,
        expected: expectation,
        actual: status,
        pass: satisfied,
      };
      rows.push(row);
      if (!satisfied) failures.push({ ...row, actual: status });
      if (jsonOut) continue;
      console.log(
        `${satisfied ? 'ok  ' : 'FAIL'} ${String(status).padEnd(4)} ${role.padEnd(8)} ${expectation.padEnd(8)} ${surface.id.padEnd(26)} ${surface.request.method} ${surface.request.path}`,
      );
    }
  }

  if (jsonOut) {
    console.log(
      JSON.stringify({ logins: logins.map(({ jar, ...rest }) => rest), rows, failures }, null, 2),
    );
  } else {
    console.log('\nsigned in as:');
    for (const entry of logins) {
      console.log(
        `  ${entry.role.padEnd(8)} ${entry.username.padEnd(28)} ${entry.ok ? 'ok' : `FAILED (${entry.status})`}`,
      );
    }
    const refusedChecked = rows.filter((row) => row.expected === 'refused').length;
    const allowedChecked = rows.filter((row) => row.expected === 'allowed').length;
    console.log(
      `\n${rows.length} assertions across ${contract.surfaces.length} surfaces ` +
        `(${refusedChecked} must-refuse, ${allowedChecked} must-allow), ${failures.length} failed.`,
    );
    if (passwordIsFallback) {
      console.log('(password: local rehearsal default — UMIPOS_ROLE_PASSWORD was unset)');
    }
  }

  if (failures.length > 0) {
    const lines = failures.map(
      (failure) =>
        `  ${failure.surface} [${failure.role}] expected ${failure.expected}, measured ${failure.actual}` +
        (failure.detail ? ` — ${failure.detail}` : ''),
    );
    throw new Error(
      `Role surface gate failed: ${failures.length} mismatch(es).\n${lines.join('\n')}`,
    );
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
