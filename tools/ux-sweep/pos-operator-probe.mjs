#!/usr/bin/env node
/**
 * Create a manager with an operator PIN, through the Dashboard.
 *
 * WHY THIS EXISTS. An enrolled till stops on "Ingresa tu PIN de operador", and that PIN is
 * a property of a staff member, not of the device. A database whose staff all have
 * `operator_pin_hash = null` therefore has a till that can be enrolled and never signed
 * in — which is exactly the wall the enrollment work hit. The Dashboard is the product
 * path for both halves: Team and access creates the person and sets the PIN.
 *
 * Run:
 *   ./scripts/ux-browser.sh
 *   node tools/ux-sweep/pos-operator-probe.mjs inspect
 *   node tools/ux-sweep/pos-operator-probe.mjs create --name "Gerente Local" --role Manager --pin 1234
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const CDP = process.env.UX_CDP || 'http://127.0.0.1:9222';
const BASE = process.env.UX_BASE || 'http://127.0.0.1:4000';
const OUT = process.env.UX_OUT || '/tmp/ux/operator';

const mode = process.argv[2] || 'inspect';
const flag = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? true);
};
const say = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error(`No browser context on the CDP connection at ${CDP}.`);
const page = context.pages().find((p) => p.url().startsWith(BASE)) ?? (await context.newPage());

/** A window parked off the viewport makes every click miss; §2 wants it full screen anyway. */
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

async function dump(label) {
  const state = await page.evaluate(() => {
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
    return {
      headings: [...document.querySelectorAll('h1, h2, h3')]
        .filter(visible)
        .map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
      controls: [
        ...document.querySelectorAll(
          'button, input, select, textarea, a, [role="tab"], [role="option"]',
        ),
      ]
        .filter(visible)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: nameOf(el).slice(0, 80),
          disabled: el.disabled === true,
        })),
    };
  });
  say(`--- ${label} ---`);
  say(`headings  ${state.headings.join(' | ')}`);
  for (const control of state.controls) {
    say(`  ${control.tag} "${control.name}"${control.disabled ? ' (disabled)' : ''}`);
  }
  await page.screenshot({ path: `${OUT}/${label.replace(/\W+/g, '-')}.png` });
  return state;
}

/** Open Equipo y accesos by clicking the nav the operator clicks. */
async function openStaff() {
  const item = page
    .locator('nav a, nav button, aside a, aside button, [role="link"], [role="tab"]')
    .filter({ hasText: /^\s*(Equipo y accesos|Team and access)\s*$/ })
    .first();
  if ((await item.count()) > 0) {
    if ((await item.getAttribute('aria-current')) === 'page') return 'already-there';
    await item.click();
    await sleep(1200);
    return 'click';
  }
  await page.goto(`${BASE}/staff`);
  await sleep(1500);
  return 'deep-link';
}

if (
  !['repro', 'where'].includes(mode) &&
  (await page.locator('input[type="password"]').count()) > 0
) {
  say('FAIL: the console is signed out; sign in before provisioning.');
  process.exit(1);
}
await ensureFullScreen();

if (mode === 'where') {
  say(`url ${page.url()}`);
  await dump('current');
  process.exit(0);
}

if (mode === 'inspect') {
  say(`opened Equipo y accesos via ${await openStaff()}`);
  await dump('staff');
  process.exit(0);
}

if (mode === 'repro') {
  const password = page.locator('input[type="password"]');
  if ((await password.count()) > 0) {
    say('signing in');
    await page
      .locator('input[type="email"], input[name="email"], input[type="text"]')
      .first()
      .fill(String(flag('email', 'admin@elgranribera.mx')));
    await password.first().fill(String(flag('password', 'Umi2026!')));
    await page
      .getByRole('button', { name: /entrar|sign in|iniciar|continuar|log in/i })
      .first()
      .click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(2500);
  }
  await ensureFullScreen();
  say(`opened Equipo y accesos via ${await openStaff()}`);
  const peopleTab = page
    .locator('[role="tab"], button')
    .filter({ hasText: /^\s*(Personas|People)\s*$/ })
    .first();
  if ((await peopleTab.count()) > 0) {
    await peopleTab.click();
    await sleep(600);
  }
  await page
    .locator('button')
    .filter({ hasText: /añadir persona|add person/i })
    .first()
    .click();
  await sleep(1400);

  // Everything except the phone: name, role, PIN.
  await page.locator('input[id$="-name"]').fill('Sin Teléfono');
  const role = page
    .locator('[role="tab"]')
    .filter({ hasText: /^\s*Manager\s*$/i })
    .first();
  if ((await role.count()) > 0) await role.click();
  await page.locator('input[id$="-pin"]').fill('1234');
  await page.locator('input[id$="-pin-confirmation"]').fill('1234');
  await sleep(600);

  const save = page
    .locator('aside.sheet button')
    .filter({ hasText: /añadir persona|add person/i })
    .last();
  say(`phone value: "${await page.locator('input[id$="-phone"]').inputValue()}"`);
  say(`save button disabled: ${await save.isDisabled()}`);
  const alert = page.locator('aside.sheet [role="alert"]');
  say(
    `message shown by the sheet: ${(await alert.count()) > 0 ? await alert.first().innerText() : '(none)'}`,
  );
  await dump('repro-empty-phone');
  process.exit(0);
}

