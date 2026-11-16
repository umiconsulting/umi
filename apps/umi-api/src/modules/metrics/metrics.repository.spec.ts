import { describe, expect, it, vi } from 'vitest';
import { MetricsPaymentDistribution, type MetricsQueryInput } from '@umi/contract';
import { MetricsRepository } from './metrics.repository';

type Responder = (sql: string, params: unknown[]) => Record<string, unknown>[];

function make(responder: Responder) {
  const query = vi.fn((sql: string, params: unknown[]) =>
    Promise.resolve({ rows: responder(sql, params) }),
  );
  const runWithMerchant = vi.fn(
    (
      _merchantId: string,
      _userId: string,
      operation: (client: { query: typeof query }) => unknown,
      _locationId: string | null,
    ) => operation({ query }),
  );
  return { repository: new MetricsRepository({ runWithMerchant } as never), query };
}

const merchantId = '55555555-5555-4555-8555-000000000001';
const userId = '11111111-1111-4111-8111-000000000041';

const goldenResponder: Responder = (sql, params) => {
  if (sql.includes('FROM merchant.merchant m'))
    return [
      {
        timezone: 'America/Mexico_City',
        currency: 'MXN',
        today: '2026-11-15',
        capturedAt: '2026-11-16T01:30:00.000Z',
      },
    ];
  if (sql.includes('x.total_minor_units - x.tip_minor_units')) return [{ refund: '9000' }];
  if (sql.includes('WITH payment'))
    return [
      {
        method: 'cash',
        amount: '20000',
        totalItems: '1',
        totalAmount: '37500',
      },
    ];
  if (sql.includes('AS "productId"'))
    return [
      {
        productId: 'product-1',
        productName: 'Concha',
        category: 'Pan',
        units: '2',
        amount: '20000',
        totalItems: '1',
        totalUnits: '2',
        totalAmount: '20000',
      },
    ];
  if (sql.includes("coalesce(st.name,'—') AS key"))
    return [
      {
        key: '—',
        units: '4',
        amount: '40000',
        totalItems: '1',
        totalUnits: '4',
        totalAmount: '40000',
      },
    ];
  if (sql.includes('sum(cl.quantity)::bigint AS units') && sql.includes('HH24'))
    return [
      {
        key: '04',
        units: '1',
        amount: '10000',
        totalItems: '1',
        totalUnits: '1',
        totalAmount: '10000',
      },
    ];
  if (sql.includes('AS label'))
    return [
      {
        key: '2026-11-02',
        amount: '28500',
        totalItems: '1',
        totalAmount: '28500',
      },
    ];
  if (sql.includes('origin_channel'))
    return [
      {
        key: 'walk_in',
        amount: '37500',
        orders: '3',
        totalItems: '1',
        totalAmount: '37500',
        totalOrders: '3',
      },
    ];
  if (sql.includes('sum(cl.quantity)')) return [{ units: '4' }];
  if (sql.includes('AS net') && Array.isArray(params) && params[1] === '2026-10-22')
    return [{ net: '0', orders: '0', discount: '0', tips: '0' }];
  if (sql.includes('sum(r.grand_total)'))
    return [{ net: '37500', orders: '3', discount: '4000', tips: '1500' }];
  return [];
};

const allMetrics: MetricsQueryInput = {
  metrics: [
    'net_sales',
    'orders',
    'average_ticket',
    'items_sold',
    'units_per_ticket',
    'discounts',
    'tips',
    'prior_net_sales',
    'refunds',
    'payment_mix',
    'channel_mix',
    'product_mix',
    'operator_mix',
    'hour_mix',
    'series',
  ],
  dimensions: [],
  range: 'last_7_days',
};

