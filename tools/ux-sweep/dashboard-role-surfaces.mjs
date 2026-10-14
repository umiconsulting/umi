#!/usr/bin/env node
/**
 * What each ROLE actually sees, in a real browser, route by route.
 *
 * `scripts/umipos-role-surface-gate.mjs` proves the API half of plan §C step 4 — "the client
 * hides, and the API still decides" — by asking the API whether it refuses a role. It says
 * nothing about the CLIENT half: whether the dashboard really hides what the API refuses, and
 * whether it shows a screen that the API will then refuse. That is what this walks.
 *
 * For every role in `config/umipos-surface-permissions.json` it signs in on the Dashboard (the
 * login the contract names), then loads every route in the sweep's list and records what the
 * client did: rendered the screen, refused it (the shell's refusal card), redirected away, or
 * failed. The verdict is compared against the same file's `expect` map, per module, per role.
 *
 * Usage:
 *   node tools/ux-sweep/dashboard-role-surfaces.mjs --base http://127.0.0.1:4031 \
 *     --cdp http://127.0.0.1:9333 --out /tmp/ux/role-ui.json --md /tmp/ux/role-ui.md
 *
 * The dashboard it points at must serve a database whose four role logins work — on this
 * workstation that is the fixture `scripts/umipos-role-surface-fixture.sh` builds.
 *
 * Flags: --base, --cdp, --out, --md, --password (default the local rehearsal one), --routes,
 * --delay <ms>, --no-fail.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROUTES, routeSlug } from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || new URL('../..', import.meta.url).pathname;
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contract = JSON.parse(
  readFileSync(resolve(root, 'config/umipos-surface-permissions.json'), 'utf8'),
);

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const BASE = (arg('--base', process.env.UX_BASE || 'http://127.0.0.1:4031') || '').replace(
  /\/$/,
  '',
);
const CDP = arg('--cdp', process.env.UX_CDP || 'http://127.0.0.1:9222');
const OUT = arg('--out', '/tmp/ux/role-ui.json');
const MD = arg('--md', null);
const PASSWORD = arg('--password', process.env.UMIPOS_ROLE_PASSWORD || 'Umi2026!');
const DELAY = Number(arg('--delay', '800'));
const NO_FAIL = process.argv.includes('--no-fail');
const ONLY_ROLES = arg('--roles');
const ROUTES = (arg('--routes') ? String(arg('--routes')).split(',') : DEFAULT_ROUTES).map((r) =>
  r.trim(),
);

// The shell's own words for "this screen is not yours". Both languages, because the walk runs in
// whichever the session resolves to.
const REFUSALS = [
  'no está activo en este café',
  'is not active for this café',
  'acceso de plataforma requerido',
  'platform access required',
  'sin negocio seleccionado',
  'no business selected',
  'esta cuenta no tiene negocios',
  'this account has no businesses',
];

/** The module behind a route, exactly as the shell derives it from the path. */
function moduleOf(route) {
  const raw = String(route).split('/').filter(Boolean)[0] || 'overview';
  return raw === 'conversations' || raw === 'insights' ? 'customers' : raw;
}

/**
 * What the contract says about one module for one role.
 *
 * THE CONTRACT IS ABOUT API SURFACES, NOT ABOUT SCREENS, and the first version of this file
 * forgot that: it called a module "allowed" when any of its rows allowed the role, and then
 * reported the cashier's `/settings` as a mismatch because the client refuses a screen whose
 * reward-config rows are allowed — two different questions. What the rows can answer is whether
 * ANY of the module's surfaces is refused for the role, and whether ALL of them are:
 *
 *   anyRefused  the module needs something this role cannot have, so a client that hides it is
 *               justified. A client that SHOWS it is only wrong if the screen then asks for the
 *               refused thing — which the 4xx the walk records decides, not this file.
 *   allRefused  every surface behind the module is refused, so hiding the screen is the only
 *               right answer; drawing it is over-showing.
 */
function contractVerdict(moduleKey, role) {
  const rows = contract.surfaces.filter((s) => s.module === moduleKey && s.expect?.[role]);
  if (rows.length === 0)
    return { verdict: 'unlisted', rows: 0, anyRefused: false, allRefused: false };
  const verdicts = rows.map((r) => r.expect[role]);
  const anyRefused = verdicts.includes('refused');
  const allRefused = verdicts.every((v) => v === 'refused');
  return {
    verdict: allRefused ? 'refused' : anyRefused ? 'mixed' : 'allowed',
    rows: rows.length,
    anyRefused,
    allRefused,
  };
}

