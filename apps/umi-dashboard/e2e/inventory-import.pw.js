import { Buffer } from 'node:buffer';
import { test, expect, chromium, request } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import process from 'node:process';
import ExcelJS from 'exceljs';
import { assertImportFixtureOrigins } from './inventory-import-safety.js';
import {
  verifyInventoryImport,
  verifyImportClose,
  verifyImportJournalScope,
  verifyImportTemplateDownloads,
} from './inventory-import-scenarios.js';
import {
  loginImportOwner,
  verifyInventoryImportLive,
  verifyImportedRecipeCheckout,
  verifyImportBoundaries,
  verifyImportRestricted,
} from './inventory-import-live.js';

test('CSV and Excel import preview, cancel, lost response recovery and localized results', async () => {
  test.setTimeout(240000);
  test.skip(!process.env.UMI_IMPORT_FIXTURE, 'Requires an isolated local import fixture.');
  const fixture = JSON.parse(readFileSync(process.env.UMI_IMPORT_FIXTURE, 'utf8'));
  const base = process.env.UMI_IMPORT_BASE || 'http://127.0.0.1:4083';
  assertImportFixtureOrigins(fixture, base);
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
    await loginImportOwner(page, fixture, base);
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
    await browser.close(); // CDP closes this transport and preserves the shared Chromium process.
  }
});

test('real API and database: exact recipes, history, checkout, pagination and access boundaries', async () => {
  test.skip(
    !process.env.UMI_IMPORT_FIXTURE || !process.env.UMI_IMPORT_DATABASE_URL,
    'Requires the isolated import fixture and its local database URL.',
  );
  const fixture = JSON.parse(readFileSync(process.env.UMI_IMPORT_FIXTURE, 'utf8'));
  expect(fixture.task4).toBeTruthy();
  const base = process.env.UMI_IMPORT_BASE || 'http://127.0.0.1:4083';
  assertImportFixtureOrigins(fixture, base, process.env.UMI_IMPORT_DATABASE_URL);
  const requireApi = createRequire(new URL('../../umi-api/package.json', import.meta.url));
  const { Client } = requireApi('pg');
  const db = new Client({ connectionString: process.env.UMI_IMPORT_DATABASE_URL });
  await db.connect();
  const evidenceDir =
    process.env.UMI_IMPORT_EVIDENCE_DIR || '/private/tmp/umi-import-task4-evidence';
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
    await loginImportOwner(page, fixture, base);
    const result = await verifyInventoryImportLive({
      page,
      fixture,
      expect,
      base,
      db,
      ExcelJS,
      evidenceDir,
    });
    await verifyImportedRecipeCheckout({ fixture, run: result.run, db, expect, request });
    await verifyImportBoundaries({ page, fixture, expect, base, db, evidenceDir });
    await verifyImportRestricted({ browser, fixture, expect, base, db, evidenceDir });
  } finally {
    await context.close();
    await browser.close(); // CDP closes this transport and preserves the shared Chromium process.
    await db.end();
  }
});

test('journal survives the same tab and isolates independent tabs without API import writes', async () => {
  test.skip(!process.env.UMI_IMPORT_FIXTURE, 'Requires an isolated local import fixture.');
  const fixture = JSON.parse(readFileSync(process.env.UMI_IMPORT_FIXTURE, 'utf8'));
  const base = process.env.UMI_IMPORT_BASE || 'http://127.0.0.1:4083';
  assertImportFixtureOrigins(fixture, base);
  const evidenceDir =
    process.env.UMI_IMPORT_EVIDENCE_DIR || '/private/tmp/umi-import-final-fix-evidence';
  mkdirSync(evidenceDir, { recursive: true });
  const browser = await chromium.connectOverCDP(process.env.UX_CDP || 'http://127.0.0.1:9226', {
    noDefaults: true,
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    await loginImportOwner(page, fixture, base);
    await verifyImportJournalScope({ page, fixture, expect, base, evidenceDir });
  } finally {
    await context.close();
    await browser.close();
  }
});

test('XLSX template downloads include guidance and never import their example sheets', async () => {
  test.skip(!process.env.UMI_IMPORT_FIXTURE, 'Requires an isolated local import fixture.');
  const fixture = JSON.parse(readFileSync(process.env.UMI_IMPORT_FIXTURE, 'utf8'));
  const base = process.env.UMI_IMPORT_BASE || 'http://127.0.0.1:4083';
  assertImportFixtureOrigins(fixture, base);
  const evidenceDir =
    process.env.UMI_IMPORT_EVIDENCE_DIR || '/private/tmp/umi-import-final-fix-evidence';
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
    await loginImportOwner(page, fixture, base);
    await verifyImportTemplateDownloads({ page, fixture, expect, base, ExcelJS, evidenceDir });
  } finally {
    await context.close();
    await browser.close();
  }
});
