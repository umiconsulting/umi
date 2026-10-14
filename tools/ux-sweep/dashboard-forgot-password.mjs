#!/usr/bin/env node
/**
 * The forgotten-password journey, driven in the real browser with real clicks.
 *
 * The dashboard's click sweeps press every control on every route, and the API has unit tests for
 * the token rules. Neither one walks the journey a person walks when they cannot get in: open the
 * sign-in screen, ask for the link, open the link from the message, and set a new password. That
 * journey has four places to fail quietly — the request view, the email, the token handoff, and
 * the new-password form — and this is the instrument that walks all four and says which one broke.
 *
 * WHERE THE EMAIL COMES FROM. The running API sends through whatever `SMTP_HOST` names. This tool
 * does not touch that: it asks the API for the link the way the screen does, and it reads the
 * message from a Mailpit sink when one is configured (`--mint-api` + `--mailpit`). That pair is how
 * a local run proves the message itself — subject, greeting, and the link inside it — instead of
 * only proving that the screen moved on.
 *
 * THE OTHER ADDRESS. `--request-email` is the address typed into the visible form. It defaults to
 * `nadie@ejemplo.invalid`, a reserved name that cannot receive mail, because that step only proves
 * the view: the API answers 201 and sends nothing when no account matches, which is deliberate.
 * `--email` is the account the reset actually runs against.
 *
 * Usage:
 *   node tools/ux-sweep/dashboard-forgot-password.mjs \
 *     --email prueba-reset@umiconsulting.co --password 'ClaveNueva2026!' \
 *     --mint-api http://127.0.0.1:4021 --mailpit http://127.0.0.1:8025 \
 *     --out /tmp/ux/forgot.json --md /tmp/ux/forgot.md --shots /tmp/ux/forgot-shots
 *
 * Flags: --base (http://127.0.0.1:4000), --cdp (http://127.0.0.1:9222), --email, --password,
 * --request-email, --mint-api, --mailpit (http://127.0.0.1:8025), --token-url, --out/--md/--shots,
 * --no-fail.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// Resolve against the WORKSPACE, like the other harnesses here: a hard-coded path belongs to the
// machine the tool was first written on, and the dashboard's tree is the one that owns Playwright.
const WORKSPACE = process.env.UX_WORKSPACE || new URL('../..', import.meta.url).pathname;
const require = createRequire(`${WORKSPACE}/`);
const { chromium } = require('@playwright/test');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const BASE = (arg('--base', 'http://127.0.0.1:4000') || '').replace(/\/+$/, '');
const CDP = arg('--cdp', process.env.UX_CDP || 'http://127.0.0.1:9222');
const EMAIL = arg('--email');
const PASSWORD = arg('--password');
const REQUEST_EMAIL = arg('--request-email', 'nadie@ejemplo.invalid');
const MINT_API = arg('--mint-api');
const MAILPIT = arg('--mailpit', 'http://127.0.0.1:8025');
const TOKEN_URL = arg('--token-url');
const OUT = arg('--out', '/tmp/ux/dashboard-forgot-password.json');
const MD = arg('--md', null);
const SHOTS = arg('--shots', null);
const NO_FAIL = process.argv.includes('--no-fail');

if (!EMAIL) throw new Error('pass --email: the account the reset runs against.');
if (!PASSWORD) throw new Error('pass --password: the new password to set.');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One step, with the evidence for its verdict. */
const steps = [];
let page = null;
let shotIndex = 0;

