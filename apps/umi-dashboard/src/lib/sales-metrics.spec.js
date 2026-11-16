import { describe, expect, it } from 'vitest';
import {
  adaptSalesSummary,
  buildSalesInsightRequest,
  buildSalesMetricsRequests,
  SALES_INSIGHT_METRICS,
  SALES_PRESET_METRICS,
  SALES_SCALAR_METRICS,
} from './sales-metrics.js';

function scalarResponse(overrides = {}) {
  return {
    definitionVersion: '1.0.0',
    scope: {
      merchantId: '55555555-5555-4555-8555-000000000001',
      locationId: '55555555-5555-4555-8555-000000000011',
      currency: 'MXN',
      timezone: 'America/Mazatlan',
      attribution: { category: 'current' },
    },
    period: {
      range: 'last_30_days',
      start: '2026-10-18',
      end: '2026-11-16',
      bucket: 'day',
      comparison: { start: '2026-09-18', end: '2026-10-17' },
    },
    coverage: { sources: ['pos_committed_sale'], committedOnly: true, refundsIncluded: false },
    freshness: { capturedAt: '2026-11-16T04:00:00.000Z' },
    truncated: false,
    totals: {
      values: {
        net_sales: 35500,
        orders: 3,
        average_ticket: 11833,
        items_sold: 5,
        discounts: 1000,
        tips: 2500,
        prior_net_sales: 0,
        ...overrides,
      },
    },
  };
}

function presetResponse() {
  return {
    ...scalarResponse(),
    totals: {
      values: {
        payment_mix: {
          items: [
            { method: 'cash', amountMinorUnits: 19000 },
            { method: 'wallet', amountMinorUnits: 0 },
            { method: 'cash', amountMinorUnits: 16500 },
          ],
          truncated: false,
          limit: 8,
          totalItems: 3,
          total: { amountMinorUnits: 35500 },
        },
        channel_mix: {
          items: [{ channel: 'walk_in', netSalesMinorUnits: 35500, orders: 3 }],
          truncated: false,
          limit: 8,
          totalItems: 1,
          total: { netSalesMinorUnits: 35500, orders: 3 },
        },
        product_mix: {
          items: [
            {
              productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              productName: 'Café americano',
              category: 'Bebidas',
              units: 3,
              merchandiseMinorUnits: 24000,
            },
            {
              productId: null,
              productName: 'Concha',
              category: null,
              units: 2,
              merchandiseMinorUnits: 10000,
            },
          ],
          truncated: false,
          limit: 200,
          totalItems: 2,
          total: { units: 5, merchandiseMinorUnits: 34000 },
        },
        operator_mix: {
          items: [{ operator: 'I1 Owner', units: 5, merchandiseMinorUnits: 34000 }],
          truncated: false,
          limit: 100,
          totalItems: 1,
          total: { units: 5, merchandiseMinorUnits: 34000 },
        },
        hour_mix: {
          items: [
            { hour: '01', units: 2, merchandiseMinorUnits: 16000 },
            { hour: '11', units: 3, merchandiseMinorUnits: 18000 },
          ],
          truncated: false,
          limit: 24,
          totalItems: 2,
          total: { units: 5, merchandiseMinorUnits: 34000 },
        },
        series: {
          items: [
            { label: '2026-11-02', netSalesMinorUnits: 27000 },
            { label: '2026-11-04', netSalesMinorUnits: 8500 },
          ],
          truncated: false,
          limit: 31,
          totalItems: 2,
          total: { netSalesMinorUnits: 35500 },
        },
      },
    },
  };
}

describe('sales metrics request split', () => {
  it('sends seven scalars and six presets, both inside the public limit', () => {
    const [a, b] = buildSalesMetricsRequests('last_30_days', '');
    expect(a.metrics).toEqual(SALES_SCALAR_METRICS);
    expect(b.metrics).toEqual(SALES_PRESET_METRICS);
    expect(a.metrics).toHaveLength(7);
    expect(b.metrics).toHaveLength(6);
    expect(a.metrics.length).toBeLessThanOrEqual(10);
    expect(b.metrics.length).toBeLessThanOrEqual(10);
    expect(a.dimensions).toEqual([]);
    expect(b.dimensions).toEqual([]);
    expect(a.limit).toBeUndefined();
    expect(b.limit).toBeUndefined();
  });

  it('omits locationId for all locations and sends it for a location', () => {
    const [a] = buildSalesMetricsRequests('today', '');
    expect(a.locationId).toBeUndefined();
    const [scoped] = buildSalesMetricsRequests('today', '55555555-5555-4555-8555-000000000011');
    expect(scoped.locationId).toBe('55555555-5555-4555-8555-000000000011');
  });

  it('sends only the range and optional location to the insight route', () => {
    const body = buildSalesInsightRequest('last_7_days', '');
    expect(body).toEqual({ range: 'last_7_days' });
    expect(SALES_INSIGHT_METRICS).toHaveLength(8);
    const scoped = buildSalesInsightRequest('today', '55555555-5555-4555-8555-000000000011');
    expect(scoped).toEqual({
      range: 'today',
      locationId: '55555555-5555-4555-8555-000000000011',
    });
  });
});

