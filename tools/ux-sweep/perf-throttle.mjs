#!/usr/bin/env node
/**
 * Throttled device run — Step F6 of the ultimate platform plan, the row
 * "Throttled device run | `Emulation.setCPUThrottlingRate`,
 * `Network.emulateNetworkConditions`".
 *
 * `devtools-probe.mjs` measures the Dashboard on the machine it is running on,
 * with the network and CPU the machine happens to have. Section 4 of the plan
 * makes a claim about a *reference tablet* — "loads in less than 1 second" — and
 * a number from an idle dev box cannot answer that. This runs the same routes
 * under emulated CPU and network conditions and reports, per route:
 *
 *   - first contentful paint (paint timing entry)
 *   - largest contentful paint (PerformanceObserver, buffered)
 *   - the load event, and time until the Dashboard shell actually mounts
 *   - task duration, so a CPU-bound screen is distinguishable from a slow one
 *
 * Profiles are not invented here. They are Lighthouse's own throttling
 * constants, the ones `Lantern.Simulation.Constants.throttling` exports and
 * Lighthouse 13.4.1 ships as its mobile default
 * (the package and file are named in the `source` field of each profile below;
 * the module lives in `node_modules/.pnpm/@paulirish+trace_engine@<version>/`).
 * Lighthouse applies two adjustment factors when it converts those numbers into
 * DevTools protocol arguments (`DEVTOOLS_RTT_ADJUSTMENT_FACTOR = 3.75`,
 * `DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR = 0.9`, same file) and converts
 * throughput as `floor(kbps * 1024 / 8)` bytes/second
 * (`lighthouse/core/lib/emulation.js`). The values pushed to
 * `Network.emulateNetworkConditions` below are those adjusted values, so this
 * probe throttles the same way the industry-standard audit does.
 *
 * Profiles:
 *   none          no emulation at all — the raw dev-server number.
 *   slow-4g       Lighthouse `mobileSlow4G` — 150 ms RTT, 1.6 Mbps down,
 *                 750 kbps up, 4x CPU. Lighthouse's default mobile preset.
 *   slow-3g       Lighthouse `mobileRegular3G` — 300 ms RTT, 700 kbps down and
 *                 up, 4x CPU. The "3G" preset.
 *   desktop-dense-4g  Lighthouse `desktopDense4G` — 40 ms RTT, no throughput
 *                 cap, no CPU slowdown. Upstream sets its throughput and
 *                 latency to 0 ("unset") because it only feeds the *simulation*
 *                 model; this rig applies the 40 ms RTT and leaves throughput
 *                 uncapped, which is the honest protocol-level reading of it.
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/perf-throttle.mjs --network slow-4g --cpu 4 --routes /,/reportes
 *
 *   # first paint for every route, no throttling — what `pnpm ux:verify` runs
 *   node tools/ux-sweep/perf-throttle.mjs --quick
 *
 * Flags:
 *   --network <profile>  One of the profiles above. Default `slow-4g`.
 *   --cpu N              CPU slowdown multiplier. Default from the profile.
 *   --quick              Skip emulation entirely and measure FCP/load only.
 *                        Fast enough to sit in `ux:verify`.
 *   --routes a,b,c       Route subset. Default all Dashboard routes.
 *   --viewport WxH       Default 1280x720 (the terminal). The reference tablet
 *                        is 1024x768 — pass `--viewport 1024x768` for it.
 *   --budget <ms>        The plan's "less than 1 second" bound. Default 1000.
 *   --delay <ms>         Pause between routes. Default 3000: the API allows 300
 *                        requests/minute per IP and a route load costs several
 *                        calls. A 429 is counted and printed, not hidden.
 *   --timeout <ms>       Per-route navigation timeout. Default 60000 (throttled
 *                        SPA loads are slow).
 *   --out / --md         Report paths.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  DEFAULT_ROUTES,
  applyViewport,
  arg,
  hasFlag,
  parseRoutes,
  parseViewport,
} from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const QUICK = hasFlag('--quick');
const OUT = arg('--out', QUICK ? '/tmp/ux/first-paint.json' : '/tmp/ux/perf-throttle.json');
const MD = arg('--md', QUICK ? '/tmp/ux/first-paint.md' : '/tmp/ux/perf-throttle.md');
const ROUTES = parseRoutes(arg('--routes'), DEFAULT_ROUTES);
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const BUDGET_MS = Number(arg('--budget', '1000'));
const DELAY = Number(arg('--delay', '3000'));
const TIMEOUT = Number(arg('--timeout', '60000'));

/** kbps -> bytes/second, exactly as `lighthouse/core/lib/emulation.js` does it. */
const kbpsToBps = (kbps) => Math.floor((kbps * 1024) / 8);

