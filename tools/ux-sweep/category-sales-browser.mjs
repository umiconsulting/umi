import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const expect = playwrightExpect.configure({ timeout: 30000 });
const base = process.env.UX_BASE || 'http://127.0.0.1:4027';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw Error('Use an authorized local candidate API.');
const output = process.env.UX_OUT || '/tmp/umi-category-evidence';
mkdirSync(output, { recursive: true });
const state = JSON.parse(readFileSync(process.env.UX_STORAGE_STATE, 'utf8'));
const origin = new URL(base).origin;
state.cookies = state.cookies.map((cookie) => ({
  ...cookie,
  name: cookie.name.replace(/^umi_staging_/, 'umi_'),
  domain: new URL(base).hostname,
  secure: false,
  sameSite: 'Lax',
}));
state.origins = state.origins.map((item) => ({
  ...item,
  origin,
  localStorage: item.localStorage.filter((item) => item.name !== 'umi-dashboard-local-session'),
}));
const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9222');
const context = await browser.newContext({
  storageState: state,
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const errors = [],
  reports = [],
  accessibility = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('response', async (response) => {
  if (response.url().includes('/sales/analysis?') && response.ok())
    reports.push(await response.json());
});
async function checkAccessibility(label) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  accessibility.push({ label, violations: violations.map(({ id, impact }) => ({ id, impact })) });
  assert.equal(
    violations.filter((item) => ['critical', 'serious'].includes(item.impact)).length,
    0,
    JSON.stringify(accessibility),
  );
}
try {
  await page.goto(`${base}/?home=1&days=30`);
  await expect(
    page.getByRole('heading', { name: 'Tu negocio en números', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Personalizar inicio', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Venta neta por categoría', exact: true }).check();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  const widget = page.locator('.category-sales-card');
  await expect(widget.getByRole('img')).toBeVisible();
  await expect.poll(() => reports.some((report) => report.byCategory?.length)).toBe(true);
  const report = reports.findLast((report) => report.byCategory?.length);
  const amount = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: report.currency,
  }).format(report.totals.netMinorUnits / 100);
  await expect(widget.locator('.category-sales-total')).toContainText(amount);
  const fills = await widget
    .locator('.category-sales-cell')
    .evaluateAll((nodes) => [
      ...new Set(nodes.map((node) => node.getAttribute('fill').toLowerCase())),
    ]);
  for (const fill of fills)
    assert.ok(report.byCategory.some((row) => (row.color || '#8994a6').toLowerCase() === fill));
  await widget.getByRole('button').first().click();
  await expect(widget.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true');
  assert.ok(await widget.locator('.category-sales-cell[data-muted="true"]').count());
  await widget.getByRole('button').first().click();
  await widget.screenshot({ path: `${output}/category-widget.png`, animations: 'disabled' });
  await page.screenshot({
    path: `${output}/home-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await checkAccessibility('home-desktop');
  await page.reload();
  await expect(widget.getByRole('img')).toBeVisible();
  const detailLink = new URL(
    await widget.getByRole('link', { name: 'Ver informe', exact: false }).getAttribute('href'),
    base,
  );
  assert.equal(detailLink.searchParams.get('from'), report.from);
  assert.equal(detailLink.searchParams.get('to'), report.to);
  assert.equal(detailLink.searchParams.get('locationId'), report.locationId);
  await widget.getByRole('link', { name: 'Ver informe', exact: false }).click();
  await expect(page.locator('.category-sales-full')).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get('section'), 'categories');
  await expect(page.getByRole('table').getByText(amount, { exact: true }).last()).toBeVisible();
  await page.screenshot({
    path: `${output}/category-detail-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await checkAccessibility('category-detail');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCard = await page.locator('.category-sales-full').boundingBox();
  assert.ok(mobileCard.x >= 0 && mobileCard.x + mobileCard.width <= 390);
  const mobileChart = await page.locator('.category-sales-mosaic').boundingBox();
  assert.ok(mobileChart.x >= 0 && mobileChart.x + mobileChart.width <= 390);
  await page.screenshot({
    path: `${output}/category-detail-mobile.png`,
    fullPage: true,
    animations: 'disabled',
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await checkAccessibility('category-mobile');
  await page.goto(`${base}/?home=1`);
  await expect(
    widget.getByText('La venta neta es cero. No hay una participación porcentual que mostrar.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(widget.getByRole('img')).toHaveCount(0);
  await page.screenshot({
    path: `${output}/category-empty.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/sales/analysis?**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    delete body.byCategory;
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${base}/?home=1&days=30`);
  await expect(
    widget.getByText(
      'El desglose por categoría no está disponible. Actualiza la consulta para reintentar.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(widget.getByRole('img')).toHaveCount(0);
  await page.unroute('**/sales/analysis?**');
  let releaseReport;
  const reportReady = new Promise((resolve) => {
    releaseReport = resolve;
  });
  await page.route('**/sales/analysis?**', async (route) => {
    await reportReady;
    await route.continue();
  });
  await page.goto(`${base}/?home=1&days=30`);
  await expect(page.getByText('Consultando ventas…', { exact: true })).toBeVisible();
  await expect(widget).toHaveCount(0);
  releaseReport();
  await expect(widget.getByRole('img')).toBeVisible();
  await page.unroute('**/sales/analysis?**');
  await page.route('**/sales/analysis?**', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.goto(`${base}/?home=1&days=30`);
  await expect(
    page.getByText('No se pudieron cargar las ventas. Los importes no están disponibles.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(widget).toHaveCount(0);
  await page.unroute('**/sales/analysis?**');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(widget.getByRole('img')).toBeVisible();
  assert.deepEqual(errors, []);
  const evidence = {
    passed: true,
    source: 'Candidate service with read-only staging PostgreSQL and live API authorization',
    report: {
      from: report.from,
      to: report.to,
      currency: report.currency,
      totals: report.totals,
      byCategory: report.byCategory,
    },
    fills,
    accessibility,
    errors,
  };
  writeFileSync(`${output}/browser-verification.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await context.close();
  await browser.close();
}
