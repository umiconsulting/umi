#!/usr/bin/env node
/**
 * Enroll a UmiPOS till through the Dashboard, the way an operator does it.
 *
 * WHY THIS EXISTS. A fresh till has no device credential, so it stops on
 * "Registrar este dispositivo" and never reaches the PIN keypad. Everything below that
 * screen — the PIN, the catalog, every POS flow in `pnpm ux:verify` — is unreachable
 * until somebody works the enrollment by hand: sign in, open Dispositivos, register a
 * register, carry the eight-character code to the till, approve the request. The step is
 * manual today, and `docs/development/RUNNING_UMIPOS.md` describes it in prose.
 *
 * This probe does the Dashboard half with real clicks over CDP, in the operator's own
 * signed-in tab. The till half stays with `pos-native-driver.mjs`, which already knows how
 * to type into the app; the two are wired together in the runbook that calls them.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   node tools/ux-sweep/pos-enrollment-probe.mjs inspect
 *   node tools/ux-sweep/pos-enrollment-probe.mjs register --name "Caja 1"
 *   node tools/ux-sweep/pos-enrollment-probe.mjs approve
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.env.UX_OUT || '/tmp/ux/enrollment';
const OWNER_EMAIL = process.env.UX_OWNER_EMAIL || 'admin@kalalacafe.mx';
const OWNER_PASSWORD = process.env.UX_OWNER_PASSWORD || 'Umi2026!';
const BRANCH = process.env.UX_BRANCH || 'Chapultepec';

const mode = process.argv[2] || 'inspect';
const flag = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
};
const say = (line) => process.stdout.write(`${line}\n`);

mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
// Reuse the operator's tab: a second one is a second Vite client on a box that swaps.
const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? (await context.newPage());

/**
 * Work the console full screen.
 *
 * A windowed console is a smaller viewport, and §2 of the playbook records a defect that
 * was invented by one. It is also not optional here: a window parked off the viewport
 * makes every click miss with "element is outside of the viewport", which reads as a
 * missing control.
 */
async function ensureFullScreen() {
  const session = await context.newCDPSession(page);
  const { windowId } = await session.send('Browser.getWindowForTarget');
  const { bounds } = await session.send('Browser.getWindowBounds', { windowId });
  if (bounds.windowState !== 'fullscreen') {
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'fullscreen' },
    });
    await page.waitForTimeout(1200);
  }
  say(`viewport ${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`);
}

/** Every visible control, with the name a person or a screen reader would use. */
async function controls() {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const nameOf = (el) =>
      (
        el.getAttribute('aria-label') ||
        el.innerText ||
        el.value ||
        el.getAttribute('placeholder') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    const nodes = [
      ...document.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="tab"], [role="link"]',
      ),
    ].filter(visible);
    return {
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .filter(visible)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
      controls: nodes.map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: nameOf(el).slice(0, 90),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      })),
    };
  });
}

async function dump(label) {
  const state = await controls();
  say(`--- ${label} ---`);
  say(`url       ${page.url()}`);
  say(`headings  ${state.headings.join(' | ')}`);
  for (const control of state.controls) {
    const type = control.type ? `[${control.type}]` : '';
    say(`  ${control.tag}${type} "${control.name}"${control.disabled ? ' (disabled)' : ''}`);
  }
  await page.screenshot({ path: `${OUT}/${label.replace(/\W+/g, '-')}.png` });
  return state;
}

/** Sign in only when the console actually asks; the borrowed profile usually has a session. */
async function ensureSignedIn() {
  const password = page.locator('input[type="password"]');
  if ((await password.count()) === 0) return false;
  say(`signing in as ${OWNER_EMAIL}`);
  await page
    .locator('input[type="email"], input[name="email"], input[type="text"]')
    .first()
    .fill(OWNER_EMAIL);
  await password.first().fill(OWNER_PASSWORD);
  await page
    .getByRole('button', { name: /entrar|iniciar sesi|sign in|continuar|log in/i })
    .first()
    .click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  return true;
}

/**
 * Open Dispositivos by clicking the nav the operator clicks.
 *
 * The nav groups items under a section header that must be open, so a missing item is
 * retried once after pressing its section. `goto` is the fallback and it is reported:
 * a probe that silently deep-linked would not prove the entry is reachable.
 */
