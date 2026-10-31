/** Use a real local API and an isolated page with an authenticated owner. */
export async function verifyNegativeStock({ page, fixture, expect, evidenceDir }) {
  const hints = {
    allow_and_flag:
      'Permite vender aunque la existencia registrada no alcance. El saldo puede quedar negativo.',
    block: 'Impide la venta cuando la existencia registrada no alcanza.',
    manager_override: 'Pide autorización para vender cuando la existencia registrada no alcanza.',
  };
  const labels = {
    allow_and_flag: 'Permitir saldo negativo',
    block: 'Bloquear',
    manager_override: 'Con autorización',
  };
  const commands = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/administrative-commands'))
      commands.push(request.postDataJSON());
  });
  const dialog = () => page.getByRole('dialog', { name: /^(Nuevo|Editar) artículo$/ });
  const policy = () =>
    dialog().locator('label').filter({ hasText: 'Si falta inventario' }).getByRole('button');
  const save = async () => {
    await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
  };
  const readItem = (name) =>
    page.evaluate(
      async ({ merchantId, name }) => {
        const response = await fetch(
          `/api/merchants/${merchantId}/items?includeItemsWithoutCost=true&limit=100`,
        );
        if (!response.ok) throw new Error(`Read items: ${response.status}`);
        return (await response.json()).items.find((item) => item.displayName === name);
      },
      { merchantId: fixture.merchantId, name },
    );
  const results = [];
  const run = Date.now().toString(36);
  for (const [value, label] of Object.entries(labels)) {
    const name = `Saldo ${value} ${run}`;
    await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
    await expect(policy()).toHaveText(labels.allow_and_flag);
    await expect(dialog().getByText(hints.allow_and_flag, { exact: true })).toBeVisible();
    await dialog().getByLabel('Referencia', { exact: false }).fill(`NEG-${value}-${run}`);
    await dialog().getByLabel('Nombre', { exact: true }).fill(name);
    if (value !== 'allow_and_flag') {
      await policy().click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
    await expect(dialog().getByText(hints[value], { exact: true })).toBeVisible();
    await save();
    expect(commands.at(-1).operation).toBe('inventory.item.create');
    expect(commands.at(-1).parameters.negativeStockPolicy).toBe(value);
    const created = await readItem(name);
    expect(created.negativeStockPolicy).toBe(value);
    await page.getByRole('textbox', { name: 'Buscar artículo', exact: true }).fill(name);
    await page.getByRole('button', { name: `Acciones de ${name}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Editar artículo', exact: true }).click();
    await expect(policy()).toHaveText(label);
    await expect(dialog().getByText(hints[value], { exact: true })).toBeVisible();
    await dialog().getByLabel('Vida útil en días', { exact: true }).fill('3');
    await save();
    expect(commands.at(-1).operation).toBe('inventory.item.update');
    expect(commands.at(-1).parameters.negativeStockPolicy).toBe(value);
    const updated = await readItem(name);
    expect(updated.negativeStockPolicy).toBe(value);
    expect(updated.shelfLifeDays).toBe(3);
    await page.getByText(name, { exact: true }).click();
    const panel = page.getByRole('complementary');
    await expect(panel.getByText('Si falta inventario', { exact: true })).toBeVisible();
    await expect(panel.getByText(label, { exact: true })).toBeVisible();
    await page.screenshot({
      path: `${evidenceDir}/negative-stock-detail-${value}.png`,
      fullPage: true,
    });
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
    results.push({ itemId: created.id, policy: value, preserved: true });
  }
  await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 640 });
  await policy().scrollIntoViewIfNeeded();
  await policy().click();
  await page.getByRole('option', { name: 'Con autorización', exact: true }).click();
  await expect(policy()).toHaveText('Con autorización');
  await expect(dialog().getByText(hints.manager_override, { exact: true })).toBeVisible();
  expect(await dialog().evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({
    path: `${evidenceDir}/negative-stock-mobile-policy.png`,
    fullPage: true,
  });
  const saveButton = dialog().getByRole('button', { name: 'Guardar', exact: true });
  const cancel = dialog().getByRole('button', { name: 'Cancelar', exact: true });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport({ ratio: 1 });
  await expect(saveButton).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: `${evidenceDir}/negative-stock-mobile-controls.png`,
    fullPage: true,
  });
  const count = commands.length;
  await cancel.click();
  expect(commands).toHaveLength(count);
  return { results, commands: commands.length, mobile: 'passed' };
}
