#!/usr/bin/env node
/**
 * A full flow trace — Step F6 of the ultimate platform plan, the row
 * "A full flow trace | `Tracing` domain".
 *
 * Records one real operator flow (land on the Dashboard, move between screens
 * through the sidebar the way a person does) with the DevTools `Tracing`
 * domain, and writes a Chrome Trace Event JSON file. The trace is the artifact
 * you open when a screen *feels* slow but the paint numbers look fine: it shows
 * what the renderer was doing for every millisecond of the flow, including the
 * work between the clicks.
 *
 * The output is the standard Trace Event Format, so both viewers accept it:
 *
 *   chrome://tracing            -> Load -> pick the file
 *   https://ui.perfetto.dev     -> Open trace file -> pick the file
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/trace-flow.mjs --trace-out /tmp/ux/trace-overview-reportes.json
 *
 * Flags:
 *   --trace                Explicit opt-in to tracing (the flag the plan names).
 *                          The script is the trace mode, so it is redundant;
 *                          it is accepted so the documented command works.
 *   --trace-out <path>     Where the Chrome trace JSON goes. Default
 *                          /tmp/ux/trace-<timestamp>.json
 *   --flow <name>          Which flow to record. Currently `dashboard-nav`
 *                          (default): overview -> reports -> orders -> overview.
 *   --out / --md           Summary report paths.
 *   --delay <ms>           Pause between clicks inside the flow. Default 1500.
 *   --viewport WxH         Default 1280x720, the reference terminal.
 */

import { createRequire } from 'node:module';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyViewport, arg, hasFlag, parseViewport } from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