describe('sales metrics adapter', () => {
  it('keeps every old summary field and value', () => {
    const view = adaptSalesSummary(scalarResponse(), presetResponse());
    expect(view.totals).toEqual({
      netSalesMinorUnits: 35500,
      orders: 3,
      averageTicketMinorUnits: 11833,
      itemsSold: 5,
      discountMinorUnits: 1000,
      tipsMinorUnits: 2500,
      priorNetSalesMinorUnits: 0,
    });
    expect(view.currency).toBe('MXN');
    expect(view.bucket).toBe('day');
    expect(view.range).toBe('last_30_days');
    expect(view.locationId).toBe('55555555-5555-4555-8555-000000000011');
    expect(view.series).toEqual([
      { label: '2026-11-02', amountMinorUnits: 27000 },
      { label: '2026-11-04', amountMinorUnits: 8500 },
    ]);
  });

  it('keeps duplicate payment methods as separate rows', () => {
    const view = adaptSalesSummary(scalarResponse(), presetResponse());
    expect(view.paymentMix).toEqual([
      { method: 'cash', amountMinorUnits: 19000 },
      { method: 'wallet', amountMinorUnits: 0 },
      { method: 'cash', amountMinorUnits: 16500 },
    ]);
  });

  it('maps merchandise and category fields without changing a number', () => {
    const view = adaptSalesSummary(scalarResponse(), presetResponse());
    expect(view.productMix[0]).toEqual({
      productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      productName: 'Café americano',
      category: 'Bebidas',
      units: 3,
      netMinorUnits: 24000,
    });
    expect(view.productMix[1]).toEqual({
      productId: null,
      productName: 'Concha',
      category: null,
      units: 2,
      netMinorUnits: 10000,
    });
    expect(view.byOperator).toEqual([{ key: 'I1 Owner', units: 5, netMinorUnits: 34000 }]);
    expect(view.byHour).toEqual([
      { key: '01', units: 2, netMinorUnits: 16000 },
      { key: '11', units: 3, netMinorUnits: 18000 },
    ]);
  });

  it('keeps zeroes and empty arrays for an empty period', () => {
    const empty = scalarResponse({
      net_sales: 0,
      orders: 0,
      average_ticket: 0,
      items_sold: 0,
      discounts: 0,
      tips: 0,
      prior_net_sales: 0,
    });
    const emptyPresets = {
      ...presetResponse(),
      totals: {
        values: {
          payment_mix: {
            items: [],
            truncated: false,
            limit: 8,
            totalItems: 0,
            total: { amountMinorUnits: 0 },
          },
          channel_mix: {
            items: [],
            truncated: false,
            limit: 8,
            totalItems: 0,
            total: { netSalesMinorUnits: 0, orders: 0 },
          },
          product_mix: {
            items: [],
            truncated: false,
            limit: 200,
            totalItems: 0,
            total: { units: 0, merchandiseMinorUnits: 0 },
          },
          operator_mix: {
            items: [],
            truncated: false,
            limit: 100,
            totalItems: 0,
            total: { units: 0, merchandiseMinorUnits: 0 },
          },
          hour_mix: {
            items: [],
            truncated: false,
            limit: 24,
            totalItems: 0,
            total: { units: 0, merchandiseMinorUnits: 0 },
          },
          series: {
            items: [],
            truncated: false,
            limit: 31,
            totalItems: 0,
            total: { netSalesMinorUnits: 0 },
          },
        },
      },
      scope: { ...presetResponse().scope, currency: null },
    };
    const view = adaptSalesSummary(empty, emptyPresets);
    expect(view.totals.netSalesMinorUnits).toBe(0);
    expect(view.totals.orders).toBe(0);
    expect(view.currency).toBeNull();
    expect(view.paymentMix).toEqual([]);
    expect(view.productMix).toEqual([]);
    expect(view.series).toEqual([]);
  });
});