describe('MetricsRepository totals', () => {
  it('pins every golden formula and reports one statement per family', async () => {
    const { repository } = make(goldenResponder);
    const result = await repository.readWithStats(
      userId,
      merchantId,
      null,
      allMetrics,
      '2026-11-04',
    );

    expect(result.statementCount).toBe(11);
    expect(result.response.totals?.values).toMatchObject({
      net_sales: 37500,
      orders: 3,
      average_ticket: 12500,
      items_sold: 4,
      units_per_ticket: 1.3333,
      discounts: 4000,
      tips: 1500,
      prior_net_sales: 0,
      refunds: 9000,
      channel_mix: {
        items: [{ channel: 'walk_in', netSalesMinorUnits: 37500, orders: 3 }],
        truncated: false,
        limit: 8,
        totalItems: 1,
        total: { netSalesMinorUnits: 37500, orders: 3 },
      },
      product_mix: {
        items: [
          {
            productId: 'product-1',
            productName: 'Concha',
            category: 'Pan',
            units: 2,
            merchandiseMinorUnits: 20000,
          },
        ],
        total: { units: 2, merchandiseMinorUnits: 20000 },
      },
      operator_mix: {
        items: [{ operator: '—', units: 4, merchandiseMinorUnits: 40000 }],
        total: { units: 4, merchandiseMinorUnits: 40000 },
      },
      hour_mix: {
        items: [{ hour: '04', units: 1, merchandiseMinorUnits: 10000 }],
        total: { units: 1, merchandiseMinorUnits: 10000 },
      },
      series: {
        items: [{ label: '2026-11-02', netSalesMinorUnits: 28500 }],
        total: { netSalesMinorUnits: 28500 },
      },
    });
    const payment = result.response.totals?.values.payment_mix;
    expect(MetricsPaymentDistribution.safeParse(payment).success).toBe(true);
    expect(payment).toMatchObject({
      items: [{ method: 'cash', amountMinorUnits: 20000 }],
      totalItems: 1,
      total: { amountMinorUnits: 37500 },
    });
    expect(result.response).toMatchObject({
      definitionVersion: '1.0.0',
      scope: {
        merchantId,
        locationId: null,
        currency: 'MXN',
        timezone: 'America/Mexico_City',
        attribution: { category: 'current' },
      },
      period: {
        range: 'last_7_days',
        start: '2026-10-29',
        end: '2026-11-04',
        bucket: 'day',
        comparison: { start: '2026-10-22', end: '2026-10-28' },
      },
      coverage: {
        sources: [
          'pos_committed_sale',
          'receipt_snapshot',
          'pos_cart_line',
          'pos_sale_exception',
          'pos_tender_fact',
          'customer_value_tender_allocation',
          'product',
          'product_category',
          'cash_shift',
          'staff',
        ],
        committedOnly: true,
        refundsIncluded: true,
      },
      truncated: false,
    });
    expect(result.response.totals).toBeDefined();
    expect(result.response.rows).toBeUndefined();
  });

  it('binds every value and interpolates no caller string into SQL', async () => {
    const { repository, query } = make(goldenResponder);
    await repository.read(
      userId,
      merchantId,
      null,
      { ...allMetrics, metrics: ['net_sales'] },
      '2026-11-04',
    );

    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('s.merchant_id=$1::uuid');
    expect(sql).toContain('r.business_date BETWEEN $2::date AND $3::date');
    expect(sql).toContain('s.location_id=$4::uuid');
    expect(sql).not.toContain(merchantId);
    expect(params).toEqual([merchantId, '2026-10-29', '2026-11-04', null]);
  });

  it('returns the explicit zero and null cases', async () => {
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: null,
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      if (sql.includes('AS net')) return [{ net: '0', orders: '0', discount: '0', tips: '0' }];
      if (sql.includes('sum(cl.quantity)')) return [{ units: '0' }];
      return [];
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      {
        metrics: [
          'net_sales',
          'orders',
          'average_ticket',
          'items_sold',
          'units_per_ticket',
          'refunds',
        ],
        dimensions: [],
        range: 'today',
      },
      '2026-11-15',
    );
    expect(result.totals?.values).toEqual({
      net_sales: 0,
      orders: 0,
      average_ticket: 0,
      items_sold: 0,
      units_per_ticket: null,
      refunds: 0,
    });
  });

  it('keeps zero when orders exist and no item does', async () => {
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      if (sql.includes('AS net')) return [{ net: '5000', orders: '2', discount: '0', tips: '0' }];
      if (sql.includes('sum(cl.quantity)')) return [{ units: '0' }];
      return [];
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      { metrics: ['units_per_ticket'], dimensions: [], range: 'today' },
      '2026-11-15',
    );
    expect(result.totals?.values).toEqual({ units_per_ticket: 0 });
  });
});

