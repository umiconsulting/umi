#!/usr/bin/env node
/**
 * Memory growth over a shift — Step F6 of the ultimate platform plan, the row
 * "Memory growth over a shift | `HeapProfiler`, `Memory`".
 *
 * The click inventory says what exists; `devtools-probe.mjs` says how one page
 * load performs. Neither can say whether the Dashboard gets heavier as an
 * operator keeps working. This drives the app the way a shift does — the same
 * few screens, over and over — while sampling the V8 heap and the DOM counters
 * from the DevTools `Performance`, `Memory`, and `HeapProfiler` domains.
 *
 * What it measures, and why two anchors:
 *   - The baseline sample is taken after `HeapProfiler.collectGarbage`, so it
 *     is what the tab *retains* at the start.
 *   - The samples in between are raw: a rising raw heap is normal, because the
 *     collector is lazy. Raw growth alone is not a leak.
 *   - The final sample forces GC again. The difference between the first and
 *     last GC-anchored sample is the part that looks retained; that is the
 *     number worth acting on. DOM node and event-listener counts cannot be
 *     argued away by a lazy collector, so they are read on every sample.
 *
 * Honesty note, printed in the output as well: a run of a few minutes can show
 * that memory grows or that it does not *in that window*. It cannot prove the
 * absence of a leak. Leaks that need a real shift — a cache keyed on data that
 * only accumulates over hours, a subscription re-created per navigation —
 * would not appear here. Read `--minutes 3` as "no leak visible under a
 * 3-minute navigation loop", never as "no leak".
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/memory-shift.mjs --minutes 3
 *
 * Flags:
 *   --minutes N      How long to drive the app. Default 3 — long enough to take
 *                    a dozen samples and see a trend on a normal machine, short
 *                    enough that a developer actually runs it. Use 30 or 60
 *                    for a shift-shaped answer.
 *   --interval <ms>  Sampling cadence. Default 15000.
 *   --delay <ms>     Pause between navigations. Default 3000: the API allows
 *                    300 requests/minute per IP and a Dashboard route load costs
 *                    several calls, so a tight loop trips it. A 429 is counted
 *                    and reported, never averaged away.
 *   --routes a,b,c   Screens to cycle through. Default the four an operator
 *                    touches most.
 *   --out / --md     Report paths.
 */

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyViewport, arg, parseRoutes, parseViewport } from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const MINUTES = Number(arg('--minutes', '3'));
const INTERVAL = Number(arg('--interval', '15000'));
const DELAY = Number(arg('--delay', '3000'));
const OUT = arg('--out', '/tmp/ux/memory.json');
const MD = arg('--md', '/tmp/ux/memory.md');
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const ROUTES = parseRoutes(arg('--routes'), ['/', '/operations', '/reportes', '/orders']);

const MB = 1048576;
const toMap = (metrics) =>
  Object.fromEntries((metrics.metrics || []).map((m) => [m.name, m.value]));

/**
 * Least-squares slope of `values` against minutes-since-first-sample. A slope
 * fitted over every sample resists one noisy reading in a way that
 * `(last - first) / minutes` does not; both are reported.
 */