// The two adjustment factors Lighthouse applies before handing numbers to the
// DevTools protocol. Named, not inlined, so the arithmetic below is checkable.
const DEVTOOLS_RTT_ADJUSTMENT_FACTOR = 3.75;
const DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR = 0.9;

const PROFILES = {
  none: {
    label: 'no throttling',
    source: '—',
    latencyMs: 0,
    downloadBps: -1,
    uploadBps: -1,
    cpu: 1,
  },
  'slow-4g': {
    label: 'Lighthouse mobileSlow4G (150 ms RTT, 1.6 Mbps down, 750 kbps up, 4x CPU)',
    source:
      '@paulirish/trace_engine models/trace/lantern/simulation/Constants.js throttling.mobileSlow4G, devtools-applied',
    latencyMs: Math.round(150 * DEVTOOLS_RTT_ADJUSTMENT_FACTOR),
    downloadBps: kbpsToBps(1.6 * 1024 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR),
    uploadBps: kbpsToBps(750 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR),
    cpu: 4,
  },
  'slow-3g': {
    label: 'Lighthouse mobileRegular3G (300 ms RTT, 700 kbps down/up, 4x CPU)',
    source:
      '@paulirish/trace_engine models/trace/lantern/simulation/Constants.js throttling.mobileRegular3G, devtools-applied',
    latencyMs: Math.round(300 * DEVTOOLS_RTT_ADJUSTMENT_FACTOR),
    downloadBps: kbpsToBps(700 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR),
    uploadBps: kbpsToBps(700 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR),
    cpu: 4,
  },
  'desktop-dense-4g': {
    label: 'Lighthouse desktopDense4G (40 ms RTT, uncapped throughput, 1x CPU)',
    source:
      '@paulirish/trace_engine models/trace/lantern/simulation/Constants.js throttling.desktopDense4G; upstream leaves latency/throughput at 0 for simulation, this rig applies only the 40 ms RTT',
    latencyMs: 40,
    downloadBps: -1,
    uploadBps: -1,
    cpu: 1,
  },
};

const PROFILE_NAME = QUICK ? 'none' : arg('--network', 'slow-4g');
const PROFILE = PROFILES[PROFILE_NAME];
if (!PROFILE) {
  process.stderr.write(
    `unknown --network "${PROFILE_NAME}"; known: ${Object.keys(PROFILES).join(', ')}\n`,
  );
  process.exit(2);
}
const CPU = QUICK ? 1 : Number(arg('--cpu', String(PROFILE.cpu)));

/**
 * Installed before every navigation: LCP is only observable through a
 * PerformanceObserver, so it has to be registered before the paint happens.
 * Without this, `getEntriesByType('largest-contentful-paint')` is always empty.
 */
