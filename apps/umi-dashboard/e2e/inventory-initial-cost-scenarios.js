/** Real local API acceptance. The caller supplies an isolated signed-in page. */
export async function verifyInitialCost({
  page,
  fixture,
  expect,
  evidenceDir,
  resume,
  checkpoint = () => {},
}) {
  expect(await page.evaluate(() => localStorage.getItem('umi-dashboard-selected-merchant'))).toBe(
    fixture.merchantId,
  );
  const run = Date.now().toString(36);
  const name = resume?.name || `Harina inicial ${run}`;
  const apiBase = `/api/merchants/${fixture.merchantId}`;
  const api = async (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(path, {
          method: body ? 'POST' : 'GET',
          credentials: 'include',
          headers: {
            ...(body
              ? {
                  'content-type': 'application/json',
                  'X-UMI-CSRF': decodeURIComponent(
                    document.cookie
                      .split(';')
                      .map((part) => part.trim())
                      .find((part) => part.startsWith('umi_csrf='))
                      ?.slice('umi_csrf='.length) || '',
                  ),
                }
              : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Local API ${response.status}: ${JSON.stringify(data)}`);
        return data;
      },
      { path: apiBase + path, body },
    );
  const commands = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/administrative-commands')) {
      commands.push(request.postDataJSON());
    }
  });
  const admin = async (operation, targetAggregateId, parameters, targetVersion = null) => {
    const ids = await page.evaluate(() => [crypto.randomUUID(), crypto.randomUUID()]);
    return api('/administrative-commands', {
      operation,
      targetAggregateId,
      targetVersion,
      parameters,
      locationId: fixture.locationId,
      commandId: ids[0],
      idempotencyKey: ids[1],
      approvalId: null,
    });
  };
  const freshId = () => page.evaluate(() => crypto.randomUUID());
  const readItems = () => api('/items?includeItemsWithoutCost=true&limit=100');
  const readItem = async () => (await readItems()).items.find((item) => item.displayName === name);
  const readBasis = async () =>
    (await api('/inventory-costing/cost-basis?includeWithoutReceipts=true')).items.find(
      (item) => item.inventoryItemId === savedId,
    );
  let savedId = resume?.itemId;
  let recipeId = resume?.recipeId;
  const dialog = () => page.getByRole('dialog', { name: /^(Nuevo|Editar) artículo$/ });
  const cost = () => dialog().getByRole('textbox', { name: 'Costo inicial por kg', exact: true });
  const save = () => dialog().getByRole('button', { name: 'Guardar', exact: true });
  const cancel = () => dialog().getByRole('button', { name: 'Cancelar', exact: true });
  const open = async () => {
    if (new URL(page.url()).pathname !== '/inventory')
      await page.getByRole('tab', { name: 'Artículos', exact: true }).click();
    await page.getByRole('textbox', { name: 'Buscar artículo', exact: true }).fill(name);
    await page.getByRole('button', { name: `Acciones de ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Editar artículo', exact: true }).click();
    await expect(dialog()).toBeVisible();
  };
  const commit = async () => {
    await save().click();
    await expect(dialog()).not.toBeVisible();
  };
  if (!resume) {
    await page.goto(new URL('/inventory', page.url()).href);
    await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
    await dialog().getByLabel('Referencia', { exact: false }).fill(`INITIAL-UI-${run}`);
    await dialog().getByLabel('Nombre', { exact: true }).fill(name);
    await dialog()
      .locator('label')
      .filter({ hasText: 'Unidad de inventario' })
      .getByRole('button')
      .click();
    await page.getByRole('option', { name: 'kg', exact: true }).click();
    await dialog()
      .locator('label')
      .filter({ hasText: 'Decimales permitidos' })
      .getByRole('button')
      .click();
    await page.getByRole('option', { name: '2', exact: true }).click();
    await expect(cost()).toHaveValue('');
    for (const value of ['-1', '1e3', '1.001', '90071992547409.92']) {
      await cost().fill(value);
      await expect(save()).toBeDisabled();
      await expect(dialog().getByRole('alert')).toContainText('hasta 2 decimales');
    }
    await cost().fill('100,00');
    await expect(dialog().getByText('MXN', { exact: true })).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}/initial-cost-create-desktop.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await commit();
    let item = await readItem();
    expect(item.initialUnitCostMinor).toBe(10000);
    savedId = item.id;
    const stockAtCreate = item.onHand;
    await page.getByRole('textbox', { name: 'Buscar artículo', exact: true }).fill(name);
    await page.getByText(name, { exact: true }).click();
    await expect(page.getByText('Costo inicial', { exact: true })).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}/initial-cost-manual-desktop.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Cerrar', exact: true })
      .click();
    expect(await readBasis()).toMatchObject({
      basis: 'manual_initial',
      unitCostMinor: 10000,
      receiptCount: 0,
    });
    const recipes = (await api('/recipes')).recipes;
    let recipe = recipes.find(
      (entry) => entry.id === fixture.recipeId || entry.productId === fixture.productId,
    );
    recipeId = recipe?.id || (await freshId());
    await admin(
      recipe ? 'inventory.recipe.update' : 'inventory.recipe.create',
      recipeId,
      {
        ...(!recipe ? { targetKind: 'product', productId: fixture.productId } : {}),
        yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
        components: [
          { inventoryItemId: savedId, quantity: { value: 125, scale: 2, unit: 'kilogram' } },
        ],
      },
      recipe?.version ?? null,
    );
    const readRecipe = async () =>
      (await api('/recipes')).recipes.find(
        (entry) => entry.productId === fixture.productId && entry.active,
      );
    recipeId = (await readRecipe()).id;
    expect((await readRecipe()).costMinor).toBe(12500);
    const showRecipe = async (minor) => {
      await page.getByRole('tab', { name: 'Recetas', exact: true }).click();
      recipe = await readRecipe();
      const row = page.getByRole('row').filter({ hasText: recipe.targetName });
      await expect(row).toContainText((minor / 100).toFixed(2));
    };
    await showRecipe(12500);
    await open();
    await expect(cost()).toHaveValue('100.00');
    await cost().fill('120.00');
    await commit();
    expect((await readItem()).initialUnitCostMinor).toBe(12000);
    expect((await readRecipe()).costMinor).toBe(15000);
    await showRecipe(15000);
    await open();
    const writesBeforeCancel = commands.filter(
      (entry) => entry.operation === 'inventory.item.update',
    ).length;
    await cost().fill('999');
    await cancel().click();
    expect(commands.filter((entry) => entry.operation === 'inventory.item.update')).toHaveLength(
      writesBeforeCancel,
    );
    expect((await readItem()).initialUnitCostMinor).toBe(12000);
    await open();
    await dialog().getByLabel('Vida útil en días', { exact: true }).fill('3');
    await commit();
    expect((await readItem()).initialUnitCostMinor).toBe(12000);
    expect(
      commands.filter((entry) => entry.operation === 'inventory.item.update').at(-1).parameters,
    ).not.toHaveProperty('initialUnitCostMinor');
    await open();
    await dialog().getByLabel('Vida útil en días', { exact: true }).fill('4');
    await page.route('**/administrative-commands', async (route) => {
      if (route.request().postDataJSON()?.operation !== 'inventory.item.update')
        return route.continue();
      await route.fetch();
      await route.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', message: 'Local transport failure' },
      });
      await page.unroute('**/administrative-commands');
    });
    await save().click();
    await expect(
      dialog().getByText('El servicio no está disponible. Intenta de nuevo después.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(cost()).toHaveValue('120.00');
    expect((await readItem()).shelfLifeDays).toBe(4);
    await commit();
    const retries = commands
      .filter((entry) => entry.operation === 'inventory.item.update')
      .slice(-2);
    expect(retries[0].commandId).toBe(retries[1].commandId);
    expect(retries[0].idempotencyKey).toBe(retries[1].idempotencyKey);
    expect((await readItem()).initialUnitCostMinor).toBe(12000);
    await open();
    await cost().fill('');
    await commit();
    expect((await readItem()).initialUnitCostMinor).toBeNull();
    expect(await readBasis()).toMatchObject({ basis: 'no_receipts', unitCostMinor: null });
    await page.getByRole('textbox', { name: 'Buscar artículo', exact: true }).fill(name);
    await page.getByText(name, { exact: true }).click();
    await expect(
      page.getByRole('complementary').getByText('Sin costo', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'Agregar costo', exact: true })
      .click();
    await expect(dialog()).toBeVisible();
    await cost().fill('0');
    await commit();
    expect((await readItem()).initialUnitCostMinor).toBe(0);
    expect(await readBasis()).toMatchObject({ basis: 'manual_initial', unitCostMinor: 0 });
    await open();
    await cost().fill('120');
    await commit();
    expect((await readItem()).onHand).toEqual(stockAtCreate);
    // Real procurement commands post the two receipts and their stock ledger facts.
    const supplier = await api('/suppliers', {
      locationId: fixture.locationId,
      idempotencyKey: await freshId(),
      publicReference: `INITIAL-UI-${run}`,
      displayName: `Proveedor inicial ${run}`,
    });
    for (const [value, unitCostMinor] of [
      [100, 14000],
      [300, 10000],
    ]) {
      const quantity = { value, scale: 2, unit: 'kilogram' };
      const lineTotalMinor = (value * unitCostMinor) / 100;
      const created = await api('/purchase-orders', {
        locationId: fixture.locationId,
        idempotencyKey: await freshId(),
        inventoryLocationId: fixture.inventoryLocationId,
        supplierId: supplier.supplier.id,
        currency: 'MXN',
        lines: [{ inventoryItemId: savedId, quantity, unitCostMinor, lineTotalMinor }],
      });
      const sent = await api(`/purchase-orders/${created.purchaseOrder.id}/send`, {
        locationId: fixture.locationId,
        idempotencyKey: await freshId(),
        purchaseOrderId: created.purchaseOrder.id,
        expectedVersion: created.purchaseOrder.version,
      });
      await api(`/purchase-orders/${sent.purchaseOrder.id}/receipts`, {
        locationId: fixture.locationId,
        idempotencyKey: await freshId(),
        purchaseOrderId: sent.purchaseOrder.id,
        expectedVersion: sent.purchaseOrder.version,
        lines: [
          {
            purchaseOrderLineId: sent.purchaseOrder.lines[0].id,
            quantity,
            actualUnitCostMinor: unitCostMinor,
            lineTotalMinor,
          },
        ],
      });
    }
    expect(await readBasis()).toMatchObject({
      basis: 'weighted_average_of_receipts',
      unitCostMinor: 11000,
      receiptCount: 2,
      receiptLineCount: 2,
      receivedQuantity: { value: 400, scale: 2 },
    });
    expect((await readRecipe()).costMinor).toBe(13750);
    checkpoint({ name, itemId: savedId, recipeId });
    await showRecipe(13750);
    await page.screenshot({
      path: `${evidenceDir}/initial-cost-recipe-purchases.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await open();
  await expect(cost()).toHaveValue('120.00');
  await expect(dialog()).toContainText('Las compras registradas tienen prioridad');
  await cancel().click();
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByText('Calculado con compras', { exact: true })).toBeVisible();
  await expect(page.getByText('Costo inicial guardado:', { exact: false })).toContainText('120.00');
  await page.screenshot({
    path: `${evidenceDir}/initial-cost-source-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page.route('**/inventory-costing/cost-basis?**', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.getByRole('tab', { name: 'Recetas', exact: true }).click();
  await page.getByRole('tab', { name: 'Artículos', exact: true }).click();
  await page.getByRole('textbox', { name: 'Buscar artículo', exact: true }).fill(name);
  await page.getByText(name, { exact: true }).click();
  await expect(page.locator('.inv-panel').getByRole('alert')).toContainText(
    'No se pudo leer la base del costo.',
  );
  await expect(
    page.locator('.inv-panel').getByText('Sin costo', { exact: true }),
  ).not.toBeVisible();
  await page.unroute('**/inventory-costing/cost-basis?**');

  await page.getByRole('tab', { name: 'Costos y márgenes', exact: true }).click();
  const basisRow = page
    .getByRole('row')
    .filter({ hasText: name })
    .filter({ hasText: 'Calculado con compras' });
  await expect(basisRow).toContainText('Calculado con compras');
  await expect(basisRow).toContainText('110.00');
  await page.screenshot({
    path: `${evidenceDir}/initial-cost-report-desktop.png`,
    fullPage: true,
    animations: 'disabled',
  });
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 640 },
  ]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open();
    await page.setViewportSize(viewport);
    await save().scrollIntoViewIfNeeded();
    await expect(save()).toBeInViewport({ ratio: 1 });
    await expect(cancel()).toBeInViewport({ ratio: 1 });
    expect(await dialog().evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({
      path: `${evidenceDir}/initial-cost-controls-${viewport.width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await cost().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${evidenceDir}/initial-cost-field-${viewport.width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await cancel().click();
  }
  return {
    itemId: savedId,
    recipeId,
    cases: [
      ...(resume
        ? []
        : [
            'create',
            'invalid',
            'edit',
            'cancel',
            'unchanged',
            'ambiguous-retry',
            'clear',
            'zero',
            'no-stock-change',
            'recipe-12500',
            'recipe-15000',
            'purchases-11000',
            'recipe-13750',
          ]),
      'sources',
      'source-read-error',
      'desktop',
      'mobile',
    ],
  };
}