// The plan names a `--trace` mode; this script is that mode. Accept the flag so
// the documented command works, and note that it changes nothing.
const TRACE_FLAG = hasFlag('--trace');
const TRACE_OUT = arg(
  '--trace-out',
  `/tmp/ux/trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
const OUT = arg('--out', '/tmp/ux/trace.json');
const MD = arg('--md', '/tmp/ux/trace.md');
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const DELAY = Number(arg('--delay', '1500'));
const FLOW_NAME = arg('--flow', 'dashboard-nav');

/**
 * Tracing categories: the set Chrome DevTools' own Performance panel records,
 * minus the screenshot category. Frames are a separate instrument here
 * (`trace-screencast.mjs`), and including screenshots would multiply the file
 * size for a payload this file is not meant to carry.
 */
const TRACE_CATEGORIES = [
  '-*',
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'latencyInfo',
  'loading',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-v8.cpu_profiler',
].join(',');

/**
 * The flow: real clicks on the real sidebar, returning to the starting screen.
 *
 * `expand: true` marks a parent group. In the Dashboard's sidebar a parent group
 * is a pure disclosure control — `shell.jsx` toggles it and returns, and only a
 * nested `.side-subitem` navigates — so a flow that clicks "Reports" and expects
 * to land on a screen is wrong about the app. The flow therefore expands the
 * group and then clicks the child, which is what an operator does.
 */
const FLOWS = {
  'dashboard-nav': [
    { kind: 'goto', route: '/' },
    { kind: 'click', label: 'Reports', expand: true },
    { kind: 'click', label: 'Sales', subitem: true },
    { kind: 'click', label: 'Orders' },
    { kind: 'click', label: 'Overview' },
  ],
};

const STEPS = FLOWS[FLOW_NAME];
if (!STEPS) {
  process.stderr.write(`unknown --flow "${FLOW_NAME}"; known: ${Object.keys(FLOWS).join(', ')}\n`);
  process.exit(2);
}

/** Count events by a key, descending. */
function tally(events, pick) {
  const counts = new Map();
  for (const e of events) {
    const key = pick(e);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  const previousViewport = await applyViewport(page, VIEWPORT);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');

  let rateLimited = 0;
  const onResponse = (r) => {
    if (r.status() === 429) rateLimited += 1;
  };
  page.on('response', onResponse);

  // Land on the entry route before tracing starts, so the recorded window is
  // the flow itself rather than the cold start of whatever page happened to be
  // open in the shared browser.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('button.side-item, form, .card', { timeout: 15000 }).catch(() => {});

  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const tracingComplete = new Promise((resolve) => cdp.on('Tracing.tracingComplete', resolve));

  await cdp.send('Tracing.start', {
    categories: TRACE_CATEGORIES,
    transferMode: 'ReportEvents',
  });

  const startedAt = Date.now();
  const steps = [];
  for (const step of STEPS) {
    const t0 = Date.now();
    const urlBefore = page.url();
    let ok = true;
    let detail = null;
    try {
      if (step.kind === 'goto') {
        await page.goto(`${BASE}${step.route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        detail = page.url();
      } else {
        // Clicking the sidebar is a pure navigation — it cannot write data.
        // A parent group is a disclosure toggle, so it is addressed by its own
        // selector and its child subitems by theirs.
        const selector = step.subitem
          ? 'button.side-item.side-subitem'
          : 'button.side-item:not(.side-subitem)';
        await page
          .locator(selector)
          .filter({ hasText: new RegExp(`^\\s*${step.label}\\s*$`, 'i') })
          .first()
          .click({ timeout: 10000 });
        await page.waitForTimeout(2000);
        detail = page.url();
      }
    } catch (error) {
      ok = false;
      detail = (error?.message || String(error)).slice(0, 200);
    }
    steps.push({
      ...step,
      ok,
      detail,
      urlBefore,
      navigated: page.url() !== urlBefore,
      ms: Date.now() - t0,
    });
    process.stderr.write(
      `${step.kind === 'goto' ? 'goto ' : 'click'} ${step.route || step.label}: ${
        ok
          ? step.expand && page.url() === urlBefore
            ? 'ok (disclosure toggle, no navigation — expected)'
            : `ok (${detail})`
          : `FAILED ${detail}`
      }\n`,
    );
    if (DELAY > 0) await page.waitForTimeout(DELAY);
  }

  await cdp.send('Tracing.end');
  // `Tracing.tracingComplete` arrives only after every `dataCollected`. Race it
  // against a timeout so a wedged renderer cannot hang the harness forever.
  await Promise.race([tracingComplete, page.waitForTimeout(30000)]);
  const flowMs = Date.now() - startedAt;

  const trace = {
    traceEvents: events,
    metadata: {
      source: 'tools/ux-sweep/trace-flow.mjs',
      flow: FLOW_NAME,
      base: BASE,
      recordedAt: new Date().toISOString(),
      categories: TRACE_CATEGORIES,
      viewport: VIEWPORT,
    },
  };
  await mkdir(dirname(TRACE_OUT), { recursive: true });
  await writeFile(TRACE_OUT, JSON.stringify(trace));
  const { size } = await stat(TRACE_OUT);

  const byName = tally(events, (e) => e.name);
  const byCategory = tally(events, (e) => e.cat);
  const byPhase = tally(events, (e) => e.ph);
  const byProcess = tally(events, (e) => e.pid);
  // Folded, not spread: a minute-long trace carries six figures of events and
  // `Math.max(...ts)` blows the argument limit ("Maximum call stack size
  // exceeded") long before it returns a number.
  let tsMin = Infinity;
  let tsMax = -Infinity;
  let tsCount = 0;
  for (const e of events) {
    // Metadata events (`ph: "M"`) are emitted with `ts: 0` beside the real
    // timeline. Including them says the flow lasted ten hours.
    if (e.ph === 'M' || !Number.isFinite(e.ts) || e.ts === 0) continue;
    tsCount += 1;
    if (e.ts < tsMin) tsMin = e.ts;
    if (e.ts > tsMax) tsMax = e.ts;
  }
  const recordSpanMs = tsCount > 1 ? Math.round((tsMax - tsMin) / 1000) : null;

  // Captured once: `Tracing.dataCollected` can still deliver a straggler after
  // the completion event, and a count that changes between two reads of the
  // same array reads like two different runs.
  const eventCount = events.length;
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    flow: FLOW_NAME,
    traceFlagAccepted: TRACE_FLAG,
    traceOut: TRACE_OUT,
    traceBytes: size,
    traceMB: +(size / 1048576).toFixed(2),
    flowWallClockMs: flowMs,
    recordedSpanMs: recordSpanMs,
    eventCount,
    steps,
    rateLimit429s: rateLimited,
    topEventNames: byName.slice(0, 15).map(([name, count]) => ({ name, count })),
    topCategories: byCategory.slice(0, 15).map(([cat, count]) => ({ cat, count })),
    phases: byPhase.map(([ph, count]) => ({ phase: ph, count })),
    processes: byProcess.length,
    open: {
      chrome: 'chrome://tracing -> Load -> select the file',
      perfetto: 'https://ui.perfetto.dev -> Open trace file -> select the file',
      file: TRACE_OUT,
    },
    caveats: [
      'The trace is the dev server. Production module loading looks different.',
      rateLimited > 0
        ? `${rateLimited} response(s) were 429s during the flow; a rate-limited resource did not load, so part of the trace is the app failing to fetch.`
        : 'No 429 was seen during the flow.',
    ],
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  if (MD) {
    const lines = [
      '# Flow trace',
      '',
      `Generated: ${report.generatedAt}`,
      `Flow: \`${FLOW_NAME}\` · base ${BASE}`,
      `Recorded span: ${recordSpanMs} ms · wall clock ${flowMs} ms · **${eventCount} events** in ${report.traceMB} MB`,
      '',
      `Trace file: \`${TRACE_OUT}\``,
      '',
      'Open it with either viewer:',
      '',
      `- ${report.open.chrome}`,
      `- ${report.open.perfetto}`,
      '',
      '| Step | Result | URL | Navigated | ms |',
      '| --- | --- | --- | --- | --- |',
      ...steps.map(
        (s) =>
          `| ${s.kind} ${s.route || s.label}${s.expand ? ' (disclosure)' : ''} | ${s.ok ? 'ok' : 'FAILED'} | ${s.detail} | ${s.navigated ? 'yes' : 'no'} | ${s.ms} |`,
      ),
      '',
      '## Top event names',
      '',
      '| Event | Count |',
      '| --- | --- |',
      ...report.topEventNames.map((e) => `| \`${e.name}\` | ${e.count} |`),
      '',
      '## Categories',
      '',
      '| Category | Count |',
      '| --- | --- |',
      ...report.topCategories.map((c) => `| \`${c.cat}\` | ${c.count} |`),
      '',
      ...report.caveats.map((c) => `- ${c}`),
    ];
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  process.stderr.write(
    `\ntrace: ${eventCount} events, ${report.traceMB} MB -> ${TRACE_OUT}\n` +
      `open with chrome://tracing or https://ui.perfetto.dev\n` +
      `wrote ${OUT}\n`,
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
