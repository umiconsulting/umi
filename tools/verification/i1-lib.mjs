// Shared plumbing for the I1 acceptance harness.
//
// The harness never launches a private browser. It attaches to the CDP
// Chromium that scripts/ux-browser.sh starts, the same surface the dashboard
// sweeps use. The API and the dashboard are started outside this module; the
// runner may own the API process so it can pause and restart it.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const require = createRequire(new URL('../../apps/umi-api/package.json', import.meta.url));
const { Pool } = require('pg');

export const CANDIDATE = '2f52a6d5bd7aad099a79a23955df4c3241c13e01';
export const BASELINE = 'b4ba45fc7ec111dd02e0a0f86dad324697a4ca48';
export const DEFAULT_DB = 'umi_i1_exec_2f52a6d5';
export const DEFAULT_API = 'http://127.0.0.1:4001';
export const DEFAULT_BASE = 'http://127.0.0.1:4000';
export const DEFAULT_DEV = 'http://127.0.0.1:4002';
export const DEFAULT_CDP = 'http://127.0.0.1:9222';
export const PASSWORD = process.env.I1_PASSWORD || 'I1Local2026!';

export const IDS = {
  M1: '11111111-1111-4111-8111-000000000001',
  M2: '11111111-1111-4111-8111-000000000002',
  L1: '11111111-1111-4111-8111-000000000011',
  L2: '11111111-1111-4111-8111-000000000012',
  M2_L1: '05e9a3c1-8b15-55f2-a8f4-0f1b36eb7d0e',
  C1: '11111111-1111-4111-8111-000000000021',
  C2: '11111111-1111-4111-8111-000000000022',
  P1: '11111111-1111-4111-8111-000000000031',
  P2: '11111111-1111-4111-8111-000000000032',
  P3: '11111111-1111-4111-8111-000000000033',
  U1: '11111111-1111-4111-8111-000000000041',
  U2: '11111111-1111-4111-8111-000000000042',
  U3: '11111111-1111-4111-8111-000000000043',
  U4: '11111111-1111-4111-8111-000000000044',
  U5: '11111111-1111-4111-8111-000000000045',
  U6: '11111111-1111-4111-8111-000000000046',
  U7: '11111111-1111-4111-8111-000000000047',
  U8: '11111111-1111-4111-8111-000000000048',
  MZ: '22222222-2222-4222-8222-000000000001',
  MN: '22222222-2222-4222-8222-000000000002',
  MP: '22222222-2222-4222-8222-000000000003',
  MC: '22222222-2222-4222-8222-000000000004',
  LARGE: '22222222-2222-4222-8222-000000000005',
  CATALOG: '22222222-2222-4222-8222-000000000006',
  MIXED: '22222222-2222-4222-8222-000000000007',
  OVERFLOW: '22222222-2222-4222-8222-000000000008',
  HEAVY: '33333333-3333-4333-8333-000000000001',
  HEAVY_L1: '33333333-3333-4333-8333-000000000011',
  PERF: '44444444-4444-4444-8444-000000000001',
  PERF_L1: '44444444-4444-4444-8444-000000000011',
  METRIC: '55555555-5555-4555-8555-000000000001',
  METRIC_L1: '55555555-5555-4555-8555-000000000011',
  METRIC_L2: '55555555-5555-4555-8555-000000000012',
};

export const USERS = {
  owner: 'verifier.owner@local.test',
  branch: 'verifier.branch@local.test',
  denied: 'verifier.denied@local.test',
  revoked: 'verifier.revoked@local.test',
  other: 'verifier.other@local.test',
  nobody: 'verifier.nobody@local.test',
  heavy: 'verifier.heavy@local.test',
  perf: 'verifier.perf@local.test',
};

