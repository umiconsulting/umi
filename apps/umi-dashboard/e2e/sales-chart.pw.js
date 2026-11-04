import { test, expect } from '@playwright/test';

const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';

// Datos controlados para medir el gráfico real. No verifica la contabilidad de la API.
async function prepare(page) {
  await page.addInitScript(() => {
    localStorage.setItem('umi.dashboard.locale', 'es');
    localStorage.setItem(
      'umi-dashboard-local-session',
      JSON.stringify({
        user: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Propietario local' },
        accessExpiresAt: Date.now() + 3600000,
      }),
    );
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id: merchantId, name: 'Café local' }] } });
    if (path.endsWith('/capabilities'))
      return route.fulfill({
        json: {
          merchant: { id: merchantId, name: 'Café local' },
          locations: [{ id: locationId, name: 'Centro', status: 'active' }],
          selectedLocation: { id: locationId, name: 'Centro', status: 'active' },
          membership: {
            permissions: ['merchant.manage', 'reports.read', 'operations.read', '*'],
            role: 'owner',
          },
          products: { dashboard: { status: 'active' } },
        },
      });
    if (path.endsWith('/reports/sales/insight'))
      return route.fulfill({ json: { narrative: null } });
    if (path.endsWith('/reports/sales')) {
      const daily = url.searchParams.get('range') === 'last_7_days';
      return route.fulfill({
        json: {
          range: daily ? 'last_7_days' : 'today',
          currency: 'MXN',
          bucket: daily ? 'day' : 'hour',
          totals: {
            netSalesMinorUnits: daily ? 70000 : 50000,
            orders: 3,
            averageTicketMinorUnits: 10000,
            itemsSold: 3,
            discountMinorUnits: 0,
            tipsMinorUnits: 0,
            priorNetSalesMinorUnits: null,
          },
          series: daily
            ? [
                { label: '2026-11-01', amountMinorUnits: 10000 },
                { label: '2026-11-02', amountMinorUnits: 40000 },
                { label: '2026-11-03', amountMinorUnits: 20000 },
              ]
            : [
                { label: '14', amountMinorUnits: 0 },
                { label: '16', amountMinorUnits: 10000 },
                { label: '17', amountMinorUnits: 40000 },
              ],
          paymentMix: [],
          channelMix: [],
          productMix: [],
          byOperator: [],
          byHour: [],
        },
      });
    }
    if (request.method() !== 'GET') throw new Error(`Escritura inesperada: ${path}`);
    return route.fulfill({ json: {} });
  });
}

async function barHeights(page) {
  const chart = page.getByRole('img', { name: 'Serie de ventas del periodo' });
  await expect(chart).toBeVisible();
  await expect(chart.locator('[title]')).toHaveCount(3);
  return chart
    .locator('[title]')
    .evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().height));
}

for (const width of [1440, 768]) {
  test(`representa importes distintos por hora y día a ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await prepare(page);
    await page.goto('/reportes');
    await expect(page.getByText('Venta por hora', { exact: true })).toBeVisible();
    const hourly = await barHeights(page);
    await testInfo.attach('hora', { body: await page.screenshot(), contentType: 'image/png' });
    expect(hourly[2]).toBeGreaterThan(80);
    expect(hourly[1] / hourly[2]).toBeCloseTo(0.25, 1);
    expect(hourly[0]).toBeLessThan(hourly[1]);

    await page.getByRole('button', { name: '7 días', exact: true }).click();
    await expect(page.getByText('Venta por día', { exact: true })).toBeVisible();
    const daily = await barHeights(page);
    await testInfo.attach('dia', { body: await page.screenshot(), contentType: 'image/png' });
    expect(daily[1]).toBeGreaterThan(80);
    expect(daily[0] / daily[1]).toBeCloseTo(0.25, 1);
    expect(daily[2] / daily[1]).toBeCloseTo(0.5, 1);
    await testInfo.attach('medidas', {
      body: JSON.stringify({ width, hourly, daily }),
      contentType: 'application/json',
    });
  });
}
