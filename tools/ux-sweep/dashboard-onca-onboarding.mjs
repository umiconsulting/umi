/**
 * The high-altitude flow, in the real console with real clicks: an administrator
 * opens a branch, reads the café's catalogue, and sees the till it just enrolled.
 *
 * WHY THIS EXISTS. Every piece of this has been measured on its own — the branch
 * route has integration tests, the catalogue has API tests, the device list is
 * covered by the click sweep — and none of that answers the question the owner
 * asks, which is whether a PERSON holding an administrator's session can do the
 * onboarding in order. A screen that works alone can still be unreachable from the
 * one before it.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   UX_BASE=http://127.0.0.1:4020 UX_OWNER_EMAIL=admin@onca.mx UX_OWNER_PASSWORD=… \
 *     node tools/ux-sweep/dashboard-onca-onboarding.mjs --branch "ONCA Sucursal 2" [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const EMAIL = process.env.UX_OWNER_EMAIL || '';
const PASSWORD = process.env.UX_OWNER_PASSWORD || '';
const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
};
const BRANCH = String(flag('branch', 'ONCA Sucursal 2'));
const OUT = String(flag('out', process.env.UX_OUT || '/tmp/ux/onca-onboarding'));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (line) => process.stdout.write(`${line}\n`);
mkdirSync(OUT, { recursive: true });

const steps = [];
const record = (step, detail) => {
  steps.push({ step, ...detail });
  say(`${detail.ok === false ? '✗' : '✓'} ${step}${detail.note ? ` — ${detail.note}` : ''}`);
};

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const bodyText = () => page.locator('body').innerText();

/** Ajustes (or Settings), by the nav an operator clicks. */
async function openNav(pattern) {
  const item = page
    .locator('nav button, nav a, aside button, aside a')
    .filter({ hasText: pattern })
    .first();
  if ((await item.count()) === 0) return false;
  await item.click();
  await sleep(2500);
  return true;
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // The profile keeps a session between runs; this walk is about one café, so a
  // session it did not open is signed out first.
  const account = page
    .locator('button')
    .filter({ hasText: /Admin ONCA|Cuenta|Account|^[A-Z]{1,3}\s+[A-Z]/ })
    .last();
  if ((await account.count()) > 0) {
    await account.click();
    await sleep(700);
    const out = page
      .locator('button, a')
      .filter({ hasText: /cerrar sesi|sign out|log out/i })
      .first();
    if ((await out.count()) > 0) {
      await out.click();
      await sleep(2000);
    }
  }
  const password = page.locator('#login-pw, input[type="password"]');
  if ((await password.count()) === 0) throw new Error('the console is not asking for a sign-in');
  await page.locator('#login-email, input[type="email"]').first().fill(EMAIL);
  await password.first().fill(PASSWORD);
  await page
    .getByRole('button', { name: /entrar|sign in|iniciar|continuar|log in/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(3000);
  record('the administrator signs in', { ok: /ONCA/.test(await bodyText()), note: EMAIL });

  // ── 1 · a branch, from the console ────────────────────────────────────────
  if (!(await openNav(/Ajustes|Settings/))) throw new Error('no Ajustes entry in the nav');
  const addBranch = page.getByRole('button', { name: /Agregar sucursal|Add location/i }).first();
  await addBranch.scrollIntoViewIfNeeded();
  await addBranch.click();
  await sleep(1200);
  const sheet = page.locator('aside.sheet, .sheet').last();
  await sheet.locator('input').first().fill(BRANCH);
  await page.screenshot({ path: `${OUT}/01-branch-sheet.png` });
  await sheet
    .getByRole('button', { name: /^Agregar sucursal$|^Add location$/ })
    .last()
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2500);
  const afterBranch = await bodyText();
  record('open a branch from Ajustes', {
    ok: afterBranch.includes(BRANCH),
    note: `"${BRANCH}" is in the branch list`,
  });
  await page.screenshot({ path: `${OUT}/02-branch-created.png` });

  // ── 2 · the catalogue ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  const catalogue = await bodyText();
  const header = (catalogue.match(/(\d+)\s*(products|productos)/i) || [])[0] || 'no header';
  const rows = await page.evaluate(() => {
    const found = new Set();
    for (const node of document.querySelectorAll('li, tr, [role="row"]')) {
      const text = (node.innerText || '').trim().split('\n')[0];
      if (text) found.add(text);
    }
    return [...found];
  });
  await page.screenshot({ path: `${OUT}/03-catalogue.png`, fullPage: false });
  record('the catalogue loads', {
    ok: /Aeropress|Amanecer|Latte/.test(catalogue),
    note: `header says "${header}"; ${rows.length} distinct rows rendered`,
  });

  // ── 3 · the till the console enrolled ─────────────────────────────────────
  if (!(await openNav(/Dispositivos|Devices/))) throw new Error('no Devices entry in the nav');
  await sleep(2500);
  const devices = await bodyText();
  record('the enrolled terminal is listed', {
    ok: /Caja ONCA/.test(devices),
    note: 'the console shows the device the till claimed',
  });
  await page.screenshot({ path: `${OUT}/04-devices.png` });

  // ── 4 · the permissions this administrator actually holds ─────────────────
  await page.goto(`${BASE}/team`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const team = await bodyText();
  record('the administrator is on the team', {
    ok: /Admin ONCA|admin@onca\.mx/.test(team),
    note: 'member of the café with a role',
  });
  await page.screenshot({ path: `${OUT}/05-team.png` });
} finally {
  const failed = steps.filter((step) => step.ok === false);
  writeFileSync(
    `${OUT}/walk.json`,
    JSON.stringify({ base: BASE, signedInAs: EMAIL, branch: BRANCH, steps }, null, 2),
  );
  await page.close().catch(() => {});
  say(`${steps.length - failed.length}/${steps.length} steps passed; evidence in ${OUT}`);
  process.exit(failed.length > 0 ? 1 : 0);
}
