import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.UX_BASE || 'http://127.0.0.1:4026';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) {
  throw new Error('Use a local dashboard with the authorized API proxy.');
}
const output = process.env.UX_OUT || '/tmp/umi-business-evidence';
mkdirSync(output, { recursive: true });
const state = JSON.parse(readFileSync(process.env.UX_STORAGE_STATE, 'utf8'));
const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9222');
const context = await browser.newContext({
  storageState: state,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const failures = [];
const reports = [];
const accessibility = [];
page.on('pageerror', (error) => failures.push(error.message));
page.on('response', async (response) => {
  if (!response.url().includes('/sales/analysis?')) return;
  reports.push({
    url: response.url(),
    status: response.status(),
    body: await response.json().catch(() => null),
  });
});
async function readyHome() {
  await expect(
    page.getByRole('heading', { name: 'Tu negocio en números', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /^Venta neta/ })).toBeVisible();
  await expect(page.getByText('Consultando operación…', { exact: true })).toHaveCount(0);
}
async function a11y(label) {
  const result = await new AxeBuilder({ page }).analyze();
  const blockers = result.violations.filter((item) =>
    ['serious', 'critical'].includes(item.impact),
  );
  accessibility.push({
    label,
    violations: result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
  });
  assert.equal(
    blockers.length,
    0,
    `${label}: ${JSON.stringify(blockers.map(({ id, impact }) => ({ id, impact })))}`,
  );
}
async function home() {
  await page.getByRole('button', { name: 'Resumen', exact: true }).first().click();
  await readyHome();
}
try {
  await page.goto(`${base}/?home=1`);
  await readyHome();
  await page.getByRole('button', { name: 'Personalizar inicio', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar indicadores', exact: true }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await a11y('home-desktop');
  await page.screenshot({ path: `${output}/home-desktop.png`, fullPage: true });
  const metricLinks = page.locator('.sales-metric');
  assert.equal(await metricLinks.count(), 4);
  const query = new URL(await metricLinks.first().getAttribute('href'), base).searchParams;
  const primary = reports.findLast(
    (entry) => entry.body?.from === query.get('from') && entry.body?.to === query.get('to'),
  )?.body;
  assert.ok(primary, 'The real API returned the primary report.');
  const amount = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: primary.currency,
  }).format(primary.totals.netMinorUnits / 100);
  await expect(metricLinks.first()).toContainText(amount);

  await page.getByRole('button', { name: 'Personalizar inicio', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Piezas en cada ticket', exact: true }).check();
  for (let index = 0; index < 7; index++) {
    const up = page.getByRole('button', { name: 'Subir Piezas en cada ticket', exact: true });
    if (await up.isEnabled()) await up.click();
  }
  await page.getByRole('checkbox', { name: 'Tickets de venta', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.reload();
  await readyHome();
  await expect(page.getByRole('link', { name: /^Tickets de venta/ })).toHaveCount(0);
  await expect(page.locator('.sales-widget-grid > .sales-widget').first()).toContainText(
    'Piezas en cada ticket',
  );
  await page.screenshot({ path: `${output}/home-custom.png`, fullPage: true });
  await page.getByLabel('Periodo', { exact: true }).selectOption('30');
  await readyHome();
  await page.getByRole('link', { name: 'Venta por día', exact: false }).click();
  await expect(
    page.getByRole('heading', { name: 'Horas, días y meses', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Comparar por', { exact: true })).toHaveValue('byDay');
  const detail = new URL(page.url()).searchParams;
  assert.equal(detail.get('locationId'), query.get('locationId'));
  assert.equal(detail.get('refundView'), 'sale_result');
  await page
    .getByLabel('Indicador del gráfico', { exact: true })
    .selectOption('averageTicketMinorUnits');
  await page.getByText('Ver tabla del periodo', { exact: true }).click();
  await page.screenshot({ path: `${output}/sales-time-desktop.png`, fullPage: true });
  await a11y('sales-time');
  await page.goBack();
  await page.goBack();
  await page.goBack();
  if (!page.url().includes('?home=1')) await page.goto(`${base}/?home=1&days=30`);
  await readyHome();
  await expect(page.getByLabel('Periodo', { exact: true })).toHaveValue('30');
  await page.getByRole('link', { name: /^Ticket promedio/ }).click();
  await expect(page.getByLabel('Indicador del gráfico', { exact: true })).toHaveValue(
    'averageTicketMinorUnits',
  );

  await page.getByRole('button', { name: 'Compras conjuntas', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '¿Qué se compra junto?', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${output}/sales-pairs-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/sales-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await a11y('sales-mobile');

  await page.getByLabel('Desde', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(
    page.getByText(
      'Este periodo no contiene tickets de venta. Puede incluir devoluciones de ventas anteriores.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({ path: `${output}/sales-empty.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await home();
  await page.route('**/sales/analysis?**', (route) => route.abort(), { times: 2 });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudieron cargar las ventas.' }),
  ).toBeVisible();
  await expect(page.locator('.sales-metric')).toHaveCount(0);
  await page.screenshot({ path: `${output}/home-error.png`, fullPage: true });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await readyHome();

  let release;
  const slow = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/sales/analysis?**',
    async (route) => {
      await slow;
      await route.continue();
    },
    { times: 2 },
  );
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText('Consultando ventas…', { exact: true })).toBeVisible();
  await expect(page.locator('.sales-metric')).toHaveCount(0);
  await page.screenshot({ path: `${output}/home-loading.png`, fullPage: true });
  release();
  await readyHome();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${output}/home-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        realApi: true,
        primary: {
          from: primary.from,
          to: primary.to,
          currency: primary.currency,
          totals: primary.totals,
        },
        accessibility,
      },
      null,
      2,
    ),
  );
} finally {
  writeFileSync(`${output}/browser-api-evidence.json`, JSON.stringify(reports, null, 2));
  writeFileSync(`${output}/accessibility.json`, JSON.stringify(accessibility, null, 2));
  await context.close();
  await browser.close();
}
