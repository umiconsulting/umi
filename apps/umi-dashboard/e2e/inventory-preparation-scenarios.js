import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Run only against the caller's isolated synthetic preparation fixture. */
export async function verifyInventoryPreparation({ page, fixture, expect, evidenceDir, base }) {
  const commandPath = `/api/merchants/${fixture.merchantId}/administrative-commands`;
  const commandPattern = `**${commandPath}`;
  const api = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(path, {
          method: body ? 'POST' : 'GET',
          credentials: 'include',
          headers: body
            ? {
                'content-type': 'application/json',
                'X-UMI-CSRF': decodeURIComponent(
                  document.cookie
                    .split(';')
                    .map((part) => part.trim())
                    .find((part) => part.startsWith('umi_csrf='))
                    ?.slice(9) || '',
                ),
              }
            : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(`Local API ${response.status}: ${JSON.stringify(result)}`);
        return result;
      },
      { path, body },
    );
  const command = (operation, targetAggregateId, parameters, targetVersion = null) =>
    api(commandPath, {
      operation,
      locationId: fixture.locationId,
      targetAggregateId,
      targetVersion,
      commandId: randomUUID(),
      idempotencyKey: randomUUID(),
      approvalId: null,
      parameters,
    });
  const balance = async (itemId) => {
    const overview = await command('inventory.overview', itemId, {
      itemId,
      inventoryLocationId: fixture.inventoryLocationId,
      limit: 100,
    });
    return overview.balances.find((entry) => entry.inventoryItemId === itemId)?.onHand || 0;
  };
  const balances = async () => ({
    output: await balance(fixture.outputItemId),
    flour: await balance(fixture.ingredientId),
    nested: await balance(fixture.nestedOutputItemId),
  });
  const requests = [];
  const results = [];
  page.on('request', (request) => {
    if (request.url().endsWith(commandPath) && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.operation === 'inventory.production.produce') requests.push(body);
    }
  });
  page.on('response', async (response) => {
    if (
      response.url().endsWith(commandPath) &&
      response.ok() &&
      response.request().postDataJSON()?.operation === 'inventory.production.produce'
    ) {
      try {
        results.push(await response.json());
      } catch {
        /* A lost response has no readable body. */
      }
    }
  });
  const dialog = () => page.getByRole('dialog', { name: 'Nueva preparación', exact: true });
  const close = async () => {
    await dialog()
      .getByRole('button', { name: /^(Cancelar|Cerrar)$/ })
      .click();
    await expect(dialog()).toHaveCount(0);
  };
  const openPrep = async (itemId = fixture.outputItemId) => {
    if (new URL(page.url()).pathname !== '/inventory/preparacion') {
      await page.getByRole('tab', { name: 'Preparación', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Nueva preparación', exact: true }).click();
    await dialog().getByLabel('Artículo a preparar', { exact: true }).selectOption(itemId);
    await dialog().getByLabel('Almacén', { exact: true }).selectOption(fixture.inventoryLocationId);
  };
  const review = async (amount, grams) => {
    await dialog().getByLabel('Cantidad a preparar', { exact: true }).fill(String(amount));
    await dialog().getByRole('button', { name: 'Revisar ingredientes', exact: true }).click();
    await expect(dialog().getByLabel('Ingredientes revisados')).toContainText(`${grams} g`);
  };
  const confirm = async () => {
    await dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }).click();
    await expect(dialog().getByRole('status')).toContainText('Preparación registrada:');
    await expect(dialog().getByRole('status')).toContainText('Lote:');
  };
  const before = await balances();
  const recipeRows = [];
  let cursor = '';
  do {
    const response = await api(
      `/api/merchants/${fixture.merchantId}/recipes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    recipeRows.push(...response.recipes);
    cursor = response.page?.hasMore ? response.page.nextCursor : '';
  } while (cursor);

  await page.goto(`${base}/inventory/recetas`);
  await expect(page.getByRole('row').filter({ hasText: 'Pan preparado' })).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: 'Pan de prueba 105' })).toHaveCount(1);
  const salesRecipe = recipeRows.find((entry) => entry.productId === fixture.productId);
  expect(salesRecipe).toBeDefined();
  const sales = page.getByRole('row').filter({ hasText: salesRecipe.targetName });
  await expect(sales).toHaveCount(1);
  await expect(sales.getByRole('button', { name: 'Preparar', exact: true })).toHaveCount(0);
  await page
    .getByRole('row')
    .filter({ hasText: 'Pan preparado' })
    .getByRole('button', { name: 'Preparar', exact: true })
    .click();
  await expect(dialog().getByLabel('Artículo a preparar', { exact: true })).toHaveValue(
    fixture.outputItemId,
  );
  await dialog().getByLabel('Cantidad a preparar', { exact: true }).fill('5');
  await expect(
    dialog().getByRole('button', { name: 'Revisar ingredientes', exact: true }),
  ).toBeDisabled();
  await dialog().getByLabel('Almacén', { exact: true }).selectOption(fixture.inventoryLocationId);
  await review(5, 500);
  await page.screenshot({ path: `${evidenceDir}/recipe-half-preview.png` });
  await close();
  expect(await balances()).toEqual(before);

  await page
    .getByRole('row')
    .filter({ hasText: 'Pan preparado' })
    .getByRole('button', { name: 'Preparar', exact: true })
    .click();
  await dialog().getByLabel('Almacén', { exact: true }).selectOption(fixture.inventoryLocationId);
  await review(5, 500);
  await confirm();
  await page.screenshot({ path: `${evidenceDir}/recipe-half-success.png` });
  await close();

  await openPrep();
  await expect(
    dialog().getByLabel('Artículo a preparar', { exact: true }).locator('option'),
  ).toHaveCount(109);
  await dialog()
    .getByLabel('Artículo a preparar', { exact: true })
    .selectOption(fixture.paginationItemId);
  await expect(dialog().getByLabel('Artículo a preparar', { exact: true })).toContainText(
    fixture.paginationItemName,
  );
  await dialog()
    .getByLabel('Artículo a preparar', { exact: true })
    .selectOption(fixture.outputItemId);
  await review(20, 2000);
  await dialog().getByLabel('Cantidad a preparar', { exact: true }).fill('5');
  await expect(
    dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }),
  ).toHaveCount(0);
  await review(20, 2000);
  await dialog()
    .getByLabel('Almacén', { exact: true })
    .selectOption(fixture.secondInventoryLocationId);
  await expect(dialog().getByLabel('Ingredientes revisados')).toHaveCount(0);
  await dialog().getByLabel('Almacén', { exact: true }).selectOption(fixture.inventoryLocationId);
  await review(20, 2000);
  await dialog()
    .getByLabel('Artículo a preparar', { exact: true })
    .selectOption(fixture.nestedOutputItemId);
  await expect(dialog().getByLabel('Ingredientes revisados')).toHaveCount(0);
  await dialog()
    .getByLabel('Artículo a preparar', { exact: true })
    .selectOption(fixture.outputItemId);
  await review(20, 2000);
  await confirm();
  await close();

  await openPrep(fixture.nestedOutputItemId);
  await review(5, 50);
  await confirm();
  await close();

  // A real recipe update makes the server refuse the old reviewed plan.
  const original = recipeRows.find((recipe) => recipe.targetItemId === fixture.outputItemId);
  const parameters = {
    yieldQuantity: original.yieldQuantity,
    ...(original.shelfLifeDays == null ? {} : { shelfLifeDays: original.shelfLifeDays }),
    components: original.components.map(
      ({
        inventoryItemId,
        quantity,
        conversionNumerator,
        conversionDenominator,
        roundingPolicy,
        required,
      }) => ({
        inventoryItemId,
        quantity,
        conversionNumerator,
        conversionDenominator,
        roundingPolicy,
        required,
      }),
    ),
  };
  await openPrep();
  await review(5, 500);
  const changed = await command(
    'inventory.recipe.update',
    original.id,
    {
      ...parameters,
      components: parameters.components.map((line) => ({
        ...line,
        quantity: { ...line.quantity, value: line.quantity.value * 2 },
      })),
    },
    original.version,
  );
  try {
    await dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText('La receta cambió');
    await expect(
      dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}/stale-recipe.png` });
    await dialog().getByRole('button', { name: 'Revisar ingredientes', exact: true }).click();
    await expect(dialog().getByLabel('Ingredientes revisados')).toContainText('1000 g');
  } finally {
    await command('inventory.recipe.update', changed.recipe.id, parameters, changed.recipe.version);
    await close();
  }

  // Existing stock rules reject production in the empty secondary stock room.
  await openPrep();
  await dialog()
    .getByLabel('Almacén', { exact: true })
    .selectOption(fixture.secondInventoryLocationId);
  await review(5, 500);
  await dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }).click();
  await expect(dialog().getByRole('alert')).toContainText('No hay ingredientes suficientes');
  await close();

  // One gram of mixture would consume half a gram at an integer ingredient scale.
  await openPrep(fixture.nestedItemId);
  await dialog().getByLabel('Cantidad a preparar', { exact: true }).fill('1');
  await dialog().getByRole('button', { name: 'Revisar ingredientes', exact: true }).click();
  await expect(dialog().getByRole('alert')).toContainText('exactitud');
  await expect(
    dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }),
  ).toHaveCount(0);
  await close();

  // A failed preview remains an error and cannot expose confirmation.
  await openPrep();
  const failPreview = async (route) => {
    if (route.request().postDataJSON()?.operation === 'inventory.production.preview')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Local injected failure' },
        }),
      });
    else await route.continue();
  };
  await page.route(commandPattern, failPreview);
  await dialog().getByLabel('Cantidad a preparar', { exact: true }).fill('5');
  await dialog().getByRole('button', { name: 'Revisar ingredientes', exact: true }).click();
  await expect(dialog().getByRole('alert')).toBeVisible();
  await expect(
    dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/preview-error.png` });
  await page.unroute(commandPattern, failPreview);
  await close();

  // Consume the real server response, then lose it before the UI receives it.
  await openPrep();
  await review(5, 500);
  let lostResult;
  let intercepted = false;
  const loseResponse = async (route) => {
    if (
      !intercepted &&
      route.request().postDataJSON()?.operation === 'inventory.production.produce'
    ) {
      intercepted = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lostResult = await response.json();
      await route.abort('failed');
    } else await route.continue();
  };
  await page.route(commandPattern, loseResponse);
  await dialog().getByRole('button', { name: 'Confirmar preparación', exact: true }).click();
  await expect(
    dialog().getByRole('button', { name: 'Reintentar preparación', exact: true }),
  ).toBeVisible();
  await expect(dialog().getByLabel('Cantidad a preparar', { exact: true })).toBeDisabled();
  await expect(dialog().getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${evidenceDir}/response-loss.png` });
  await dialog().getByRole('button', { name: 'Reintentar preparación', exact: true }).click();
  await expect(dialog().getByRole('status')).toContainText(lostResult.lotReference);
  expect(requests.at(-1)).toEqual(requests.at(-2));
  await page.unroute(commandPattern, loseResponse);
  await close();

  // Mobile controls stay within both required viewports and accept real clicks.
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await openPrep(fixture.nestedOutputItemId);
    await review(5, 50);
    const confirmButton = dialog().getByRole('button', {
      name: 'Confirmar preparación',
      exact: true,
    });
    const box = await confirmButton.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    await page.screenshot({ path: `${evidenceDir}/mobile-${width}.png` });
    await close();
  }
  for (const request of requests) {
    expect(request.parameters.quantity).toEqual(request.parameters.plannedQuantity);
    expect(request.parameters.recipeFingerprint).toMatch(/^[0-9a-f]{64}$/);
  }
  const after = await balances();
  expect(after).toEqual({
    output: before.output + 30,
    flour: before.flour - 3050,
    nested: before.nested + 5,
  });
  for (const result of [...results, lostResult]) {
    const recall = await api(
      `/api/merchants/${fixture.merchantId}/stock-lots/${result.lotId}/recall`,
    );
    expect(recall.lotReference).toBe(result.lotReference);
  }
  await page.getByRole('tab', { name: 'Artículos', exact: true }).click();
  await page.getByPlaceholder('Buscar artículo').fill('Pan preparado');
  await expect(page.locator('.inv-row').filter({ hasText: 'Pan preparado' })).toContainText(
    `${after.output} pza`,
  );
  await page.screenshot({ path: `${evidenceDir}/stock-after.png` });
  writeFileSync(
    `${evidenceDir}/api-evidence.json`,
    JSON.stringify(
      {
        before,
        after,
        requests,
        results,
        lostResult,
        pagination: { itemName: fixture.paginationItemName, activeItemRecipes: 108 },
        screenshots: [
          'recipe-half-preview.png',
          'recipe-half-success.png',
          'stale-recipe.png',
          'preview-error.png',
          'response-loss.png',
          'mobile-320.png',
          'mobile-390.png',
          'stock-after.png',
        ],
      },
      null,
      2,
    ),
  );
}