async function shot(name) {
  if (!SHOTS) return null;
  shotIndex += 1;
  const file = join(SHOTS, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function step(name, body) {
  const started = Date.now();
  try {
    const detail = (await body()) ?? '';
    const file = await shot(name);
    steps.push({ name, ok: true, detail, ms: Date.now() - started, shot: file });
    process.stderr.write(`${name.padEnd(22)} ok ${detail ? `· ${detail}` : ''}\n`);
    return true;
  } catch (error) {
    const file = await shot(`${name}-failed`).catch(() => null);
    steps.push({
      name,
      ok: false,
      detail: error.message,
      ms: Date.now() - started,
      shot: file,
    });
    process.stderr.write(`${name.padEnd(22)} FAILED · ${error.message}\n`);
    // A step that fails ends the walk: the next step would report a second failure about the
    // same broken screen, and two faults where there is one is how a report loses its reader.
    throw error;
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function textOf(selector) {
  return ((await page.locator(selector).first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
}

/** The newest message to `address`, or null while none has arrived. */
async function newestMessage(address, notBefore) {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=20`);
  if (!response.ok) throw new Error(`Mailpit answered ${response.status}`);
  const body = await response.json();
  const match = (body.messages ?? []).find(
    (message) =>
      (message.To ?? []).some((to) => (to.Address ?? '').toLowerCase() === address.toLowerCase()) &&
      new Date(message.Created).getTime() >= notBefore,
  );
  return match ?? null;
}

async function messageBody(id) {
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} for the message body`);
  return response.json();
}

async function main() {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) throw new Error('No browser context on the CDP connection.');
  page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    email: EMAIL,
    requestEmail: REQUEST_EMAIL,
    steps,
  };

  try {
    await step('sign-in screen', async () => {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
      const link = page.getByRole('button', {
        name: /Olvidaste tu contraseña|Forgot your password/i,
      });
      expect(
        await link.count(),
        'the sign-in screen offers no "¿Olvidaste tu contraseña?" control',
      );
      return 'the link to the request view is on the sign-in screen';
    });

    await step('request view', async () => {
      await page
        .getByRole('button', { name: /Olvidaste tu contraseña|Forgot your password/i })
        .first()
        .click();
      const heading = await textOf('h2');
      expect(
        /olvidaste tu contraseña/i.test(heading),
        `the request view does not name itself: heading is "${heading}"`,
      );
      const field = page.locator('#forgot-email');
      expect((await field.count()) === 1, 'the request view has no #forgot-email field');
      return `heading "${heading}", the email field is present`;
    });

    await step('request sent', async () => {
      await page.locator('#forgot-email').fill(REQUEST_EMAIL);
      await page
        .getByRole('button', { name: /Enviar enlace|Send link/i })
        .first()
        .click();
      await page.waitForSelector('text=/Revisa tu correo|Check your email/i', { timeout: 20_000 });
      const sub = await textOf('section p.sub');
      expect(/15/.test(sub), `the confirmation does not state the expiry: "${sub}"`);
      return 'the confirmation view answers and names the 15-minute expiry';
    });

    let link = TOKEN_URL;
    if (!link && MINT_API) {
      await step('message and link', async () => {
        const mintedAt = Date.now() - 1000;
        const response = await fetch(
          `${MINT_API.replace(/\/+$/, '')}/api/auth/local/forgot-password`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL }),
          },
        );
        expect(response.ok, `the mint API answered ${response.status}`);
        for (let attempt = 0; attempt < 20 && !link; attempt += 1) {
          const message = await newestMessage(EMAIL, mintedAt);
          if (message) {
            const body = await messageBody(message.ID);
            const found = /https?:\/\/\S+reset-password\?token=[0-9a-f]{32,}/i.exec(
              body.Text ?? body.HTML ?? '',
            );
            expect(found, 'the message carries no reset link');
            link = found[0];
            report.message = {
              to: EMAIL,
              subject: body.Subject,
              greeting: /Hola ([^,]+),/.exec(body.Text ?? '')?.[1] ?? null,
              linkHost: new URL(link).host,
            };
            return `the message arrived · subject "${body.Subject}" · link on ${report.message.linkHost}`;
          }
          await sleep(500);
        }
        throw new Error(`no message to ${EMAIL} arrived within 10s`);
      });
    }
    expect(link, 'pass --token-url or --mint-api: the walk needs the link from the message');

    await step('new-password view', async () => {
      await page.goto(link, { waitUntil: 'networkidle', timeout: 30_000 });
      const heading = await textOf('h2');
      expect(
        /nueva contraseña/i.test(heading),
        `the link did not open the new-password view: heading is "${heading}"`,
      );
      const fields = page.locator('input[type="password"]');
      expect(
        (await fields.count()) === 2,
        `the view has ${await fields.count()} hidden password fields, not two`,
      );
      const locale = page.getByLabel(/Idioma|Language/i);
      expect((await locale.count()) >= 1, 'the view has no language control');
      return `heading "${heading}", two hidden fields, the language control is present`;
    });

    await step('reveal toggle', async () => {
      const reveals = page.locator('.login-reveal');
      expect(
        (await reveals.count()) === 2,
        `the view has ${await reveals.count()} reveal controls`,
      );
      await page.locator('input[type="password"]').first().fill('ClaveVisible1');
      await reveals.first().click();
      const visible = await page.locator('input[type="text"]').count();
      expect(visible === 1, 'pressing the eye did not make the password readable');
      const back = page.getByRole('button', { name: /Ocultar contraseña|Hide password/i });
      expect((await back.count()) >= 1, 'the reveal control does not announce that it hides');
      await reveals.first().click();
      expect(
        (await page.locator('input[type="text"]').count()) === 0,
        'the second press did not hide the password again',
      );
      return 'the password can be shown and hidden, and the control says which it will do';
    });

    await step('language on the form', async () => {
      const headingBefore = await textOf('h2');
      await page
        .getByLabel(/Idioma|Language/i)
        .first()
        .click();
      await page
        .getByRole('option', { name: /English/i })
        .first()
        .click();
      await page.waitForTimeout(400);
      const headingAfter = await textOf('h2');
      expect(
        /new password/i.test(headingAfter),
        `the form did not follow the language choice: "${headingBefore}" stayed "${headingAfter}"`,
      );
      await page
        .getByLabel(/Idioma|Language/i)
        .first()
        .click();
      await page
        .getByRole('option', { name: /Español|Spanish/i })
        .first()
        .click();
      await page.waitForTimeout(400);
      const headingBack = await textOf('h2');
      expect(
        /nueva contraseña/i.test(headingBack),
        `the form did not come back to Spanish: "${headingBack}"`,
      );
      return `"${headingBefore}" → "${headingAfter}" → "${headingBack}"`;
    });

    await step('refuses a short password', async () => {
      const fields = page.locator('input[type="password"]');
      await fields.nth(0).fill('corta12');
      await fields.nth(1).fill('corta12');
      await page
        .getByRole('button', { name: /Guardar|Reestablecer|Actualizar/i })
        .first()
        .click();
      await page.waitForSelector('text=/Mínimo 8 caracteres|At least 8 characters/i', {
        timeout: 10_000,
      });
      return 'the form refuses it in its own words, before the API is asked';
    });

    await step('refuses a mismatch', async () => {
      const fields = page.locator('input[type="password"]');
      await fields.nth(0).fill(`${PASSWORD}1`);
      await fields.nth(1).fill(`${PASSWORD}2`);
      await page
        .getByRole('button', { name: /Guardar|Reestablecer|Actualizar/i })
        .first()
        .click();
      await page.waitForSelector('text=/no coinciden|do not match/i', { timeout: 10_000 });
      return 'the form refuses two different passwords';
    });

    await step('sets the password', async () => {
      const fields = page.locator('input[type="password"]');
      await fields.nth(0).fill(PASSWORD);
      await fields.nth(1).fill(PASSWORD);
      await page
        .getByRole('button', { name: /Guardar|Reestablecer|Actualizar/i })
        .first()
        .click();
      await page.waitForSelector('text=/Contraseña actualizada|Password updated/i', {
        timeout: 20_000,
      });
      return 'the API accepted the token and the view confirms the change';
    });

    await step('signs in with it', async () => {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.locator('#login-email, input[type="email"]').first().fill(EMAIL);
      await page.locator('#login-pw, input[type="password"]').first().fill(PASSWORD);
      await page
        .getByRole('button', { name: /Entrar|Iniciar sesión|Sign in/i })
        .first()
        .click();
      // The dashboard leaves the sign-in screen on success. Where it lands depends on the
      // account's roles, so the assertion is the one fact every outcome shares: the sign-in
      // screen is gone and no sign-in error is on it.
      await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 25_000 });
      return `the browser left the sign-in screen for ${new URL(page.url()).pathname}`;
    });
  } catch {
    // The failing step is already in the report, with its screenshot.
  }

  report.passed = steps.every((s) => s.ok);
  await mkdir(join(OUT, '..'), { recursive: true }).catch(() => {});
  await writeFile(OUT, JSON.stringify(report, null, 2));

  if (MD) {
    const lines = [
      '# The forgotten-password journey',
      '',
      `Generated: ${report.generatedAt} · ${BASE} · account ${EMAIL}`,
      '',
      `The address typed into the visible form: \`${REQUEST_EMAIL}\``,
      '',
      '| Step | Result | Detail |',
      '| --- | --- | --- |',
      ...steps.map((s) => `| ${s.name} | ${s.ok ? 'ok' : '**FAILED**'} | ${s.detail} |`),
      '',
    ];
    const failed = steps.filter((s) => !s.ok);
    if (failed.length) {
      lines.push('## What broke', '');
      lines.push(...failed.map((s) => `- **${s.name}** — ${s.detail}`));
      lines.push('');
    }
    if (report.message) {
      lines.push('## The message', '');
      lines.push(`- to \`${report.message.to}\`, subject \`${report.message.subject}\``);
      lines.push(`- greeting: \`Hola ${report.message.greeting},\``);
      lines.push(`- the link points at \`${report.message.linkHost}\``, '');
    }
    await writeFile(MD, lines.join('\n'));
  }

  process.stderr.write(
    `\nwrote ${OUT}${MD ? ` and ${MD}` : ''} · ${steps.filter((s) => s.ok).length}/${steps.length} steps ok\n`,
  );
  if (!report.passed && !NO_FAIL) process.exitCode = 1;
  await page.close().catch(() => {});
}

await main();
