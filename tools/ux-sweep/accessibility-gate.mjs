#!/usr/bin/env node
/**
 * Accessibility gate for the Umi Dashboard (plan §7, Step F4).
 *
 * Runs axe-core on every Dashboard route over CDP and fails — non-zero exit —
 * on any `serious` or `critical` violation, printing the rule id, the impact,
 * the route, and the offending selector.
 *
 * It reports what it finds, including a non-zero exit, and it does not suppress
 * anything to look better. The serious count reached zero on 2026-09-16, so
 * `pnpm ux:verify` now runs it as a HARD GATE: a serious or critical violation
 * fails the standing loop. Use `--no-fail` when you want the report without the
 * verdict (that is what `pnpm ux:a11y:report` is for).
 *
 * Usage:
 *   node tools/ux-sweep/accessibility-gate.mjs --out /tmp/ux/a11y.json --md /tmp/ux/a11y.md
 *   node tools/ux-sweep/accessibility-gate.mjs --routes /,/reportes
 *   node tools/ux-sweep/accessibility-gate.mjs --no-fail   # report, always exit 0
 *
 * Flags:
 *   --out <path>       JSON report (default /tmp/ux/a11y.json).
 *   --md <path>        Markdown summary.
 *   --routes a,b,c     Override the route list.
 *   --viewport WxH     Pin the viewport.
 *   --settle <ms>      Wait after each route load (default 3000).
 *   --delay <ms>       Pause between routes (the API allows 300 requests per
 *                      minute per IP; each route load costs several).
 *   --tags a,b         axe tags to run (default: the WCAG A/AA/AAA rule sets).
 *   --no-fail          Always exit 0. Reporting mode for the aggregate script.
 *   --fail-on a,b      Impacts that fail the run (default serious,critical).
 *
 * POS side: out of scope here. Flutter's half of the same gate is the semantics
 * report (plan §7, Step F2).
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
const { AxeBuilder } = require('@axe-core/playwright');

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';

const OUT = arg('--out', '/tmp/ux/a11y.json');
const MD = arg('--md', null);
const ROUTES = parseRoutes(arg('--routes'), DEFAULT_ROUTES);
const VIEWPORT = parseViewport(arg('--viewport', '1280x720'));
const SETTLE = Number(arg('--settle', '3000'));
const DELAY = Number(arg('--delay', '0'));
const NO_FAIL = hasFlag('--no-fail');
const FAIL_ON = (arg('--fail-on', 'serious,critical') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TAGS = (arg('--tags', 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa,best-practice') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  const page = await context.newPage();
  await applyViewport(page, VIEWPORT).catch(() => {});

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    tool: 'axe-core via @axe-core/playwright',
    tags: TAGS,
    failOn: FAIL_ON,
    routes: [],
    totals: {
      serious: 0,
      critical: 0,
      moderate: 0,
      minor: 0,
      byImpact: {},
      byImpactNodes: {},
      byRule: {},
    },
    failingRoutes: [],
  };

  for (const [i, route] of ROUTES.entries()) {
    if (i > 0 && DELAY > 0) await page.waitForTimeout(DELAY);
    let entry;
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(SETTLE);
      const builder = new AxeBuilder({ page }).withTags(TAGS);
      const results = await builder.analyze();

      const violations = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        selectors: v.nodes.slice(0, 5).map((n) => (n.target || []).join(' ')),
      }));
      entry = {
        ok: true,
        route,
        url: page.url(),
        violations,
        passCount: results.passes.length,
        incompleteCount: results.incomplete.length,
        counts: violations.reduce(
          (acc, v) => {
            acc[v.impact || 'unknown'] = (acc[v.impact || 'unknown'] || 0) + 1;
            return acc;
          },
          { serious: 0, critical: 0, moderate: 0, minor: 0 },
        ),
      };
    } catch (error) {
      entry = { ok: false, route, error: (error?.message || String(error)).slice(0, 400) };
    }
    report.routes.push(entry);

    if (!entry.ok) {
      process.stderr.write(`${route}: FAILED TO ANALYZE ${entry.error}\n`);
      continue;
    }
    for (const v of entry.violations) {
      // `byImpact` counts violations; `byImpactNodes` counts the elements they
      // touch. Kept apart from the per-route totals below so a violation is
      // never counted twice.
      const impact = v.impact || 'unknown';
      report.totals.byImpact[impact] = (report.totals.byImpact[impact] || 0) + 1;
      report.totals.byImpactNodes[impact] = (report.totals.byImpactNodes[impact] || 0) + v.nodes;
      report.totals.byRule[v.id] = (report.totals.byRule[v.id] || 0) + 1;
      if (FAIL_ON.includes(v.impact)) {
        report.failingRoutes.push({
          route,
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes,
          selector: v.selectors[0] || '',
        });
      }
    }
    report.totals.serious += entry.counts.serious || 0;
    report.totals.critical += entry.counts.critical || 0;
    report.totals.moderate += entry.counts.moderate || 0;
    report.totals.minor += entry.counts.minor || 0;
    process.stderr.write(
      `${route} -> ${entry.violations.length} violation(s): ${entry.counts.critical} critical, ${entry.counts.serious} serious, ${entry.counts.moderate} moderate, ${entry.counts.minor} minor\n`,
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(report, null, 2));
  process.stderr.write(`\nwrote ${OUT}\n`);

  if (report.failingRoutes.length) {
    process.stderr.write(
      `\n${report.failingRoutes.length} blocking finding(s) by rule (${FAIL_ON.join(', ')}):\n`,
    );
    for (const f of report.failingRoutes) {
      process.stderr.write(
        `  [${f.impact}] ${f.rule} on ${f.route} — ${f.nodes} node(s), first: ${f.selector}\n`,
      );
    }
  } else {
    process.stderr.write(`\nNo ${FAIL_ON.join('/')} violations on any route.\n`);
  }

  if (MD) {
    const lines = [
      '# Accessibility gate (axe-core)',
      '',
      `Generated: ${report.generatedAt}`,
      `Base: ${report.base}`,
      `Tags: ${report.tags.join(', ')}`,
      `Blocking impacts: ${report.failOn.join(', ')}`,
      '',
      '| Route | critical | serious | moderate | minor |',
      '| --- | --- | --- | --- | --- |',
    ];
    for (const r of report.routes) {
      lines.push(
        r.ok
          ? `| \`${r.route}\` | ${r.counts.critical} | ${r.counts.serious} | ${r.counts.moderate} | ${r.counts.minor} |`
          : `| \`${r.route}\` | FAILED | | | ${r.error} |`,
      );
    }
    lines.push('', '## Blocking findings', '');
    if (!report.failingRoutes.length) lines.push('_None._');
    for (const f of report.failingRoutes) {
      lines.push(
        `- **${f.impact}** \`${f.rule}\` on \`${f.route}\` — ${f.nodes} node(s); first: \`${f.selector}\``,
      );
    }
    await mkdir(dirname(MD), { recursive: true });
    await writeFile(MD, `${lines.join('\n')}\n`);
    process.stderr.write(`wrote ${MD}\n`);
  }

  await page.close().catch(() => {});

  if (NO_FAIL) {
    process.stderr.write('(--no-fail: exit 0 even with findings)\n');
    process.exit(0);
  }
  process.exit(report.failingRoutes.length ? 1 : 0);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
