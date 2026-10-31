import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Use only an isolated local fixture. All writes use the visible import dialog. */
export async function verifyInventoryImport({
  page,
  fixture,
  expect,
  evidenceDir,
  base,
  excelBuffer,
}) {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/merchants/${fixture.merchantId}/administrative-commands`))
      requests.push(request.postDataJSON());
  });
  const journalKey = `umi:inventory-import:v1:${fixture.merchantId}:items`;
  const name = 'Importar artículos';
  const dialog = page.getByRole('dialog', { name, exact: true });
  const button = (text) => dialog.getByRole('button', { name: text, exact: true });
  const open = async () => {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(dialog).toBeVisible();
  };
  const choose = async (buffer, fileName = 'articulos.csv') => {
    await dialog.getByLabel('Elegir archivo', { exact: true }).setInputFiles({
      name: fileName,
      mimeType: fileName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      buffer,
    });
    await button('Revisar archivo').click();
  };
  const csv = (rows) => Buffer.from(`codigo,nombre,tipo,unidad,decimales\n${rows.join('\n')}\n`);
  const key = randomUUID().slice(0, 8);
  await page.goto(`${base}/inventory`);
  await open();
  await choose(csv([`PREVIEW-${key},Artículo de prueba,ingredient,gram,0`]));
  await expect(button('Importar 1 artículo')).toBeEnabled();
  await page.screenshot({
    path: `${evidenceDir}/preview-desktop.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${evidenceDir}/preview-mobile.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  const geometry = await dialog.evaluate((node) => ({
    scroll: node.scrollWidth,
    width: node.clientWidth,
    rect: node.getBoundingClientRect().toJSON(),
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  await dialog.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.screenshot({
    path: `${evidenceDir}/preview-mobile-rows.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
  expect(geometry.rect.x).toBeGreaterThanOrEqual(0);
  expect(geometry.rect.right).toBeLessThanOrEqual(390);
  await button('Cancelar').click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toHaveLength(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBeNull();
  await page.setViewportSize({ width: 1280, height: 900 });
  await open();
  await dialog.getByLabel('Formato de descarga').selectOption('csv');
  const guideDownload = page.waitForEvent('download');
  await button('Descargar guía').click();
  const guide = await guideDownload;
  const guideBytes = readFileSync(await guide.path(), 'utf8');
  expect(guideBytes).toContain('Campo');
  expect(guideBytes).toContain('Código único del artículo');
  expect(requests).toHaveLength(0);
  if (excelBuffer) {
    await choose(excelBuffer, 'articulos.xlsx');
    await expect(button('Importar 1 artículo')).toBeEnabled();
    await expect(dialog.getByText('Artículo Excel', { exact: true })).toBeVisible();
  }
  const commandPattern = `**/api/merchants/${fixture.merchantId}/administrative-commands`;
  let lost = false;
  const loseResponse = async (route) => {
    if (route.request().postDataJSON().operation !== 'inventory.item.create' || lost)
      return route.continue();
    lost = true;
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    await route.abort('failed');
  };
  await page.route(commandPattern, loseResponse);
  await choose(
    csv([
      `SAVE-${key},Guardado de importación,ingredient,gram,0`,
      `DUP-${key},Duplicado uno,ingredient,gram,0`,
      `DUP-${key},Duplicado dos,ingredient,gram,0`,
      `,Sin código,ingredient,gram,0`,
    ]),
  );
  await button('Importar 1 artículo').click();
  await expect(dialog.getByText('Por confirmar', { exact: true })).toBeVisible();
  await expect(button('Nueva importación')).toBeDisabled();
  const firstRequest = requests[0];
  expect(firstRequest.locationId).toBe(fixture.locationId);
  expect(firstRequest.approvalId).toBeNull();
  await button('Cerrar').click();
  await open();
  await expect(dialog.getByText('Por confirmar', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Elegir archivo', { exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.setItem('umi-dashboard-selected-location', 'changed-after-confirmation'),
  );
  await page.unroute(commandPattern, loseResponse);
  await button('Reintentar pendientes').click();
  await expect(dialog.getByText('Guardado', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(firstRequest);
  await expect(button('Reintentar pendientes')).toBeDisabled();
  await dialog.getByLabel('Formato de descarga').selectOption('csv');
  const resultDownload = page.waitForEvent('download');
  await button('Descargar resultado').click();
  const result = await resultDownload;
  const resultBytes = readFileSync(await result.path(), 'utf8');
  expect(resultBytes.split('\r\n')).toHaveLength(5);
  expect(resultBytes).toContain('Guardado');
  expect(resultBytes).toContain('Duplicado');
  expect(resultBytes).not.toContain('DUPLICATE_CODE');
  expect(resultBytes).toContain('campo obligatorio');
  await dialog.getByLabel('Formato de descarga').selectOption('xlsx');
  const xlsxDownload = page.waitForEvent('download');
  await button('Descargar resultado').click();
  const xlsx = await xlsxDownload;
  expect(
    readFileSync(await xlsx.path())
      .subarray(0, 2)
      .toString(),
  ).toBe('PK');
  await page.screenshot({
    path: `${evidenceDir}/recovered-result.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  await button('Nueva importación').click();
  await expect(dialog.getByLabel('Elegir archivo', { exact: true })).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBeNull();
  await button('Cancelar').click();
  await expect(page.getByRole('row').filter({ hasText: `SAVE-${key}` })).toBeVisible();
  await page.goto(`${base}/inventory/recetas`);
  await page.getByRole('button', { name: 'Importar recetas', exact: true }).click();
  const recipe = page.getByRole('dialog', { name: 'Importar recetas', exact: true });
  await recipe.getByLabel('Elegir archivo', { exact: true }).setInputFiles({
    name: 'recetas.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `producto_id,variante_id,rendimiento,unidad_rendimiento,ingrediente_codigo,cantidad,unidad\n${fixture.productId},,1,unit,CAFE-UI,1,gram\n${fixture.productId},,1,unit,MISSING,1,gram\n`,
    ),
  });
  await recipe.getByRole('button', { name: 'Revisar archivo', exact: true }).click();
  await expect(recipe.getByText('2, 3', { exact: true })).toBeVisible();
  await expect(recipe.getByText(/Fila 3/)).toBeVisible();
  await expect(
    recipe.getByRole('button', { name: 'Importar 0 recetas', exact: true }),
  ).toBeDisabled();
  await recipe.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(requests).toHaveLength(2);
  return { commands: requests.length, identicalRetry: true, mobileWidth: geometry.width };
}

export async function verifyImportClose({ page, fixture, expect, base }) {
  await page.goto(`${base}/inventory`);
  await page.getByRole('button', { name: 'Importar artículos', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar artículos', exact: true });
  const key = randomUUID().slice(0, 8);
  await dialog.getByLabel('Elegir archivo', { exact: true }).setInputFiles({
    name: 'cerrar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `codigo,nombre,tipo,unidad,decimales\nCLOSE-${key},Cierre ${key},ingredient,gram,0\nPENDING-${key},Pendiente ${key},ingredient,gram,0\n`,
    ),
  });
  await dialog.getByRole('button', { name: 'Revisar archivo', exact: true }).click();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let saved;
  const received = new Promise((resolve) => {
    saved = resolve;
  });
  const requests = [];
  const pattern = `**/api/merchants/${fixture.merchantId}/administrative-commands`;
  const hold = async (route) => {
    requests.push(route.request().postDataJSON());
    const response = await route.fetch();
    saved();
    await gate;
    await route.fulfill({ response });
  };
  await page.route(pattern, hold);
  try {
    await dialog.getByRole('button', { name: 'Importar 2 artículos', exact: true }).click();
    await received;
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
    release();
    await expect(page.getByRole('row').filter({ hasText: `CLOSE-${key}` })).toBeVisible();
    expect(requests).toHaveLength(1);
    await page.getByRole('button', { name: 'Importar artículos', exact: true }).click();
    await expect(dialog.getByText('Pendiente', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Nueva importación', exact: true }).click();
    await expect(dialog.getByLabel('Elegir archivo', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  } finally {
    release();
    await page.unroute(pattern, hold);
  }
  return { savedAfterClose: true, unsentDiscarded: true };
}