function slopePerMinute(samples, pick) {
  const points = samples
    .map((s) => ({ x: (s.at - samples[0].at) / 60000, y: pick(s) }))
    .filter((p) => Number.isFinite(p.y));
  if (points.length < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
  const my = points.reduce((a, p) => a + p.y, 0) / points.length;
  const num = points.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const den = points.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  return den === 0 ? null : num / den;
}

const round = (n, places = 2) =>
  n === null || n === undefined || !Number.isFinite(n) ? null : +n.toFixed(places);

/** One reading of everything that should not grow if the app is steady. */
async function takeSample(cdp, page, label, { gc = false } = {}) {
  if (gc) {
    // Forced collection is the only way to tell garbage from retention. It is
    // deliberately not done in the middle of the run: the periodic samples are
    // meant to see the tab exactly as an operator would leave it.
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await page.waitForTimeout(500);
  }
  const metrics = toMap(await cdp.send('Performance.getMetrics'));
  const counters = await cdp.send('Memory.getDOMCounters').catch(() => null);
  return {
    label,
    at: Date.now(),
    url: page.url(),
    heapUsedMB: round((metrics.JSHeapUsedSize || 0) / MB, 1),
    heapTotalMB: round((metrics.JSHeapTotalSize || 0) / MB, 1),
    performanceNodes: metrics.Nodes ?? null,
    performanceDocuments: metrics.Documents ?? null,
    domNodes: counters?.nodes ?? null,
    domDocuments: counters?.documents ?? null,
    eventListeners: counters?.jsEventListeners ?? null,
    layoutCount: metrics.LayoutCount ?? null,
    recalcStyleCount: metrics.RecalcStyleCount ?? null,
    taskDurationMs: metrics.TaskDuration ? Math.round(metrics.TaskDuration * 1000) : null,
  };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  // A killed run used to leave its tab behind. Close it on the way out, however
  // the way out happens.
  const bail = () => {
    page
      .close()
      .catch(() => {})
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', bail);
  process.on('SIGTERM', bail);
  const previousViewport = await applyViewport(page, VIEWPORT);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  // A 429 is a fact about the run, not noise. Track it and say so, because a
  // screen that 429'd did not render and its memory story is not the app's.
  let rateLimited = 0;
  const onResponse = (r) => {
    if (r.status() === 429) rateLimited += 1;
  };
  page.on('response', onResponse);

  const samples = [];
  const startedAt = Date.now();
  const durationMs = Math.max(60000, MINUTES * 60000);

  // Warm up onto a real screen before the baseline. Taking the baseline on the
  // page's `about:blank` would anchor every later comparison to an empty
  // document, and the "retained across the run" delta would just measure the
  // first navigation.
  await page
    .goto(`${BASE}${ROUTES[0]}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  await page.waitForSelector('button.side-item, form, .card', { timeout: 15000 }).catch(() => {});

  samples.push(await takeSample(cdp, page, 'baseline (after forced GC)', { gc: true }));
  process.stderr.write(
    `baseline: heap ${samples[0].heapUsedMB}MB, DOM ${samples[0].domNodes} nodes, ` +
      `${samples[0].eventListeners} listeners\n`,
  );

  let lastSampleAt = Date.now();
  let navigations = 0;
  let index = 0;
  while (Date.now() - startedAt < durationMs) {
    const route = ROUTES[index % ROUTES.length];
    index += 1;
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for the shell, then do a little real work on the screen: the point
      // is to allocate like a user, not to sit on an idle page.
      await page
        .waitForSelector('button.side-item, form, .card', { timeout: 10000 })
        .catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(600);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      navigations += 1;
    } catch (error) {
      process.stderr.write(`navigation to ${route} failed: ${error?.message || error}\n`);
    }

    if (Date.now() - lastSampleAt >= INTERVAL) {
      const s = await takeSample(cdp, page, `t+${round((Date.now() - startedAt) / 60000, 1)}m`);
      samples.push(s);
      lastSampleAt = Date.now();
      process.stderr.write(
        `t+${round((Date.now() - startedAt) / 60000, 1)}m: heap ${s.heapUsedMB}MB, ` +
          `DOM ${s.domNodes} nodes, ${s.eventListeners} listeners\n`,
      );
    }
    if (DELAY > 0) await page.waitForTimeout(DELAY);
  }

  // Return to the screen the baseline was taken on before the final sample. A
  // comparison between the overview and whatever screen the loop happened to
  // stop on measures the screens' difference, not growth.
  await page
    .goto(`${BASE}${ROUTES[0]}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  await page.waitForSelector('button.side-item, form, .card', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const finalSample = await takeSample(cdp, page, 'final (after forced GC)', { gc: true });
  samples.push(finalSample);

  const elapsedMinutes = (finalSample.at - samples[0].at) / 60000;
  const raw = samples.slice(0, -1);
  const heapSlope = slopePerMinute(raw, (s) => s.heapUsedMB);
  const nodeSlope = slopePerMinute(raw, (s) => s.domNodes);
  const listenerSlope = slopePerMinute(raw, (s) => s.eventListeners);
  const retainedHeapDeltaMB = round(finalSample.heapUsedMB - samples[0].heapUsedMB, 1);
  const retainedNodeDelta = (finalSample.domNodes ?? 0) - (samples[0].domNodes ?? 0);
  const retainedListenerDelta =
    (finalSample.eventListeners ?? 0) - (samples[0].eventListeners ?? 0);

  // Thresholds are stated so a reader can disagree with them. They are not
  // "pass" lines: crossing one means "look at this", not "the app is broken".
  const HEAP_MB_PER_MIN = 1.5;
  const NODES_PER_MIN = 200;
  const LISTENERS_PER_MIN = 50;
  // A single fitted slope cannot tell a leak from a cache filling up. A screen
  // that allocates once and then holds steady has a large first-half slope and a
  // flat second half; a leak keeps climbing. Fitting both halves separates the
  // two, and the verdict below reports which one this run saw.
  const half = Math.floor(raw.length / 2);
  const firstHalf = raw.slice(0, half);
  const secondHalf = raw.slice(half);
  const tailSlopes =
    secondHalf.length >= 2
      ? {
          heapMB: round(slopePerMinute(secondHalf, (s) => s.heapUsedMB)),
          domNodes: round(
            slopePerMinute(secondHalf, (s) => s.domNodes),
            1,
          ),
          eventListeners: round(
            slopePerMinute(secondHalf, (s) => s.eventListeners),
            1,
          ),
        }
      : { heapMB: null, domNodes: null, eventListeners: null };
  const headSlopes =
    firstHalf.length >= 2
      ? {
          heapMB: round(slopePerMinute(firstHalf, (s) => s.heapUsedMB)),
          domNodes: round(
            slopePerMinute(firstHalf, (s) => s.domNodes),
            1,
          ),
          eventListeners: round(
            slopePerMinute(firstHalf, (s) => s.eventListeners),
            1,
          ),
        }
      : { heapMB: null, domNodes: null, eventListeners: null };

  const within = (value, threshold) => value === null || value <= threshold;
  const tailBounded =
    within(tailSlopes.heapMB, HEAP_MB_PER_MIN) &&
    within(tailSlopes.domNodes, NODES_PER_MIN) &&
    within(tailSlopes.eventListeners, LISTENERS_PER_MIN);
  const headBounded =
    within(headSlopes.heapMB, HEAP_MB_PER_MIN) &&
    within(headSlopes.domNodes, NODES_PER_MIN) &&
    within(headSlopes.eventListeners, LISTENERS_PER_MIN);
  const looksBounded = tailBounded && headBounded;
  const growthPhase = !tailBounded
    ? 'still growing'
    : headBounded
      ? 'flat'
      : 'front-loaded plateau';

  const windowMs = finalSample.at - samples[0].at;
  const shortWindow = elapsedMinutes < 10;

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    routes: ROUTES,
    requestedMinutes: MINUTES,
    elapsedMinutes: round(elapsedMinutes, 2),
    samplingIntervalMs: INTERVAL,
    navigationDelayMs: DELAY,
    navigations,
    rateLimit429s: rateLimited,
    thresholds: {
      heapMBPerMinute: HEAP_MB_PER_MIN,
      domNodesPerMinute: NODES_PER_MIN,
      eventListenersPerMinute: LISTENERS_PER_MIN,
    },
    samples,
    growthPerMinute: {
      heapMB: round(heapSlope),
      domNodes: round(nodeSlope, 1),
      eventListeners: round(listenerSlope, 1),
    },
    retainedAcrossRun: {
      heapMB: retainedHeapDeltaMB,
      domNodes: retainedNodeDelta,
      eventListeners: retainedListenerDelta,
      note: 'First and last sample are both taken after HeapProfiler.collectGarbage, so these deltas are retention, not lazy collection.',
    },
    headSlopes,
    tailSlopes,
    looksBounded,
    growthPhase,
    verdict:
      growthPhase === 'still growing'
        ? `still climbing at the end of this ${round(elapsedMinutes, 1)}-minute window (heap ${tailSlopes.heapMB} MB/min, DOM ${tailSlopes.domNodes}/min, listeners ${tailSlopes.eventListeners}/min in the second half) — investigate`
        : growthPhase === 'front-loaded plateau'
          ? `front-loaded then flat within this ${round(elapsedMinutes, 1)}-minute window: the first half climbed (heap ${headSlopes.heapMB} MB/min) and the second half stopped (heap ${tailSlopes.heapMB} MB/min). That is the shape of per-screen state being built once and kept, not of a per-navigation leak — but a short window cannot tell a cache from a slow leak.`
          : `flat within this ${round(elapsedMinutes, 1)}-minute window`,
    canProve: [
      `That heap, DOM node count, and listener count did or did not trend upward across ${round(elapsedMinutes, 1)} minutes of ${navigations} navigations.`,
      'That the last GC-forced reading retained more (or less) than the first, which is the part a lazy collector cannot explain.',
    ],
    cannotProve: [
      `That there is no leak. ${shortWindow ? `A ${round(elapsedMinutes, 1)}-minute window is short: ` : ''}a leak that only appears after a real shift (a cache keyed on accumulating data, a subscription rebuilt per navigation, slow growth under a few KB/min) would not show up here.`,
      'That production behaves the same. This is the Vite dev server on a desktop-class machine, with HMR clients attached.',
      rateLimited > 0
        ? `Anything about the ${rateLimited} request(s) the API answered with 429: those screens did not render normally.`
        : 'Nothing about rate limiting — no 429 was seen in this run.',
    ],
    windowMs,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# Memory over a shift',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${BASE} · routes: ${ROUTES.join(', ')}`,
      `Window: ${report.elapsedMinutes} min · ${navigations} navigations · ${samples.length} samples every ${INTERVAL} ms`,
      rateLimited > 0
        ? `**Rate limit: ${rateLimited} response(s) came back 429.** A screen that was rate-limited did not render; its readings are not the app's.`
        : 'Rate limit: no 429 seen.',
      '',
      '| Sample | t | Screen | Heap MB | Heap total MB | DOM nodes | Listeners | Documents | Layout count |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    const t0 = samples[0].at;
    for (const s of samples) {
      lines.push(
        `| ${s.label} | +${round((s.at - t0) / 60000, 1)}m | \`${new URL(s.url).pathname}\` | ${s.heapUsedMB} | ${s.heapTotalMB} | ${s.domNodes} | ${s.eventListeners} | ${s.domDocuments} | ${s.layoutCount} |`,
      );
    }
    lines.push(
      '',
      '## Growth',
      '',
      `Fitted over the raw samples (the lazily-collected ones, which is what a user actually experiences):`,
      '',
      `- Heap: **${report.growthPerMinute.heapMB} MB/min** (threshold ${HEAP_MB_PER_MIN})`,
      `- DOM nodes: **${report.growthPerMinute.domNodes}/min** (threshold ${NODES_PER_MIN})`,
      `- Event listeners: **${report.growthPerMinute.eventListeners}/min** (threshold ${LISTENERS_PER_MIN})`,
      '',
      `Split in half, because the two halves say different things:`,
      '',
      `| Window | Heap MB/min | DOM nodes/min | Listeners/min |`,
      `| --- | --- | --- | --- |`,
      `| first half | ${headSlopes.heapMB} | ${headSlopes.domNodes} | ${headSlopes.eventListeners} |`,
      `| second half | ${tailSlopes.heapMB} | ${tailSlopes.domNodes} | ${tailSlopes.eventListeners} |`,
      '',
      `Retention across the run, first GC-forced sample to last: heap **${retainedHeapDeltaMB} MB**, DOM nodes **${retainedNodeDelta}**, listeners **${retainedListenerDelta}**.`,
      '',
      `**Verdict: ${report.verdict}.**`,
      '',
      'What this run proves:',
      '',
      ...report.canProve.map((c) => `- ${c}`),
      '',
      'What it cannot prove:',
      '',
      ...report.cannotProve.map((c) => `- ${c}`),
    );
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  process.stderr.write(
    `\n${report.verdict}: heap ${report.growthPerMinute.heapMB} MB/min, ` +
      `DOM ${report.growthPerMinute.domNodes} nodes/min, listeners ${report.growthPerMinute.eventListeners}/min; ` +
      `retained over ${report.elapsedMinutes}m: heap ${retainedHeapDeltaMB}MB, DOM ${retainedNodeDelta}, listeners ${retainedListenerDelta}\n` +
      `wrote ${OUT}${rateLimited ? ` (${rateLimited} 429s seen)` : ''}\n`,
  );

  page.off('response', onResponse);
  if (VIEWPORT && previousViewport) await page.setViewportSize(previousViewport).catch(() => {});
  await page.close().catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
