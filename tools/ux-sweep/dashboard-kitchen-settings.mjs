import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Borrows the real browser started by scripts/ux-browser.sh; no mocked requests.
const out = 'docs/reports/evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes(':4000'));
if (!page) throw new Error('Open the authenticated dashboard first');
await page.setViewportSize({ width: 1440, height: 1000 });
const requests = [];
page.on('response', (r) => {
  if (r.url().includes('/kds/'))
    requests.push({ method: r.request().method(), url: r.url(), status: r.status() });
});
await page.getByRole('button', { name: 'Cocina', exact: true }).click();
await page.getByLabel('Umbral Barra', { exact: true }).waitFor();
const station = page.getByLabel('Umbral Barra', { exact: true }).locator('xpath=ancestor::form');
await station.getByRole('checkbox').uncheck();
await station.getByRole('button', { name: 'Guardar estación', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Configuración guardada' }).waitFor();
await page.reload();
await page.getByLabel('Umbral Barra', { exact: true }).waitFor();
const restored = page.getByLabel('Umbral Barra', { exact: true }).locator('xpath=ancestor::form');
if (await restored.getByRole('checkbox').isChecked())
  throw new Error('Sound off did not survive reload');
await restored.getByRole('checkbox').check();
await restored.getByRole('button', { name: 'Guardar estación', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Configuración guardada' }).waitFor();
await page.getByLabel('Buscar producto', { exact: true }).fill('Capuccino');
await page
  .getByLabel('Producto a configurar', { exact: true })
  .selectOption({ label: 'Capuccino' });
const route = page.getByLabel('Capuccino', { exact: true }).locator('xpath=ancestor::form');
await route.getByRole('combobox').selectOption({ label: 'Cocina' });
await route.getByLabel('Prioridad Capuccino', { exact: true }).fill('10');
await route.getByLabel('Objetivo Capuccino', { exact: true }).fill('30');
await route.getByRole('button', { name: 'Guardar ruta', exact: true }).click();
await page.getByRole('status').filter({ hasText: 'Configuración guardada' }).waitFor();
await page.getByText('Capuccino: Cocina', { exact: true }).waitFor();
await page.screenshot({ path: `${out}/dashboard-02-product-override.png`, fullPage: true });
await page.reload();
await page
  .getByLabel('Producto a configurar', { exact: true })
  .selectOption({ label: 'Capuccino' });
await page.getByText('Capuccino: Cocina', { exact: true }).waitFor();
await page
  .getByText('Excepción por producto · Prioridad 10 · Objetivo 30 s', { exact: true })
  .waitFor();
await page.screenshot({ path: `${out}/dashboard-03-persisted.png`, fullPage: true });
writeFileSync(
  `${out}/dashboard-clicks.json`,
  JSON.stringify(
    { soundOffSurvivedReload: true, productOverrideSurvivedReload: true, requests },
    null,
    2,
  ),
);
console.log(
  'Dashboard: sound off/on persisted; product override Cocina priority=10 target=30 persisted.',
);
await browser.close();
