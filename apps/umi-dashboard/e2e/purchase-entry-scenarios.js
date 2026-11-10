import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
export async function runPurchaseEntryScenarios({
  page,
  fixture: f,
  photoPath,
  screenshot,
  checkpoint,
  expect,
}) {
  const origins = [new URL(f.dashboard), new URL(f.api)];
  if (
    origins.some(
      (u) =>
        u.protocol !== 'http:' ||
        u.hostname !== '127.0.0.1' ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash,
    ) ||
    origins[0].origin === origins[1].origin ||
    new URL(page.url()).origin !== origins[0].origin
  )
    throw new Error('Isolated local purchase fixture required');
  const attempts = [];
  const artifacts = [];
  page.on('request', (r) => {
    if (r.url().includes('/administrative-commands') && r.method() === 'POST') {
      const body = r.postDataJSON();
      if (
        ['inventory.purchase.record', 'inventory.invoice.receive_direct'].includes(body.operation)
      )
        attempts.push({
          merchantId: new URL(r.url()).pathname.split('/')[3],
          body,
          raw: r.postData(),
        });
    }
    if (r.url().endsWith('/artifact')) artifacts.push(r.url());
  });
  const button = page.getByRole('button', { name: 'Registrar compra', exact: true });
  const dialog = () => page.getByRole('dialog');
  const open = async () => {
    await button.click();
    await expect(dialog().getByLabel('Artículo 1', { exact: true })).toBeVisible();
  };
  const fill = async ({ item = 1, q = '1.250', cost = '12.50', reference = '' } = {}) => {
    await dialog()
      .getByLabel('Dónde entra el inventario', { exact: true })
      .selectOption(f.inventoryLocations[0].id);
    await dialog().getByLabel('Artículo 1', { exact: true }).selectOption(f.items[item].id);
    await dialog().getByLabel('Cantidad 1', { exact: true }).fill(q);
    await dialog().getByLabel('Costo por unidad 1', { exact: true }).fill(cost);
    if (reference)
      await dialog().getByLabel('Referencia (opcional)', { exact: true }).fill(reference);
  };
  const review = async () => {
    await dialog().getByRole('button', { name: 'Revisar compra', exact: true }).click();
    await expect(
      dialog().getByRole('button', { name: 'Guardar compra', exact: true }),
    ).toBeVisible();
  };
  const closeSuccess = async () => {
    await expect(dialog().getByText('La compra quedó registrada.', { exact: true })).toBeVisible();
    await dialog().getByRole('button', { name: 'Cerrar compra', exact: true }).click();
    await expect(dialog()).toHaveCount(0);
  };
  await checkpoint('before');
  await open();
  await expect(dialog().getByLabel('Dónde entra el inventario', { exact: true })).toHaveValue('');
  await expect(dialog().getByLabel('Artículo 1', { exact: true }).locator('option')).toHaveCount(4);
  await fill();
  await review();
  await screenshot('task2-review-desktop');
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(attempts).toHaveLength(0);
  await checkpoint('canceled');
  await expect(button).toBeFocused();
  await open();
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(button).toBeFocused();
  // Real files exercise native decode and canvas, without a purchase write.
  await open();
  const photoInput = dialog().getByLabel('Foto del comprobante (opcional)', { exact: true });
  for (const extension of ['jpg', 'webp', 'png']) {
    await photoInput.setInputFiles(photoPath(`receipt.${extension}`));
    const preview = dialog().getByRole('img', {
      name: 'Vista previa del comprobante',
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(dialog().getByText('Preparando la foto…', { exact: true })).toHaveCount(0);
    const result = await preview.evaluate((img) => ({
      src: img.src,
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    expect(result.width).toBeGreaterThan(0);
    const bytes = Buffer.from(result.src.split(',')[1], 'base64');
    expect(bytes.length).toBeLessThanOrEqual(700 * 1024);
    await checkpoint('photo-' + extension, {
      bytes: bytes.length,
      width: result.width,
      height: result.height,
      contentType: result.src.split(';')[0],
      data: extension === 'png' ? bytes : undefined,
    });
    await dialog().getByRole('button', { name: 'Quitar foto', exact: true }).click();
  }
  for (const file of [
    { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    { name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('bad image') },
  ]) {
    await photoInput.setInputFiles(file);
    await expect(dialog().getByRole('alert')).toBeVisible();
    await expect(
      dialog().getByRole('button', { name: 'Revisar compra', exact: true }),
    ).toBeDisabled();
    await dialog().getByRole('button', { name: 'Quitar foto', exact: true }).click();
  }
  await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(attempts).toHaveLength(0);
  await checkpoint('photos-canceled');
  // Manual purchase keeps repeated prices and has no supplier or receipt photo.
  const manualRef = `UI manual ${Date.now()}`;
  await open();
  await fill({ reference: manualRef });
  await dialog().getByRole('button', { name: 'Agregar fila', exact: true }).click();
  await dialog().getByLabel('Artículo 2', { exact: true }).selectOption(f.items[1].id);
  await dialog().getByLabel('Cantidad 2', { exact: true }).fill('0.750');
  await dialog().getByLabel('Costo por unidad 2', { exact: true }).fill('20');
  await review();
  await dialog().getByRole('button', { name: 'Guardar compra', exact: true }).click();
  await closeSuccess();
  expect(attempts).toHaveLength(1);
  expect(attempts[0].body.parameters).toMatchObject({
    supplierId: null,
    folio: manualRef,
    lines: [
      { quantity: { value: 1250, scale: 3, unit: 'kilogram' }, unitCostMinor: 1250 },
      { quantity: { value: 750, scale: 3, unit: 'kilogram' }, unitCostMinor: 2000 },
    ],
  });
  expect(attempts[0].body.parameters.artifactBase64).toBeUndefined();
  await expect(page.getByRole('article').filter({ hasText: manualRef })).toContainText(
    'Sin proveedor',
  );
  await checkpoint('manual-saved', { attempt: attempts[0] });
  // The server commits. The browser loses the response, reloads, then retries the exact envelope.
  const photoRef = `UI photo ${Date.now()}`;
  await open();
  await fill({ item: 0, q: '2', cost: '0', reference: photoRef });
  await dialog()
    .getByLabel('Proveedor (opcional)', { exact: true })
    .selectOption(f.suppliers[0].id);
  await dialog()
    .getByLabel('Foto del comprobante (opcional)', { exact: true })
    .setInputFiles(photoPath('receipt.png'));
  await expect(
    dialog().getByRole('img', { name: 'Vista previa del comprobante', exact: true }),
  ).toBeVisible();
  await expect(dialog().getByText('Preparando la foto…', { exact: true })).toHaveCount(0);
  await review();
  let dropped = false;
  await page.route('**/administrative-commands', async (route) => {
    const body = route.request().postDataJSON();
    if (!dropped && body.operation === 'inventory.purchase.record') {
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await dialog().getByRole('button', { name: 'Guardar compra', exact: true }).click();
  await expect(
    dialog().getByText('No se pudo confirmar el resultado. Reintenta esta misma compra.', {
      exact: true,
    }),
  ).toBeVisible();
  await screenshot('task2-lost-response');
  await checkpoint('photo-response-lost', { attempt: attempts[1] });
  await page.reload();
  await expect(button).toBeVisible();
  await button.click();
  await expect(
    dialog().getByRole('button', { name: 'Reintentar la misma compra', exact: true }),
  ).toBeVisible();
  await dialog().getByRole('button', { name: 'Reintentar la misma compra', exact: true }).click();
  await closeSuccess();
  await page.unroute('**/administrative-commands');
  expect(attempts).toHaveLength(3);
  expect(attempts[1].raw).toBe(attempts[2].raw);
  expect(attempts[1].merchantId).toBe(f.merchants[0].id);
  expect(
    Buffer.from(attempts[1].body.parameters.artifactBase64, 'base64').length,
  ).toBeLessThanOrEqual(700 * 1024);
  expect(Buffer.byteLength(attempts[1].raw, 'utf8')).toBeLessThanOrEqual(1024 * 1024);
  await checkpoint('photo-retried', { attempt: attempts[2] });
  expect(artifacts).toHaveLength(0);
  const receiptArticle = page.getByRole('article').filter({ hasText: photoRef });
  await receiptArticle.getByRole('button', { name: 'Ver comprobante', exact: true }).click();
  await expect(
    dialog().getByRole('img', { name: 'Comprobante de la compra', exact: true }),
  ).toBeVisible();
  await expect(dialog().getByRole('img')).toHaveJSProperty('naturalWidth', 1600);
  await screenshot('task2-artifact');
  expect(artifacts).toHaveLength(1);
  await dialog().getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Comprobante de la compra', exact: true }),
  ).toHaveCount(0);
  // XML upload and matching use the existing screen. Direct receive submits only the destination and note.
  const xmlRef = `XML-${Date.now()}`;
  const uuid = randomUUID();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="${xmlRef}" Fecha="2026-11-03T10:00:00" SubTotal="30.63" Moneda="MXN" Total="30.63" TipoDeComprobante="I" LugarExpedicion="06000"><cfdi:Emisor Rfc="XAXX010101000" Nombre="Proveedor de prueba" RegimenFiscal="601"/><cfdi:Conceptos><cfdi:Concepto Cantidad="1.250" ClaveUnidad="KGM" Descripcion="${f.items[1].name}" ValorUnitario="12.50" Importe="15.63"/><cfdi:Concepto Cantidad="0.750" ClaveUnidad="KGM" Descripcion="${f.items[1].name}" ValorUnitario="20.00" Importe="15.00"/></cfdi:Conceptos><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="2026-11-03T10:01:00"/></cfdi:Complemento></cfdi:Comprobante>`;
  await page
    .locator('input[type=file][accept=".xml,text/xml,application/xml"]')
    .setInputFiles({ name: 'purchase.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  let xmlArticle = page.getByRole('article').filter({ hasText: xmlRef });
  await expect(xmlArticle).toBeVisible();
  for (const n of [1, 2]) {
    await xmlArticle.getByRole('button', { name: `Casar la línea ${n}`, exact: true }).click();
    await expect(dialog().locator('.ui-select-trigger')).toHaveCount(1);
    await dialog().locator('.ui-select-trigger').click();
    await page
      .getByRole('option', { name: `${f.items[1].name} · ${f.items[1].ref}`, exact: true })
      .click();
    await dialog().getByRole('button', { name: 'Guardar el cotejo', exact: true }).click();
    await expect(dialog()).toHaveCount(0);
    xmlArticle = page.getByRole('article').filter({ hasText: xmlRef });
    await expect(xmlArticle).toBeVisible();
  }
  await expect(
    xmlArticle.getByRole('button', { name: 'Recibir contra un pedido', exact: true }),
  ).toBeVisible();
  await xmlArticle.getByRole('button', { name: 'Registrar compra del XML', exact: true }).click();
  await expect(dialog().getByLabel('Dónde entra el inventario', { exact: true })).toBeVisible();
  await dialog()
    .getByLabel('Dónde entra el inventario', { exact: true })
    .selectOption(f.inventoryLocations[1].id);
  await review();
  await screenshot('task2-xml-review');
  await dialog().getByRole('button', { name: 'Guardar compra', exact: true }).click();
  await closeSuccess();
  const direct = attempts.at(-1);
  expect(direct.body.operation).toBe('inventory.invoice.receive_direct');
  expect(direct.body.parameters).toEqual({
    locationId: f.locations[0].id,
    inventoryLocationId: f.inventoryLocations[1].id,
    note: null,
  });
  await expect(xmlArticle).toContainText('Registrada');
  await checkpoint('xml-direct-saved', { attempt: direct });
  // At 390 px, the dialog has no horizontal overflow and native focus remains inside.
  await page.setViewportSize({ width: 390, height: 844 });
  await open();
  await fill();
  await review();
  await screenshot('task2-review-mobile');
  const widths = await dialog().evaluate((d) => ({
    client: d.clientWidth,
    scroll: d.scrollWidth,
    inside: d.contains(document.activeElement),
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  expect(widths.inside).toBe(true);
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  expect(await dialog().evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  await expect(button).toBeFocused();
  await checkpoint('mobile-canceled');
  return {
    attempts: attempts.map(({ body, merchantId, raw }) => ({
      merchantId,
      operation: body.operation,
      commandId: body.commandId,
      targetAggregateId: body.targetAggregateId,
      locationId: body.locationId,
      parameters: {
        ...body.parameters,
        artifactBase64: body.parameters.artifactBase64
          ? `[${Buffer.from(body.parameters.artifactBase64, 'base64').length} bytes]`
          : undefined,
      },
      utf8Bytes: Buffer.byteLength(raw, 'utf8'),
    })),
    artifactRequests: artifacts.length,
  };
}
