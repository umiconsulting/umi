#!/usr/bin/env node
/**
 * Click audit for the Umi Dashboard.
 *
 * `click-inventory.mjs` answers "what is on the screen". This answers "what
 * happens when you press it" — which is the acceptance line in the platform
 * plan (§7, Step F1): *one command writes a report with every Dashboard control,
 * its size, its accessible name, and its result when clicked.*
 *
 * The default run is READ-ONLY. It classifies every control as safe or
 * destructive and writes the report, and it clicks nothing. Most Dashboard
 * screens write to the database on a single click, so the click pass is behind
 * an explicit opt-in that names the thing it is allowed to wreck:
 *
 *   UX_CLICK_CONFIRM=disposable node tools/ux-sweep/click-audit.mjs
 *
 * With the opt-in set, for each route the audit walks the safe controls in DOM
 * order, one at a time. After each click it records the resulting URL, the
 * console errors, the page errors, the failed requests, and whether a
 * dialog/confirm appeared; then it navigates back to the route before the next
 * click, so no click is judged from a state a previous click created.
 *
 * Usage:
 *   # classification only — safe to run against anything
 *   node tools/ux-sweep/click-audit.mjs --out /tmp/ux/click-audit.json
 *
 *   # click the safe controls on read-mostly screens, disposable database only
 *   UX_CLICK_CONFIRM=disposable node tools/ux-sweep/click-audit.mjs \
 *     --routes /,/reportes --limit 5 --shots /tmp/ux/shots
 *
 * Flags:
 *   --out <path>        JSON report (default /tmp/ux/click-audit.json).
 *   --md <path>         Markdown summary.
 *   --routes a,b,c      Override the route list.
 *   --shots <dir>       Screenshot per route and per state change.
 *   --limit <n>         Max controls clicked per route (default 10).
 *   --click-timeout <ms> Timeout for one click (default 5000).
 *   --settle <ms>       Wait after a route loads before collecting (default 1500).
 *   --viewport WxH      Pin the viewport (e.g. 1280x720).
 *   --skip-shell        Do not click the sidebar and top bar, so the pass is
 *                       about the screen instead of the navigation.
 *   --delay <ms>        Pause between routes. The API allows 300 requests per
 *                       minute per IP, and each route load costs several.
 *
 * Safety rules baked in:
 *   - A control is skipped when its href points off the Dashboard origin.
 *   - A click that lands off the origin is recorded and then undone by
 *     navigating back; the audit never follows links off the app.
 *   - A dialog raised by a click is recorded and dismissed, never accepted.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_ROUTES,
  COLLECT,
  applyViewport,
  arg,
  attachDiagnostics,
  collectRoute,
  extendedCollectArgs,
  parseRoutes,
  parseViewport,
  routeSlug,
} from './lib/collect.mjs';

// The workspace this tool belongs to, derived from its own path: a hard-coded
// home directory belongs to the machine the harness was first written on, and on
// any other box `require('@playwright/test')` resolves against a tree that does
// not exist.
const WORKSPACE = process.env.UX_WORKSPACE || new URL('../..', import.meta.url).pathname;
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const OUT = arg('--out', '/tmp/ux/click-audit.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
const LIMIT = Number(arg('--limit', '10'));
const CLICK_TIMEOUT = Number(arg('--click-timeout', '5000'));
const SETTLE = Number(arg('--settle', '1500'));
const ROUTES = parseRoutes(arg('--routes'), DEFAULT_ROUTES);
// PIN THE VIEWPORT, AND PIN IT BY DEFAULT.
//
// Without it the browser keeps its own window size, and the sidebar's nav items
// then resolve, report themselves visible, enabled and stable — and sit outside
// the viewport that Playwright is allowed to click in. Every sidebar click fails
// with "element is outside of the viewport", which reads as 115 broken controls
// and produces a report with no writes in it. `--viewport 1280x720` makes the
// same clicks succeed; 1280x720 is the reference viewport the other sweeps pin
// (see tools/ux-sweep/README.md), so it is the default here too.
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const DELAY = Number(arg('--delay', '0'));
const SKIP_SHELL = process.argv.includes('--skip-shell');

// The whole run is destructive by construction, so the confirmation is a
// literal string. "disposable" is not a flag; it is the operator claiming the
// database behind this browser can be thrown away.
const CONFIRM = process.env.UX_CLICK_CONFIRM || '';
const ENABLED = CONFIRM === 'disposable';

/*
 * PACE THE RUN, OR THE OPERATOR'S OWN CEILING BECOMES A FINDING.
 *
 * The API prices a principal at 240 requests per minute
 * (`operational.interceptor.ts`, `LIMITS.user`), and every click in this audit
 * reloads the route before it presses. A 24-route write pass spends thousands of
 * requests, so the routes near the end are answered 429 and the audit records
 * `failedRequests: 429` — which reads exactly like a broken screen and is only
 * the harness spending the budget. Wait before a route load or a click reload
 * that would cross three quarters of it, and say so, so a slow run is legible.
 */
