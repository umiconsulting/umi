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
