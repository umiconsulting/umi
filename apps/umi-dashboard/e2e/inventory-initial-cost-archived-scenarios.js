/** Verify archived presentation against retained amounts from the real local API. */
export async function verifyArchivedInitialCost({ page, fixture, expect, evidenceDir }) {
  const base = `/api/merchants/${fixture.merchantId}`;
  const api = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const csrf = document.cookie
          .split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('umi_csrf='));
        const response = await fetch(path, {
          method: body ? 'POST' : 'GET',
          credentials: 'include',
          headers: body
            ? {
                'content-type': 'application/json',
                'X-UMI-CSRF': decodeURIComponent(csrf?.slice('umi_csrf='.length) || ''),
              }
            : {},
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Local API ${response.status}: ${JSON.stringify(data)}`);
        return data;
      },
      { path: base + path, body },
    );
  const items = () => api('/items?includeArchived=true&includeItemsWithoutCost=true&limit=100');
  const read = async (id) => (await items()).items.find((item) => item.id === id);
  const archiveAndInspect = async (item, savedAmount, screenshot) => {
    const search = page.getByRole('textbox', { name: 'Buscar artículo', exact: true });
    if (item.active) {
      await page.getByRole('tab', { name: /^Todo / }).click();
      await search.fill(item.displayName);
      await page
        .getByRole('button', { name: `Acciones de ${item.displayName}`, exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Editar artículo', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Editar artículo', exact: true });
      await dialog.getByRole('button', { name: 'Archivar', exact: true }).click();
      await dialog.getByRole('button', { name: 'Confirmar archivo', exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
    await page.getByRole('tab', { name: /^Archivados / }).click();
    await search.fill(item.displayName);
    await page.getByText(item.displayName, { exact: true }).click();
    const panel = page.locator('.inv-panel');
    expect(await read(item.id)).toMatchObject({ active: false, initialUnitCostMinor: savedAmount });
    expect(
      (await api('/inventory-costing/cost-basis?includeWithoutReceipts=true')).items.some(
        (entry) => entry.inventoryItemId === item.id,
      ),
    ).toBe(false);
    await expect(panel.getByText('Costo no disponible', { exact: true })).toBeVisible();
    await expect(panel).toContainText(
      'El artículo está archivado. La fuente del costo no está disponible.',
    );
    await expect(panel.getByText('Costo inicial guardado:', { exact: false })).toContainText(
      `${(savedAmount / 100).toFixed(2)} MXN / kg`,
    );
    await expect(panel.getByText('Sin costo', { exact: true })).not.toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Agregar costo', exact: true }),
    ).not.toBeVisible();
    await expect(panel.getByText('Calculado con compras', { exact: true })).not.toBeVisible();
    await expect(
      panel.getByText('Las compras registradas tienen prioridad', { exact: false }),
    ).not.toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}/${screenshot}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  };
  const receiptItem = await read(fixture.archivedReceiptItemId);
  expect(receiptItem.initialUnitCostMinor).toBe(12000);
  if (receiptItem.active) {
    const basis = (
      await api('/inventory-costing/cost-basis?includeWithoutReceipts=true')
    ).items.find((entry) => entry.inventoryItemId === receiptItem.id);
    expect(basis).toMatchObject({
      basis: 'weighted_average_of_receipts',
      unitCostMinor: 11000,
      receiptCount: 2,
    });
  }
  await archiveAndInspect(receiptItem, 12000, 'initial-cost-archived-purchases');
  const reference = 'ARCHIVED-INITIAL-ZERO-20261030';
  let zero = (await items()).items.find((item) => item.publicReference === reference);
  if (!zero) {
    const [targetAggregateId, commandId, idempotencyKey] = await page.evaluate(() => [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]);
    await api('/administrative-commands', {
      operation: 'inventory.item.create',
      targetAggregateId,
      commandId,
      idempotencyKey,
      targetVersion: null,
      locationId: fixture.locationId,
      approvalId: null,
      parameters: {
        publicReference: reference,
        displayName: 'Costo inicial cero archivado',
        itemType: 'ingredient',
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'block',
        baseUnit: 'kilogram',
        quantityScale: 2,
        initialUnitCostMinor: 0,
      },
    });
    zero = await read(targetAggregateId);
    // The ordinary tab navigation reloads the real item list after fixture creation.
    await page.getByRole('tab', { name: 'Recetas', exact: true }).click();
    await page.getByRole('tab', { name: 'Artículos', exact: true }).click();
  }
  await archiveAndInspect(zero, 0, 'initial-cost-archived-zero');
}