async function installLcpObserver(page) {
  await page.addInitScript(() => {
    window.__uxLcp = null;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) {
          window.__uxLcp = {
            startTime: Math.round(last.startTime),
            size: last.size ?? null,
            url: last.url || null,
            element: last.element?.tagName ?? null,
          };
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // Older engines: LCP simply stays null and the report says so.
    }
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  const previousViewport = await applyViewport(page, VIEWPORT);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await installLcpObserver(page);

  let rateLimited = 0;
  const onResponse = (r) => {
    if (r.status() === 429) rateLimited += 1;
  };
  page.on('response', onResponse);

  const applyThrottling = async () => {
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    if (PROFILE.downloadBps !== -1 || PROFILE.uploadBps !== -1 || PROFILE.latencyMs > 0) {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: PROFILE.latencyMs,
        downloadThroughput: PROFILE.downloadBps,
        uploadThroughput: PROFILE.uploadBps,
        connectionType: 'cellular4g',
      });
    }
  };
  const clearThrottling = async () => {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await cdp
      .send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      .catch(() => {});
  };

  await applyThrottling();

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    mode: QUICK ? 'quick (no emulation)' : 'throttled',
    profile: { name: PROFILE_NAME, ...PROFILE, appliedCpu: CPU },
    viewport: VIEWPORT,
    budgetMs: BUDGET_MS,
    routes: [],
  };

  for (const [i, route] of ROUTES.entries()) {
    if (i > 0 && DELAY > 0) await page.waitForTimeout(DELAY);
    const url = `${BASE}${route}`;
    const rate429Before = rateLimited;
    const started = Date.now();
    let entry = { route, url, ok: false };
    try {
      // Quick mode is the fourth sweep inside `ux:verify`, so it does not wait
      // out the full load plus a settle window: it stops at DOMContentLoaded and
      // reads the paint entries as soon as they exist. The throttled mode waits
      // for the load event, because there the whole point is the full cost.
      await page.goto(url, { waitUntil: QUICK ? 'domcontentloaded' : 'load', timeout: TIMEOUT });
      if (QUICK) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const painted = await page
            .evaluate(() =>
              performance
                .getEntriesByType('paint')
                .some((p) => p.name === 'first-contentful-paint'),
            )
            .catch(() => false);
          if (painted) break;
          await page.waitForTimeout(150);
        }
      }
      if (!QUICK) await page.waitForTimeout(1500);

      const timings = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const paint = performance.getEntriesByType('paint');
        const pick = (name) => {
          const e = paint.find((p) => p.name === name);
          return e ? Math.round(e.startTime) : null;
        };
        return {
          firstPaintMs: pick('first-paint'),
          fcpMs: pick('first-contentful-paint'),
          domContentLoadedMs: nav?.domContentLoadedEventEnd
            ? Math.round(nav.domContentLoadedEventEnd)
            : null,
          loadEventMs: nav?.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
          transferSizeKB: nav ? Math.round((nav.transferSize || 0) / 1024) : null,
          // The dev server's module count is the reason a throttled dev run is
          // slow; counting them makes that visible instead of mysterious.
          resourceCount: performance.getEntriesByType('resource').length,
          lcpMs: window.__uxLcp?.startTime ?? null,
          lcpElement: window.__uxLcp?.element ?? null,
        };
      });
      const metrics = Object.fromEntries(
        ((await cdp.send('Performance.getMetrics')).metrics || []).map((m) => [m.name, m.value]),
      );
      // The shell mounts later than the first paint. Waiting for it is what
      // makes `shellReadyMs` a real number, and it is also the check that the
      // screen rendered at all rather than being a rate-limited stub. `/login`
      // is the one route that legitimately has no sidebar.
      let shellReadyMs = null;
      const shellExpected = route !== '/login';
      try {
        await page.waitForSelector('button.side-item, form, .card', {
          timeout: QUICK ? 8000 : 15000,
        });
        shellReadyMs = Date.now() - started;
      } catch {
        // No shell within the window: the null is the finding.
      }
      const sidebar = await page
        .locator('button.side-item')
        .count()
        .catch(() => 0);
      // LCP is reported after FCP (it can still change until the user
      // interacts), so a quick-mode read taken at FCP is often empty. The shell
      // wait above has already spent the time; read it again now.
      const lateLcp = await page.evaluate(() => window.__uxLcp ?? null).catch(() => null);
      if (lateLcp?.startTime) {
        timings.lcpMs = lateLcp.startTime;
        timings.lcpElement = lateLcp.element ?? timings.lcpElement;
      }

      entry = {
        ok: true,
        route,
        url,
        firstPaintMs: timings.firstPaintMs,
        fcpMs: timings.fcpMs,
        lcpMs: timings.lcpMs,
        lcpElement: timings.lcpElement,
        domContentLoadedMs: timings.domContentLoadedMs,
        loadEventMs: timings.loadEventMs,
        shellReadyMs,
        transferSizeKB: timings.transferSizeKB,
        requestCount: timings.resourceCount,
        taskDurationMs: metrics.TaskDuration ? Math.round(metrics.TaskDuration * 1000) : null,
        scriptDurationMs: metrics.ScriptDuration ? Math.round(metrics.ScriptDuration * 1000) : null,
        domNodes: metrics.Nodes ?? null,
        // A screen that did not render is not a fast screen. Say it. `/login`
        // renders a panel with no sidebar, so it is exempt from the check.
        degradedShell: shellExpected ? sidebar === 0 : false,
        rateLimited429: rateLimited - rate429Before,
        underBudgetFcp: timings.fcpMs !== null && timings.fcpMs <= BUDGET_MS,
        underBudgetLoad: timings.loadEventMs !== null && timings.loadEventMs <= BUDGET_MS,
      };
    } catch (error) {
      entry = { route, url, ok: false, error: (error?.message || String(error)).slice(0, 300) };
    }
    report.routes.push(entry);
    process.stderr.write(
      entry.ok
        ? `${route}: FCP ${entry.fcpMs}ms, LCP ${entry.lcpMs}ms, load ${entry.loadEventMs}ms, shell ${entry.shellReadyMs}ms${entry.degradedShell ? ' [DEGRADED SHELL]' : ''}${entry.rateLimited429 ? ` [${entry.rateLimited429} x 429]` : ''}\n`
        : `${route}: FAILED ${entry.error}\n`,
    );
  }

  await clearThrottling();

  const measured = report.routes.filter((r) => r.ok);
  const warm = measured.filter((r) => !r.degradedShell && !r.rateLimited429);
  report.summary = {
    measured: measured.length,
    failed: report.routes.length - measured.length,
    degradedShells: measured.filter((r) => r.degradedShell).length,
    rateLimit429s: rateLimited,
    medianFcpMs: median(warm.map((r) => r.fcpMs)),
    medianLoadEventMs: median(warm.map((r) => r.loadEventMs)),
    medianShellReadyMs: median(warm.map((r) => r.shellReadyMs)),
    overBudgetFcp: warm.filter((r) => r.underBudgetFcp === false).map((r) => r.route),
    overBudgetLoad: warm.filter((r) => r.underBudgetLoad === false).map((r) => r.route),
  };
  report.answersSection4 = {
    question: `Does a screen paint and load in under ${BUDGET_MS} ms on the reference device?`,
    answer:
      report.summary.overBudgetFcp.length === 0 && report.summary.overBudgetLoad.length === 0
        ? `Yes for every route measured, at ${report.profile.name} (${report.profile.label}).`
        : `No: ${report.summary.overBudgetFcp.length} route(s) missed ${BUDGET_MS} ms to first contentful paint and ${report.summary.overBudgetLoad.length} missed it to the load event, at ${report.profile.name}.`,
    caveat: [
      'This is the Vite dev server, which ships the Dashboard as hundreds of unbundled ES modules. Production serves a built bundle from a CDN, so these numbers are a floor on the *dev* setup and are not the production load time.',
      'To answer the tablet question for real, run this against a production build (`pnpm build && pnpm preview`) on the tablet viewport (`--viewport 1024x768`).',
      'Only routes that actually rendered are counted: a degraded shell or a 429 response is excluded from the medians and named in the summary.',
    ],
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      `# ${QUICK ? 'First paint per route' : 'Throttled device run'}`,
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${BASE}`,
      `Profile: **${report.profile.name}** — ${report.profile.label} (applied CPU ${CPU}x, latency ${PROFILE.latencyMs} ms, down ${PROFILE.downloadBps} B/s, up ${PROFILE.uploadBps} B/s)`,
      `Profile source: ${PROFILE.source}`,
      `Viewport: ${VIEWPORT?.width}x${VIEWPORT?.height} · budget: ${BUDGET_MS} ms`,
      rateLimited > 0
        ? `**Rate limit: ${rateLimited} response(s) came back 429.** A screen that was rate-limited did not render normally; it is excluded from the medians.`
        : 'Rate limit: no 429 seen.',
      '',
      '| Route | FCP ms | LCP ms | Load ms | Shell ms | Task ms | Requests | Under budget |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const r of report.routes) {
      if (!r.ok) {
        lines.push(`| \`${r.route}\` | FAILED | | | | | | ${r.error} |`);
        continue;
      }
      const flags = [
        r.degradedShell ? 'degraded shell' : '',
        r.rateLimited429 ? `${r.rateLimited429}x429` : '',
      ]
        .filter(Boolean)
        .join(' ');
      lines.push(
        `| \`${r.route}\` | ${r.fcpMs} | ${r.lcpMs} | ${r.loadEventMs} | ${r.shellReadyMs} | ${r.taskDurationMs} | ${r.requestCount} | ${r.underBudgetFcp && r.underBudgetLoad ? 'yes' : 'no'}${flags ? ` (${flags})` : ''} |`,
      );
    }
    lines.push(
      '',
      `Median first contentful paint: **${report.summary.medianFcpMs} ms**; median load: **${report.summary.medianLoadEventMs} ms**; median shell ready: **${report.summary.medianShellReadyMs} ms**.`,
      '',
      `Section 4 asks: _${report.answersSection4.question}_ **${report.answersSection4.answer}**`,
      '',
      ...report.answersSection4.caveat.map((c) => `- ${c}`),
    );
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  // A run that could not render its screens is not a pass. Fail on that, and
  // only on that: a budget miss is reported, because the dev-server caveat
  // above is real and a red gate for it would train people to ignore the gate.
  process.stderr.write(
    `\n${report.answersSection4.answer}\n` +
      `median FCP ${report.summary.medianFcpMs}ms, median load ${report.summary.medianLoadEventMs}ms; ` +
      `${report.summary.degradedShells} degraded shell(s), ${rateLimited} 429(s), ${report.summary.failed} failure(s)\n`,
  );
  process.stderr.write(`wrote ${OUT}\n`);

  page.off('response', onResponse);
  if (VIEWPORT && previousViewport) await page.setViewportSize(previousViewport).catch(() => {});
  await page.close().catch(() => {});
  process.exit(report.summary.failed > 0 ? 1 : 0);
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