async function openDevices() {
  const item = page
    .locator('nav a, nav button, aside a, aside button, [role="link"], [role="tab"]')
    .filter({ hasText: /^\s*(Dispositivos|Devices)\s*$/ })
    .first();
  if ((await item.count()) > 0) {
    // The screen may already be the one we want; clicking a nav item that is current
    // still scrolls and can miss if the row sits outside a shrunken viewport.
    if ((await item.getAttribute('aria-current')) === 'page') return 'already-there';
    await item.click();
    await page.waitForTimeout(1200);
    return 'click';
  }
  const section = page
    .locator('nav button, aside button')
    .filter({ hasText: /^\s*(Negocio|Business)\s*$/ })
    .first();
  if ((await section.count()) > 0) {
    await section.click();
    await page.waitForTimeout(600);
    if ((await item.count()) > 0) {
      await item.click();
      await page.waitForTimeout(1200);
      return 'click-after-section';
    }
  }
  await page.goto(`${BASE}/devices`);
  await page.waitForTimeout(1500);
  return 'deep-link';
}

async function chooseBranch() {
  const scope = page.locator('select, [role="combobox"]');
  const scopes = await scope.count();
  for (let index = 0; index < scopes; index += 1) {
    const control = scope.nth(index);
    const text = (await control.innerText().catch(() => '')) || '';
    if (!/Chapultepec|Congreso|branch|sucursal/i.test(text)) continue;
    const options = await control
      .locator('option')
      .allTextContents()
      .catch(() => []);
    if (!options.some((option) => option.includes(BRANCH))) continue;
    await control.selectOption({ label: new RegExp(BRANCH) }).catch(async () => {
      await control.selectOption({ index: 0 });
    });
    say(`branch set to ${BRANCH}`);
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

if ((await ensureSignedIn()) === true) say('signed in');
await ensureFullScreen();

if (mode === 'inspect') {
  const state = await dump('console');
  if (!state.headings.length) say('note: no headings found — is the console signed in?');
  const where = await openDevices();
  say(`opened Dispositivos via ${where}`);
  await dump('devices');
  process.exit(0);
}

if (mode === 'add') {
  say(`opened Dispositivos via ${await openDevices()}`);
  const add = page
    .locator('button')
    .filter({ hasText: /add device|agregar dispositivo|registrar umipos/i })
    .first();
  if ((await add.count()) === 0) {
    say('FAIL: no Add device button on the Devices screen.');
    await dump('devices-no-add');
    process.exit(1);
  }
  await add.click();
  await page.waitForTimeout(1500);
  await dump('add-device-dialog');
  process.exit(0);
}

if (mode === 'register') {
  say(`opened Dispositivos via ${await openDevices()}`);
  const name = String(flag('name', 'Caja 1'));
  // The product list is read once, when the app boots: a product activated while the tab
  // was open stays greyed out until the console is reloaded.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('h1, h2').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await dump('after-reload');

  // Three states are possible, and only the panel tells them apart: closed, open with the
  // product still unchosen, and open with UmiPOS already selected from an earlier run.
  const posName = page.locator('input[id$="-pos-name"]');
  const productTrigger = () =>
    page
      .locator('button')
      .filter({ hasText: /select a product|selecciona un producto/i })
      .first();

  if ((await posName.count()) === 0 && (await productTrigger().count()) === 0) {
    const openButton = page
      .locator('button')
      .filter({ hasText: /add device|agregar dispositivo/i })
      .first();
    if ((await openButton.count()) === 0) {
      say('FAIL: no Add device button and no open panel.');
      await dump('register-no-entry');
      process.exit(1);
    }
    await openButton.click();
    await page.waitForTimeout(1500);
  }

  if ((await posName.count()) === 0 && (await productTrigger().count()) > 0) {
    await productTrigger().click();
    await page.waitForTimeout(600);
    const option = page
      .locator('[role="option"], li, button')
      .filter({ hasText: /^\s*UmiPOS\s*$/i })
      .first();
    if ((await option.count()) === 0) {
      say('FAIL: UmiPOS is not offered. The product is inactive for this merchant.');
      await dump('register-no-umipos-option');
      process.exit(1);
    }
    await option.click();
    await page.waitForTimeout(1200);
  }

  if ((await posName.count()) === 0) {
    say('FAIL: the UmiPOS register panel did not appear.');
    await dump('register-no-panel');
    process.exit(1);
  }

  // The name box is empty; what the dump prints as "Main register" is its placeholder.
  await page.locator('input[id$="-pos-name"]').fill(name);
  say(`name set to ${name}`);

  // The claim is rejected when the request's platform differs from the till's, and the
  // panel defaults to Web while a Linux desktop till reports `linux`. This cost one
  // enrollment: the till showed "el código no es válido o caducó" for a code that was
  // fresh, and the API had answered ENROLLMENT_REJECTED.
  const platform = String(flag('platform', 'linux'));
  const platformTrigger = page.locator('[id$="-pos-platform"]').first();
  if ((await platformTrigger.count()) > 0) {
    await platformTrigger.click();
    await page.waitForTimeout(500);
    const platformOption = page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(`^${platform}$`, 'i') })
      .first();
    if ((await platformOption.count()) === 0) {
      say(`FAIL: no "${platform}" option in the platform list.`);
      await dump('register-no-platform');
      process.exit(1);
    }
    await platformOption.click();
    await page.waitForTimeout(600);
    say(`platform set to ${platform}`);
  } else {
    say('note: this panel has no platform control');
  }
  await dump('register-after-name');

  const submit = page
    .locator('button')
    .filter({ hasText: /crear código|create code/i })
    .first();
  await submit.click();
  await page.waitForTimeout(3000);
  const after = await dump('register-result');

  // The eight-character setup code is published with an aria-label, so read it there
  // rather than parsing rendered text.
  const code = await page.evaluate(() => {
    const node = document.querySelector('[aria-label^="Código "], [aria-label^="Code "]');
    return node
      ? node
          .getAttribute('aria-label')
          .replace(/^\S+\s*/, '')
          .replace(/\s+/g, '')
      : null;
  });
  if (code) {
    say(`SETUP_CODE ${code}`);
    writeFileSync(`${OUT}/setup-code.txt`, code);
  } else {
    say('FAIL: no setup code on screen after registering.');
    say(`headings after: ${after.headings.join(' | ')}`);
    process.exit(1);
  }
  process.exit(0);
}

