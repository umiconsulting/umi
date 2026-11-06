import {
  test,
  expect,
  prepareDashboard,
  salesScope,
  choose,
  centroId,
  norteId,
} from './redesign-parity-fixture.js';

async function assertScope(page, server, range, locationId) {
  const scope = salesScope(range, locationId);
  await expect(page.getByText('Resumen del periodo', { exact: true })).toBeVisible();
  await expect(page.getByText(scope.narrative, { exact: true })).toBeVisible();
  const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    scope.totals.netSalesMinorUnits / 100,
  );
  await expect(page.getByText('Ventas netas', { exact: true }).locator('..')).toContainText(money);
  await expect(page.getByText('Órdenes', { exact: true }).locator('..')).toHaveText(
    `Órdenes${scope.totals.orders}`,
  );
  for (const suffix of ['/reports/sales', '/reports/sales/insight']) {
    await expect
      .poll(() => server.requests.filter((entry) => entry.path.endsWith(suffix)).at(-1)?.query)
      .toEqual({ range, locationId });
  }
}

async function screenshot(page, testInfo, name) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
}

test('sales narrative and totals follow the period and branch controls', async ({
  page,
}, testInfo) => {
  const server = await prepareDashboard(page);
  await page.goto('/reportes');
  await assertScope(page, server, 'today', centroId);
  await screenshot(page, testInfo, 'sales-desktop');
  for (const [label, range] of [
    ['Ayer', 'yesterday'],
    ['7 días', 'last_7_days'],
    ['30 días', 'last_30_days'],
  ]) {
    await page
      .getByRole('group', { name: 'Rango de fechas' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await assertScope(page, server, range, centroId);
  }
  await choose(page, 'Sucursal', 'Norte');
  await assertScope(page, server, 'last_30_days', norteId);
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await assertScope(page, server, 'today', norteId);
  expect(server.errors).toEqual([]);
});

test('sales summary remains complete when the optional narrative is absent', async ({ page }) => {
  const server = await prepareDashboard(page, { narrative: false });
  await page.goto('/reportes');
  await expect(page.getByText('Ventas netas', { exact: true }).locator('..')).toContainText(
    '$1,234.00',
  );
  await expect
    .poll(() => server.requests.some((entry) => entry.path.endsWith('/sales/insight')))
    .toBe(true);
  await expect(page.getByText('Resumen del periodo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Serie de ventas del periodo' })).toBeVisible();
  await expect(page.getByText('Método de pago', { exact: true })).toBeVisible();
  await expect(page.getByText('Canal de venta', { exact: true })).toBeVisible();
  expect(server.errors).toEqual([]);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 402, height: 874 },
  { width: 412, height: 915 },
]) {
  test(`sales summary, pivot, and receipt detail remain reachable at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    const server = await prepareDashboard(page);
    await page.setViewportSize(viewport);
    await page.goto('/reportes');
    await assertScope(page, server, 'today', centroId);
    await screenshot(page, testInfo, 'summary');
    await page.getByRole('button', { name: 'Tabla dinámica', exact: true }).click();
    const grouping = page.getByRole('group', { name: 'Agrupar por' });
    await expect(page.getByRole('cell', { name: 'Café Centro', exact: true })).toBeVisible();
    for (const [label, row] of [
      ['Categoría', 'Bebidas Centro'],
      ['Operador', 'Operador Centro'],
      ['Hora', '10:00'],
    ]) {
      await grouping.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('cell', { name: row, exact: true })).toBeVisible();
    }
    await screenshot(page, testInfo, 'pivot');
    await page.getByRole('button', { name: 'Recibos', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Rango de fechas' })).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Buscar recibos' })).toBeVisible();
    await page.getByRole('button', { name: 'PRUEBA-001', exact: true }).click();
    const detail = page.getByRole('dialog', { name: 'Detalle del recibo' });
    await expect(detail).toContainText('Operador: Operador Centro');
    await expect(detail.getByText('Café Centro', { exact: true })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Reimprimir', exact: true })).toBeVisible();
    await screenshot(page, testInfo, 'receipt-detail');
    await detail.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page
      .getByRole('group', { name: 'Vista', exact: true })
      .getByRole('button', { name: 'Resumen', exact: true })
      .click();
    await assertScope(page, server, 'today', centroId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    expect(server.errors).toEqual([]);
  });
}

test('drawer navigation and tablet rotation retain the sales view and period', async ({
  page,
}, testInfo) => {
  const server = await prepareDashboard(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto('/reportes');
  await page.getByRole('button', { name: 'Ayer', exact: true }).click();
  await page.getByRole('button', { name: 'Tabla dinámica', exact: true }).click();
  for (const viewport of [
    { width: 800, height: 1340 },
    { width: 1340, height: 800 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Tabla dinámica', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Ayer', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('cell', { name: 'Café Centro', exact: true })).toBeVisible();
    await screenshot(page, testInfo, `tablet-${viewport.width}`);
  }
  await page.getByRole('button', { name: 'Menú', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/nav-open/);
  await page
    .getByRole('button', { name: 'Cerrar el menú', exact: true })
    .click({ position: { x: 780, y: 300 } });
  await expect(page.locator('.app')).not.toHaveClass(/nav-open/);
  await expect(page.getByRole('button', { name: 'Tabla dinámica', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Menú', exact: true }).click();
  await page.getByRole('button', { name: 'Resumen', exact: true }).first().click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.app')).not.toHaveClass(/nav-open/);
  expect(server.errors).toEqual([]);
});

test('the original theme and locale controls persist their choices', async ({ page }, testInfo) => {
  const server = await prepareDashboard(page);
  await page.goto('/reportes');
  for (const [label, value] of [
    ['Oscuro', 'dark'],
    ['Medianoche', 'midnight'],
    ['Umi', 'umi'],
  ]) {
    await page.getByRole('button', { name: /^Tema:/ }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await screenshot(page, testInfo, value);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  }
  await choose(page, 'Idioma', 'English');
  await expect(
    page
      .getByRole('group', { name: 'View', exact: true })
      .getByRole('button', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'View', exact: true })
      .getByRole('button', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await choose(page, 'Language', 'Español');
  await expect(
    page
      .getByRole('group', { name: 'Vista', exact: true })
      .getByRole('button', { name: 'Resumen', exact: true }),
  ).toBeVisible();
  expect(server.errors).toEqual([]);
});

for (const width of [1440, 402]) {
  test(`login keeps its image, copy, reveal, remembered email, and recovery at ${width}`, async ({
    page,
  }, testInfo) => {
    const server = await prepareDashboard(page, { signedIn: false });
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 874 });
    await page.goto('/login');
    const authFontSize = width === 1440 ? '14px' : '16px';
    await expect(page.getByLabel('Correo', { exact: true })).toBeFocused();
    await expect(page.getByLabel('Correo', { exact: true })).toHaveCSS('font-size', authFontSize);
    await expect(page.locator('.login-hero h1')).toHaveText('Tu operación,en tiempo real.');
    await expect(page.locator('.login-hero p')).toHaveText(
      'Supervisa la operación de tu negocio al momento, desde un solo panel.',
    );
    if (width === 1440) await expect(page.locator('.login-hero')).toBeVisible();
    await expect(page.locator('.login-wrap')).toHaveCSS('background-size', 'auto, cover, auto');
    expect(
      await page
        .locator('.login-wrap')
        .evaluate((element) => getComputedStyle(element).backgroundImage),
    ).toContain('/login-bg.jpg');
    const imageResponse = await page.request.get('/login-bg.jpg');
    expect(imageResponse.ok()).toBe(true);
    expect(imageResponse.headers()['content-type']).toContain('image/jpeg');
    await page.getByLabel('Correo', { exact: true }).fill('owner@example.invalid');
    const password = page.getByLabel('Contraseña', { exact: true });
    await expect(password).toHaveCSS('font-size', authFontSize);
    await password.fill('SyntheticPassword!');
    await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByText('Recordarme', { exact: true }).click();
    await expect(page.getByLabel('Recordarme', { exact: true })).toBeChecked();
    await screenshot(page, testInfo, 'login');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Verifica que eres tú' })).toBeVisible();
    await expect(page.getByLabel('Código', { exact: true })).toHaveCSS('font-size', authFontSize);
    await expect(
      page.getByText('Te enviamos un código de seis dígitos a tu correo.', { exact: true }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'mfa');
    await page.reload();
    await expect(page.getByLabel('Correo', { exact: true })).toHaveValue('owner@example.invalid');
    await expect(page.getByLabel('Recordarme', { exact: true })).toBeChecked();
    await expect(password).toHaveValue('');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?', exact: true }).click();
    await expect(page.getByLabel('Correo', { exact: true })).toHaveCSS('font-size', authFontSize);
    await page.getByLabel('Correo', { exact: true }).fill('owner@example.invalid');
    await page.getByRole('button', { name: 'Enviar enlace', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
    await screenshot(page, testInfo, 'recovery-sent');
    await page.getByRole('button', { name: 'Volver a iniciar sesión', exact: true }).click();
    await page.getByText('Recordarme', { exact: true }).click();
    await expect(page.getByLabel('Recordarme', { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.reload();
    await expect(page.getByLabel('Correo', { exact: true })).toHaveValue('');
    expect(server.errors).toEqual([]);
  });
}

test('MFA uses the server method and keeps an invalid code outside the app', async ({ page }) => {
  const server = await prepareDashboard(page, { signedIn: false, mfaMethod: 'totp' });
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill('owner@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('SyntheticPassword!');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(
    page.getByText('Escribe el código de seis dígitos de tu aplicación de autenticación.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel('Código', { exact: true }).fill('135790');
  await page.getByRole('button', { name: 'Verificar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Código de prueba rechazado.');
  await expect(page).toHaveURL('/login');
  await expect(page.getByLabel('Código', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Volver a iniciar sesión', exact: true }).click();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
  expect(server.errors).toEqual([]);
});

test('reset validates confirmation and displays the result at phone width', async ({
  page,
}, testInfo) => {
  const server = await prepareDashboard(page, { signedIn: false });
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto('/reset-password?token=synthetic-reset');
  await expect(page.getByLabel('Nueva contraseña', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Nueva contraseña', { exact: true })).toHaveCSS('font-size', '16px');
  await expect(page.getByLabel('Confirmar contraseña', { exact: true })).toHaveCSS(
    'font-size',
    '16px',
  );
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('SyntheticPassword!');
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('DifferentPassword!');
  await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
  await expect(page.getByText('Las contraseñas no coinciden', { exact: true })).toBeVisible();
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('SyntheticPassword!');
  await screenshot(page, testInfo, 'reset-form');
  await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contraseña actualizada' })).toBeVisible();
  await screenshot(page, testInfo, 'reset-done');
  await page.getByRole('button', { name: 'Ir al inicio de sesión', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect(server.errors).toEqual([]);
});