describe('MetricsRepository rows', () => {
  it('merges sale, line and refund groups and orders by the dimension tuple', async () => {
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'America/Mexico_City',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      if (sql.includes('x.total_minor_units - x.tip_minor_units'))
        return [{ k0: '2026-11-02', refund: '9000' }];
      if (sql.includes('sum(cl.quantity)'))
        return [
          { k0: '2026-11-04', units: '1' },
          { k0: '2026-11-02', units: '3' },
        ];
      return [
        { k0: '2026-11-04', net: '9000', orders: '1', discount: '0', tips: '0' },
        {
          k0: '2026-11-02',
          net: '28500',
          orders: '2',
          discount: '3000',
          tips: '1500',
        },
      ];
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      {
        metrics: ['net_sales', 'orders', 'items_sold', 'refunds'],
        dimensions: ['day'],
        range: 'last_7_days',
        limit: 100,
      },
      '2026-11-04',
    );

    expect(result.rows?.map((row) => row.dimensions.day)).toEqual(['2026-11-02', '2026-11-04']);
    expect(result.rows?.[0].values).toEqual({
      net_sales: 28500,
      orders: 2,
      items_sold: 3,
      refunds: 9000,
    });
    expect(result.rows?.[1].values).toEqual({
      net_sales: 9000,
      orders: 1,
      items_sold: 1,
      refunds: 0,
    });
    expect(result.truncated).toBe(false);
    expect(result.rowsTotal).toBeUndefined();
  });

  it('reports the distinct total before the cut and no synthetic row', async () => {
    const days = ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      return days.map((day) => ({
        k0: day,
        net: '28500',
        orders: '2',
        discount: '0',
        tips: '0',
      }));
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      { metrics: ['net_sales'], dimensions: ['day'], range: 'last_7_days', limit: 1 },
      '2026-11-04',
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows?.[0].dimensions.day).toBe('2026-10-31');
    expect(result.rowsTotal).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('cuts the merged tuple union once across metric families', async () => {
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      if (sql.includes('x.total_minor_units - x.tip_minor_units'))
        return [{ k0: '2026-11-04', refund: '9000' }];
      if (sql.includes('sum(cl.quantity)')) return [{ k0: '2026-11-02', units: '3' }];
      return [];
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      {
        metrics: ['items_sold', 'refunds'],
        dimensions: ['day'],
        range: 'last_7_days',
        limit: 1,
      },
      '2026-11-04',
    );
    expect(result.rows).toEqual([
      { dimensions: { day: '2026-11-02' }, values: { items_sold: 3, refunds: 0 } },
    ]);
    expect(result.truncated).toBe(true);
    expect(result.rowsTotal).toBe(2);
  });

  it('reports no cut when the merged tuple union fits the limit', async () => {
    const { repository } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      if (sql.includes('x.total_minor_units - x.tip_minor_units'))
        return [{ k0: '2026-11-02', refund: '9000' }];
      if (sql.includes('sum(cl.quantity)'))
        return [
          { k0: '2026-11-02', units: '3' },
          { k0: '2026-11-04', units: '1' },
        ];
      return [];
    });
    const result = await repository.read(
      userId,
      merchantId,
      null,
      {
        metrics: ['items_sold', 'refunds'],
        dimensions: ['day'],
        range: 'last_7_days',
        limit: 5,
      },
      '2026-11-04',
    );
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.rowsTotal).toBeUndefined();
  });

  it('uses the product dimension only through a line metric', async () => {
    const { repository, query } = make((sql) => {
      if (sql.includes('FROM merchant.merchant m'))
        return [
          {
            timezone: 'UTC',
            currency: 'MXN',
            today: '2026-11-15',
            capturedAt: '2026-11-16T01:30:00.000Z',
          },
        ];
      return [{ k0: 'product-1', units: '2' }];
    });
    await repository.read(
      userId,
      merchantId,
      null,
      { metrics: ['items_sold'], dimensions: ['product'], range: 'last_7_days', limit: 100 },
      '2026-11-04',
    );
    const statements = query.mock.calls.map(([sql]) => sql);
    expect(statements.some((sql) => sql.includes('cl.product_id::text AS k0'))).toBe(true);
    expect(statements.some((sql) => sql.includes('pos_sale_exception'))).toBe(false);
    expect(statements.some((sql) => sql.includes('AS net'))).toBe(false);
  });
});
