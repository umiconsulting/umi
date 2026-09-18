#!/usr/bin/env node
/**
 * Lighthouse audit — Step F6 of the ultimate platform plan, the row
 * "Lighthouse audit | Lighthouse over CDP".
 *
 * Runs Lighthouse against the Dashboard through the Chromium that is already
 * open, so the audit sees the signed-in application rather than a login page.
 * Lighthouse is a real dependency (`devDependencies.lighthouse`, installed with
 * pnpm); this script is a wrapper that points it at the shared browser and turns
 * the result into numbers a person can read. Nothing is stubbed: if Lighthouse
 * cannot run here, the script says exactly why and exits non-zero.
 *
 * Two things about running Lighthouse against someone else's browser, both
 * verified in `lighthouse/core/gather/navigation-runner.js`:
 *
 *   1. With `flags.port` set, Lighthouse uses `puppeteer.connect` and never
 *      launches a browser. Its cleanup closes only the page it opened and then
 *      disconnects, so the shared browser and its session survive. This script
 *      re-checks `GET /json/version` afterwards and prints the tab count before
 *      and after, so "the browser is still there" is evidence, not a claim.
 *   2. Its default `clearStorageTypes` is
 *      `['file_systems','shader_cache','service_workers','cache_storage']` —
 *      cookies and localStorage are deliberately untouched, so the audit does
 *      not sign the browser out. That default is left exactly as upstream has
 *      it; changing it would change the audit.
 *
 * Preset: `desktop` by default. The product's reference devices are a 1024x768
 * tablet and a 1280x720 terminal (plan section 4), so the desktop preset's
 * 1350x940 emulation and its uncapped-throughput `desktopDense4G` throttling is
 * the closer question. The mobile preset is one flag away (`--preset mobile`)
 * and reports its own numbers. The preset used is printed with the scores.
 *
 * Usage:
 *   UX_CDP=http://127.0.0.1:9222 UX_BASE=http://127.0.0.1:4000 \
 *     node tools/ux-sweep/perf-lighthouse.mjs --out /tmp/ux/lighthouse.json --md /tmp/ux/lighthouse.md
 *
 * Flags:
 *   --url <url>        Page to audit. Default <UX_BASE>/ .
 *   --preset <name>    desktop (default) or mobile.
 *   --categories a,b   Default performance,accessibility,best-practices,seo.
 *   --out <path>       Full Lighthouse JSON report. Default /tmp/ux/lighthouse.json.
 *   --md <path>        Markdown summary. Default /tmp/ux/lighthouse.md.
 *   --summary <path>   Derived summary JSON (scores, metrics, opportunities).
 *                      Default /tmp/ux/lighthouse-summary.json.
 *   --timeout <ms>     maxWaitForLoad. Default 60000 (a dev server serving
 *                      hundreds of modules needs longer than the 45 s default).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import lighthouse from 'lighthouse';
import { arg } from './lib/collect.mjs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const URL_UNDER_TEST = arg('--url', `${BASE}/`);
const PRESET = arg('--preset', 'desktop');
const OUT = arg('--out', '/tmp/ux/lighthouse.json');
const MD = arg('--md', '/tmp/ux/lighthouse.md');
const SUMMARY = arg('--summary', '/tmp/ux/lighthouse-summary.json');
const MAX_WAIT = Number(arg('--timeout', '60000'));
const CATEGORIES = (arg('--categories') || 'performance,accessibility,best-practices,seo')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

if (!['desktop', 'mobile'].includes(PRESET)) {
  process.stderr.write(`--preset must be desktop or mobile, got "${PRESET}"\n`);
  process.exit(2);
}

/** The port Lighthouse should attach to, taken from UX_CDP. */
function portFromCdp(cdpUrl) {
  const url = new URL(cdpUrl);
  return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

const PORT = portFromCdp(CDP);
const HOSTNAME = new URL(CDP).hostname;

/** How many tabs the shared browser has right now. Evidence, not a claim. */
async function tabCount() {
  try {
    const res = await fetch(`http://${HOSTNAME}:${PORT}/json/list`);
    const list = await res.json();
    return list.filter((t) => t.type === 'page').length;
  } catch {
    return null;
  }
}

const score = (v) => (v === null || v === undefined ? null : Math.round(v * 100));

async function main() {
  const tabsBefore = await tabCount();
  process.stderr.write(
    `auditing ${URL_UNDER_TEST} with preset ${PRESET} over CDP ${HOSTNAME}:${PORT} (${tabsBefore} page(s) open)\n`,
  );

  const config =
    PRESET === 'desktop'
      ? (await import('lighthouse/core/config/desktop-config.js')).default
      : undefined;

  let result;
  try {
    result = await lighthouse(
      URL_UNDER_TEST,
      {
        port: PORT,
        hostname: HOSTNAME,
        output: 'json',
        logLevel: 'error',
        onlyCategories: CATEGORIES,
        maxWaitForLoad: MAX_WAIT,
        // Left at Lighthouse's default on purpose: cookies and localStorage are
        // not in the default clear list, so the session survives the audit.
      },
      config,
    );
  } catch (error) {
    // No hand-waving: the exact failure goes in the report and on stderr.
    const message = (error?.stack || error?.message || String(error)).slice(0, 2000);
    process.stderr.write(
      `\nLighthouse could not complete against ${URL_UNDER_TEST}:\n${message}\n`,
    );
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          url: URL_UNDER_TEST,
          preset: PRESET,
          failed: true,
          error: message,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const lhr = result.lhr;
  const tabsAfter = await tabCount();
  const stillAlive = tabsAfter !== null;

  const scores = Object.fromEntries(
    Object.entries(lhr.categories || {}).map(([id, cat]) => [id, score(cat.score)]),
  );

  const metrics = {};
  for (const id of [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'cumulative-layout-shift',
    'speed-index',
    'interactive',
  ]) {
    const audit = lhr.audits?.[id];
    if (audit) {
      metrics[id] = {
        displayValue: audit.displayValue ?? null,
        numericValue: audit.numericValue ?? null,
        score: audit.score ?? null,
      };
    }
  }

  // Opportunities = audits that carry a concrete saving. Sorted by the saving,
  // because that is the thing a reader can act on.
  const opportunities = Object.values(lhr.audits || {})
    .filter((a) => a.details?.type === 'opportunity' && (a.details.overallSavingsMs || 0) > 0)
    .map((a) => ({
      id: a.id,
      title: a.title,
      savingsMs: Math.round(a.details.overallSavingsMs),
      savingsBytes: a.details.overallSavingsBytes
        ? Math.round(a.details.overallSavingsBytes)
        : null,
      displayValue: a.displayValue ?? null,
    }))
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, 8);

  // Anything the audit itself failed outright.
  const failures = Object.values(lhr.audits || {})
    .filter(
      (a) => a.score === 0 && ['binary', 'numeric', 'metricSavings'].includes(a.scoreDisplayMode),
    )
    .map((a) => ({ id: a.id, title: a.title, displayValue: a.displayValue ?? null }));

  const report = {
    generatedAt: new Date().toISOString(),
    url: URL_UNDER_TEST,
    preset: PRESET,
    lighthouseVersion: lhr.lighthouseVersion,
    userAgent: lhr.userAgent,
    formFactor: lhr.configSettings?.formFactor,
    throttlingMethod: lhr.configSettings?.throttlingMethod,
    scores,
    metrics,
    opportunities,
    failures,
    runtimeError: lhr.runtimeError
      ? { code: lhr.runtimeError.code, message: lhr.runtimeError.message }
      : null,
    browser: {
      cdp: `http://${HOSTNAME}:${PORT}`,
      tabsBefore,
      tabsAfter,
      stillAlive,
      note: 'Lighthouse connects to this browser and disconnects; it does not launch or close one when a port is supplied.',
    },
    rawReportPath: OUT,
    summaryPath: SUMMARY,
  };

  await mkdir(dirname(OUT), { recursive: true });
  // With `output: 'json'` the report arrives as an already-serialised JSON
  // string. Writing it through `JSON.stringify` again would double-encode it and
  // hand every reader a quoted blob instead of a report.
  await writeFile(
    OUT,
    typeof result.report === 'string' ? result.report : JSON.stringify(result.report, null, 2),
  );

  await mkdir(dirname(SUMMARY), { recursive: true });
  await writeFile(SUMMARY, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# Lighthouse audit',
      '',
      `Generated: ${report.generatedAt}`,
      `URL: ${report.url}`,
      `Lighthouse ${report.lighthouseVersion} · preset **${PRESET}** · form factor ${report.formFactor} · throttling \`${report.throttlingMethod}\``,
      report.runtimeError
        ? `**Lighthouse reported a runtime error: \`${report.runtimeError.code}\` — ${report.runtimeError.message}**`
        : '',
      '',
      '## Scores',
      '',
      '| Category | Score |',
      '| --- | --- |',
      ...Object.entries(scores).map(([id, s]) => `| ${id} | ${s} |`),
      '',
      '## Metrics',
      '',
      '| Metric | Value | Score |',
      '| --- | --- | --- |',
      ...Object.entries(metrics).map(
        ([id, m]) =>
          `| ${id} | ${m.displayValue ?? m.numericValue ?? 'n/a'} | ${m.score === null ? 'n/a' : Math.round(m.score * 100)} |`,
      ),
      '',
      '## Top opportunities',
      '',
      opportunities.length
        ? '| Audit | Saving | Bytes | Detail |\n| --- | --- | --- | --- |\n' +
          opportunities
            .map(
              (o) =>
                `| ${o.title} | ${o.savingsMs} ms | ${o.savingsBytes ?? '—'} | ${o.displayValue ?? ''} |`,
            )
            .join('\n')
        : 'None reported — no audit found a concrete time saving.',
      '',
      '## Failing audits',
      '',
      failures.length
        ? failures
            .map((f) => `- \`${f.id}\` — ${f.title}${f.displayValue ? ` (${f.displayValue})` : ''}`)
            .join('\n')
        : 'None: no audit scored zero.',
      '',
      `Browser stayed up: **${stillAlive ? 'yes' : 'no'}** (${tabsBefore} page(s) before, ${tabsAfter} after).`,
      '',
      `Full JSON report: \`${OUT}\``,
      `Derived summary: \`${SUMMARY}\``,
    ];
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.filter((l) => l !== '').join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  process.stderr.write(
    `\nscores: ${Object.entries(scores)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}\n` +
      `top opportunity: ${opportunities[0] ? `${opportunities[0].title} (${opportunities[0].savingsMs} ms)` : 'none'}\n` +
      `browser still up: ${stillAlive} (${tabsBefore} -> ${tabsAfter} pages)\n` +
      `wrote ${OUT}\n`,
  );
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
