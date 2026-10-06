#!/usr/bin/env node
/**
 * Flow budget test for the Umi Dashboard and the Umi POS.
 *
 * Plan §7 Step F5: count taps and seconds for the ten core flows, keep the
 * numbers in a checked-in file, and fail when a flow exceeds its budget. The one
 * number the plan actually fixes is the money path — three taps or fewer after
 * the cart (§4).
 *
 * The budgets live in `config/ux-budgets.json`. Each flow either carries a small
 * step script the driver can execute over CDP, or it is marked
 * `not-yet-instrumented` with the reason. Nothing in between: a flow that the
 * harness cannot drive is reported as unmeasured, never as passing.
 *
 * Usage:
 *   node tools/ux-sweep/flow-budget.mjs --out /tmp/ux/flows.json --md /tmp/ux/flows.md
 *   node tools/ux-sweep/flow-budget.mjs --only customers-search
 *
 * Flags:
 *   --config <path>  Budget file (default config/ux-budgets.json).
 *   --out <path>     JSON report (default /tmp/ux/flows.json).
 *   --md <path>      Markdown summary.
 *   --only a,b       Run just these flow ids.
 *   --viewport WxH   Pin the viewport (default 1280x720, the counter terminal
 *                    from plan §4). `--viewport native` uses whatever the
 *                    attached browser happens to be.
 *   --settle <ms>    Extra wait after a route load (default 3000). The screens
 *                    fetch their own data; clicking a control before the first
 *                    render settles measures a race, not a flow.
 *
 * Exit code is non-zero when a measured flow misses a budget or a step does not
 * take effect. Uninstrumented flows do not fail the run; they are listed.
 *
 * Why the viewport is pinned: below 1080 px the Dashboard moves its sidebar into
 * an off-canvas drawer, so every navigation flow costs one extra tap (open the
 * drawer) and the numbers stop describing the terminal. 1280x720 is the docked
 * shell — the shape the tap budgets are written against.
 */

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { applyViewport, arg, parseViewport } from './lib/collect.mjs';

