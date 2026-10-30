import { test as base, expect, chromium } from '@playwright/test';
import process from 'node:process';

// Estos datos aíslan la interfaz. Esta prueba no verifica el backend.
const test = base.extend({
  inventoryPage: async ({ browserName }, run) => {
    expect(browserName).toBe('chromium');
    const browser = process.env.UMI_INVENTORY_CDP
      ? await chromium.connectOverCDP(process.env.UMI_INVENTORY_CDP)
      : await chromium.launch();
    const context = process.env.UMI_INVENTORY_CDP
      ? browser.contexts()[0]
      : await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await run(page);
    await page.close();
    if (!process.env.UMI_INVENTORY_CDP) await browser.close();
  },
});

const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const inventoryLocationId = '88888888-8888-4888-8888-888888888888';
const itemId = '33333333-3333-4333-8333-333333333333';
const item = {
  id: itemId,
  displayName: 'Harina de prueba',
  publicReference: 'HARINA',
  baseUnit: 'gram',
  quantityScale: 2,
  active: true,
  trackingPolicy: 'tracked',
  onHand: [{ locationId, onHand: 100 }],
  conversions: [],
};
const component = {
  id: '55555555-5555-4555-8555-555555555555',
  inventoryItemId: itemId,
  quantity: { value: 125, scale: 2, unit: 'kilogram' },
  conversionNumerator: 1000,
  conversionDenominator: 1,
  roundingPolicy: 'exact',
  required: false,
};
const recipe = {
  id: '44444444-4444-4444-8444-444444444444',
  targetKind: 'product',
  productId: '66666666-6666-4666-8666-666666666666',
  targetName: 'Pan de prueba',
  version: 3,
  active: true,
  yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
  components: [component],
  costMinor: 1250,
  marginMinor: 750,
};

async function prepare(page) {
  const operations = [];
  let overviewReads = 0;
  const overviewCommandIds = new Set();
  await page.addInitScript(() => {
    localStorage.setItem('umi.dashboard.locale', 'es');
    localStorage.setItem(
      'umi-dashboard-local-session',
      JSON.stringify({
        user: { id: '77777777-7777-4777-8777-777777777777', displayName: 'Propietario local' },
        accessExpiresAt: Date.now() + 3600000,
      }),
    );
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id: merchantId, name: 'Café local' }] } });
    if (path.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          merchant: { id: merchantId, name: 'Café local' },
          locations: [{ id: locationId, name: 'Centro', status: 'active' }],
          selectedLocation: { id: locationId, name: 'Centro', status: 'active' },
          membership: {
            permissions: ['merchant.manage', 'inventory.read', 'inventory.adjust'],
            role: 'owner',
          },
          products: { dashboard: { status: 'active' } },
        },
      });
    if (path.endsWith('/administrative-commands')) {
      const body = request.postDataJSON();
      if (body.operation === 'inventory.overview')
        expect(body.parameters.inventoryLocationId).toBeUndefined();
      operations.push(body);
      if (body.operation === 'inventory.overview') {
        overviewReads++;
        // La API rechaza una segunda lectura con la misma identidad mientras la primera sigue activa.
        if (overviewCommandIds.has(body.commandId))
          return route.fulfill({
            status: 409,
            json: { code: 'ADMINISTRATIVE_COMMAND_RECOVERY_REQUIRED', message: 'Lectura repetida' },
          });
        overviewCommandIds.add(body.commandId);
        return route.fulfill({
          json: {
            policy: { fingerprint: 'local-policy' },
            items: [{ id: itemId, scale: 2, baseUnit: 'gram' }],
            balances: [{ inventoryItemId: itemId, inventoryLocationId, onHand: 250, version: 7 }],
            locations: [{ id: inventoryLocationId, locationId, active: true }],
            restockReviews: [],
            activeCount: null,
            page: {},
          },
        });
      }
      if (body.operation === 'inventory.preview')
        return route.fulfill({
          json: {
            approvalRequired: false,
            commandFingerprint: 'local-command',
            approvalPermission: null,
          },
        });
      if (body.operation === 'inventory.adjustment') return route.fulfill({ json: {} });
      if (body.operation === 'inventory.recipe.update')
        return route.fulfill({
          json: {
            recipe: {
              ...recipe,
              ...body.parameters,
              version: 4,
            },
          },
        });
      throw new Error(`Operación inesperada: ${body.operation}`);
    }
    if (path.endsWith('/items')) return route.fulfill({ json: { items: [item] } });
    if (path.endsWith('/recipes')) return route.fulfill({ json: { recipes: [recipe] } });
    if (path.endsWith('/cost-basis'))
      return route.fulfill({ json: { items: [{ inventoryItemId: itemId, unitCostMinor: 1 }] } });
    if (path.endsWith('/plates')) return route.fulfill({ json: { plates: [] } });
    if (request.method() !== 'GET') throw new Error(`Escritura inesperada: ${path}`);
    return route.fulfill({ json: {} });
  });
  return { operations, reads: () => overviewReads };
}

