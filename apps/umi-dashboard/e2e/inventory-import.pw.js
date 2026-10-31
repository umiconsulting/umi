import { Buffer } from 'node:buffer';
import { test, expect, chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import ExcelJS from 'exceljs';
import { verifyInventoryImport, verifyImportClose } from './inventory-import-scenarios.js';

test('CSV and Excel import preview, cancel, lost response recovery and localized results', async () => {
  test.setTimeout(240000);
  test.skip(!process.env.UMI_IMPORT_FIXTURE, 'Requires an isolated local import fixture.');
  const fixture = JSON.parse(readFileSync(process.env.UMI_IMPORT_FIXTURE, 'utf8'));
  const base = process.env.UMI_IMPORT_BASE || 'http://127.0.0.1:4083';
  const evidenceDir =
    process.env.UMI_IMPORT_EVIDENCE_DIR || '/private/tmp/umi-import-task3-evidence';
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9226', {
    noDefaults: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
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
    await page.waitForURL((url) => url.pathname != '/login');
    await page.waitForLoadState('networkidle');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Articulos');
    sheet.addRows([
      ['codigo', 'nombre', 'tipo', 'unidad', 'decimales'],
      ['EXCEL-PREVIEW', 'Artículo Excel', 'ingredient', 'gram', '0'],
    ]);
    await verifyInventoryImport({
      page,
      fixture,
      expect,
      evidenceDir,
      base,
      excelBuffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    });
    await verifyImportClose({ page, fixture, expect, base });
  } finally {
    await context.close();
    await browser.close();
  }
});
