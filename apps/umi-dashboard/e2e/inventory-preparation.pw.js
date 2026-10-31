import { test, expect, chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import { verifyInventoryPreparation } from './inventory-preparation-scenarios.js';

test('direct preparation uses exact server plans and recovers one lost response', async () => {
  test.setTimeout(180000);
  test.skip(
    !process.env.UMI_PREPARATION_FIXTURE,
    'Requires an isolated local preparation fixture.',
  );
  const fixture = JSON.parse(readFileSync(process.env.UMI_PREPARATION_FIXTURE, 'utf8'));
  const base = process.env.UMI_PREPARATION_BASE || 'http://127.0.0.1:4073';
  const evidenceDir =
    process.env.UMI_PREPARATION_EVIDENCE_DIR || '/private/tmp/umi-preparation-evidence';
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9225', {
    noDefaults: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(({ merchantId, locationId }) => {
      localStorage.setItem('umi.dashboard.locale', 'es');
      localStorage.setItem('umi-dashboard-selected-merchant', merchantId);
      localStorage.setItem('umi-dashboard-selected-location', locationId);
    }, fixture);
    await page.goto(`${base}/login`);
    await page.getByLabel('Correo', { exact: true }).fill(fixture.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/login');
    await page.waitForLoadState('networkidle');
    await verifyInventoryPreparation({ page, fixture, expect, evidenceDir, base });
  } finally {
    await context.close();
    await browser.close();
  }
});

async function withPreparationPage(run) {
  const fixture = JSON.parse(readFileSync(process.env.UMI_PREPARATION_FIXTURE, 'utf8'));
  const base = process.env.UMI_PREPARATION_BASE || 'http://127.0.0.1:4073';
  const evidenceDir =
    process.env.UMI_PREPARATION_EVIDENCE_DIR || '/private/tmp/umi-preparation-evidence';
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9225', {
    noDefaults: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(({ merchantId, locationId }) => {
      localStorage.setItem('umi.dashboard.locale', 'es');
      localStorage.setItem('umi-dashboard-selected-merchant', merchantId);
      localStorage.setItem('umi-dashboard-selected-location', locationId);
    }, fixture);
    await page.goto(`${base}/login`);
    await page.getByLabel('Correo', { exact: true }).fill(fixture.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL((url) => url.pathname !== '/login');
    await page.waitForLoadState('networkidle');
    await run({ page, fixture, base, evidenceDir });
  } finally {
    await context.close();
    await browser.close();
  }
}

for (const operation of ['preview', 'produce']) {
  test(`pending ${operation} keeps keyboard focus inside preparation`, async () => {
    test.setTimeout(60000);
    test.skip(
      !process.env.UMI_PREPARATION_FIXTURE,
      'Requires an isolated local preparation fixture.',
    );
    await withPreparationPage(async ({ page, fixture, base, evidenceDir }) => {
      await page.goto(`${base}/inventory/preparacion`);
      await page.getByRole('button', { name: 'Nueva preparación', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Nueva preparación', exact: true });
      await dialog
        .getByLabel('Artículo a preparar', { exact: true })
        .selectOption(fixture.outputItemId);
      await dialog.getByLabel('Almacén', { exact: true }).selectOption(fixture.inventoryLocationId);
      await dialog.getByLabel('Cantidad a preparar', { exact: true }).fill('5');
      if (operation === 'produce') {
        await dialog.getByRole('button', { name: 'Revisar ingredientes', exact: true }).click();
        await expect(dialog.getByLabel('Ingredientes revisados')).toContainText('500 g');
      }
      const requests = [];
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let markPending;
      const pending = new Promise((resolve) => {
        markPending = resolve;
      });
      const pattern = `**/api/merchants/${fixture.merchantId}/administrative-commands`;
      const holdResponse = async (route) => {
        const body = route.request().postDataJSON();
        if (body.operation !== `inventory.production.${operation}`) return route.continue();
        requests.push(body);
        markPending();
        await gate;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Local pending focus test' },
          }),
        });
      };
      await page.route(pattern, holdResponse);
      try {
        await dialog
          .getByRole('button', {
            name: operation === 'preview' ? 'Revisar ingredientes' : 'Confirmar preparación',
            exact: true,
          })
          .click();
        await pending;
        await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
        await expect
          .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
          .toBe(true);
        for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
          await page.keyboard.press(key);
          expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        }
        await page
          .getByRole('tab', { name: 'Artículos', exact: true })
          .evaluate((node) => node.focus());
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        expect(new URL(page.url()).pathname).toBe('/inventory/preparacion');
        await page.screenshot({ path: `${evidenceDir}/pending-${operation}-focus.png` });
      } finally {
        release();
      }
      await expect(
        dialog.getByRole('alert').filter({ hasText: 'El servicio no está disponible' }),
      ).toBeVisible();
      if (operation === 'produce') {
        await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
        await expect(dialog.getByLabel('Cantidad a preparar', { exact: true })).toBeDisabled();
        await dialog.getByRole('button', { name: 'Reintentar preparación', exact: true }).click();
        await expect.poll(() => requests.length).toBe(2);
        expect(requests[1]).toEqual(requests[0]);
        await page.unroute(pattern, holdResponse);
      } else {
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.getByRole('tab', { name: 'Artículos', exact: true }).click();
        await expect(page.getByPlaceholder('Buscar artículo')).toBeVisible();
      }
    });
  });
}
