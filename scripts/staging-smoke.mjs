#!/usr/bin/env node
/**
 * Live post-deploy smoke suite for Umi staging (or production via env overrides).
 *
 * Uses @playwright/test (already installed in root devDependencies) to verify:
 *   1. API /health + /health/release (db, redis, schema compatibility, commit)
 *   2. Dashboard boot in real headless Chromium (HTTP 200, mounted UI, 0 pageerrors, 0 5xx)
 *      + optional authenticated login check when STAGING_SMOKE_EMAIL & STAGING_SMOKE_PASSWORD are set
 *   3. Cash surface reachability in real headless Chromium (< 500, 0 pageerrors, 0 5xx)
 *   4. Optional landing legal/downloads check (--include-landing)
 *
 * Usage:
 *   pnpm smoke:staging
 *   pnpm smoke:staging -- --shots /tmp/staging-shots --json
 *   STAGING_SMOKE_EMAIL=... STAGING_SMOKE_PASSWORD=... pnpm smoke:staging
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

export const DEFAULTS = {
  apiUrl: 'https://api-staging.umiconsulting.co',
  dashboardUrl: 'https://staging-dashboard.umiconsulting.co',
  cashUrl: 'https://umi-cash-staging.hola-8ae.workers.dev',
  landingUrl: 'https://www.umiconsulting.co',
  timeoutMs: 25_000,
};

export function parseArgs(argv, env = process.env) {
  const opts = {
    apiUrl: (env.STAGING_API_URL || DEFAULTS.apiUrl).replace(/\/+$/, ''),
    dashboardUrl: (env.STAGING_DASHBOARD_URL || DEFAULTS.dashboardUrl).replace(/\/+$/, ''),
    cashUrl: (env.STAGING_CASH_URL || DEFAULTS.cashUrl).replace(/\/+$/, ''),
    landingUrl: (env.STAGING_LANDING_URL || DEFAULTS.landingUrl).replace(/\/+$/, ''),
    email: env.STAGING_SMOKE_EMAIL || '',
    password: env.STAGING_SMOKE_PASSWORD || '',
    shotsDir: null,
    includeLanding: false,
    skipCash: false,
    asJson: false,
    timeoutMs: Number(env.STAGING_SMOKE_TIMEOUT_MS || DEFAULTS.timeoutMs),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--shots') {
      opts.shotsDir = argv[++i] || null;
    } else if (arg === '--include-landing') {
      opts.includeLanding = true;
    } else if (arg === '--skip-cash') {
      opts.skipCash = true;
    } else if (arg === '--json') {
      opts.asJson = true;
    } else if (arg === '--api') {
      opts.apiUrl = (argv[++i] || opts.apiUrl).replace(/\/+$/, '');
    } else if (arg === '--dashboard') {
      opts.dashboardUrl = (argv[++i] || opts.dashboardUrl).replace(/\/+$/, '');
    } else if (arg === '--cash') {
      opts.cashUrl = (argv[++i] || opts.cashUrl).replace(/\/+$/, '');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

export function validateApiHealthPayload(health, release) {
  const issues = [];
  if (!health || typeof health !== 'object') {
    issues.push('health payload is not a JSON object');
  } else {
    if (health.status !== 'ok') issues.push(`health.status=${String(health.status)} (expected ok)`);
    if (health.db !== true) issues.push(`health.db=${String(health.db)} (expected true)`);
    if (health.redis !== true) issues.push(`health.redis=${String(health.redis)} (expected true)`);
    if (health.schema && health.schema.compatible !== true) {
      issues.push(
        `schema incompatible: current=${String(health.schema.current)} expected=${String(health.schema.expected)}`,
      );
    }
  }

  if (!release || typeof release !== 'object') {
    issues.push('release payload is not a JSON object');
  } else {
    if (!release.gitCommit) issues.push('release.gitCommit is missing');
    if (!release.contractVersion) issues.push('release.contractVersion is missing');
  }
  return issues;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function checkApi(opts) {
  const started = Date.now();
  const [healthRes, releaseRes] = await Promise.all([
    fetchJson(`${opts.apiUrl}/health`, opts.timeoutMs),
    fetchJson(`${opts.apiUrl}/health/release`, opts.timeoutMs),
  ]);
  const issues = [];
  if (healthRes.status !== 200) issues.push(`/health returned HTTP ${healthRes.status}`);
  if (releaseRes.status !== 200) issues.push(`/health/release returned HTTP ${releaseRes.status}`);
  issues.push(...validateApiHealthPayload(healthRes.json, releaseRes.json));

  return {
    name: 'api-health',
    ok: issues.length === 0,
    durationMs: Date.now() - started,
    url: opts.apiUrl,
    commit: releaseRes.json?.gitCommit?.slice(0, 8) || null,
    contractVersion: releaseRes.json?.contractVersion || null,
    environment: releaseRes.json?.environment || null,
    issues,
  };
}

async function runBrowserCheck(browser, { name, url, timeoutMs, shotsDir, afterLoad }) {
  const started = Date.now();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageErrors = [];
  const serverErrors = [];
  const issues = [];

  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  let httpStatus = null;
  let extra = {};
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    await page
      .waitForFunction(() => (document.body?.innerText || '').trim().length >= 20, null, {
        timeout: Math.min(timeoutMs, 10_000),
      })
      .catch(() => {});
    httpStatus = response ? response.status() : null;
    if (httpStatus === null || httpStatus >= 500) {
      issues.push(`navigation returned HTTP ${String(httpStatus)}`);
    }
    if (afterLoad) {
      extra = (await afterLoad(page, issues)) || {};
    }
    if (pageErrors.length > 0) {
      issues.push(`uncaught page errors: ${pageErrors.join(' | ')}`);
    }
    if (serverErrors.length > 0) {
      issues.push(`5xx responses: ${serverErrors.join(' | ')}`);
    }
    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: false });
    }
  } catch (err) {
    issues.push(err instanceof Error ? err.message : String(err));
    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await page
        .screenshot({ path: path.join(shotsDir, `${name}-failed.png`), fullPage: false })
        .catch(() => {});
    }
  } finally {
    await context.close();
  }

  return {
    name,
    ok: issues.length === 0,
    durationMs: Date.now() - started,
    url,
    httpStatus,
    ...extra,
    issues,
  };
}

async function checkLanding(opts) {
  const started = Date.now();
  const routes = [
    '/',
    '/descargas',
    '/aviso-de-privacidad',
    '/privacidad-umipos',
    '/terminos-umipos',
  ];
  const issues = [];
  for (const route of routes) {
    const res = await fetchJson(`${opts.landingUrl}${route}`, opts.timeoutMs);
    if (res.status !== 200) {
      issues.push(`${route} returned HTTP ${res.status}`);
    }
  }
  return {
    name: 'landing-routes',
    ok: issues.length === 0,
    durationMs: Date.now() - started,
    url: opts.landingUrl,
    routesChecked: routes.length,
    issues,
  };
}

export async function runSmoke(opts) {
  const results = [];
  results.push(await checkApi(opts));

  const browser = await chromium.launch({ headless: true });
  try {
    results.push(
      await runBrowserCheck(browser, {
        name: 'dashboard-boot',
        url: opts.dashboardUrl,
        timeoutMs: opts.timeoutMs,
        shotsDir: opts.shotsDir,
        afterLoad: async (page, issues) => {
          const textLen = await page.evaluate(() => (document.body?.innerText || '').trim().length);
          if (textLen < 15) {
            issues.push(`dashboard rendered nearly empty body (${textLen} chars)`);
          }
          const hasLoginInput =
            (await page
              .locator('input[type="email"], input[name="username"], input[type="password"]')
              .count()) > 0;
          let authenticated = false;
          if (hasLoginInput && opts.email && opts.password) {
            const userInput = page
              .locator('input[type="email"], input[name="username"], input[type="text"]')
              .first();
            const passInput = page.locator('input[type="password"]').first();
            await userInput.fill(opts.email);
            await passInput.fill(opts.password);
            await page.locator('button[type="submit"]').first().click();
            await page.waitForLoadState('networkidle', { timeout: opts.timeoutMs });
            const postLoginPasswordInputs = await page.locator('input[type="password"]').count();
            if (postLoginPasswordInputs > 0) {
              issues.push('dashboard login did not transition past password form');
            } else {
              authenticated = true;
            }
          }
          return { textLen, hasLoginInput, authenticated };
        },
      }),
    );

    if (!opts.skipCash) {
      results.push(
        await runBrowserCheck(browser, {
          name: 'cash-surface',
          url: opts.cashUrl,
          timeoutMs: opts.timeoutMs,
          shotsDir: opts.shotsDir,
          afterLoad: async (page) => {
            const title = await page.title();
            return { title };
          },
        }),
      );
    }
  } finally {
    await browser.close();
  }

  if (opts.includeLanding) {
    results.push(await checkLanding(opts));
  }

  return {
    ok: results.every((r) => r.ok),
    timestamp: new Date().toISOString(),
    checks: results,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node scripts/staging-smoke.mjs [--shots DIR] [--include-landing] [--skip-cash] [--json]',
    );
    return 0;
  }
  const summary = await runSmoke(opts);
  if (opts.asJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const check of summary.checks) {
      const tag = check.ok ? 'PASS' : 'FAIL';
      const detail = check.commit
        ? ` commit=${check.commit} contract=${check.contractVersion}`
        : '';
      console.log(`[${tag}] ${check.name} (${check.durationMs}ms) ${check.url}${detail}`);
      for (const issue of check.issues) {
        console.log(`       - ${issue}`);
      }
    }
    console.log(summary.ok ? '\nSTAGING SMOKE: PASS' : '\nSTAGING SMOKE: FAIL');
  }
  return summary.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
