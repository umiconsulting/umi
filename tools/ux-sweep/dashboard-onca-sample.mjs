/**
 * ONCA in its own console, with real clicks: does the café's own data reach the
 * screens, and does its logo land?
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `dashboard-shots.mjs`. That tool borrows the
 * tab the operator already has open on the console. This one has to prove that a
 * DIFFERENT person — the administrator the fixture creates — sees a DIFFERENT café,
 * so it opens its own page, signs out of whatever the profile was holding, signs in
 * with the credential it was given, and then asserts on data that only ONCA has
 * (product names from the menu recovered off the legacy till, and the café's own
 * name in the shell). A capture that said "Overview" over another café's numbers
 * would pass a screenshot check and mean nothing.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   UX_BASE=http://127.0.0.1:4020 UX_OWNER_EMAIL=admin@onca.mx \
 *     UX_OWNER_PASSWORD='...' node tools/ux-sweep/dashboard-onca-sample.mjs [logo.png] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const EMAIL = process.env.UX_OWNER_EMAIL || '';
const PASSWORD = process.env.UX_OWNER_PASSWORD || '';
const LOGO = process.argv[2] || '/tmp/onca-logo.png';
const OUT = process.argv[3] || process.env.UX_OUT || '/tmp/ux/onca-console';

/** Two products the legacy till carried and nothing else on this database has. */
const ONCA_MENU_MARKERS = [/Aeropress/, /Amanecer/];

const SCREENS = [
  ['01-overview', /Resumen|Overview/, /Resumen|Overview/],
  ['02-products', /^(Productos|Products)$/, /Productos|Products|Carta|Menu/],
  ['03-customers', /^(Clientes|Customers)$/, /Clientes|Customers/],
  ['04-settings', /Ajustes|Settings/, /Ajustes|Settings/],
];

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

async function signOut() {
  const account = page
    .locator('button')
    .filter({ hasText: /Propietaria|Administradora|Admin|Cuenta|Account|^[A-Z]{1,3}\s+[A-Z]/ })
    .last();
  if ((await account.count()) === 0) return false;
  await account.click();
  await sleep(800);
  const out = page
    .locator('button, a')
    .filter({ hasText: /cerrar sesi|sign out|log out/i })
    .first();
  if ((await out.count()) === 0) return false;
  await out.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2000);
  return true;
}

try {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  const signedOut = await signOut();
  record('start from a clean session', {
    ok: true,
    note: signedOut ? 'signed out of the borrowed session' : 'nothing was signed in',
  });

  const password = page.locator('#login-pw, input[type="password"]');
  if ((await password.count()) === 0) throw new Error('the console is not showing a sign-in form');
  await page.locator('#login-email, input[type="email"]').first().fill(EMAIL);
  await password.first().fill(PASSWORD);
  await page
    .getByRole('button', { name: /entrar|sign in|iniciar|continuar|log in/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(3000);

  const shell = await bodyText();
  record('the administrator signs in', {
    ok: /ONCA/.test(shell),
    note: `signed in as ${EMAIL}; the shell names ONCA`,
  });

  for (const [file, nav, marker] of SCREENS) {
    const item = page
      .locator('nav button, nav a, aside button, aside a, button, a')
      .filter({ hasText: nav })
      .first();
    if ((await item.count()) === 0) {
      record(`open ${file}`, { ok: false, note: `no nav entry matched ${nav}` });
      continue;
    }
    await item.click();
    await sleep(2500);
    const text = await bodyText();
    await page.screenshot({ path: `${OUT}/${file}.png` });
    record(`open ${file}`, {
      ok: marker.test(text),
      note: marker.test(text) ? 'rendered' : 'the screen did not show its own marker',
    });
  }

  // ONCA's OWN MENU, not a screenshot of a heading. The legacy till's 51 products
  // are the one thing on these screens that no other café in this database has.
  await page.goto(`${BASE}/products`, { waitUntil: 'domcontentloaded' });
  await sleep(3500);
  const products = await bodyText();
  const found = ONCA_MENU_MARKERS.filter((pattern) => pattern.test(products));
  await page.screenshot({ path: `${OUT}/05-onca-menu.png`, fullPage: false });
  record('the console shows ONCA’s own catalogue', {
    ok: found.length > 0,
    note:
      found.length > 0
        ? `found ${found.map(String).join(', ')}`
        : 'none of ONCA’s products rendered',
  });

  // ── the logo, through the card, as this administrator ─────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const heading = page.getByRole('heading', { name: /Logo del negocio|Business logo/ }).first();
  await heading.scrollIntoViewIfNeeded();
  await sleep(600);
  const beforeUrl = await page.evaluate(
    () =>
      [...document.querySelectorAll('img')]
        .find((i) => /\/logos\//.test(i.getAttribute('src') || ''))
        ?.getAttribute('src') || null,
  );
  await page.locator('input[type="file"]').last().setInputFiles(LOGO);
  await page.waitForFunction(
    (previous) => {
      const img = [...document.querySelectorAll('img')].find((i) =>
        /\/logos\//.test(i.getAttribute('src') || ''),
      );
      return Boolean(img) && img.getAttribute('src') !== previous;
    },
    beforeUrl,
    { timeout: 30_000 },
  );
  await sleep(1500);
  const after = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find((i) =>
      /\/logos\//.test(i.getAttribute('src') || ''),
    );
    return img
      ? {
          url: img.getAttribute('src'),
          loaded: img.complete && img.naturalWidth > 0,
          width: img.naturalWidth,
        }
      : null;
  });
  record('upload ONCA’s logo through the card', {
    ok: Boolean(after?.loaded) && after.url !== beforeUrl,
    note: after ? `${after.url} (${after.width}px rendered)` : 'no image in the card',
  });
  await page.screenshot({ path: `${OUT}/06-onca-logo-card.png` });
  const wallet = await page.evaluate(() => {
    const img = [...document.querySelectorAll('.wallet-logo img, .wallet-pass img')].find((i) =>
      /\/logos\//.test(i.getAttribute('src') || ''),
    );
    return img
      ? { url: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 }
      : null;
  });
  record('the wallet pass preview draws the same logo', {
    ok: Boolean(wallet?.loaded),
    note: wallet ? wallet.url : 'no pass preview on this café',
  });
  await page.screenshot({ path: `${OUT}/07-onca-pass-and-logo.png`, fullPage: true });
} finally {
  const failed = steps.filter((step) => step.ok === false);
  writeFileSync(
    `${OUT}/walk.json`,
    JSON.stringify({ base: BASE, signedInAs: EMAIL, logo: LOGO, steps }, null, 2),
  );
  await page.close().catch(() => {});
  say(`${steps.length - failed.length}/${steps.length} steps passed; evidence in ${OUT}`);
  process.exit(failed.length > 0 ? 1 : 0);
}
