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
    channelMix: [{ channel: 'walk_in', netSalesMinorUnits: net, orders }],
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

function metricsPeriod(range) {
  const bucket = range === 'today' || range === 'yesterday' ? 'hour' : 'day';
  return {
    range,
    start: '2026-10-18',
    end: '2026-11-16',
    bucket,
    comparison: { start: '2026-09-18', end: '2026-10-17' },
  };
}

export function metricsResponse(body, scope) {
  const values = body.metrics.includes('net_sales')
    ? {
        net_sales: scope.totals.netSalesMinorUnits,
        orders: scope.totals.orders,
        average_ticket: scope.totals.averageTicketMinorUnits,
        items_sold: scope.totals.itemsSold,
        discounts: scope.totals.discountMinorUnits,
        tips: scope.totals.tipsMinorUnits,
        prior_net_sales: scope.totals.priorNetSalesMinorUnits,
      }
    : {
        payment_mix: {
          items: scope.paymentMix.map((row) => ({
            method: row.method,
            amountMinorUnits: row.amountMinorUnits,
          })),
          truncated: false,
          limit: 8,
          totalItems: scope.paymentMix.length,
          total: { amountMinorUnits: scope.totals.netSalesMinorUnits },
        },
        channel_mix: {
          items: scope.channelMix.map((row) => ({
            channel: row.channel,
            netSalesMinorUnits: row.netSalesMinorUnits,
            orders: row.orders,
          })),
          truncated: false,
          limit: 8,
          totalItems: scope.channelMix.length,
          total: {
            netSalesMinorUnits: scope.totals.netSalesMinorUnits,
            orders: scope.totals.orders,
          },
        },
        product_mix: {
          items: scope.productMix.map((row) => ({
            productId: null,
            productName: row.productName,
            category: row.category,
            units: row.units,
            merchandiseMinorUnits: row.netMinorUnits,
          })),
          truncated: false,
          limit: 200,
          totalItems: scope.productMix.length,
          total: {
            units: scope.productMix.reduce((sum, row) => sum + row.units, 0),
            merchandiseMinorUnits: scope.productMix.reduce(
              (sum, row) => sum + row.netMinorUnits,
              0,
            ),
          },
        },
        operator_mix: {
          items: scope.byOperator.map((row) => ({
            operator: row.key,
            units: row.units,
            merchandiseMinorUnits: row.netMinorUnits,
          })),
          truncated: false,
          limit: 100,
          totalItems: scope.byOperator.length,
          total: {
            units: scope.byOperator.reduce((sum, row) => sum + row.units, 0),
            merchandiseMinorUnits: scope.byOperator.reduce(
              (sum, row) => sum + row.netMinorUnits,
              0,
            ),
          },
        },
        hour_mix: {
          items: scope.byHour.map((row) => ({
            hour: row.key,
            units: row.units,
            merchandiseMinorUnits: row.netMinorUnits,
          })),
          truncated: false,
          limit: 24,
          totalItems: scope.byHour.length,
          total: {
            units: scope.byHour.reduce((sum, row) => sum + row.units, 0),
            merchandiseMinorUnits: scope.byHour.reduce((sum, row) => sum + row.netMinorUnits, 0),
          },
        },
        series: {
          items: scope.series.map((row) => ({
            label: row.label,
            netSalesMinorUnits: row.amountMinorUnits,
          })),
          truncated: false,
          limit: 31,
          totalItems: scope.series.length,
          total: {
            netSalesMinorUnits: scope.series.reduce((sum, row) => sum + row.amountMinorUnits, 0),
          },
        },
      };
  return {
    definitionVersion: '1.0.0',
    scope: {
      merchantId,
      locationId: body.locationId ?? null,
      currency: 'MXN',
      timezone: 'America/Mexico_City',
      attribution: { category: 'current' },
    },
    period: metricsPeriod(body.range),
    coverage: {
      sources: [
        'pos_committed_sale',
        'receipt_snapshot',
        'pos_cart_line',
        'pos_tender_fact',
        'customer_value_tender_allocation',
        'product',
        'product_category',
      ],
      committedOnly: true,
      refundsIncluded: false,
    },
    freshness: { capturedAt: '2026-11-02T18:00:00.000Z' },
    truncated: false,
    totals: { values },
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
    if (path.endsWith('/reports/sales/analysis/options')) {
      // The analysis view reads these before it renders.
      return route.fulfill({
        json: {
          products: [],
          groups: [],
          locations: locations.map(({ id, name }) => ({ id, name })),
          canCompareLocations: true,
          canManageGroups: true,
          firstSaleDate: '2026-11-02',
          today: '2026-11-02',
          timezone: 'America/Mexico_City',
        },
      });
    }
    if (path.endsWith('/reports/sales/analysis')) {
      const metrics = {
        tickets: 0,
        units: 0,
        merchandiseMinorUnits: 0,
        refundsMinorUnits: 0,
        netMinorUnits: 0,
        averageTicketMinorUnits: null,
        unitsPerTicket: null,
        tipsMinorUnits: 0,
        discountsMinorUnits: 0,
      };
      return route.fulfill({
        json: {
          merchantId,
          locationId: url.searchParams.get('locationId') || centroId,
          from: '2026-11-02',
          to: '2026-11-02',
          timezone: 'America/Mexico_City',
          currency: 'MXN',
          refundView: url.searchParams.get('refundView') || 'sale_result',
          basketUnit: url.searchParams.get('basketUnit') || 'ticket',
          capturedAt: '2026-11-02T18:00:00.000Z',
          firstSaleDate: '2026-11-02',
          totals: metrics,
          byHour: [],
          byDay: [],
          byWeekday: [],
          byMonth: [],
          byLocation: [],
          basketState: { state: 'unavailable', code: 'BASKETS_TOO_COMPLEX' },
        },
      });
    }
    if (path.endsWith('/metrics/query')) {
      const body = request.postDataJSON();
      const data = salesScope(body.range, body.locationId);
      return route.fulfill({ json: metricsResponse(body, data) });
    }
    if (path.endsWith('/metrics/insight')) {
      const body = request.postDataJSON();
      const data = salesScope(body.range, body.locationId);
      return route.fulfill({
        json: {
          narrative: narrative ? data.narrative : null,
          generated: Boolean(narrative),
          capturedAt: '2026-11-02T18:00:00.000Z',
        },
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