export const MZ_LOC = '0a6f68b1-1a0a-5a6e-9a6f-0ba1b7a8c3d1';
export const MN_LOC = '0a6f68b1-1a0a-5a6e-9a6f-0ba1b7a8c3d2';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
export function sha256File(path) {
  return sha256(readFileSync(path));
}
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}
export function equalJson(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function nearestRank(samples, percentile) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('no samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}
export function distribution(samples) {
  return {
    n: samples.length,
    p50: nearestRank(samples, 0.5),
    p95: nearestRank(samples, 0.95),
    max: Math.max(...samples),
    min: Math.min(...samples),
  };
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export class Checks {
  constructor() {
    this.items = [];
  }
  check(name, ok, expected, actual) {
    this.items.push({ name, ok: Boolean(ok), expected, actual });
    return Boolean(ok);
  }
  eq(name, actual, expected) {
    return this.check(name, equalJson(actual, expected), expected, actual);
  }
  truthy(name, actual) {
    return this.check(name, Boolean(actual), true, actual);
  }
  includes(name, haystack, needle) {
    return this.check(name, String(haystack).includes(needle), `includes ${needle}`, haystack);
  }
  notIncludes(name, haystack, needle) {
    return this.check(name, !String(haystack).includes(needle), `excludes ${needle}`, haystack);
  }
  get failed() {
    return this.items.filter((item) => !item.ok);
  }
}

export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  absorb(response) {
    const values =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
    for (const raw of values) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  entries() {
    return [...this.cookies];
  }
}

export class ApiClient {
  constructor(apiBase, { log } = {}) {
    this.apiBase = apiBase.replace(/\/+$/, '');
    this.jar = new CookieJar();
    this.log = log || [];
    this.session = null;
  }
  async login(email = USERS.owner, password = PASSWORD) {
    const response = await this.request('/api/auth/local/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
      allowError: true,
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`login ${email} failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    this.jar.absorb(response.raw);
    this.session = response.body?.session ?? null;
    this.email = email;
    return response;
  }
  setCookies(entries = []) {
    this.jar.cookies = new Map(entries);
  }
  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.apiBase}${path}`;
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (this.jar.header()) headers.cookie = this.jar.header();
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = this.jar.cookies.get('umi_csrf');
      if (csrf) headers['x-umi-csrf'] = decodeURIComponent(csrf);
    }
    const started = Date.now();
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      redirect: 'manual',
      signal: options.signal,
    });
    this.jar.absorb(response);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const record = {
      at: new Date().toISOString(),
      method: options.method || 'GET',
      url,
      status: response.status,
      ms: Date.now() - started,
    };
    this.log.push(record);
    if (!options.allowError && (response.status < 200 || response.status >= 300)) {
      const error = new Error(`${record.method} ${url} -> ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return { status: response.status, body, text, raw: response, url, ms: record.ms };
  }
  get(path, options) {
    return this.request(path, options);
  }
}

export class Database {
  constructor(database = DEFAULT_DB, options = {}) {
    this.pool = new Pool({
      host: process.env.I1_PGHOST || '127.0.0.1',
      port: Number(process.env.I1_PGPORT || 5543),
      user: options.user || process.env.I1_PGUSER || 'postgres',
      password: options.password || process.env.I1_PGPASSWORD || 'sales_analysis_local',
      database,
    });
  }
  async query(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }
  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0];
  }
  async value(sql, params = []) {
    const row = await this.one(sql, params);
    return row ? Object.values(row)[0] : null;
  }
  async close() {
    await this.pool.end();
  }
}

export function salesPath(merchantId, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const suffix = params.toString();
  return `/api/merchants/${merchantId}/operations/reports/sales/analysis${suffix ? `?${suffix}` : ''}`;
}

export function optionsPath(merchantId, locationId) {
  const params = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
  return `/api/merchants/${merchantId}/operations/reports/sales/analysis/options${params}`;
}

export class BrowserSession {
  static async open(run, {
    user = USERS.owner,
    password = PASSWORD,
    viewport = { width: 1440, height: 900 },
    merchant,
    location,
    baseUrl = run.baseUrl,
    locale = 'es',
    cookies = null,
    uiLogin = false,
    caseDir = null,
  } = {}) {
    const context = await run.browser.newContext({
      viewport,
      locale: 'es-MX',
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
    });
    if (cookies?.length) {
      const host = new URL(run.apiUrl).hostname;
      await context.addCookies(
        cookies.map(([name, value]) => ({ name, value, domain: host, path: '/' })),
      );
    }
    await context.addInitScript(
      ({ locale: chosen, merchant: merchantId, location: locationId }) => {
        try {
          localStorage.setItem('umi.dashboard.locale', chosen);
          if (merchantId) localStorage.setItem('umi-dashboard-selected-merchant', merchantId);
          else localStorage.removeItem('umi-dashboard-selected-merchant');
          if (locationId) localStorage.setItem('umi-dashboard-selected-location', locationId);
          else localStorage.removeItem('umi-dashboard-selected-location');
        } catch {
          /* storage can be unavailable on a locked profile */
        }
      },
      { locale, merchant, location },
    );
    const page = await context.newPage();
    const errors = [];
    const failedRequests = [];
    const requests = [];
    const responses = [];
    const reportBodies = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push({ type: 'console', text: message.text() });
    });
    page.on('pageerror', (error) => errors.push({ type: 'pageerror', text: error.message }));
    page.on('request', (request) => {
      if (!request.url().includes('/api/')) return;
      requests.push({ at: new Date().toISOString(), method: request.method(), url: request.url() });
    });
    page.on('response', (response) => {
      if (!response.url().includes('/api/')) return;
      responses.push({
        at: new Date().toISOString(),
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
      });
      if (response.url().includes('/operations/reports/sales/analysis?')) {
        response
          .json()
          .then((body) => {
            reportBodies.push({
              at: new Date().toISOString(),
              url: response.url(),
              status: response.status(),
              capturedAt: body?.capturedAt || null,
              from: body?.from || null,
              to: body?.to || null,
              tickets: body?.totals?.tickets ?? null,
            });
          })
          .catch(() => {});
      }
    });
    page.on('requestfailed', (request) => {
      failedRequests.push({
        at: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText ?? 'failed',
      });
    });
    const session = new BrowserSession({ run, context, page, errors, requests, responses, failedRequests, reportBodies, baseUrl, user, caseDir });
    if (uiLogin) await session.login(user, password);
    return session;
  }

  constructor({ run, context, page, errors, requests, responses, failedRequests, reportBodies, baseUrl, user, caseDir }) {
    this.run = run;
    this.context = context;
    this.page = page;
    this.errors = errors;
    this.requests = requests;
    this.responses = responses;
    this.failedRequests = failedRequests;
    this.reportBodies = reportBodies;
    this.baseUrl = baseUrl;
    this.user = user;
    this.caseDir = caseDir;
  }

  clearObservations() {
    this.errors.length = 0;
    this.requests.length = 0;
    this.responses.length = 0;
    this.failedRequests.length = 0;
    this.reportBodies.length = 0;
  }

  async login(email = this.user, password = PASSWORD) {
    await this.page.goto(`${this.baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.locator('input[type=email]').waitFor({ state: 'visible', timeout: 15000 });
    await this.page.locator('input[type=email]').fill(email);
    await this.page.locator('input[type=password]').fill(password);
    await this.page.getByRole('button', { name: 'Entrar' }).click();
    await this.page.waitForTimeout(1200);
    if (this.page.url().includes('/login')) {
      const text = await this.page.locator('body').innerText();
      throw new Error(`browser login failed for ${email}: ${text.slice(0, 300)}`);
    }
  }

  async gotoHome({ days = 30, wait = true } = {}) {
    this.clearObservations();
    await this.page.goto(`${this.baseUrl}/?home=1&days=${days}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (wait) await this.waitForPrimary();
    return this;
  }

  async waitForPrimary(timeout = 25000) {
    await this.page.locator('.sales-primary').waitFor({ state: 'visible', timeout });
    await this.page.waitForFunction(
      () => {
        const element = document.querySelector('.sales-primary');
        return element && element.innerText.trim().length > 0;
      },
      null,
      { timeout },
    );
  }

  async primaryText() {
    return (await this.page.locator('.sales-primary').innerText()).trim();
  }

  async bodyText() {
    return (await this.page.locator('body').innerText()).trim();
  }

  async screenshot(name, { fullPage = true } = {}) {
    const path = join(this.caseDir || this.run.out, name);
    await this.page.screenshot({ path, fullPage });
    return path;
  }

  async openAnalysis({
    location = 'all',
    from = null,
    to = null,
    refundView = null,
    basketUnit = null,
    section = null,
    days = 30,
  } = {}) {
    await this.gotoHome({ days });
    await this.openDetail();
    if (location !== null) {
      await this.page
        .getByLabel('Sucursal del análisis')
        .selectOption({ label: location === 'all' ? 'Todas las sucursales' : location });
    }
    if (from) await this.page.locator('input[type=date]').nth(0).fill(from);
    if (to) await this.page.locator('input[type=date]').nth(1).fill(to);
    if (refundView) {
      await this.page.getByLabel('Devoluciones').selectOption({
        label:
          refundView === 'period_movements'
            ? 'Movimientos del periodo'
            : 'Resultado de las ventas del periodo',
      });
    }
    if (basketUnit) {
      await this.page.getByLabel('Compras conjuntas por').selectOption({
        label: basketUnit === 'table_visit' ? 'Visita de mesa identificada' : 'Ticket',
      });
    }
    await this.page.getByRole('button', { name: 'Consultar', exact: true }).click();
    await this.page.waitForTimeout(2200);
    if (section) {
      const label = {
        overview: 'Resumen de ventas',
        categories: 'Categorías',
        pairs: 'Compras conjuntas',
        time: 'Horas y tendencias',
        distribution: 'Piezas por ticket',
        locations: 'Sucursales',
      }[section];
      await this.page.getByRole('button', { name: label, exact: true }).click();
      await this.page.waitForTimeout(500);
    }
    return this;
  }

  async openDetail() {
    await this.page.locator('.sales-primary').click();
    await this.page.waitForURL(/\/analisis|\/analisis-compra|\/sales-analysis|\/reportes/, { timeout: 15000 }).catch(() => {});
    await this.page.locator('.sales-analysis').waitFor({ state: 'visible', timeout: 25000 });
    await this.page.waitForTimeout(600);
  }

  async queryCache() {
    return this.page.evaluate(async () => {
      try {
        const module = await import('/src/lib/query-client.js');
        const cache = module.queryClient.getQueryCache().getAll();
        return cache
          .filter((entry) => JSON.stringify(entry.queryKey).includes('sales-analysis'))
          .map((entry) => ({
            key: entry.queryKey,
            status: entry.state.status,
            dataUpdatedAt: entry.state.dataUpdatedAt,
            error: entry.state.error ? String(entry.state.error) : null,
            hasData: entry.state.data !== undefined,
          }));
      } catch (error) {
        return { unavailable: String(error) };
      }
    });
  }

  async close() {
    await this.context.close().catch(() => {});
  }
}

export function pidFromFile(path) {
  try {
    return Number(readFileSync(path, 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

export async function waitForHttp(url, { timeout = 60000, expect = 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status === expect) return true;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${url}`);
}

export class ApiProcess {
  constructor({ worktree, port = 4001, database = DEFAULT_DB, logPath = null }) {
    this.worktree = worktree;
    this.port = port;
    this.database = database;
    this.logPath = logPath;
    this.child = null;
    this.stopped = false;
  }
  env() {
    return {
      ...process.env,
      PORT: String(this.port),
      EXPECTED_SCHEMA_VERSION: 'build-v3-290',
      DATABASE_URL_APP: `postgresql://api_login:i1_local_api@127.0.0.1:5543/${this.database}`,
      DATABASE_URL_WORKER: `postgresql://worker_login:i1_local_worker@127.0.0.1:5543/${this.database}`,
      DATABASE_TLS_MODE: 'disable',
      REDIS_URL: process.env.I1_REDIS_URL || 'redis://127.0.0.1:6386',
      CORS_ORIGINS: 'http://127.0.0.1:4000,http://127.0.0.1:4002,http://127.0.0.1:4173',
      OTEL_SDK_DISABLED: 'true',
      WALLET_MODE: 'test',
      RATE_LIMIT_IP_PER_MINUTE: '10000',
      RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE: '10000',
      JWT_SECRET: process.env.JWT_SECRET || 'i1-local-only-jwt-secret-0123456789abcdef',
      NODE_ENV: 'development',
      UMI_ENVIRONMENT: 'development',
    };
  }
  async start() {
    if (this.child) return;
    const cwd = join(this.worktree, 'apps/umi-api');
    this.child = spawn(process.execPath, ['--env-file=.env', 'dist/main.js'], {
      cwd,
      env: this.env(),
      stdio: this.logPath ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      detached: false,
    });
    if (this.logPath) {
      const stream = (await import('node:fs')).createWriteStream(this.logPath, { flags: 'a' });
      this.child.stdout.pipe(stream);
      this.child.stderr.pipe(stream);
    }
    this.stopped = false;
    await waitForHttp(`http://127.0.0.1:${this.port}/health`, { timeout: 60000 });
  }
  async stop() {
    if (!this.child) return;
    this.child.kill('SIGTERM');
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 8000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    if (this.child.exitCode === null) this.child.kill('SIGKILL');
    this.child = null;
    this.stopped = true;
    await sleep(300);
  }
  async restart() {
    await this.stop();
    await this.start();
  }
  pause() {
    if (this.child) this.child.kill('SIGSTOP');
  }
  resume() {
    if (this.child) this.child.kill('SIGCONT');
  }
  async close() {
    if (this.child) await this.stop();
  }
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function worktreeRoot() {
  return resolve(new URL('../..', import.meta.url).pathname);
}

export function fileExists(path) {
  return existsSync(path);
}
