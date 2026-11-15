#!/usr/bin/env node
// P2/P3 browser timing harness.
//
// Attaches to the CDP Chromium that scripts/ux-browser.sh starts. It does not
// launch a private browser. Every sample runs inside the page with
// performance.now(); P2 uses a real pointer click on the primary amount; P3 uses
// a fresh full reload. Three warm-ups are discarded, then 30 samples per run,
// three runs per target. Percentiles use the nearest-rank rule.

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
const EXPECTED_SCOPE = {
  from: '2026-10-10',
  to: '2026-11-08',
  tickets: 19000,
};

function isBoundReport(report) {
  return (
    report.status === 200 &&
    report.from === EXPECTED_SCOPE.from &&
    report.to === EXPECTED_SCOPE.to &&
    report.tickets === EXPECTED_SCOPE.tickets
  );
}

async function waitForBoundReport(probe, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    const bound = probe.reportBodies.find(isBoundReport);
    if (bound) return bound;
    await sleep(100);
  } while (Date.now() < deadline);
  return null;
}

function memorySnapshot() {
  try {
    return execSync('free -m', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

import { ApiClient, IDS, USERS, distribution, sha256File, sleep, writeJson } from './i1-lib.mjs';
import { assertConformingBinding, describeBinding } from './i1-browser-binding.mjs';

function argsOf(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:4000',
    apiUrl: 'http://127.0.0.1:4001',
    cdp: 'http://127.0.0.1:9222',
    user: USERS.perf,
    merchant: IDS.PERF,
    location: IDS.PERF_L1,
    out: null,
    runs: 3,
    samples: 30,
    warmups: 3,
    targets: ['p2', 'p3'],
    label: 'candidate',
    paceMs: 3500,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    if (arg === '--base-url') args.baseUrl = next().replace(/\/+$/, '');
    else if (arg === '--api-url') args.apiUrl = next().replace(/\/+$/, '');
    else if (arg === '--cdp') args.cdp = next();
    else if (arg === '--user') args.user = next();
    else if (arg === '--merchant') args.merchant = next();
    else if (arg === '--location') args.location = next();
    else if (arg === '--out') args.out = next();
    else if (arg === '--runs') args.runs = Number(next());
    else if (arg === '--samples') args.samples = Number(next());
    else if (arg === '--warmups') args.warmups = Number(next());
    else if (arg === '--targets') args.targets = next().split(',');
    else if (arg === '--label') args.label = next();
    else if (arg === '--pace-ms') args.paceMs = Number(next());
    else if (arg === '--help') {
      console.log(
        'i1-browser-timing.mjs [--base-url URL] [--api-url URL] [--cdp URL] [--out DIR] [--label candidate|baseline] [--targets p2,p3]',
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

class PageProbe {
  constructor(page) {
    this.page = page;
    this.consoleErrors = [];
    this.failedRequests = [];
    this.apiStatuses = [];
    this.reportBodies = [];
    page.on('console', (message) => {
      if (message.type() === 'error') this.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => this.consoleErrors.push(error.message));
    page.on('requestfailed', (request) =>
      this.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText }),
    );
    page.on('response', (response) => {
      if (!response.url().includes('/api/')) return;
      this.apiStatuses.push({ url: response.url(), status: response.status() });
      if (response.url().includes('/operations/reports/sales/analysis?')) {
        response
          .json()
          .then((body) =>
            this.reportBodies.push({
              at: new Date().toISOString(),
              url: response.url(),
              status: response.status(),
              capturedAt: body?.capturedAt,
              from: body?.from,
              to: body?.to,
              tickets: body?.totals?.tickets,
              location: body?.locationId,
            }),
          )
          .catch(() => {});
      }
    });
  }
  reset() {
    this.consoleErrors.length = 0;
    this.failedRequests.length = 0;
    this.apiStatuses.length = 0;
    this.reportBodies.length = 0;
  }
}

async function openContext(browser, args) {
  const client = new ApiClient(args.apiUrl);
  await client.login(args.user);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-MX',
    deviceScaleFactor: 1,
  });
  const host = new URL(args.apiUrl).hostname;
  await context.addCookies(
    client.jar.entries().map(([name, value]) => ({ name, value, domain: host, path: '/' })),
  );
  await context.addInitScript(
    ({ merchant, location }) => {
      try {
        localStorage.setItem('umi.dashboard.locale', 'es');
        localStorage.setItem('umi-dashboard-selected-merchant', merchant);
        localStorage.setItem('umi-dashboard-selected-location', location);
      } catch {
        /* ignore */
      }
    },
    { merchant: args.merchant, location: args.location },
  );
  const page = await context.newPage();
  const probe = new PageProbe(page);
  return { context, page, probe };
}

async function waitForUsefulHome(page, timeout = 30000) {
  await page.locator('.sales-primary').waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const element = document.querySelector('.sales-primary');
      return element && element.innerText.trim().length > 0;
    },
    null,
    { timeout },
  );
}

async function measureP3(page, probe) {
  await page.evaluate(() => performance.clearResourceTimings());
  probe.reset();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForUsefulHome(page);
  return page.evaluate(
    () =>
      new Promise((resolvePromise) => {
        requestAnimationFrame(() => resolvePromise(performance.now()));
      }),
  );
}

async function measureP2(page, probe, baseUrl) {
  probe.reset();
  await page
    .goto(`${baseUrl}/?home=1&days=30`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  await waitForUsefulHome(page);
  const t0 = await page.evaluate(() => performance.now());
  await page.locator('.sales-primary').click();
  await page.waitForURL(/\/reportes/, { timeout: 20000 });
  await page.locator('.analysis-lead').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForFunction(
    () => !document.body.innerText.includes('Consultando compras…'),
    null,
    { timeout: 20000 },
  );
  const t1 = await page.evaluate(
    () =>
      new Promise((resolvePromise) => {
        requestAnimationFrame(() => resolvePromise(performance.now()));
      }),
  );
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await waitForUsefulHome(page);
  return t1 - t0;
}

async function measureTarget(page, probe, target, args) {
  const runs = [];
  for (let run = 1; run <= args.runs; run += 1) {
    const samples = [];
    const warmups = [];
    const memoryBefore = memorySnapshot();
    for (let index = 0; index < args.warmups; index += 1) {
      probe.reset();
      const ms =
        target === 'p3' ? await measureP3(page, probe) : await measureP2(page, probe, args.baseUrl);
      const bound = await waitForBoundReport(probe);
      if (!bound) {
        return {
          target,
          status: 'FAIL',
          reason: 'a warmup did not bind the 19,000-ticket window',
          samples: [],
          warmups,
          memoryBefore,
          memoryAfter: memorySnapshot(),
        };
      }
      warmups.push({ ms, report: bound, ticketWindowBound: true });
      await sleep(args.paceMs);
    }
    for (let index = 0; index < args.samples; index += 1) {
      probe.reset();
      const startedAt = new Date().toISOString();
      const ms =
        target === 'p3' ? await measureP3(page, probe) : await measureP2(page, probe, args.baseUrl);
      const reports = probe.reportBodies.slice();
      const bound = await waitForBoundReport(probe);
      const badStatus = reports.find((entry) => entry.status !== 200);
      const sample = {
        run,
        target,
        index: index + 1,
        ms,
        startedAt,
        status: badStatus ? badStatus.status : 200,
        consoleErrors: probe.consoleErrors.length,
        failedRequests: probe.failedRequests.length,
        report: bound,
        reports,
        ticketWindowBound: bound !== null,
      };
      samples.push(sample);
      if (!bound) {
        return {
          target,
          status: 'FAIL',
          reason: `sample ${index + 1} did not bind from=${EXPECTED_SCOPE.from} to=${EXPECTED_SCOPE.to} tickets=${EXPECTED_SCOPE.tickets} with status 200`,
          samples,
          warmups,
          memoryBefore,
          memoryAfter: memorySnapshot(),
        };
      }
      if (badStatus || probe.failedRequests.length || probe.consoleErrors.length) {
        return {
          target,
          status: 'FAIL',
          reason:
            'a sample returned an error, a non-200 report status, a failed request, or a console error',
          samples,
          warmups,
          memoryBefore,
          memoryAfter: memorySnapshot(),
        };
      }
      await sleep(args.paceMs);
    }
    runs.push({
      run,
      warmups,
      samples,
      memoryBefore,
      memoryAfter: memorySnapshot(),
      distribution: distribution(samples.map((sample) => sample.ms)),
    });
  }
  const p95s = runs.map((run) => run.distribution.p95).sort((a, b) => a - b);
  const median = p95s[Math.floor(p95s.length / 2)];
  const worst = p95s[p95s.length - 1];
  const targetMs = target === 'p2' ? 1000 : 1500;
  return {
    target,
    targetMs,
    status: runs.every((run) => run.distribution.p95 <= targetMs) ? 'PASS' : 'FAIL',
    runs,
    medianP95: median,
    worstP95: worst,
  };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const out = resolve(
    args.out || join(process.cwd(), '.i1-perf', new Date().toISOString().replace(/[:.]/g, '-')),
  );
  mkdirSync(out, { recursive: true });
  const browser = await chromium.connectOverCDP(args.cdp);
  const browserBinding = await describeBinding(browser, args.cdp);
  assertConformingBinding(browserBinding);
  const { context, page, probe } = await openContext(browser, args);

  await page.goto(`${args.baseUrl}/?home=1&days=30`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await waitForUsefulHome(page);
  await page.waitForTimeout(500);
  const initial = probe.reportBodies.at(-1);
  const scope = {
    merchant: args.merchant,
    location: args.location,
    from: initial?.from,
    to: initial?.to,
    tickets: initial?.tickets,
    capturedAt: initial?.capturedAt,
    url: page.url(),
  };

  const results = [];
  if (args.targets.includes('p2')) results.push(await measureTarget(page, probe, 'p2', args));
  if (args.targets.includes('p3')) results.push(await measureTarget(page, probe, 'p3', args));

  const buildIdentity = {
    label: args.label,
    baseUrl: args.baseUrl,
    apiUrl: args.apiUrl,
    browser: await page.evaluate(() => navigator.userAgent),
    health: await fetch(`${args.apiUrl}/health`)
      .then((response) => response.json())
      .catch(() => null),
  };
  const output = {
    generatedAt: new Date().toISOString(),
    label: args.label,
    scope,
    buildIdentity,
    browserBinding,
    method: {
      warmupsPerTargetPerRun: args.warmups,
      samplesPerRun: args.samples,
      runs: args.runs,
      percentile: 'nearest-rank',
      p50Index: 14,
      p95Index: 28,
      viewport: '1440x900',
      locale: 'es-MX',
      concurrency: 1,
      paceMs: args.paceMs,
      pacingReason:
        'the API principal bucket allows 240 requests per minute; pacing keeps every sample under it',
      p2: 'home -> click .sales-primary -> visible .analysis-lead without Consultando compras…',
      p3: 'clearResourceTimings -> full reload -> .sales-primary has a non-empty amount',
    },
    results,
    status:
      results.every((result) => result.status === 'PASS') &&
      scope.from === EXPECTED_SCOPE.from &&
      scope.to === EXPECTED_SCOPE.to &&
      scope.tickets === EXPECTED_SCOPE.tickets
        ? 'PASS'
        : 'FAIL',
  };

  writeJson(join(out, 'browser-timing.json'), output);
  writeJson(
    join(out, 'samples.json'),
    results.flatMap((result) =>
      result.runs.flatMap((run) =>
        run.samples.map((sample) => ({ target: result.target, run: run.run, ...sample })),
      ),
    ),
  );
  const files = ['browser-timing.json', 'samples.json'];
  const lines = files.map((name) => `${sha256File(join(out, name))}  ${name}`);
  writeFileSync(join(out, 'sha256.txt'), lines.join('\n') + '\n');
  const hash = createHash('sha256').update(JSON.stringify(output)).digest('hex');
  writeFileSync(join(out, 'run.sha256'), `${hash}  browser-timing.json\n`);
  console.log(
    JSON.stringify(
      {
        out,
        label: args.label,
        scope,
        status: output.status,
        results: results.map((result) => ({
          target: result.target,
          status: result.status,
          medianP95: result.medianP95,
          worstP95: result.worstP95,
          runP95: result.runs?.map((run) => run.distribution.p95),
        })),
      },
      null,
      2,
    ),
  );

  await context.close();
  await browser.close();
  process.exit(output.status === 'PASS' ? 0 : 1);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(2);
});
