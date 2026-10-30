import { expect } from '@playwright/test';
const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const productId = '44444444-4444-4444-8444-444444444444';
const mappingId = '55555555-5555-4555-8555-555555555555';
const initialRecipe = {
  id: '66666666-6666-4666-8666-666666666666',
  targetKind: 'product',
  productId,
  targetName: 'Pan de recuperación',
  version: 3,
  active: true,
  yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
  components: [
    {
      id: '77777777-7777-4777-8777-777777777777',
      inventoryItemId: itemId,
      quantity: { value: 2, scale: 0, unit: 'gram' },
      conversionNumerator: 1,
      conversionDenominator: 1,
      roundingPolicy: 'exact',
      required: true,
    },
  ],
  costMinor: null,
  marginMinor: null,
};

export async function prepare(page, mode) {
  const writes = [];
  let recipe = mode === 'replacement' ? null : structuredClone(initialRecipe);
  await page.addInitScript(() => {
    localStorage.setItem('umi.dashboard.locale', 'es');
    localStorage.setItem('umi-dashboard-selected-merchant', '11111111-1111-4111-8111-111111111111');
    localStorage.setItem('umi-dashboard-selected-location', '22222222-2222-4222-8222-222222222222');
    localStorage.setItem(
      'umi-dashboard-local-session',
      JSON.stringify({
        user: { id: '88888888-8888-4888-8888-888888888888', displayName: 'Dueño local' },
        accessExpiresAt: Date.now() + 3600000,
      }),
    );
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id: merchantId, name: 'Café local' }] } });
    if (path.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          merchant: { id: merchantId, name: 'Café local' },
          locations: [{ id: locationId, name: 'Centro', status: 'active' }],
          selectedLocation: { id: locationId, name: 'Centro', status: 'active' },
          membership: { permissions: ['merchant.manage', 'inventory.read'], role: 'owner' },
          products: { dashboard: { status: 'active' } },
        },
      });
    if (path.endsWith('/administrative-commands')) {
      const input = route.request().postDataJSON();
      writes.push(input);
      const error = (status, code, details) =>
        route.fulfill({ status, json: { error: { code, message: 'Raw service error', details } } });
      if (mode === 'replacement' && writes.length === 1)
        return error(409, 'INVENTORY_RECIPE_MAPPING_CONFLICT', {
          mappingId,
          mappingVersion: 4,
          mappingType: 'direct',
        });
      if (mode === 'replacement' && writes.length === 2) return error(503, 'SERVICE_UNAVAILABLE');
      if (mode === 'stale' && writes.length === 1) {
        recipe = { ...recipe, version: 4 };
        return error(409, 'OPTIMISTIC_VERSION_CONFLICT');
      }
      if (mode === 'permission') return error(403, 'PERMISSION_DENIED');
      recipe = { ...initialRecipe, ...input.parameters, version: mode === 'stale' ? 5 : 1 };
      return route.fulfill({ json: { recipe } });
    }
    if (path.endsWith('/items'))
      return route.fulfill({
        json: {
          items: [
            {
              id: itemId,
              displayName: 'Harina local',
              publicReference: 'HARINA',
              baseUnit: 'gram',
              quantityScale: 0,
              active: true,
            },
          ],
        },
      });
    if (path.endsWith('/recipes'))
      return route.fulfill({ json: { recipes: recipe ? [recipe] : [] } });
    if (path.endsWith('/recipe-targets'))
      return route.fulfill({
        json: {
          targets: [
            {
              productId,
              productName: 'Pan de recuperación',
              productActive: true,
              variantId: null,
              variantName: null,
              priceMinor: 5000,
            },
          ],
          page: { hasMore: false },
        },
      });
    return route.fulfill({ json: {} });
  });
  return writes;
}
export async function openEditor(page, baseURL, create = false) {
  await page.goto(`${baseURL}/inventory`);
  await page.getByRole('tab', { name: 'Recetas', exact: true }).click();
  await page
    .getByRole('button', {
      name: create ? 'Nueva receta' : 'Editar Pan de recuperación',
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  if (create) {
    await dialog
      .locator('label')
      .filter({ hasText: /^Producto/ })
      .getByRole('button')
      .click();
    await page.getByRole('option', { name: 'Pan de recuperación', exact: true }).click();
    await dialog.getByRole('button', { name: 'Agregar ingrediente', exact: true }).click();
    await dialog
      .locator('label')
      .filter({ hasText: /^Artículo/ })
      .getByRole('button')
      .click();
    await page.getByRole('option', { name: 'Harina local · HARINA', exact: true }).click();
  }
  return dialog;
}

export async function replacementRecovery(page, baseURL) {
  const writes = await prepare(page, 'replacement');
  let dialog = await openEditor(page, baseURL, true);
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Usar esta receta', exact: true }).click();
  await expect(
    dialog.getByRole('textbox', { name: 'Cantidad del ingrediente 1', exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Cerrar', exact: true })).toBeDisabled();
  await page.screenshot({ path: '/private/tmp/umi-inventory-phase2-task2-retry-503.png' });
  await dialog.getByRole('button', { name: 'Reintentar guardado', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Editar receta', exact: true })).toBeVisible();
  expect(writes).toHaveLength(3);
  expect(writes[1].parameters.replaceSalesMapping).toEqual({ mappingId, expectedVersion: 4 });
  expect(writes[2]).toEqual(writes[1]);
}

export async function staleRecovery(page, baseURL) {
  const writes = await prepare(page, 'stale');
  let dialog = await openEditor(page, baseURL);
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(
    dialog.getByText(
      'Otra persona guardó una versión nueva de esta receta. Recarga para ver la versión nueva.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({ path: '/private/tmp/umi-inventory-phase2-task2-stale-reload.png' });
  await dialog.getByRole('button', { name: 'Recargar', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Editar Pan de recuperación', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].targetVersion).toBe(4);
}

export async function translatedError(page, baseURL) {
  await prepare(page, 'permission');
  const dialog = await openEditor(page, baseURL);
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(
    dialog.getByText('No tienes permiso para administrar el inventario.', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('Raw service error', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/private/tmp/umi-inventory-phase2-task2-translated-error.png' });
  await expect(
    dialog.getByRole('textbox', { name: 'Cantidad del ingrediente 1', exact: true }),
  ).toBeEnabled();
}