if (mode === 'diagnose') {
  const events = [];
  page.on('console', (message) => events.push(`console.${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => events.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    events.push(
      `requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`,
    ),
  );

  say(`opened Equipo y accesos via ${await openStaff()}`);
  await sleep(900);
  const add = page
    .locator('button')
    .filter({ hasText: /añadir persona|add person/i })
    .first();
  if ((await add.count()) === 0) {
    say('no button matching "Add person"');
    await dump('diagnose-no-button');
    say(events.join('\n'));
    process.exit(1);
  }
  const box = await add.boundingBox();
  const hit = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}` : 'none';
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  say(`button box ${JSON.stringify(box)}`);
  say(`element at its centre: ${hit}`);
  say(`disabled: ${await add.isDisabled()}`);

  await add.click();
  await sleep(1600);
  const sheet = await page.locator('aside.sheet').count();
  say(`sheet open after the click: ${sheet > 0}`);
  await dump('diagnose-after-click');
  say(events.length ? `--- page events ---\n${events.join('\n')}` : 'no page events');
  process.exit(sheet > 0 ? 0 : 1);
}

if (mode === 'create') {
  const name = String(flag('name', 'Gerente Local'));
  const phone = String(flag('phone', '+521550000000'));
  const roleName = String(flag('role', 'Manager'));
  const pin = String(flag('pin', '1234'));

  say(`opened Equipo y accesos via ${await openStaff()}`);
  // The Add button only exists on the Personas tab.
  const peopleTab = page
    .locator('[role="tab"], button')
    .filter({ hasText: /^\s*(Personas|People)\s*$/ })
    .first();
  if ((await peopleTab.count()) > 0) {
    await peopleTab.click();
    await sleep(700);
  }

  const add = page
    .locator('button')
    .filter({ hasText: /añadir persona|add person/i })
    .first();
  if ((await add.count()) === 0) {
    say('FAIL: no "Add person" button on Team and access.');
    await dump('staff-no-add');
    process.exit(1);
  }
  await add.click();
  await sleep(1400);
  await dump('invite-form');

  await page.locator('input[id$="-name"]').fill(name);
  await page.locator('input[id$="-phone"]').fill(phone);

  const role = page
    .locator('[role="tab"]')
    .filter({ hasText: new RegExp(`^\\s*${roleName}\\s*$`, 'i') })
    .first();
  if ((await role.count()) === 0) {
    say(`FAIL: no "${roleName}" role offered in the invite panel.`);
    await dump('invite-no-role');
    process.exit(1);
  }
  await role.click();
  await sleep(500);

  await page.locator('input[id$="-pin"]').fill(pin);
  await page.locator('input[id$="-pin-confirmation"]').fill(pin);
  await dump('invite-filled');

  // The save button carries the same words as the button that opened the sheet, so it is
  // scoped to the sheet.
  const save = page
    .locator('aside.sheet button')
    .filter({ hasText: /añadir persona|add person/i })
    .last();
  await save.click();
  await sleep(3000);
  const after = await dump('after-create');

  const created = after.controls.some((control) => control.name.includes(name));
  say(
    created
      ? `Created "${name}" with role ${roleName} and a ${pin.length}-digit PIN.`
      : 'Created, but the new person did not appear in the panel dump.',
  );
  process.exit(created ? 0 : 1);
}

say(`unknown mode "${mode}"`);
process.exit(2);
