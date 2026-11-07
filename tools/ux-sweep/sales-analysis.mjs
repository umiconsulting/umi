import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const base = process.env.UX_BASE || 'http://127.0.0.1:4015';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Use a local Dashboard.');
const fixture = JSON.parse(readFileSync(process.env.SALES_ANALYSIS_SESSION, 'utf8'));
const output = process.env.UX_OUT || '.sales-analysis-browser';
mkdirSync(output, { recursive: true });
const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9233');
const context = browser.contexts()[0];
await context.addCookies([
  { name: 'umi_access', value: fixture.token, url: base, httpOnly: true },
  { name: 'umi_csrf', value: 'sales-analysis-browser', url: base },
]);
await context.addInitScript(({ user, merchant }) => {
  localStorage.setItem(
    'umi-dashboard-local-session',
    JSON.stringify({
      user: { id: user, displayName: 'Administración de prueba', email: 'analysis@example.test' },
      accessExpiresAt: Date.now() + 7_200_000,
    }),
  );
  localStorage.setItem('umi-dashboard-selected-merchant', merchant);
  localStorage.removeItem('umi-dashboard-selected-location');
}, fixture);
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(`${base}/reportes`);
const language = page.getByRole('button', { name: /^(Language|Idioma)$/ });
await language.click();
await page.getByRole('option', { name: 'Español', exact: true }).click();
await expect(page.getByRole('heading', { name: 'Ventas y ticket promedio' })).toBeVisible();

async function apply() {
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/sales/analysis?') && response.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Consultar', exact: true }).click();
  const result = await response;
  assert.equal(result.status(), 200);
  await expect(page.getByRole('heading', { name: 'Ventas y ticket promedio' })).toBeVisible();
  return result.json();
}

await page.getByLabel('Desde', { exact: true }).fill('2026-11-02');
await page.getByLabel('Hasta', { exact: true }).fill('2026-11-04');
await page.getByLabel('Grupo A', { exact: true }).selectOption({ label: 'Pan' });
await page.getByLabel('Grupo B', { exact: true }).selectOption({ label: 'Café' });
await page.getByLabel('Devoluciones', { exact: true }).selectOption('period_movements');
const movements = await apply();
assert.equal(movements.totals.netMinorUnits, 27000);
assert.equal(movements.selectedGroups.basketsWithBoth, 1);
await expect(page.getByText('1 de 3 compras incluyen Pan y Café.', { exact: true })).toBeVisible();
await expect(page.getByText(/De 2 compras con Pan, 1 también incluyen Café/)).toBeVisible();
await page.getByLabel('Comparar por', { exact: true }).selectOption('byMonth');
await expect(page.getByRole('rowheader', { name: '2026-11', exact: true })).toBeVisible();
await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });

await page.getByLabel('Sucursal del análisis', { exact: true }).selectOption(fixture.location);
const branch = await apply();
assert.equal(branch.totals.tickets, 2);
assert.equal(branch.byLocation.length, 1);
await page.getByLabel('Sucursal del análisis', { exact: true }).selectOption('');
await apply();

await page.getByText('Grupos de productos', { exact: true }).click();
await page.getByRole('button', { name: 'Crear grupo', exact: true }).click();
const groupName = `Desayuno ${Date.now()}`;
await page.getByLabel('Nombre del grupo', { exact: true }).fill(groupName);
await page.getByRole('checkbox', { name: 'Concha', exact: true }).check();
const saved = page.waitForResponse(
  (response) =>
    response.request().method() === 'PUT' && response.url().includes('/analysis/groups/'),
);
await page.getByRole('button', { name: 'Guardar grupo', exact: true }).click();
assert.equal((await saved).status(), 200);
await expect(page.getByRole('button', { name: groupName, exact: true })).toBeVisible();

await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-11-02');
await expect(page.getByLabel('Devoluciones', { exact: true })).toHaveValue('period_movements');
await page.reload();
await page.getByText('Grupos de productos', { exact: true }).click();
await expect(page.getByRole('button', { name: groupName, exact: true })).toBeVisible();

await page.getByRole('button', { name: groupName, exact: true }).click();
await page.getByLabel('Nombre del grupo', { exact: true }).fill(`${groupName} actualizado`);
const updated = page.waitForResponse(
  (response) =>
    response.request().method() === 'PUT' && response.url().includes('/analysis/groups/'),
);
await page.getByRole('button', { name: 'Guardar grupo', exact: true }).click();
assert.equal((await updated).status(), 200);
await page.getByRole('button', { name: `${groupName} actualizado`, exact: true }).click();
const removed = page.waitForResponse(
  (response) =>
    response.request().method() === 'DELETE' && response.url().includes('/analysis/groups/'),
);
await page.getByRole('button', { name: 'Eliminar grupo', exact: true }).click();
assert.equal((await removed).status(), 200);
await expect(
  page.getByRole('button', { name: `${groupName} actualizado`, exact: true }),
).toHaveCount(0);

await page.getByLabel('Desde', { exact: true }).fill('2026-11-03');
await page.getByLabel('Hasta', { exact: true }).fill('2026-11-03');
await page.getByLabel('Devoluciones', { exact: true }).selectOption('period_movements');
const refundOnly = await apply();
assert.equal(refundOnly.totals.tickets, 0);
assert.equal(refundOnly.totals.netMinorUnits, -9000);
await expect(page.getByText(/Este periodo no contiene tickets de venta/)).toBeVisible();

await page.route('**/sales/analysis/options', (route) => route.abort(), { times: 1 });
await page.getByRole('button', { name: 'Actualizar grupos', exact: true }).click();
await expect(page.getByRole('alert')).toBeVisible();
await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-11-03');
await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
await expect(page.getByRole('alert')).toHaveCount(0);
await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-11-03');

await page.route('**/sales/analysis?**', (route) => route.abort(), { times: 1 });
await page.getByLabel('Compras conjuntas por', { exact: true }).selectOption('table_visit');
await page.getByRole('button', { name: 'Consultar', exact: true }).click();
await expect(page.getByRole('alert')).toBeVisible();
const retried = page.waitForResponse(
  (response) => response.url().includes('/sales/analysis?') && response.status() === 200,
);
await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
const retryReport = await (await retried).json();
assert.equal(retryReport.from, '2026-11-03');
assert.equal(retryReport.refundView, 'period_movements');
assert.equal(retryReport.basketUnit, 'table_visit');
await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2026-11-03');
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${output}/mobile.png`, fullPage: true, animations: 'disabled' });
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
assert.deepEqual(errors, []);
await browser.close();
console.log(
  'Browser passed: real API, group persistence, conditional counts, refund-only period, retry filters and mobile width.',
);