const WORKSPACE = process.env.UX_WORKSPACE || '/home/jc/umi';
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const CONFIG = arg('--config', `${WORKSPACE}/config/ux-budgets.json`);
const OUT = arg('--out', '/tmp/ux/flows.json');
const MD = arg('--md', null);
const VIEWPORT_ARG = arg('--viewport', '1280x720');
const VIEWPORT = VIEWPORT_ARG === 'native' ? null : parseViewport(VIEWPORT_ARG);
const SETTLE = Number(arg('--settle', '3000'));
const ONLY = (arg('--only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** How long a single expectation is allowed to keep failing before it is a failure. */
const EXPECT_DEADLINE_MS = 12_000;

/** Locate a control by selector, optionally narrowed to one that contains text. */
function locate(page, spec) {
  let locator = page.locator(spec.selector);
  if (spec.text) {
    locator = locator.filter({ hasText: spec.text });
  }
  if (Number.isInteger(spec.index)) {
    locator = locator.nth(spec.index);
  } else {
    locator = locator.first();
  }
  return locator;
}

/** Poll a predicate until it is true or the deadline passes. Returns ms waited. */
async function until(fn, deadlineMs = EXPECT_DEADLINE_MS) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < deadlineMs) {
    try {
      last = await fn();
      if (last) return { ok: true, waitedMs: Date.now() - started };
    } catch (error) {
      last = String(error?.message || error).slice(0, 160);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { ok: false, waitedMs: Date.now() - started, last };
}

/** Resolve one expectation step. Returns {ok, waitedMs, detail}. */
async function checkExpectation(page, step) {
  if (step.expectUrl) {
    const wanted = step.expectUrl;
    return until(() => page.url().includes(wanted)).then((r) => ({
      ...r,
      detail: `url contains ${wanted} (last ${page.url()})`,
    }));
  }
  if (step.expectVisible) {
    return until(async () => (await page.locator(step.expectVisible).count()) > 0).then((r) => ({
      ...r,
      detail: `visible ${step.expectVisible}`,
    }));
  }
  if (step.expectAttr) {
    const { selector, text, attribute, contains, equals } = step.expectAttr;
    let locator = page.locator(selector);
    if (text) locator = locator.filter({ hasText: text });
    locator = locator.first();
    return until(async () => {
      // The attribute name has to travel as an argument: this function is
      // serialised into the page, where outer variables do not exist.
      const values = await locator.evaluateAll(
        (els, attr) =>
          els.map((el) =>
            // `fill()` writes the property, not the attribute, for inputs.
            attr === 'value' ? String(el.value ?? '') : el.getAttribute(attr) || '',
          ),
        attribute,
      );
      return values.some((v) =>
        equals != null ? v === equals : contains != null ? v.includes(contains) : Boolean(v),
      );
    }).then((r) => ({
      ...r,
      detail: `${selector}${text ? ` (${text})` : ''} @${attribute} ${equals != null ? `== ${equals}` : `~ ${contains}`}`,
    }));
  }
  return { ok: true, waitedMs: 0, detail: 'no-op' };
}

/** Run one flow's step script. Returns {taps, ms, failures[], trace[]}. */
async function runFlow(page, flow) {
  const failures = [];
  const trace = [];
  const started = Date.now();
  let taps = 0;

  for (const step of flow.steps || []) {
    if (step.click) {
      const label = `${step.click.selector}${step.click.text ? ` "${step.click.text}"` : ''}`;
      try {
        const locator = locate(page, step.click);
        // Let Playwright's own auto-wait resolve the element: the screen is a
        // SPA and the control may not exist yet on the first tick after a route
        // change. An immediate count() would call that a missing control.
        await locator.waitFor({ state: 'attached', timeout: 6000 });
        if (!(await locator.count())) {
          const raw = await page.locator(step.click.selector).count();
          throw new Error(
            `no element matched ${label} (raw selector matched ${raw}; url ${page.url()})`,
          );
        }
        await locator.click({ timeout: 5000 });
        taps += 1;
        trace.push({ step: 'click', target: label, ok: true });
        // Short settle only: the measured milliseconds should describe the
        // interaction, not the harness's own sleeps.
        await page.waitForTimeout(200);
      } catch (error) {
        trace.push({
          step: 'click',
          target: label,
          ok: false,
          error: String(error?.message || error).slice(0, 200),
        });
        failures.push(`click failed: ${label} — ${String(error?.message || error).slice(0, 160)}`);
      }
      continue;
    }
    if (step.type) {
      const label = `${step.type.selector}`;
      try {
        const locator = locate(page, step.type);
        await locator.waitFor({ state: 'attached', timeout: 6000 });
        if (!(await locator.count()))
          throw new Error(
            `no element matched ${label} (raw selector matched ${await page.locator(step.type.selector).count()}; url ${page.url()})`,
          );
        await locator.fill(step.type.value, { timeout: 5000 });
        taps += 1;
        trace.push({ step: 'type', target: label, ok: true });
        await page.waitForTimeout(200);
      } catch (error) {
        trace.push({
          step: 'type',
          target: label,
          ok: false,
          error: String(error?.message || error).slice(0, 200),
        });
        failures.push(`type failed: ${label} — ${String(error?.message || error).slice(0, 160)}`);
      }
      continue;
    }
    if (step.wait) {
      await page.waitForTimeout(step.wait);
      trace.push({ step: 'wait', ms: step.wait });
      continue;
    }
    const result = await checkExpectation(page, step);
    trace.push({ step: 'expect', detail: result.detail, ok: result.ok, waitedMs: result.waitedMs });
    if (!result.ok) {
      const why = typeof result.last === 'string' ? ` (last error: ${result.last})` : '';
      failures.push(`expectation not met: ${result.detail}${why}`);
    }
  }

  return { taps, ms: Date.now() - started, failures, trace };
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  const flows = (config.flows || []).filter((f) => (ONLY.length ? ONLY.includes(f.id) : true));

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  await applyViewport(page, VIEWPORT).catch(() => {});

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    config: CONFIG,
    flows: [],
    notInstrumented: [],
    failures: [],
  };

  for (const flow of flows) {
    if (flow.status !== 'instrumented') {
      report.notInstrumented.push({ id: flow.id, label: flow.label, reason: flow.reason });
      report.flows.push({
        id: flow.id,
        label: flow.label,
        status: flow.status,
        budget: flow.budget,
        measured: null,
        passed: null,
        note: flow.reason,
      });
      process.stderr.write(
        `${flow.id}: NOT INSTRUMENTED — ${String(flow.reason || '').slice(0, 120)}\n`,
      );
      continue;
    }

    const started = Date.now();
    await page.goto(`${BASE}${flow.start || '/'}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    // The shell is the last thing to appear and the first thing every flow
    // touches. Waiting for it beats guessing a sleep.
    await page.waitForSelector('button.side-item, .app, form', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(SETTLE);
    const navigationMs = Date.now() - started;

    const result = await runFlow(page, flow);
    const overTaps = result.taps > flow.budget.taps;
    const overMs = result.ms > flow.budget.ms;
    const passed = !result.failures.length && !overTaps && !overMs;

    const entry = {
      id: flow.id,
      label: flow.label,
      status: 'instrumented',
      start: flow.start,
      budget: flow.budget,
      budgetSource: flow.budgetSource,
      measured: { taps: result.taps, ms: result.ms, routeLoadMs: navigationMs },
      overBudget: { taps: overTaps, ms: overMs },
      trace: result.trace,
      failures: result.failures,
      passed,
    };
    report.flows.push(entry);
    if (!passed) {
      const why = [
        overTaps ? `taps ${result.taps} > ${flow.budget.taps}` : null,
        overMs ? `ms ${result.ms} > ${flow.budget.ms}` : null,
        ...result.failures,
      ]
        .filter(Boolean)
        .join('; ');
      report.failures.push({ id: flow.id, why });
      process.stderr.write(`${flow.id}: FAIL — ${why}\n`);
    } else {
      process.stderr.write(
        `${flow.id}: ok — ${result.taps} tap(s), ${result.ms} ms (budget ${flow.budget.taps}/${flow.budget.ms})\n`,
      );
    }
  }

  await page.close().catch(() => {});

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`\nwrote ${OUT}\n`);

  if (MD) {
    const lines = [
      '# Flow budgets',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${report.base}`,
      `Config: ${report.config}`,
      '',
      '| Flow | Status | Taps (budget) | ms (budget) | Result |',
      '| --- | --- | --- | --- | --- |',
    ];
    for (const f of report.flows) {
      if (f.status !== 'instrumented') {
        lines.push(
          `| ${f.label} | ${f.status} | – (${f.budget.taps}) | – (${f.budget.ms}) | not measured |`,
        );
        continue;
      }
      lines.push(
        `| ${f.label} | instrumented | ${f.measured.taps} (${f.budget.taps}) | ${f.measured.ms} (${f.budget.ms}) | ${f.passed ? 'pass' : 'FAIL'} |`,
      );
    }
    lines.push('', `Unmeasured flows: ${report.notInstrumented.length}`, '');
    for (const n of report.notInstrumented) {
      lines.push(`- \`${n.id}\` — ${n.reason}`);
    }
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  process.exit(report.failures.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
