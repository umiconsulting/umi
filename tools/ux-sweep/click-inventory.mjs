#!/usr/bin/env node
/**
 * Click inventory for the Umi Dashboard and UmiPOS web build.
 *
 * Connects to a running Chromium over CDP, walks a list of routes, and records
 * every interactive element on each screen: accessible name, role, hit-target
 * size, visibility, and a stable selector. The audit data answers three
 * questions that a route list cannot answer:
 *
 *   1. What can an operator actually click on this screen?
 *   2. Which controls have no accessible name (screen readers and agents both
 *      fail on those)?
 *   3. Which hit targets are smaller than the 44x44 touch minimum?
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/click-inventory.mjs --out /tmp/ux/inventory.json
 *
 * Flags:
 *   --out <path>     Write the JSON report here.
 *   --md <path>      Write a markdown summary here.
 *   --routes a,b,c   Override the route list.
 *   --shots <dir>    Save a screenshot per route.
 *   --viewport WxH   Pin the viewport (e.g. 1280x720) for a reproducible count.
 *   --delay <ms>     Pause between routes (the API allows 300 requests/minute
 *                    per IP; a bare sweep of 22 routes can trip it).
 *
 * The script never clicks. It only reads the DOM. Clicking lives in
 * click-audit.mjs, which needs explicit opt-in because most screens mutate data.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DEFAULT_ROUTES,
  applyViewport,
  arg,
  attachDiagnostics,
  collectRoute,
  hasFlag,
  parseRoutes,
  parseViewport,
} from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const OUT = arg('--out', '/tmp/ux/inventory.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
// Flutter web paints to a canvas. The accessibility tree only exists after the
// engine is told to build it, which the semantics placeholder triggers.
const FLUTTER = hasFlag('--flutter');
const ROUTES = parseRoutes(arg('--routes'), DEFAULT_ROUTES);
const VIEWPORT = parseViewport(arg('--viewport', null));
const DELAY = Number(arg('--delay', '0'));

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  const previousViewport = await applyViewport(page, VIEWPORT);
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const diagnostics = attachDiagnostics(page);

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    routes: [],
  };

  for (const [i, route] of ROUTES.entries()) {
    if (i > 0 && DELAY > 0) await page.waitForTimeout(DELAY);
    const entry = await collectRoute(page, { route, base: BASE, diagnostics, flutter: FLUTTER });
    if (entry.ok && SHOTS)
      await page.screenshot({ path: join(SHOTS, `${route.replace(/\W+/g, '_') || 'root'}.png`) });
    report.routes.push(entry);
    process.stderr.write(
      `${route} -> ${
        entry.ok
          ? `${entry.clickableCount} clickable, ${entry.unnamed} unnamed, ${entry.smallTargets} small${entry.degradedShell ? ' [DEGRADED SHELL — API did not answer, count is not the screen]' : ''}`
          : `FAILED ${entry.error}`
      }\n`,
    );
  }

  diagnostics.detach();
  if (VIEWPORT && previousViewport) await page.setViewportSize(previousViewport).catch(() => {});

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`\nwrote ${OUT}\n`);

  if (MD) {
    const lines = [
      '# Click inventory',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${report.base}`,
      '',
      '| Route | Clickable | Unnamed | Targets < 44px | Disabled | Console errors |',
      '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const r of report.routes) {
      lines.push(
        r.ok
          ? `| \`${r.route}\` | ${r.clickableCount} | ${r.unnamed} | ${r.smallTargets} | ${r.disabledCount} | ${r.consoleErrors.length} |`
          : `| \`${r.route}\` | FAILED | | | | ${r.error} |`,
      );
    }
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }
  // Close the harness's own tab before exiting. It used to be left open, and
  // every run leaked a Dashboard tab whose stale session kept calling refresh —
  // which, once the refresh cookie died, cleared the shared localStorage session
  // for every other tab. The browser itself stays open.
  await page.close().catch(() => {});
  // The CDP connection keeps the event loop alive. Exit on purpose so the
  // caller's shell prompt returns. The attached browser stays open.
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
