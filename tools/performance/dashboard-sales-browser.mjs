import assert from 'node:assert/strict';
import { chromium, expect as testExpect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
const expect = testExpect.configure({ timeout: 30000 });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const base = process.env.UMI_PERF_BASE || 'http://umi-category.localhost:4027';
if (
  !['localhost', '127.0.0.1'].includes(new URL(base).hostname) &&
  !new URL(base).hostname.endsWith('.localhost')
)
  throw Error('Use an authorized local candidate.');
const output = process.env.UMI_PERF_OUTPUT || '/tmp/umi-dashboard-performance';
mkdirSync(output, { recursive: true });
let context;
try {
  const owner = browser.contexts()[0];
  const source = owner.pages().find((p) => p.url().startsWith(base));
  const items = await source.evaluate(() =>
    Object.entries(localStorage).map(([name, value]) => ({ name, value })),
  );
  context = await browser.newContext({
    storageState: {
      cookies: await owner.cookies(base),
      origins: [{ origin: base, localStorage: items }],
    },
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const requests = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.endsWith('/sales/analysis'))
      requests.push({ at: Date.now(), query: new URL(req.url()).search });
  });
  const start = performance.now();
  await page.goto(`${base}/?home=1&days=30`);
  await expect(page.locator('.sales-primary')).toBeVisible();
  const coldMs = performance.now() - start;
  await expect(page.getByText('Actualizando ventas…', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(500);
  const initialRequests = requests.length;
  assert.equal(initialRequests, 2);
  const detailStart = performance.now();
  await page.locator('.sales-primary').click();
  await expect(page.locator('.sales-analysis')).toBeVisible();
  await expect(page.getByText('Consultando compras…', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  assert.equal(requests.length, initialRequests);
  const detailMs = performance.now() - detailStart;
  await page.goBack();
  await expect(page.locator('.sales-primary')).toBeVisible();
  await page.waitForTimeout(250);
  assert.equal(requests.length, initialRequests);
  await page.route('**/sales/analysis?**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText('Actualizando ventas…', { exact: true })).toBeVisible();
  await expect(page.locator('.sales-primary')).toBeVisible();
  await expect.poll(() => requests.length).toBe(initialRequests + 2);
  await expect(page.getByText('Actualizando ventas…', { exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  const countAfterRefresh = await page.evaluate(async () => {
    const { queryClient } = await import('/src/lib/query-client.js');
    return queryClient.getQueryCache().findAll({ queryKey: ['sales-analysis'] }).length;
  });
  assert.equal(countAfterRefresh, 2);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { queryClient } = await import('/src/lib/query-client.js');
        return queryClient
          .getQueryCache()
          .findAll({ queryKey: ['sales-analysis'] })
          .filter((query) => query.state.fetchStatus === 'fetching').length;
      }),
    )
    .toBe(0);
  const refreshedAt = await page.evaluate(async () => {
    const { queryClient } = await import('/src/lib/query-client.js');
    return Object.fromEntries(
      queryClient
        .getQueryCache()
        .findAll({ queryKey: ['sales-analysis'] })
        .map((query) => [query.queryKey.at(-1), query.state.dataUpdatedAt]),
    );
  });
  await page.screenshot({ path: `${output}/cache-browser.png`, fullPage: true });
  console.log(
    JSON.stringify({
      phase: 'navigation-and-manual-refresh-passed',
      coldMs,
      detailMs,
      initialRequests,
      countAfterRefresh,
    }),
  );
  const pollStart = Date.now();
  await page.waitForTimeout(61000);
  await expect.poll(() => requests.length).toBeGreaterThan(initialRequests + 2);
  const firstAuto = requests.slice(initialRequests + 2).find((req) => req.at >= pollStart);
  const autoDataAgeMs = firstAuto.at - refreshedAt[firstAuto.query.slice(1)];
  assert.ok(
    autoDataAgeMs >= 59000 && autoDataAgeMs <= 65000,
    JSON.stringify({ autoDataAgeMs, firstAuto, refreshedAt }),
  );
  await page.route('**/sales/analysis?**', (route) =>
    route.fulfill({ status: 422, json: { code: 'REPORT_RANGE_TOO_COMPLEX' } }),
  );
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(
    page.getByText('El análisis combina demasiados productos. Consulta un periodo menor.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('.sales-primary')).toHaveCount(0);
  const failedCount = requests.length;
  await page.waitForTimeout(3500);
  assert.equal(requests.length, failedCount, 'Failed polls must respect the normal interval');
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('.sales-primary')).toBeVisible();
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    coldMs,
    detailMs,
    initialRequests,
    manualRefreshEntries: countAfterRefresh,
    autoRefreshDelayMs: firstAuto.at - pollStart,
    autoDataAgeMs,
    requests,
    errors,
  };
  writeFileSync(`${output}/cache-browser.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close();
  await browser.close();
}