async function signIn(context, role) {
  const page = await context.newPage();
  await page.addInitScript(
    (pinned) => {
      try {
        localStorage.setItem('umi.dashboard.locale', pinned.locale);
        localStorage.setItem('umi-theme', pinned.theme);
        // PIN THE MERCHANT THE CONTRACT NAMES. The platform account (the owner) sees every café in
        // this database — thirty of them, most of them harness merchants with no subscription — and
        // the shell had selected Nudge Café, so all seventeen of that role's routes refused with
        // "is not active for this café" and the walk blamed the client. The selection lives in
        // `localStorage['umi-dashboard-selected-merchant']` (data.jsx), so it is pinned before the
        // first load, exactly like the locale and the palette.
        localStorage.setItem('umi-dashboard-selected-merchant', pinned.merchantId);
        if (pinned.locationId) {
          localStorage.setItem('umi-dashboard-selected-location', pinned.locationId);
        }
      } catch {
        // Storage can be blocked; the walk then runs in the session's own preferences.
      }
    },
    {
      locale: 'en',
      theme: 'umi',
      merchantId: contract.merchant.id,
      locationId: contract.merchant.locationId,
    },
  );
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1200);
  await page.locator('input[type="email"]').first().fill(role.username);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page
    .getByRole('button', { name: /sign in|iniciar sesión/i })
    .first()
    .click();
  await page.waitForTimeout(5000);
  const url = page.url();
  const signedIn = !/\/login/.test(url);
  return { page, url, signedIn };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    contract: 'config/umipos-surface-permissions.json',
    roles: [],
    mismatches: [],
  };

  const roles = contract.roles.filter((r) => !ONLY_ROLES || ONLY_ROLES.split(',').includes(r.role));

  for (const role of roles) {
    // ONE CONTEXT PER ROLE. The session cookie is per browser context, and a walk that reused one
    // would report the previous role's screens for every role after the first.
    const context = await browser.newContext();
    await context.newPage();
    const { page, signedIn, url: landing } = await signIn(context, role);
    const entry = { role: role.role, username: role.username, signedIn, landing, routes: [] };
    process.stderr.write(`\n${role.role.padEnd(8)} signed in: ${signedIn} (landed ${landing})\n`);

    if (signedIn) {
      for (const route of ROUTES) {
        const moduleKey = moduleOf(route);
        const expected = contractVerdict(moduleKey, role.role);
        const consoleErrors = [];
        const badResponses = [];
        const onConsole = (message) => {
          if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160));
        };
        const onResponse = (response) => {
          if (response.status() >= 400) {
            badResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
          }
        };
        page.on('console', onConsole);
        page.on('response', onResponse);

        let seen = 'error';
        let detail = null;
        try {
          await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          // NOT `networkidle`: the shell holds a realtime socket open, so the network never goes
          // idle and every route would spend the full timeout waiting for a quiet that cannot
          // come. The screen is ready when it has drawn its heading or its refusal.
          const deadline = Date.now() + 8000;
          for (;;) {
            const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 4000));
            const refusal = REFUSALS.find((needle) => text.toLowerCase().includes(needle));
            const heading = await page.evaluate(
              () => document.querySelector('h1, h2')?.innerText || '',
            );
            if (refusal || heading || Date.now() > deadline) break;
            await page.waitForTimeout(250);
          }
          await page.waitForTimeout(400);
          const body = await page.evaluate(() => document.body.innerText || '');
          const refusal = REFUSALS.find((needle) => body.toLowerCase().includes(needle));
          const landed = new URL(page.url()).pathname;
          if (refusal) {
            seen = 'refused';
            detail = refusal;
          } else if (moduleOf(landed) !== moduleKey) {
            seen = 'redirected';
            detail = landed;
          } else {
            seen = 'rendered';
          }
        } catch (error) {
          seen = 'error';
          detail = error.message.split('\n')[0];
        }
        page.off('console', onConsole);
        page.off('response', onResponse);

        const verdictForRole = (() => {
          if (seen === 'error') return 'mismatch';
          if (seen === 'redirected') return 'landing'; // the role's first screen, by design
          if (seen === 'refused') {
            if (expected.verdict === 'unlisted') return 'listed-only';
            // Hiding a screen is right when the role cannot have what the screen needs, and wrong
            // when the contract says every surface behind it is allowed.
            return expected.allRefused ? 'match' : expected.anyRefused ? 'partial' : 'mismatch';
          }
          // Rendered. That is right unless the screen asked for something and was refused: a 403
          // in the browser's own log is the client showing what the API denies.
          const denied = badResponses.filter((line) => /^40[13]/.test(line));
          if (denied.length > 0) return 'mismatch';
          return consoleErrors.length > 0 ? 'rendered-with-errors' : 'match';
        })();
        const row = {
          route,
          module: moduleKey,
          contract: expected.verdict,
          seen,
          detail,
          match: verdictForRole,
          consoleErrors,
          badResponses,
        };
        entry.routes.push(row);
        if (verdictForRole === 'mismatch' || verdictForRole === 'rendered-with-errors') {
          report.mismatches.push({ role: role.role, ...row, verdict: verdictForRole });
        }
        process.stderr.write(
          `  ${route.padEnd(24)} contract=${String(expected.verdict).padEnd(9)} seen=${seen.padEnd(10)} ` +
            `${verdictForRole}${consoleErrors.length ? ` · ${consoleErrors.length} console error(s)` : ''}\n`,
        );
        if (DELAY) await page.waitForTimeout(DELAY);
      }
    }

    report.roles.push(entry);
    await context.close();
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# Dashboard: what each role sees',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${report.base} · contract: ${report.contract}`,
      '',
      '| Role | Route | Module | Contract | Client showed | Verdict |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const role of report.roles) {
      for (const row of role.routes) {
        lines.push(
          `| ${role.role} | ${row.route} | ${row.module} | ${row.contract} | ${row.seen} | ${row.match} |`,
        );
      }
    }
    lines.push(
      '',
      `Findings: ${report.mismatches.length}`,
      '',
      'A `partial` verdict is not a finding: it means the screen mixes data the role may read with',
      'data it may not, and the curated surface list does not decide which half the client draws.',
      'A `landing` verdict is the role-first landing working (`lib/role-landing.js`).',
      '',
    );
    if (report.mismatches.length === 0) lines.push('None.');
    for (const m of report.mismatches) {
      lines.push(
        `- **${m.role}** on \`${m.route}\`: the contract expects \`${m.contract}\`, the client ${m.seen}${
          m.detail ? ` (${m.detail})` : ''
        }`,
      );
    }
    lines.push('');
    await writeFile(MD, lines.join('\n'));
  }

  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${report.mismatches.length} mismatch(es)\n`,
  );
  if (!NO_FAIL && report.mismatches.length > 0) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