const SPENT_AT = [];
const BUDGET_PER_MINUTE = 240;
const PACING_CEILING = Math.floor(BUDGET_PER_MINUTE * 0.75);

async function pace(page, label) {
  const now = Date.now();
  const inWindow = SPENT_AT.filter((at) => at > now - 60_000);
  if (inWindow.length < PACING_CEILING) return;
  const freedAt = Math.min(...inWindow) + 60_000;
  const waitMs = Math.max(1_000, freedAt - now + 1_000);
  process.stderr.write(
    `  pacing before ${label}: ${inWindow.length} of ${BUDGET_PER_MINUTE} requests this minute ` +
      `are spent; waiting ${Math.round(waitMs / 1000)}s\n`,
  );
  await page.waitForTimeout(waitMs);
}

/** A link to somewhere else is not a Dashboard control, and clicking it is out of scope. */
function offOriginHref(href) {
  if (!href) return false;
  try {
    const resolved = new URL(href, BASE);
    return resolved.origin !== new URL(BASE).origin;
  } catch {
    return false;
  }
}

function decide(control) {
  if (control.disabled) return { click: false, why: 'disabled' };
  if (offOriginHref(control.href)) return { click: false, why: 'leaves the Dashboard origin' };
  if (control.destructive) return { click: false, why: control.destructiveReason || 'destructive' };
  return { click: true, why: null };
}

/*
 * THE SHELL IS ON EVERY ROUTE, SO IT EATS EVERY BUDGET.
 *
 * The sidebar comes first in DOM order, so the first N "safe" controls of every
 * route are the same N navigation items: a 24-route pass with `--limit 5` clicked
 * the sidebar 120 times, navigated 46 times, and wrote nothing — one real control
 * was never pressed in any screen. `--skip-shell` drops the chrome (`aside.side`,
 * `header.topbar`) from the click list, which is what makes the pass about the
 * screen. The shell's own controls are covered once, by the flow budgets.
 */
const SHELL_PREFIX = /^div#root > div\.app > (aside\.side|header\.topbar)\b/u;
function inShellChrome(control) {
  return SHELL_PREFIX.test(String(control.selector || ''));
}