if (mode === 'options') {
  say(`opened Dispositivos via ${await openDevices()}`);
  const trigger = page
    .locator('button')
    .filter({ hasText: /select a product|selecciona un producto/i })
    .first();
  if ((await trigger.count()) === 0) {
    say('FAIL: the Add device sheet is not open.');
    process.exit(1);
  }
  await trigger.click();
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    options: [...document.querySelectorAll('[role="option"]')].map((option) => ({
      text: option.innerText.replace(/\s+/g, ' ').trim(),
      disabled: option.getAttribute('aria-disabled'),
    })),
    sheet: (document.querySelector('aside.sheet')?.innerText || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700),
  }));
  say(JSON.stringify(state, null, 2));
  await page.screenshot({ path: `${OUT}/product-options.png` });
  process.exit(0);
}

if (mode === 'approve') {
  say(`opened Dispositivos via ${await openDevices()}`);
  // The register step leaves its sheet open, and the sheet covers the request list.
  const close = page
    .locator('button')
    .filter({ hasText: /^\s*(Close|Cerrar)\s*$/i })
    .last();
  if ((await close.count()) > 0) {
    await close.click();
    await page.waitForTimeout(800);
  }
  // The request is created by the till, so the list has to be read again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('h1, h2').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  const approve = page
    .locator('button')
    .filter({ hasText: /aprobar|approve/i })
    .first();
  if ((await approve.count()) === 0) {
    say('FAIL: no approve button. Is there a pending request?');
    await dump('devices-approve-missing');
    process.exit(1);
  }
  await approve.click();
  await page.waitForTimeout(2500);
  await dump('devices-after-approve');
  process.exit(0);
}

say(`unknown mode "${mode}"`);
process.exit(2);
