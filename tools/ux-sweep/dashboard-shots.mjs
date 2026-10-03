#!/usr/bin/env node
/**
 * Capture every Dashboard screen the owner sees, in order, with real clicks.
 *
 * WHY THIS EXISTS. A client walkthrough needs the console as much as the till, and a
 * screen-by-screen set is the only honest way to show what an owner gets. The probe
 * borrows the operator's own CDP tab, clicks each nav entry, waits for the screen to
 * settle, and writes one PNG per screen.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   UX_OWNER_EMAIL=admin@kalalacafe.mx UX_OWNER_PASSWORD='...' \
 *     node tools/ux-sweep/dashboard-shots.mjs [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.argv[2] || process.env.UX_OUT || '/tmp/ux/dashboard-client';
const EMAIL = process.env.UX_OWNER_EMAIL || '';
const PASSWORD = process.env.UX_OWNER_PASSWORD || '';

/** file name, nav label in either language, and a marker the screen must show. */
const SCREENS = [
  ['01-overview', /^(Resumen|Overview)$/, /Resumen|Overview|Ventas de hoy|Today/],
  ['02-pedidos', /^(Pedidos|Orders)$/, /Pedidos|Orders/],
  ['03-reportes', /^(Reportes|Reports)$/, /Reportes|Reports/],
  ['04-caja-y-turnos', /^(Caja y turnos|Cash and shifts)$/, /Caja|Cash/],
  ['05-cocina', /^(Cocina|Kitchen)$/, /Cocina|Kitchen/],
  ['06-clientes', /^(Clientes|Customers)$/, /Clientes|Customers/],
  ['07-lealtad', /^(Lealtad y valor|Loyalty and value)$/, /Lealtad|Loyalty/],
  ['08-productos', /^(Productos|Products)$/, /Productos|Products/],
  ['09-inventario', /^(Inventario|Inventory)$/, /Inventario|Inventory/],
  ['10-plano', /^(Plano de mesas|Floor plan)$/, /Plano|Floor plan/],
  ['11-dispositivos', /^(Dispositivos|Devices)$/, /Dispositivos|Devices/],
  ['12-equipo', /^(Equipo y accesos|Team and access)$/, /Equipo|Team/],
  ['13-ajustes', /^(Ajustes|Settings)$/, /Ajustes|Settings/],
];

const say = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? (await context.newPage());

async function ensureFullScreen() {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
  if (bounds.windowState !== 'fullscreen') {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });
    await sleep(1200);
  }
}

async function signIn() {
  const password = page.locator('#login-pw, input[type="password"]');
  if ((await password.count()) === 0) return false;
  if (!EMAIL || !PASSWORD)
    throw new Error('The console is signed out and no credentials were given.');
  await page.locator('#login-email, input[type="email"]').first().fill(EMAIL);
  await password.first().fill(PASSWORD);
  await page
    .getByRole('button', { name: /entrar|sign in|iniciar|continuar|log in/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(2500);
  return true;
}

/**
 * Drop the borrowed session when it belongs to another merchant.
 *
 * The CDP profile keeps a session between runs, so a capture taken without this shows the
 * previous merchant's console — measured once: thirteen screens of the wrong café.
 */
async function signOut() {
  const account = page
    .locator('button')
    .filter({ hasText: /^[A-Z]{1,3}\s+\S|Cuenta|Account/i })
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
  await sleep(2500);
  return true;
}

/** Click the nav entry by label and wait for its marker, so a miss is not a screenshot. */
async function openScreen(pattern, marker) {
  const item = page
    .locator('nav button, nav a, aside button, aside a, button, a')
    .filter({ hasText: pattern })
    .first();
  if ((await item.count()) === 0) return 'not-found';
  await item.click();
  await page.waitForTimeout(1200);
  const seen = await page
    .locator('body')
    .innerText()
    .then((text) => marker.test(text))
    .catch(() => false);
  await page.waitForTimeout(1500);
  return seen ? 'ok' : 'no-marker';
}

if (process.env.UX_SIGNOUT === '1' && (await signOut())) say('signed out of the borrowed session');
if (await signIn()) say(`signed in as ${EMAIL}`);
await ensureFullScreen();

const results = [];
for (const [file, navPattern, marker] of SCREENS) {
  const status = await openScreen(navPattern, marker);
  await page.screenshot({ path: `${OUT}/${file}.png` });
  say(`${file}: ${status}`);
  results.push({ file, status });
}
say(`captured ${results.length} screens into ${OUT}`);
