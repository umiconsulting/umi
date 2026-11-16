import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const phase = option('--phase') ?? 'before';
const out = resolve(
  option('--out') ?? `docs/verification/2026-11-16-semantic-api-gate3/dashboard/${phase}`,
);
mkdirSync(out, { recursive: true });

async function login(page) {
  await page.goto('http://127.0.0.1:4000/login', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(600);
  await page.locator('input[type=email]').fill('verifier.owner@local.test');
  await page.locator('input[type=password]').fill('I1Local2026!');
  await page.getByRole('button', { name: /Entrar|Sign in/ }).click();
  await page.waitForTimeout(1800);
}

async function openSummary(page) {
  await page.goto('http://127.0.0.1:4000/reportes', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Cobros originales', exact: true }).click();
  await page.waitForTimeout(500);
  await page
    .getByRole('group', { name: 'Rango de fechas' })
    .getByRole('button', { name: '30 días', exact: true })
    .click();
  await page.waitForTimeout(2500);
  await page.getByText('Ventas cobradas con propina', { exact: true }).waitFor({ timeout: 15000 });
}

async function captureViewport(browser, viewport, viewportName) {
  const context = await browser.newContext({ viewport, locale: 'es-MX' });
  await context.addInitScript(() => localStorage.setItem('umi.dashboard.locale', 'es'));
  const page = await context.newPage();
  const responses = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (
      /\/reports\/sales(\/insight)?$/.test(url.pathname) ||
      /\/metrics\/(query|insight)$/.test(url.pathname)
    ) {
      let body = null;
      try {
        body = await response.json();
      } catch {}
      responses.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        status: response.status(),
        body,
      });
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${viewportName}] CONSOLE`, message.text());
  });
  page.on('pageerror', (error) => console.log(`[${viewportName}] PAGEERROR`, error.message));
  await login(page);
  await openSummary(page);
  const summaryText = await page.locator('body').innerText();
  await page.screenshot({ path: resolve(out, `summary-${viewportName}.png`), fullPage: true });

  const pivots = {};
  await page.getByRole('button', { name: 'Tabla dinámica', exact: true }).click();
  await page.waitForTimeout(400);
  for (const [group, file] of [
    ['Producto', 'product'],
    ['Categoría', 'category'],
    ['Operador', 'operator'],
    ['Hora', 'hour'],
  ]) {
    await page
      .getByRole('group', { name: 'Agrupar por' })
      .getByRole('button', { name: group, exact: true })
      .click();
    await page.waitForTimeout(500);
    pivots[group] = await page.locator('body').innerText();
    await page.screenshot({
      path: resolve(out, `pivot-${file}-${viewportName}.png`),
      fullPage: true,
    });
  }
  await context.close();
  return { viewport, summaryText, pivots, responses };
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const desktop = await captureViewport(browser, { width: 1440, height: 1000 }, '1440');
const mobile = await captureViewport(browser, { width: 390, height: 844 }, '390');
await browser.close();

writeFileSync(
  resolve(out, 'evidence.json'),
  `${JSON.stringify(
    {
      phase,
      capturedAt: new Date().toISOString(),
      url: 'http://127.0.0.1:4000/reportes',
      range: 'last_30_days',
      location: 'Centro',
      desktop,
      mobile,
    },
    null,
    2,
  )}\n`,
);
console.log('WROTE', out);
