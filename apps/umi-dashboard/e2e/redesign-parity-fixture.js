import { test as base, expect, chromium } from '@playwright/test';
import process from 'node:process';

// Synthetic responses test the current dashboard contracts. They never write business data.
// These responses do not prove live service behavior or persisted data freshness.
export const merchantId = '11111111-1111-4111-8111-111111111111';
export const centroId = '22222222-2222-4222-8222-222222222222';
export const norteId = '33333333-3333-4333-8333-333333333333';
const locations = [
  { id: centroId, name: 'Centro', status: 'active' },
  { id: norteId, name: 'Norte', status: 'active' },
];

export const test = base.extend({
  page: async ({ baseURL }, run) => {
    const cdp = process.env.UMI_PARITY_CDP;
    const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch();
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    try {
      await run(page);
    } finally {
      await context.close();
      if (!cdp) await browser.close();
    }
  },
});
export { expect };

export function salesScope(range, locationId) {
  const branch = locationId === norteId ? 'Norte' : 'Centro';
  const factor = { today: 1, yesterday: 2, last_7_days: 7, last_30_days: 30 }[range];
  if (!factor) throw new Error(`Unknown range: ${range}`);
  const net = (branch === 'Centro' ? 123400 : 432100) * factor;
  const orders = (branch === 'Centro' ? 10 : 20) * factor;
  const period = range === 'today' ? 'hoy' : range === 'yesterday' ? 'ayer' : range;
  return {
    narrative: `La venta de ${period} pertenece a ${branch}.`,
    currency: 'MXN',
    bucket: 'hour',
    totals: {
      netSalesMinorUnits: net,
      priorNetSalesMinorUnits: net / 2,
      orders,
      averageTicketMinorUnits: net / orders,
      itemsSold: orders * 2,
      discountMinorUnits: 100 * factor,
      tipsMinorUnits: 200 * factor,
    },
    series: [{ label: '10:00', amountMinorUnits: net }],
    paymentMix: [{ method: 'cash', amountMinorUnits: net, count: orders }],
    channelMix: [{ channel: 'walk_in', amountMinorUnits: net, count: orders }],
    productMix: [
      {
        productName: `Café ${branch}`,
        category: `Bebidas ${branch}`,
        units: orders,
        netMinorUnits: net,
      },
    ],
    byOperator: [{ key: `Operador ${branch}`, units: orders, netMinorUnits: net }],
    byHour: [{ key: '10:00', units: orders, netMinorUnits: net }],
  };
}

export async function prepareDashboard(
  page,
  { signedIn = true, narrative = true, mfaMethod = 'email_otp' } = {},
) {
  const requests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ signedIn, merchantId, centroId }) => {
      if (!localStorage.getItem('umi.dashboard.locale'))
        localStorage.setItem('umi.dashboard.locale', 'es');
      if (!localStorage.getItem('umi-theme')) localStorage.setItem('umi-theme', 'umi');
      if (signedIn) {
        localStorage.setItem(
          'umi-dashboard-local-session',
          JSON.stringify({
            user: {
              id: '44444444-4444-4444-8444-444444444444',
              displayName: 'Propietario de prueba',
            },
            accessExpiresAt: Date.now() + 3600000,
          }),
        );
        if (!localStorage.getItem('umi-dashboard-selected-merchant'))
          localStorage.setItem('umi-dashboard-selected-merchant', merchantId);
        if (!localStorage.getItem('umi-dashboard-selected-location'))
          localStorage.setItem('umi-dashboard-selected-location', centroId);
      }
    },
    { signedIn, merchantId, centroId },
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push({
      path,
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      body: request.postDataJSON(),
    });
    if (path.endsWith('/me/merchants'))
      return route.fulfill({ json: { merchants: [{ id: merchantId, name: 'Café de prueba' }] } });
    if (path.endsWith('/capabilities')) {
      const selectedLocation =
        locations.find((location) => location.id === url.searchParams.get('locationId')) ||
        locations[0];
      return route.fulfill({
        json: {
          merchant: { id: merchantId, name: 'Café de prueba' },
          locations,
          selectedLocation,
          canSwitchLocations: true,
          membership: {
            permissions: ['merchant.manage', 'sale.lifecycle', 'sale.exception.read'],
            role: 'owner',
          },
          products: { dashboard: { status: 'active' } },
        },
      });
    }
    if (path.endsWith('/reports/sales') || path.endsWith('/reports/sales/insight')) {
      const data = salesScope(url.searchParams.get('range'), url.searchParams.get('locationId'));
      return route.fulfill({
        json: path.endsWith('/insight') ? { narrative: narrative ? data.narrative : null } : data,
      });
    }
    if (path.endsWith('/operations') && url.searchParams.get('domain') === 'receipts') {
      return route.fulfill({
        json: {
          domains: [],
          page: { hasMore: false },
          items: [
            {
              id: 'receipt-parity',
              publicReference: 'PRUEBA-001',
              saleId: 'sale-parity',
              status: 'printed',
              currency: 'MXN',
              amountMinorUnits: 123400,
              occurredAt: '2026-11-02T17:00:00.000Z',
            },
          ],
        },
      });
    }
    if (path.endsWith('/sales/sale-parity/receipt'))
      return route.fulfill({
        json: {
          snapshot: {
            currency: 'MXN',
            operatorName: 'Operador Centro',
            businessDate: '2026-11-02',
            issuedAt: '2026-11-02T17:00:00.000Z',
            subtotal: 123400,
            taxTotal: 0,
            grandTotal: 123400,
            lines: [
              {
                lineRef: 'line-parity',
                description: 'Café Centro',
                quantity: 10,
                lineTotal: 123400,
              },
            ],
            payments: [{ tenderId: 'cash-parity', method: 'cash', amount: 123400, change: 0 }],
          },
          exceptions: [],
        },
      });
    if (path.endsWith('/auth/local/login'))
      return route.fulfill({
        json: {
          mfaRequired: true,
          method: mfaMethod,
          challengeToken: 'synthetic-challenge',
          expiresInSeconds: 300,
        },
      });
    if (path.endsWith('/auth/local/mfa/verify'))
      return route.fulfill({ status: 401, json: { message: 'Código de prueba rechazado.' } });
    if (path.endsWith('/auth/local/forgot-password') || path.endsWith('/auth/local/reset-password'))
      return route.fulfill({ json: {} });
    if (request.method() !== 'GET') {
      errors.push(`Unexpected write: ${path}`);
      return route.fulfill({ status: 400, json: { message: 'Unexpected write' } });
    }
    return route.fulfill({ json: {} });
  });
  return { requests, errors };
}

export async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
