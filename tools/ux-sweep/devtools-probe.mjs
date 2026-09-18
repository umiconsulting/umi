#!/usr/bin/env node
/**
 * Chrome DevTools Protocol probe for the Dashboard.
 *
 * The click inventory records what exists. This records how it performs. It
 * attaches to a running Chromium over CDP and, for each route, collects:
 *
 *   - paint and load timings from the Performance domain
 *   - JavaScript and CSS coverage, so dead code per screen is measurable
 *   - Runtime counters: DOM nodes, layout count, style recalculation, scripting
 *     time, and JS heap
 *   - console errors, failed requests, and the slowest responses
 *
 * Requires a Chromium started with --remote-debugging-port. The POS web build
 * works too, by setting UX_BASE.
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/devtools-probe.mjs --out /tmp/ux/perf.json
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const OUT = arg('--out', '/tmp/ux/perf.json');
const ROUTES = (arg('--routes') || '/,/operations,/reportes,/products,/inventory,/kitchen')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

/** Turn the flat Performance.getMetrics list into an object. */
const toMap = (metrics) =>
  Object.fromEntries((metrics.metrics || []).map((m) => [m.name, m.value]));

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Network.enable');

  const report = { generatedAt: new Date().toISOString(), base: BASE, routes: [] };

  for (const route of ROUTES) {
    const url = `${BASE}${route}`;
    const consoleErrors = [];
    const failed = [];
    const slow = [];
    const onConsole = (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200));
    const onResponse = (r) => {
      const req = r.request();
      const timing = r.request().timing();
      const ms =
        timing.responseEnd > 0 ? Math.round(timing.responseEnd - timing.requestStart) : null;
      if (ms !== null && ms > 300)
        slow.push({ url: r.url().slice(0, 120), status: r.status(), ms });
    };
    const onFailed = (r) =>
      failed.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText || ''}`);
    page.on('console', onConsole);
    page.on('response', onResponse);
    page.on('requestfailed', onFailed);

    let entry = { route, ok: true };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      await cdp.send('CSS.enable').catch(() => {});
      await cdp.send('CSS.startRuleUsageTracking').catch(() => {});
      await page.waitForTimeout(4000);

      const metrics = toMap(await cdp.send('Performance.getMetrics'));
      // First Contentful Paint is not a Performance.getMetrics counter in
      // current Chrome. Read it from the paint timing entries instead.
      const paint = await page
        .evaluate(() => {
          const entries = performance.getEntriesByType('paint') || [];
          const fcp = entries.find((e) => e.name === 'first-contentful-paint');
          const nav = performance.getEntriesByType('navigation')[0];
          return {
            fcp: fcp ? Math.round(fcp.startTime) : null,
            domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
            loadEvent: nav ? Math.round(nav.loadEventEnd) : null,
          };
        })
        .catch(() => ({ fcp: null, domContentLoaded: null, loadEvent: null }));
      const coverage = await cdp.send('Profiler.takePreciseCoverage');
      const cssUsage = await cdp.send('CSS.stopRuleUsageTracking').catch(() => ({}));
      await cdp.send('Profiler.stopPreciseCoverage').catch(() => {});

      let totalBytes = 0;
      let usedBytes = 0;
      for (const script of coverage.result || []) {
        for (const fn of script.functions) {
          const size = fn.ranges.reduce((sum, r) => sum + (r.endOffset - r.startOffset), 0);
          totalBytes += size;
          if (fn.ranges.some((r) => r.count > 0)) usedBytes += size;
        }
      }

      entry = {
        ok: true,
        route,
        url,
        js: {
          totalKB: Math.round(totalBytes / 1024),
          usedKB: Math.round(usedBytes / 1024),
          unusedPercent: totalBytes ? Math.round(((totalBytes - usedBytes) / totalBytes) * 100) : 0,
        },
        css: {
          rulesTracked: (cssUsage.ruleUsage || []).length,
          unusedRules: (cssUsage.ruleUsage || []).filter((r) => !r.used).length,
        },
        runtime: {
          domNodes: metrics.Nodes ?? null,
          jsHeapUsedMB: metrics.JSHeapUsedSize
            ? +(metrics.JSHeapUsedSize / 1048576).toFixed(1)
            : null,
          layoutCount: metrics.LayoutCount ?? null,
          recalcStyleCount: metrics.RecalcStyleCount ?? null,
          scriptDurationMs: metrics.ScriptDuration
            ? Math.round(metrics.ScriptDuration * 1000)
            : null,
          taskDurationMs: metrics.TaskDuration ? Math.round(metrics.TaskDuration * 1000) : null,
          firstContentfulPaintMs: metrics.FirstContentfulPaint
            ? Math.round(metrics.FirstContentfulPaint * 1000)
            : paint.fcp,
          loadEventMs: paint.loadEvent,
          domContentLoadedMs: metrics.DomContentLoaded
            ? Math.round(metrics.DomContentLoaded * 1000)
            : null,
        },
        consoleErrors,
        failedRequests: failed,
        slowResponses: slow.sort((a, b) => b.ms - a.ms).slice(0, 5),
      };
    } catch (error) {
      entry = { route, ok: false, error: (error?.message || String(error)).slice(0, 300) };
    }
    page.off('console', onConsole);
    page.off('response', onResponse);
    page.off('requestfailed', onFailed);
    report.routes.push(entry);
    process.stderr.write(
      entry.ok
        ? `${route}: FCP ${entry.runtime.firstContentfulPaintMs}ms, JS ${entry.js.usedKB}/${entry.js.totalKB}KB used, ${entry.js.unusedPercent}% unused, DOM ${entry.runtime.domNodes}, heap ${entry.runtime.jsHeapUsedMB}MB, errors ${entry.consoleErrors.length}\n`
        : `${route}: FAILED ${entry.error}\n`,
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`wrote ${OUT}\n`);
  // Close this run's tab; leaving it open leaks a Dashboard tab that keeps a
  // stale session alive. The attached browser itself stays open.
  await page.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
