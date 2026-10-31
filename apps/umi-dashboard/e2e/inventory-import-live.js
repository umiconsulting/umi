import { Buffer } from 'node:buffer';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const itemHeader =
  'codigo,nombre,tipo,unidad,decimales,costo_unitario,existencia_minima,cantidad_preparacion,vida_util_dias';
const recipeHeader =
  'producto_id,variante_id,rendimiento,unidad_rendimiento,ingrediente_codigo,cantidad,unidad';

export async function loginImportOwner(page, fixture, base) {
  await page.addInitScript(
    ({ merchantId, locationId }) => {
      localStorage.setItem('umi.dashboard.locale', 'es');
      localStorage.setItem('umi-dashboard-selected-merchant', merchantId);
      localStorage.setItem('umi-dashboard-selected-location', locationId);
    },
    { merchantId: fixture.merchantId, locationId: fixture.locationId },
  );
  await page.goto(`${base}/login`);
  await page.getByLabel('Correo', { exact: true }).fill(fixture.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  await page.waitForLoadState('networkidle');
  await page.getByRole('navigation').first().waitFor();
}

async function bounded(promise, label, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function navigateInventory(page, kind, base) {
  const target = `/inventory${kind === 'items' ? '' : '/recetas'}`;
  if (new URL(page.url()).pathname === target) return;
  const sidebar = page.locator('aside');
  const destination = sidebar.getByRole('button', {
    name: kind === 'items' ? 'Artículos' : 'Recetas',
    exact: true,
  });
  if (!(await destination.isVisible()))
    await sidebar.getByRole('button', { name: 'Inventario', exact: true }).click();
  await destination.click();
  await page.waitForURL(`${base}${target}`);
}

async function ownerCommand(
  page,
  fixture,
  operation,
  targetAggregateId,
  targetVersion,
  parameters,
) {
  return page.evaluate(
    async ({ fixture, body }) => {
      const csrf = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('umi_csrf='));
      const response = await fetch(`/api/merchants/${fixture.merchantId}/administrative-commands`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-UMI-CSRF': decodeURIComponent(csrf?.slice(9) || ''),
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    {
      fixture: { merchantId: fixture.merchantId },
      body: {
        operation,
        targetAggregateId,
        targetVersion,
        parameters,
        commandId: randomUUID(),
        idempotencyKey: randomUUID(),
        locationId: fixture.locationId,
        approvalId: null,
      },
    },
  );
}

/** This scenario requires a private fixture and the disposable local database. */
export async function verifyInventoryImportLive({
  page,
  fixture,
  expect,
  base,
  db,
  ExcelJS,
  evidenceDir,
}) {
  const run = randomUUID().slice(0, 8);
  const code = `EXACT-${run}`;
  const productId = randomUUID();
  const invalidProductId = randomUUID();
  const variantProductId = randomUUID();
  const variantId = randomUUID();
  await db.query(
    `INSERT INTO merchant.product(id,merchant_id,name,price) VALUES($1,$4,$5,50000),($2,$4,$6,10000),($3,$4,$7,20000)`,
    [
      productId,
      invalidProductId,
      variantProductId,
      fixture.merchantId,
      `Exacta ${run}`,
      `Inválida ${run}`,
      `Variante ${run}`,
    ],
  );
  await db.query(
    `INSERT INTO merchant.product_variant(id,merchant_id,product_id,name,price_delta) VALUES($1,$2,$3,'Grande',5000)`,
    [variantId, fixture.merchantId, variantProductId],
  );
  const commands = [];
  const reads = [];
  page.on('request', (request) => {
    if (request.url().endsWith(`/merchants/${fixture.merchantId}/administrative-commands`))
      commands.push(request.postDataJSON());
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.pathname.startsWith(`/api/merchants/${fixture.merchantId}/`) &&
      url.searchParams.get('limit') === '100'
    )
      reads.push({
        path: url.pathname,
        cursor: url.searchParams.has('cursor'),
        status: response.status(),
      });
  });
  const open = async (kind) => {
    const name = kind === 'items' ? 'Importar artículos' : 'Importar recetas';
    await navigateInventory(page, kind, base);
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Descargar códigos', exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    return dialog;
  };
  const button = (dialog, name) => dialog.getByRole('button', { name, exact: true });
  const choose = async (dialog, text, xlsx = false, kind = 'items') => {
    let buffer = Buffer.from(text);
    if (xlsx) {
      const book = new ExcelJS.Workbook();
      book.addWorksheet(kind === 'items' ? 'Articulos' : 'Recetas').addRows(
        text
          .trim()
          .split('\n')
          .map((row) => row.split(',')),
      );
      buffer = Buffer.from(await book.xlsx.writeBuffer());
    }
    await dialog.getByLabel('Elegir archivo', { exact: true }).setInputFiles({
      name: `import.${xlsx ? 'xlsx' : 'csv'}`,
      mimeType: xlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv',
      buffer,
    });
    await button(dialog, 'Revisar archivo').click();
  };
  const download = async (dialog, name, format) => {
    await dialog.getByLabel('Formato de descarga').selectOption(format);
    const pending = page.waitForEvent('download');
    await button(dialog, name).click();
    const file = await pending;
    const bytes = readFileSync(await file.path());
    if (format === 'csv') return bytes.toString('utf8');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    return book;
  };
  let dialog = await open('items');
  const templateCsv = await download(dialog, 'Descargar plantilla', 'csv');
  expect(templateCsv).toContain('costo_unitario');
  const templateXlsx = await download(dialog, 'Descargar plantilla', 'xlsx');
  expect(templateXlsx.getWorksheet('Articulos').getRow(1).values).toContain('codigo');
  const itemText = `${itemHeader}\n${code},Exacto ${run},ingredient,kilogram,3,12.50,1.250,2.500,7\n`;
  const ledgerBefore = (
    await db.query(
      'SELECT count(*)::int AS n FROM merchant.stock_ledger_entry WHERE merchant_id=$1',
      [fixture.merchantId],
    )
  ).rows[0].n;
  await choose(dialog, itemText, true);
  await expect(button(dialog, 'Importar 1 artículo')).toBeEnabled();
  await button(dialog, 'Importar 1 artículo').click();
  await expect(dialog.getByText('Guardado', { exact: true })).toBeVisible();
  const item = (
    await db.query(
      `SELECT id,initial_unit_cost_minor::text,low_stock_threshold::text,par_quantity::text,shelf_life_days,quantity_scale FROM merchant.inventory_item WHERE merchant_id=$1 AND public_reference=$2`,
      [fixture.merchantId, code],
    )
  ).rows;
  expect(item).toHaveLength(1);
  expect(item[0]).toMatchObject({
    initial_unit_cost_minor: '1250',
    low_stock_threshold: '1250',
    par_quantity: '2500',
    shelf_life_days: 7,
    quantity_scale: 3,
  });
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM merchant.stock_ledger_entry WHERE merchant_id=$1',
        [fixture.merchantId],
      )
    ).rows[0].n,
  ).toBe(ledgerBefore);
  await button(dialog, 'Nueva importación').click();
  const beforeNoop = commands.length;
  await choose(dialog, itemText);
  await expect(dialog.getByRole('cell', { name: 'Sin cambios', exact: true })).toBeVisible();
  await expect(button(dialog, 'Importar 0 artículos')).toBeDisabled();
  expect(commands).toHaveLength(beforeNoop);
  await button(dialog, 'Cancelar').click();
  // Seed stock after the import. The import itself must preserve the ledger.
  const stockCommand = randomUUID();
  await db.query(
    `SELECT merchant.append_stock_ledger($1::uuid,$2::uuid,$3::uuid,$4::uuid,'opening_balance',10000::bigint,$5::uuid,$6::uuid,$7,'local_fixture',$4::uuid,$8::uuid,null,null,current_date,'import-task4')`,
    [
      fixture.merchantId,
      fixture.locationId,
      fixture.inventoryLocationId,
      item[0].id,
      stockCommand,
      randomUUID(),
      createHash('sha256').update(stockCommand).digest('hex'),
      fixture.userId,
    ],
  );
  dialog = await open('recipes');
  expect(await download(dialog, 'Descargar plantilla', 'csv')).toContain('ingrediente_codigo');
  const recipeTemplate = await download(dialog, 'Descargar plantilla', 'xlsx');
  expect(recipeTemplate.getWorksheet('Recetas').getRow(1).values).toContain('producto_id');
  const components = (quantity) => [
    `${productId},,1,portion,HARINA-UI,${quantity},kilogram`,
    `${productId},,1,portion,${code},0.125,kilogram`,
  ];
  const recipeText = `${recipeHeader}\n${components('0.125').join('\n')}\n${variantProductId},${variantId},1,portion,HARINA-UI,100,gram\n${invalidProductId},,1,portion,HARINA-UI,1,gram\n${invalidProductId},,1,portion,MISSING,1,gram\n`;
  await choose(dialog, recipeText, false, 'recipes');
  await expect(button(dialog, 'Importar 2 recetas')).toBeEnabled();
  await expect(dialog.getByText('5, 6', { exact: true })).toBeVisible();
  await button(dialog, 'Importar 2 recetas').click();
  await expect(dialog.getByText('Guardado', { exact: true })).toHaveCount(2);
  const saved = (
    await db.query(
      `SELECT r.id,r.version,r.active,r.yield_quantity::text,r.yield_scale,r.yield_unit,c.quantity::text,c.quantity_scale,c.unit,c.conversion_numerator::text,c.conversion_denominator::text,c.inventory_item_id FROM merchant.inventory_recipe r JOIN merchant.inventory_recipe_component c ON c.recipe_id=r.id WHERE r.product_id=$1 ORDER BY c.inventory_item_id`,
      [productId],
    )
  ).rows;
  expect(saved).toHaveLength(2);
  expect(
    saved.every(
      (row) =>
        row.version === 1 &&
        row.active &&
        row.yield_quantity === '1' &&
        row.yield_scale === 0 &&
        row.yield_unit === 'portion',
    ),
  ).toBe(true);
  expect(saved.find((row) => row.inventory_item_id === fixture.ingredientId)).toMatchObject({
    quantity: '125',
    quantity_scale: 3,
    unit: 'kilogram',
    conversion_numerator: '1000',
    conversion_denominator: '1',
  });
  expect(saved.find((row) => row.inventory_item_id === item[0].id)).toMatchObject({
    quantity: '125',
    quantity_scale: 3,
    unit: 'kilogram',
    conversion_numerator: '1',
    conversion_denominator: '1',
  });
  const emptyInvalid = async () => {
    expect(
      (
        await db.query(
          'SELECT id FROM merchant.inventory_recipe WHERE merchant_id=$1 AND product_id=$2',
          [fixture.merchantId, invalidProductId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          'SELECT id FROM merchant.inventory_catalog_mapping WHERE merchant_id=$1 AND product_id=$2',
          [fixture.merchantId, invalidProductId],
        )
      ).rows,
    ).toHaveLength(0);
  };
  await emptyInvalid();
  const csv = await download(dialog, 'Descargar resultado', 'csv');
  expect(csv.split('\r\n')).toHaveLength(6);
  expect(csv).toContain('Guardado');
  expect(csv).toContain('El ingrediente no existe');
  expect(csv).not.toContain('MISSING_INGREDIENT');
  const resultBook = await download(dialog, 'Descargar resultado', 'xlsx');
  expect(resultBook.worksheets[0].rowCount).toBe(6);
  expect(JSON.stringify(resultBook.worksheets[0].getSheetValues())).toContain('Guardado');
  await page.screenshot({
    path: `${evidenceDir}/recipe-mixed-result.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  await button(dialog, 'Nueva importación').click();
  const recipeCount = (
    await db.query('SELECT count(*)::int AS n FROM merchant.inventory_recipe WHERE product_id=$1', [
      productId,
    ])
  ).rows[0].n;
  await choose(dialog, `${recipeHeader}\n${components('0.125').join('\n')}\n`, true, 'recipes');
  await expect(dialog.getByRole('cell', { name: 'Sin cambios', exact: true })).toBeVisible();
  await expect(button(dialog, 'Importar 0 recetas')).toBeDisabled();
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM merchant.inventory_recipe WHERE product_id=$1',
        [productId],
      )
    ).rows[0].n,
  ).toBe(recipeCount);
  await button(dialog, 'Cancelar').click();
  dialog = await open('recipes');
  await choose(dialog, `${recipeHeader}\n${components('0.250').join('\n')}\n`, true, 'recipes');
  await expect(dialog.getByRole('cell', { name: 'Actualizar', exact: true })).toBeVisible();
  await button(dialog, 'Importar 1 receta').click();
  await expect(dialog.getByText('Guardado', { exact: true })).toBeVisible();
  const history = (
    await db.query(
      `SELECT r.id,r.version,r.active,c.quantity::text,c.quantity_scale FROM merchant.inventory_recipe r JOIN merchant.inventory_recipe_component c ON c.recipe_id=r.id WHERE r.product_id=$1 AND c.inventory_item_id=$2 ORDER BY r.version`,
      [productId, fixture.ingredientId],
    )
  ).rows;
  expect(history).toHaveLength(2);
  expect(history[0]).toMatchObject({ version: 1, active: false, quantity: '125' });
  expect(history[1]).toMatchObject({ version: 2, active: true, quantity: '25', quantity_scale: 2 });
  expect(history[0].id).toBe(saved[0].id);
  await button(dialog, 'Nueva importación').click();
  await choose(dialog, `${recipeHeader}\n${components('0.500').join('\n')}\n`, false, 'recipes');
  await expect(button(dialog, 'Importar 1 receta')).toBeEnabled();
  const recipeParameters = {
    yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
    components: [
      {
        inventoryItemId: fixture.ingredientId,
        quantity: { value: 375, scale: 3, unit: 'kilogram' },
        conversionNumerator: 1000,
        conversionDenominator: 1,
        roundingPolicy: 'exact',
        required: true,
      },
      {
        inventoryItemId: item[0].id,
        quantity: { value: 125, scale: 3, unit: 'kilogram' },
        conversionNumerator: 1,
        conversionDenominator: 1,
        roundingPolicy: 'exact',
        required: true,
      },
    ],
  };
  const concurrent = await ownerCommand(
    page,
    fixture,
    'inventory.recipe.update',
    history[1].id,
    2,
    recipeParameters,
  );
  expect(concurrent.status).toBeLessThan(300);
  const refused = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/merchants/${fixture.merchantId}/administrative-commands`) &&
      response.request().method() === 'POST',
  );
  await button(dialog, 'Importar 1 receta').click();
  const staleResponse = await refused;
  expect(staleResponse.status()).toBe(409);
  await expect(dialog.getByRole('cell', { name: 'Error', exact: true })).toBeVisible();
  const staleBatch = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    `umi:inventory-import:v1:${fixture.merchantId}:recipes`,
  );
  expect(staleBatch.entries[0].result.code).toBe('CONFLICT');
  await page.screenshot({
    path: `${evidenceDir}/recipe-stale-conflict.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  const afterConflict = (
    await db.query(
      `SELECT r.version,r.active,c.quantity::text,c.quantity_scale FROM merchant.inventory_recipe r JOIN merchant.inventory_recipe_component c ON c.recipe_id=r.id WHERE r.product_id=$1 AND c.inventory_item_id=$2 ORDER BY r.version`,
      [productId, fixture.ingredientId],
    )
  ).rows;
  expect(afterConflict).toHaveLength(3);
  expect(afterConflict[2]).toMatchObject({ version: 3, active: true, quantity: '375' });
  await button(dialog, 'Nueva importación').click();
  await button(dialog, 'Cancelar').click();
  const invalid = await ownerCommand(page, fixture, 'inventory.recipe.create', randomUUID(), null, {
    targetKind: 'product',
    productId: invalidProductId,
    ...recipeParameters,
    components: [
      ...recipeParameters.components,
      { ...recipeParameters.components[0], inventoryItemId: randomUUID() },
    ],
  });
  expect(invalid.status).toBeGreaterThanOrEqual(400);
  await emptyInvalid();
  // Real reference reads must cross the server page boundary for all collections.
  for (const suffix of ['/items', '/recipes', '/recipe-targets']) {
    expect(
      reads.some((read) => read.path.endsWith(suffix) && read.cursor && read.status === 200),
      suffix,
    ).toBe(true);
  }
  const refusalBody = await staleResponse.json();
  const result = {
    staleRefusal: {
      status: staleResponse.status(),
      code: refusalBody.error?.code,
      reason: refusalBody.error?.details?.reason,
    },
    exactItemCostMinor: '1250',
    exactItemScale: 3,
    recipeVersions: 3,
    invalidGroupAtomic: true,
    referenceCursorReads: reads.filter((read) => read.cursor).length,
  };
  return {
    ...result,
    run: { code, itemId: item[0].id, productId, variantProductId, variantId },
    recipeParameters,
  };
}

export async function verifyImportedRecipeCheckout({ fixture, run, db, expect, request }) {
  const api = await request.newContext({ baseURL: fixture.apiBase });
  const post = async (path, body, headers = {}) => {
    const response = await api.post(path, { data: body, headers });
    const data = await response.json();
    expect(response.ok(), `${path}: ${response.status()} ${data.code || data.error || ''}`).toBe(
      true,
    );
    return data;
  };
  try {
    const login = await post(
      '/api/v1/auth/pos/pin-login',
      {
        pin: fixture.task4.pin,
        merchantId: fixture.merchantId,
        locationId: fixture.locationId,
        installationId: fixture.task4.installationId,
      },
      {
        'x-umi-device-id': fixture.task4.deviceId,
        'x-umi-device-credential': fixture.task4.deviceCredential,
      },
    );
    const headers = { Authorization: `Bearer ${login.tokens.accessToken}` };
    const session = await post(
      '/api/v1/pos/operator-sessions',
      { merchantId: fixture.merchantId, locationId: fixture.locationId },
      headers,
    );
    const operatorSessionId = session.id;
    const route = `/api/v1/pos/merchants/${fixture.merchantId}`;
    const common = { locationId: fixture.locationId, operatorSessionId };
    let cart = await post(`${route}/cart`, { ...common, idempotencyKey: randomUUID() }, headers);
    cart = await post(
      `${route}/cart/lines`,
      {
        ...common,
        cartId: cart.id,
        productId: run.productId,
        quantity: 2,
        expectedVersion: cart.version,
        idempotencyKey: randomUUID(),
      },
      headers,
    );
    cart = await post(
      `${route}/cart/prepare`,
      { ...common, cartId: cart.id, expectedVersion: cart.version, idempotencyKey: randomUUID() },
      headers,
    );
    const before = (
      await db.query(
        `SELECT inventory_item_id,on_hand::text FROM merchant.stock_balance WHERE merchant_id=$1 AND inventory_location_id=$2 AND inventory_item_id=ANY($3::uuid[]) ORDER BY inventory_item_id`,
        [fixture.merchantId, fixture.inventoryLocationId, [fixture.ingredientId, run.itemId]],
      )
    ).rows;
    const tender = {
      id: randomUUID(),
      type: 'manual_terminal',
      amount: cart.totals.grandTotal,
      amountReceived: null,
      status: 'confirmed_success',
      correlationId: `local-import-${randomUUID()}`,
    };
    const command = {
      ...common,
      cartId: cart.id,
      expectedCartVersion: cart.version,
      paymentMethod: 'external_terminal',
      idempotencyKey: randomUUID(),
      tenderDrafts: [tender],
    };
    let checkout = await post(`${route}/checkout`, command, headers);
    expect(checkout.confirmation.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    checkout = await post(
      `${route}/checkout`,
      {
        ...command,
        idempotencyKey: randomUUID(),
        totalsFingerprint: checkout.confirmation.fingerprint,
      },
      headers,
    );
    expect(checkout.sale.status).toBe('committed');
    const movements = (
      await db.query(
        `SELECT inventory_item_id,quantity::text,effect_on_hand::text,unit,quantity_scale FROM merchant.stock_ledger_entry WHERE merchant_id=$1 AND sale_id=$2 AND entry_type='sale_committed' ORDER BY inventory_item_id`,
        [fixture.merchantId, checkout.sale.id],
      )
    ).rows;
    expect(movements).toHaveLength(2);
    expect(movements.find((row) => row.inventory_item_id === fixture.ingredientId)).toMatchObject({
      quantity: '750',
      effect_on_hand: '-750',
      unit: 'gram',
      quantity_scale: 0,
    });
    expect(movements.find((row) => row.inventory_item_id === run.itemId)).toMatchObject({
      quantity: '250',
      effect_on_hand: '-250',
      unit: 'kilogram',
      quantity_scale: 3,
    });
    const after = (
      await db.query(
        `SELECT inventory_item_id,on_hand::text FROM merchant.stock_balance WHERE merchant_id=$1 AND inventory_location_id=$2 AND inventory_item_id=ANY($3::uuid[]) ORDER BY inventory_item_id`,
        [fixture.merchantId, fixture.inventoryLocationId, [fixture.ingredientId, run.itemId]],
      )
    ).rows;
    for (const row of after) {
      const delta = row.inventory_item_id === fixture.ingredientId ? 750n : 250n;
      expect(BigInt(row.on_hand)).toBe(
        BigInt(before.find((entry) => entry.inventory_item_id === row.inventory_item_id).on_hand) -
          delta,
      );
    }
    return {
      committedSale: true,
      flourGrams: '750',
      importedKilogramThousandths: '250',
      receiptDelivery: 'display',
    };
  } finally {
    await api.dispose();
  }
}

export async function verifyImportBoundaries({ page, fixture, expect, base, db, evidenceDir }) {
  const run = randomUUID().slice(0, 8);
  const merchantRows = (
    await db.query('SELECT id,name FROM merchant.merchant WHERE id=ANY($1::uuid[])', [
      [fixture.merchantId, fixture.task4.secondMerchantId],
    ])
  ).rows;
  const merchantName = (id) => merchantRows.find((row) => row.id === id).name;
  const commands = [];
  const pattern = `**/api/merchants/${fixture.merchantId}/administrative-commands`;
  const key = `umi:inventory-import:v1:${fixture.merchantId}:items`;
  const trigger = page.getByRole('button', { name: 'Importar artículos', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Importar artículos', exact: true });
  const button = (name) => dialog.getByRole('button', { name, exact: true });
  const choose = async (rows) => {
    await dialog.getByLabel('Elegir archivo', { exact: true }).setInputFiles({
      name: 'limites.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${itemHeader}\n${rows.join('\n')}\n`),
    });
    await button('Revisar archivo').click();
  };
  await navigateInventory(page, 'items', base);
  await trigger.click();
  await expect(button('Descargar códigos')).toBeEnabled();
  await choose(
    Array.from(
      { length: 21 },
      (_, index) => `CANCEL-${run}-${index},Cancelar ${index},ingredient,gram,0,,,,`,
    ),
  );
  await expect(dialog.getByText('Página 1 de 2', { exact: true })).toBeVisible();
  await button('Siguiente').click();
  await expect(dialog.getByText('Página 2 de 2', { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('cell', { name: `Cancelar 20 CANCEL-${run}-20`, exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(
    (
      await db.query(
        'SELECT id FROM merchant.inventory_item WHERE merchant_id=$1 AND public_reference LIKE $2',
        [fixture.merchantId, `CANCEL-${run}-%`],
      )
    ).rows,
  ).toHaveLength(0);
  expect(await page.evaluate((journal) => localStorage.getItem(journal), key)).toBeNull();
  await trigger.click();
  await expect(button('Descargar códigos')).toBeEnabled();
  const badRows = Array.from(
    { length: 21 },
    (_, index) => `BAD-${run}-${index},Error ${index},unknown,gram,0,,,,`,
  );
  await choose([`MOBILE-${run},Móvil ${run},ingredient,gram,0,,,,`, ...badRows]);
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = async () => {
    const value = await dialog.evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      body: document.documentElement.scrollWidth,
      viewport: innerWidth,
      table: node.querySelector('.inventory-import-table-scroll').clientWidth,
      tableScroll: node.querySelector('.inventory-import-table-scroll').scrollWidth,
    }));
    expect(value.scroll).toBeLessThanOrEqual(value.width + 1);
    expect(value.left).toBeGreaterThanOrEqual(0);
    expect(value.right).toBeLessThanOrEqual(390);
    expect(value.body).toBeLessThanOrEqual(value.viewport);
    expect(value.tableScroll).toBeGreaterThan(value.table);
    return value;
  };
  await geometry();
  const controls = dialog.locator('button:enabled, input:enabled, select:enabled, summary');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.screenshot({
    path: `${evidenceDir}/pagination-mobile-preview.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  await button('Importar 1 artículo').click();
  await expect(dialog.getByRole('cell', { name: 'Guardado', exact: true })).toBeVisible();
  await button('Siguiente').click();
  await expect(dialog.getByText('Página 2 de 2', { exact: true })).toBeVisible();
  await expect(dialog.getByText(`Error 20`, { exact: true })).toBeVisible();
  await geometry();
  await page.screenshot({
    path: `${evidenceDir}/pagination-mobile-result.png`,
    animations: 'disabled',
    timeout: 60000,
  });
  await button('Nueva importación').click();
  await button('Cancelar').click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await trigger.click();
  await expect(button('Descargar códigos')).toBeEnabled();
  await choose([
    `SWITCH-${run},Primer negocio ${run},ingredient,gram,0,,,,`,
    `UNSENT-${run},Sin enviar ${run},ingredient,gram,0,,,,`,
  ]);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let committed;
  const firstCommitted = new Promise((resolve) => {
    committed = resolve;
  });
  let handlerError;
  let initialError;
  let finished;
  const handled = new Promise((resolve) => {
    finished = resolve;
  });
  const hold = async (route) => {
    try {
      commands.push(route.request().postDataJSON());
      const response = await route.fetch({ timeout: 10000 });
      expect(response.ok()).toBe(true);
      committed();
      await gate;
      await route.fulfill({ response });
    } catch (error) {
      handlerError = error;
      committed();
    } finally {
      finished();
    }
  };
  await page.route(pattern, hold);
  try {
    await button('Importar 2 artículos').click();
    await bounded(firstCommitted, 'first API commit');
    if (handlerError) throw handlerError;
    // The shell becomes accessible when the owner closes the native modal.
    await button('Cerrar').click();
    await page.getByLabel('Negocio', { exact: true }).click();
    await page
      .getByRole('option', { name: merchantName(fixture.task4.secondMerchantId), exact: true })
      .click();
    await expect(page.getByLabel('Negocio', { exact: true })).toContainText(
      merchantName(fixture.task4.secondMerchantId),
    );
    release();
    await expect
      .poll(async () =>
        page.evaluate(
          (journal) => JSON.parse(localStorage.getItem(journal))?.entries[0]?.executionStatus,
          key,
        ),
      )
      .toBe('success');
    expect(commands).toHaveLength(1);
    expect(commands[0].locationId).toBe(fixture.locationId);
    const batch = await page.evaluate((journal) => JSON.parse(localStorage.getItem(journal)), key);
    expect(batch.entries[1].executionStatus).toBe('pending');
    expect(
      (
        await db.query(
          'SELECT merchant_id FROM merchant.inventory_item WHERE public_reference=$1',
          [`SWITCH-${run}`],
        )
      ).rows,
    ).toEqual([{ merchant_id: fixture.merchantId }]);
    expect(
      (
        await db.query('SELECT id FROM merchant.inventory_item WHERE public_reference=$1', [
          `UNSENT-${run}`,
        ])
      ).rows,
    ).toHaveLength(0);
    await expect(page.getByRole('row').filter({ hasText: `SWITCH-${run}` })).toHaveCount(0);
    await page.screenshot({
      path: `${evidenceDir}/second-merchant-after-response.png`,
      animations: 'disabled',
      timeout: 60000,
    });
    await page.getByLabel('Negocio', { exact: true }).click();
    await page.getByRole('option', { name: merchantName(fixture.merchantId), exact: true }).click();
    await trigger.click();
    await expect(dialog.getByRole('cell', { name: 'Pendiente', exact: true })).toBeVisible();
    await button('Nueva importación').click();
    await button('Cancelar').click();
  } catch (error) {
    initialError = error;
  } finally {
    release();
    try {
      if (commands.length) await bounded(handled, 'held response cleanup', 5000);
    } catch (error) {
      handlerError ||= error;
    }
    await page.unroute(pattern, hold);
  }
  if (initialError) throw initialError;
  if (handlerError) throw handlerError;
  return {
    previewPages: 2,
    resultPages: 2,
    mobileWidth: 390,
    focusAndEscape: true,
    switchCommands: commands.length,
    originalLocationRetained: true,
    unsentSuppressed: true,
  };
}

export async function verifyImportRestricted({ browser, fixture, expect, base, db, evidenceDir }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await loginImportOwner(
      page,
      {
        ...fixture,
        email: fixture.task4.restrictedEmail,
        password: fixture.task4.restrictedPassword,
      },
      base,
    );
    await page.goto(`${base}/inventory`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Importar artículos', exact: true })).toHaveCount(
      0,
    );
    await page.goto(`${base}/inventory/recetas`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Importar recetas', exact: true })).toHaveCount(
      0,
    );
    const code = `DENIED-${randomUUID().slice(0, 8)}`;
    const denied = await ownerCommand(page, fixture, 'inventory.item.create', randomUUID(), null, {
      publicReference: code,
      displayName: 'Acceso restringido',
      itemType: 'ingredient',
      baseUnit: 'gram',
      quantityScale: 0,
      trackingPolicy: 'tracked',
      negativeStockPolicy: 'allow_and_flag',
    });
    expect(denied.status).toBe(403);
    expect(
      (
        await db.query(
          'SELECT id FROM merchant.inventory_item WHERE merchant_id=$1 AND public_reference=$2',
          [fixture.merchantId, code],
        )
      ).rows,
    ).toHaveLength(0);
    await page.screenshot({
      path: `${evidenceDir}/restricted-user.png`,
      animations: 'disabled',
      timeout: 60000,
    });
    return {
      articleActionAbsent: true,
      recipeActionAbsent: true,
      apiWriteStatus: 403,
      deniedWrites: 0,
    };
  } finally {
    await context.close();
  }
}
