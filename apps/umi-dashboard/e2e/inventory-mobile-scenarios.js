/** Run against the local API with an authenticated owner and existing inventory. */
export async function verifyInventoryMobile({ page, fixture, expect, evidenceDir }) {
  const commands = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/administrative-commands')) {
      commands.push(request.postDataJSON());
    }
  });
  const createButton = page.getByRole('button', { name: 'Nuevo artículo', exact: true });
  const search = page.getByRole('textbox', { name: 'Buscar artículo', exact: true });
  const dialog = () => page.getByRole('dialog', { name: /^(Nuevo|Editar) artículo$/ });
  const results = [];
  await createButton.click();
  const nameField = dialog().getByLabel('Nombre', { exact: true });
  await nameField.fill('Borrador');
  for (const shortcut of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(shortcut);
    await expect(page.getByRole('dialog', { name: 'Comandos', exact: true })).toHaveCount(0);
    await expect(nameField).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(dialog()).not.toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Comandos', exact: true });
  await expect(palette).toBeVisible();
  await palette.getByRole('textbox', { name: 'Escribe un comando o un artículo' }).fill('Contar');
  await page.keyboard.press('Escape');
  await expect(palette).not.toBeVisible();
  for (const width of [390, 320, 720, 1440, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await createButton.scrollIntoViewIfNeeded();
    await expect(createButton).toBeInViewport({ ratio: 1 });
    await createButton.click();
    await expect(dialog()).toBeVisible();
    const beforeCancel = commands.length;
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    expect(commands).toHaveLength(beforeCancel);
    await search.fill('Café ajuste decimal');
    const actions = page.getByRole('button', {
      name: 'Acciones de Café ajuste decimal',
      exact: true,
    });
    await actions.scrollIntoViewIfNeeded();
    await expect(actions).toBeInViewport({ ratio: 1 });
    await actions.click();
    await page.getByRole('menuitem', { name: 'Editar artículo', exact: true }).click();
    await expect(dialog().getByLabel('Nombre', { exact: true })).toHaveValue('Café ajuste decimal');
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog()).not.toBeVisible();
    expect(commands).toHaveLength(beforeCancel);
    await page.getByText('Café ajuste decimal', { exact: true }).click();
    const panel = page.getByRole('complementary', {
      name: 'Detalle de Café ajuste decimal',
      exact: true,
    });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Acciones del artículo', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Editar artículo', exact: true }).click();
    await expect(dialog()).toBeVisible();
    await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await search.fill('');
    await createButton.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidenceDir}/inventory-mobile-${width}.png` });
    results.push({
      width,
      create: true,
      menuEdit: true,
      detailEdit: true,
      cancelWithoutWrite: true,
    });
  }
  await createButton.click();
  const name = `Artículo móvil ${Date.now().toString(36)}`;
  await dialog().getByLabel('Nombre', { exact: true }).fill(name);
  await dialog().getByLabel('Referencia', { exact: false }).fill(`MOBILE-${Date.now()}`);
  await dialog().getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog()).not.toBeVisible();
  await search.fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0].operation).toBe('inventory.item.create');
  const persisted = await page.evaluate(
    async ({ merchantId, name }) => {
      const response = await fetch(
        `/api/merchants/${merchantId}/items?includeItemsWithoutCost=true&limit=100`,
      );
      if (!response.ok) throw new Error(`Item read failed: ${response.status}`);
      return (await response.json()).items.find((item) => item.displayName === name);
    },
    { merchantId: fixture.merchantId, name },
  );
  expect(persisted?.displayName).toBe(name);
  return { viewports: results, savedItemId: persisted.id, commands: commands.length };
}