/** Click one control by its DOM index and record everything that followed. */
async function clickOne(page, diagnostics, route, index, shotsDir) {
  const url = `${BASE}${route}`;
  await pace(page, `a click on ${route}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(SETTLE);
  // Re-stamp data-ux-audit so the index from the route collection still points
  // at the same control. A fresh load rebuilds the DOM in the same order.
  await page.evaluate(COLLECT, extendedCollectArgs()).catch(() => {});

  const target = page.locator(`[data-ux-audit="${index}"]`).first();
  const present = await target.count();
  if (!present) {
    return {
      clicked: false,
      result: 'control-not-found-after-reload',
      url: page.url(),
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      dialogs: [],
    };
  }

  const before = page.url();
  diagnostics.reset();
  let clicked = true;
  let clickError = null;
  try {
    await target.click({ timeout: CLICK_TIMEOUT, noWaitAfter: true });
  } catch (error) {
    clicked = false;
    // THE REASON SURVIVES, NOT JUST THE TIMEOUT. Playwright's message names the
    // actionability check that never passed ("element is outside of the viewport",
    // "element is not stable"), and that sentence is the difference between a
    // harness bug and a screen bug. 300 characters cut it off after "waiting for
    // el…" and cost a full re-run to read.
    clickError = (error?.message || String(error)).replace(/\u001b\[[0-9;]*m/gu, '').slice(0, 1500);
  }
  await page.waitForTimeout(750);

  const after = page.url();
  const offOrigin = (() => {
    try {
      return new URL(after).origin !== new URL(BASE).origin;
    } catch {
      return false;
    }
  })();
  const shot = shotsDir
    ? join(shotsDir, `${routeSlug(route)}__click-${String(index).padStart(2, '0')}.png`)
    : null;
  if (shot) await page.screenshot({ path: shot }).catch(() => {});

  const record = {
    clicked,
    result: clickError ? `click-failed: ${clickError}` : offOrigin ? 'navigated-off-origin' : 'ok',
    urlBefore: before,
    url: after,
    navigated: after !== before,
    consoleErrors: [...diagnostics.state.consoleErrors],
    pageErrors: [...diagnostics.state.pageErrors],
    failedRequests: [...diagnostics.state.failedRequests],
    dialogs: [...diagnostics.state.dialogs],
    shot,
  };

  // Undo whatever the click did so the next control is judged on its own.
  if (offOrigin || after !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  return record;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  await applyViewport(page, VIEWPORT);
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const diagnostics = attachDiagnostics(page);
  // ONLY THE API'S OWN CALLS SPEND THE BUDGET. The dev server ships the app as
  // ~200 unbundled modules, so counting every response made one page load look
  // like it had spent the whole minute and the audit then waited for a budget
  // nobody had touched.
  page.on('response', (response) => {
    try {
      if (new URL(response.url()).pathname.startsWith('/api')) SPENT_AT.push(Date.now());
    } catch {
      // A response with an unparseable URL is not an API call.
    }
  });

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    mode: ENABLED ? 'click' : 'classify-only',
    confirmation: ENABLED ? 'disposable' : null,
    limitPerRoute: LIMIT,
    routes: [],
  };

  for (const [i, route] of ROUTES.entries()) {
    if (i > 0 && DELAY > 0) await page.waitForTimeout(DELAY);
    await pace(page, route);
    const entry = await collectRoute(page, {
      route,
      base: BASE,
      diagnostics,
      extended: true,
      settleMs: SETTLE,
    });
    if (!entry.ok) {
      report.routes.push(entry);
      process.stderr.write(`${route} -> FAILED ${entry.error}\n`);
      continue;
    }

    if (SHOTS)
      await page.screenshot({ path: join(SHOTS, `${routeSlug(route)}.png`) }).catch(() => {});

    const controls = entry.elements.map((control) => ({
      index: control.auditIndex,
      name: control.name,
      role: control.role,
      tag: control.tag,
      inputType: control.inputType ?? null,
      selector: control.selector,
      href: control.href,
      width: control.width,
      height: control.height,
      disabled: control.disabled,
      classification: control.destructive ? 'destructive' : 'safe',
      destructiveFamily: control.destructiveFamily,
      destructiveReason: control.destructiveReason,
      decision: decide(control),
    }));

    const safe = controls.filter(
      (c) => !c.disabled && c.classification === 'safe' && !(SKIP_SHELL && inShellChrome(c)),
    );
    const record = {
      ok: true,
      route,
      url: entry.url,
      title: entry.title,
      heading: entry.heading,
      clickableCount: entry.clickableCount,
      degradedShell: entry.degradedShell || false,
      safeCount: safe.length,
      destructiveCount: controls.length - safe.length,
      consoleErrors: entry.consoleErrors,
      pageErrors: entry.pageErrors,
      failedRequests: entry.failedRequests,
      controls,
      clicks: [],
    };

    if (ENABLED) {
      const budget = Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : Infinity;
      let clicked = 0;
      for (const control of safe) {
        if (clicked >= budget) break;
        if (!control.decision.click) continue;
        const result = await clickOne(page, diagnostics, route, control.index, SHOTS);
        record.clicks.push({
          index: control.index,
          name: control.name,
          role: control.role,
          selector: control.selector,
          width: control.width,
          height: control.height,
          ...result,
        });
        clicked += 1;
      }
    }

    report.routes.push(record);
    process.stderr.write(
      `${route} -> ${record.clickableCount} controls, ${record.safeCount} safe, ${record.destructiveCount} destructive/disabled${entry.degradedShell ? ' [DEGRADED SHELL — API did not answer, count is not the screen]' : ''}` +
        (ENABLED ? `, ${record.clicks.length} clicked\n` : '\n'),
    );
  }
  diagnostics.detach();

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`\nwrote ${OUT} (${report.mode})\n`);

  if (MD) {
    const lines = [
      '# Click audit',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${report.base}`,
      `Mode: ${report.mode}${ENABLED ? '' : ' — nothing was clicked'}`,
      '',
      '| Route | Controls | Safe | Destructive/disabled | Clicked | Errors after click |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const r of report.routes) {
      if (!r.ok) {
        lines.push(`| \`${r.route}\` | FAILED | | | | ${r.error} |`);
        continue;
      }
      const errors = r.clicks.reduce(
        (sum, c) => sum + c.consoleErrors.length + c.pageErrors.length + c.failedRequests.length,
        0,
      );
      lines.push(
        `| \`${r.route}\` | ${r.clickableCount} | ${r.safeCount} | ${r.destructiveCount} | ${r.clicks.length} | ${errors} |`,
      );
    }
    if (ENABLED) {
      lines.push('', '## Click results', '');
      for (const r of report.routes) {
        if (!r.ok || !r.clicks.length) continue;
        lines.push(`### \`${r.route}\``, '');
        lines.push(
          '| # | Control | Size | Result | URL after | Errors | Dialog |',
          '| --- | --- | --- | --- | --- | --- | --- |',
        );
        for (const c of r.clicks) {
          const errors = c.consoleErrors.length + c.pageErrors.length + c.failedRequests.length;
          lines.push(
            `| ${c.index} | ${(c.name || '(unnamed)').replace(/\|/g, '\\|')} | ${c.width}x${c.height} | ${c.result} | \`${c.url || ''}\` | ${errors} | ${c.dialogs.length ? c.dialogs[0].type : '-'} |`,
          );
        }
        lines.push('');
      }
    }
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  // Close the harness's own tab: a left-open Dashboard tab keeps a stale session
  // alive and its failed refresh clears the shared localStorage session. The
  // attached browser itself is left open.
  await page.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