test('ajusta 2.5 a 3.25 con el balance y la versión recién leídos', async ({
  inventoryPage: page,
  baseURL,
}, testInfo) => {
  const server = await prepare(page);
  await page.goto(`${baseURL}/inventory`);
  await page.getByRole('button', { name: 'Acciones de Harina de prueba' }).click();
  await page.getByRole('menuitem', { name: 'Ajustar existencia' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajustar existencia' });
  const input = dialog.getByRole('textbox', { name: 'Nueva existencia contada' });
  await expect(input).toHaveValue('2.5');
  const initialReads = server.reads();
  expect(initialReads).toBe(1);
  await input.fill('3.25');
  await dialog.getByRole('button', { name: 'Guardar ajuste', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const preview = server.operations.find((entry) => entry.operation === 'inventory.preview');
  const committed = server.operations.find((entry) => entry.operation === 'inventory.adjustment');
  expect(preview.parameters.command).toMatchObject({
    direction: 'increase',
    quantity: { value: 75, scale: 2, unit: 'gram' },
    expectedVersion: 7,
    inventoryLocationId,
  });
  expect(committed.parameters).toMatchObject(preview.parameters.command);
  expect(server.reads()).toBe(initialReads);
  await page.screenshot({ path: testInfo.outputPath('ajuste.png') });
});

test('rechaza precisión y rango inválidos y permite cero y coma decimal', async ({
  inventoryPage: page,
  baseURL,
}) => {
  await prepare(page);
  await page.goto(`${baseURL}/inventory`);
  await page.getByRole('button', { name: 'Acciones de Harina de prueba' }).click();
  await page.getByRole('menuitem', { name: 'Ajustar existencia' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ajustar existencia' });
  const input = dialog.getByRole('textbox', { name: 'Nueva existencia contada' });
  const submit = dialog.getByRole('button', { name: 'Guardar ajuste', exact: true });
  for (const value of ['3.251', '90071992547409.92', '-1', '2.50']) {
    await input.fill(value);
    await expect(submit).toBeDisabled();
  }
  for (const value of ['0', '3,25']) {
    await input.fill(value);
    await expect(submit).toBeEnabled();
  }
});

test('guarda una receta convertida con su unidad, factores y cantidad física', async ({
  inventoryPage: page,
  baseURL,
}, testInfo) => {
  const server = await prepare(page);
  await page.goto(`${baseURL}/inventory/recetas`);
  await page.getByRole('button', { name: 'Editar Pan de prueba' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar receta' });
  await expect(dialog.getByRole('textbox', { name: 'Cantidad del componente 1' })).toHaveValue(
    '1.25',
  );
  await expect(dialog.getByText('kg', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect
    .poll(
      () =>
        server.operations.filter((entry) => entry.operation === 'inventory.recipe.update').length,
    )
    .toBe(1);
  const saved = server.operations.find((entry) => entry.operation === 'inventory.recipe.update');
  expect(saved.targetVersion).toBe(3);
  expect(saved.parameters.components).toEqual([
    {
      inventoryItemId: itemId,
      quantity: { value: 125, scale: 2, unit: 'kilogram' },
      conversionNumerator: 1000,
      conversionDenominator: 1,
      roundingPolicy: 'exact',
      required: false,
    },
  ]);
  await page.screenshot({ path: testInfo.outputPath('receta.png') });
});

test('muestra Guardar ajuste y Cancelar dentro de la pantalla y permite cancelar', async ({
  inventoryPage: page,
  baseURL,
}, testInfo) => {
  await prepare(page);
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${baseURL}/inventory`);
    await page.getByRole('button', { name: 'Acciones de Harina de prueba' }).click();
    await page.getByRole('menuitem', { name: 'Ajustar existencia' }).click();
    await page.setViewportSize(viewport);
    const dialog = page.getByRole('dialog', { name: 'Ajustar existencia' });
    await expect(dialog.getByRole('textbox', { name: 'Nueva existencia contada' })).toHaveValue(
      '2.5',
    );
    const cancel = dialog.getByRole('button', { name: 'Cancelar', exact: true });
    await expect(
      dialog.getByRole('button', { name: 'Guardar ajuste', exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(cancel).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`controles-${viewport.width}.png`) });
    await cancel.click();
    await expect(dialog).not.toBeVisible();
  }
});
