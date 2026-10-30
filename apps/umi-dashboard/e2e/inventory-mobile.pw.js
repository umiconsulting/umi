import { test, expect, chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { verifyInventoryMobile } from './inventory-mobile-scenarios.js';

test('inventory editor is reachable from mobile list and detail', async () => {
  test.setTimeout(120000);
  test.skip(!process.env.UMI_MOBILE_FIXTURE, 'Requires an isolated local inventory fixture.');
  const fixture = JSON.parse(readFileSync(process.env.UMI_MOBILE_FIXTURE, 'utf8'));
  const base = process.env.UMI_MOBILE_BASE || 'http://127.0.0.1:4063';
  const browser = await chromium.connectOverCDP(
    process.env.UMI_INVENTORY_CDP || 'http://127.0.0.1:9225',
    { noDefaults: true },
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 800 },
    hasTouch: true,
  });
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
    await page.goto(`${base}/inventory`);
    await verifyInventoryMobile({ page, fixture, expect, evidenceDir: test.info().outputDir });
  } finally {
    await context.close();
    await browser.close();
  }
});
