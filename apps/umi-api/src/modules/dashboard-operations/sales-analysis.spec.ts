import { describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { analyzePurchases, analyzeSummary, type AnalysisSale } from './sales-analysis';
import { SalesAnalysisService } from './sales-analysis.service';
import type { SalesAnalysisRepository } from './sales-analysis.repository';

const bread = '10000000-0000-4000-8000-000000000001';
const coffee = '10000000-0000-4000-8000-000000000002';
const day = '2026-11-02';
const sale = (id: string, overrides: Partial<AnalysisSale> = {}): AnalysisSale => ({
  id,
  locationId: 'local-a',
  locationName: 'Centro',
  day,
  hour: '09',
  weekday: '1',
  visitId: null,
  merchandiseMinorUnits: 18000,
  tipsMinorUnits: 1500,
  discountsMinorUnits: 2000,
  legacyDiscount: false,
  lines: [{ id: `${id}-line`, productId: bread, name: 'Pan', quantity: 2 }],
  refunds: [],
  ...overrides,
});
const query = {
  from: day,
  to: '2026-11-03',
  refundView: 'sale_result' as const,
  basketUnit: 'ticket' as const,
};

describe('análisis de compras', () => {
  it('rechaza totales que exceden la precisión monetaria admitida', () => {
    expect(() =>
      analyzePurchases(
        [
          sale('large', { merchandiseMinorUnits: Number.MAX_SAFE_INTEGER }),
          sale('one', { merchandiseMinorUnits: 1 }),
        ],
        query,
        [],
      ),
    ).toThrow('REPORT_AMOUNT_OUT_OF_RANGE');
  });
  it('separa propinas, conserva descuentos y calcula el ticket del negocio con los totales de sus sucursales', () => {
    const result = analyzePurchases(
      [
        sale('one'),
        sale('two', { merchandiseMinorUnits: 10000, tipsMinorUnits: 0, discountsMinorUnits: 0 }),
        sale('three', {
          locationId: 'local-b',
          locationName: 'Puerto',
          merchandiseMinorUnits: 2000,
          tipsMinorUnits: 0,
          discountsMinorUnits: 0,
        }),
      ],
      query,
      [],
    );
    expect(result.totals).toMatchObject({
      tickets: 3,
      netMinorUnits: 30000,
      averageTicketMinorUnits: 10000,
      tipsMinorUnits: 1500,
      discountsMinorUnits: 2000,
      unitsPerTicket: 2,
    });
    expect(result.byHour).toEqual([
      expect.objectContaining({ key: '09', tickets: 3, netMinorUnits: 30000 }),
    ]);
  });

  it('cuenta la presencia de productos una vez por ticket y permite categorías y grupos propios', () => {
    const result = analyzePurchases(
      [
        sale('one', {
          lines: [
            { id: 'b1', productId: bread, name: 'Pan', quantity: 3 },
            { id: 'c1', productId: coffee, name: 'Café', quantity: 2 },
            { id: 'c2', productId: coffee, name: 'Café', quantity: 1 },
          ],
        }),
        sale('two', { lines: [{ id: 'b2', productId: bread, name: 'Pan', quantity: 1 }] }),
      ],
      { ...query, groupA: 'category:bread', groupB: 'group:breakfast' },
      [
        { key: 'category:bread', name: 'Panadería', productIds: [bread] },
        { key: 'group:breakfast', name: 'Desayuno', productIds: [coffee] },
      ],
    );
    expect(result.coverage.baskets).toBe(2);
    expect(result.pairs).toEqual([
      expect.objectContaining({
        baskets: 1,
        support: 0.5,
        confidenceAtoB: 0.5,
        confidenceBtoA: 1,
        lift: 1,
      }),
    ]);
    expect(result.selectedGroups).toMatchObject({
      basketsWithA: 2,
      basketsWithB: 1,
      basketsWithBoth: 1,
      support: 0.5,
      confidenceAtoB: 0.5,
    });
    expect(result.unitsDistribution).toEqual([
      { units: 1, tickets: 1 },
      { units: 6, tickets: 1 },
    ]);
  });

  it('distingue el resultado de una venta de los movimientos de devolución de otro periodo', () => {
    const original = sale('one', {
      refunds: [
        {
          id: 'refund',
          day: '2026-11-03',
          hour: '12',
          weekday: '2',
          merchandiseMinorUnits: 6000,
          tipsMinorUnits: 0,
          quantities: [{ lineId: 'one-line', quantity: 1 }],
        },
      ],
    });
    const monday = { ...query, to: day };
    expect(analyzePurchases([original], monday, []).totals).toMatchObject({
      tickets: 1,
      netMinorUnits: 12000,
      units: 1,
    });
    expect(
      analyzePurchases([original], { ...monday, refundView: 'period_movements' }, []).totals
        .netMinorUnits,
    ).toBe(18000);
    const tuesday = analyzePurchases(
      [original],
      { ...query, from: '2026-11-03', refundView: 'period_movements' },
      [],
    );
    expect(tuesday.totals).toMatchObject({
      tickets: 0,
      refundsMinorUnits: 6000,
      netMinorUnits: -6000,
      averageTicketMinorUnits: null,
      unitsPerTicket: null,
    });
    expect(tuesday.byDay[0]).toMatchObject({ key: '2026-11-03', tickets: 0, netMinorUnits: -6000 });
  });

  it('une tickets de una visita de mesa sin inventar visitas para ventas anónimas', () => {
    const result = analyzePurchases(
      [
        sale('bread', {
          visitId: 'visit',
          lines: [{ id: 'b', productId: bread, name: 'Pan', quantity: 1 }],
        }),
        sale('coffee', {
          visitId: 'visit',
          lines: [{ id: 'c', productId: coffee, name: 'Café', quantity: 1 }],
        }),
        sale('anonymous'),
      ],
      { ...query, basketUnit: 'table_visit' },
      [],
    );
    expect(result.totals.tickets).toBe(3);
    expect(result.coverage).toMatchObject({
      baskets: 1,
      ticketsWithVisit: 2,
      ticketsWithoutVisit: 1,
    });
    expect(result.pairs[0]).toMatchObject({ baskets: 1, support: 1 });
  });

  it('evita asociaciones de un producto consigo mismo cuando los grupos se solapan', () => {
    const result = analyzePurchases([sale('one')], { ...query, groupA: 'a', groupB: 'b' }, [
      { key: 'a', name: 'Pan', productIds: [bread] },
      { key: 'b', name: 'Desayuno', productIds: [bread, coffee] },
    ]);
    expect(result.selectedGroups).toMatchObject({
      basketsWithA: 1,
      basketsWithB: 1,
      basketsWithBoth: 0,
      overlappingProducts: 1,
    });
    expect(result.pairs).toEqual([]);
  });

  it('muestra denominadores ausentes en un periodo sin ventas', () => {
    const result = analyzePurchases([], query, []);
    expect(result.totals).toMatchObject({
      tickets: 0,
      netMinorUnits: 0,
      averageTicketMinorUnits: null,
      unitsPerTicket: null,
    });
    expect(result.selectedGroups.support).toBeNull();
    expect(result.byHour).toEqual([]);
  });
});

describe('bounded basket state at the service boundary', () => {
  const merchantId = '20000000-0000-4000-8000-000000000001';
  const access = {
    merchantId,
    locationId: null,
    permissions: ['sale.lifecycle', 'location.switch'],
  } as never;
  const user = { id: 'user-1' } as never;
  const context = {
    timezone: 'America/Mazatlan',
    currency: 'MXN',
    capturedAt: '2026-11-02T12:00:00.000Z',
    firstSaleDate: day,
    today: day,
    products: [],
    groups: [],
    locations: [],
  };
  const wideSale = sale('wide', {
    merchandiseMinorUnits: 500000,
    lines: Array.from({ length: 500 }, (_, index) => ({
      id: `line-${index}`,
      productId: `product-${index}`,
      name: `Product ${index}`,
      quantity: 1,
      merchandiseMinorUnits: 1000,
    })),
  });
  function serviceFor(sales: AnalysisSale[]) {
    const repository = {
      read: async () => ({ context, sales }),
    } as unknown as SalesAnalysisRepository;
    return new SalesAnalysisService(repository);
  }
  async function rejectionOf(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return error as UnprocessableEntityException;
    }
    throw new Error('The promise did not reject');
  }

  it('returns HTTP 200 shape with the exact summary when the basket work budget fails', async () => {
    const report = await serviceFor([wideSale]).read(user, access, query);
    const summary = analyzeSummary([wideSale], query);
    expect(report.basketState).toEqual({ state: 'unavailable', code: 'BASKETS_TOO_COMPLEX' });
    expect(report.totals).toEqual(summary.totals);
    expect(report.byDay).toEqual(summary.byDay);
    expect(report.byHour).toEqual(summary.byHour);
    expect(report.coverage).toBeUndefined();
    expect(report.unitsDistribution).toBeUndefined();
    expect(report.pairs).toBeUndefined();
    expect(report.selectedGroups).toBeUndefined();
    expect(report.byCategory).toBeDefined();
  });

  it('emits the complete state with all four basket fields on a normal report', async () => {
    const report = await serviceFor([sale('one')]).read(user, access, query);
    expect(report.basketState).toEqual({ state: 'complete', code: null });
    expect(report.coverage).toBeDefined();
    expect(report.unitsDistribution).toBeDefined();
    expect(report.pairs).toBeDefined();
    expect(report.selectedGroups).toBeDefined();
  });

  it('keeps a summary money overflow fatal at 422', async () => {
    const error = await rejectionOf(
      serviceFor([
        sale('huge', { merchandiseMinorUnits: Number.MAX_SAFE_INTEGER }),
        sale('one', { merchandiseMinorUnits: 1 }),
      ]).read(user, access, query),
    );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({ code: 'REPORT_AMOUNT_OUT_OF_RANGE' });
  });

  it('keeps a repository range refusal fatal at 422', async () => {
    const repository = {
      read: async () => {
        throw new UnprocessableEntityException({ code: 'REPORT_RANGE_TOO_LARGE' });
      },
    } as unknown as SalesAnalysisRepository;
    const error = await rejectionOf(new SalesAnalysisService(repository).read(user, access, query));
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect(error.getResponse()).toMatchObject({ code: 'REPORT_RANGE_TOO_LARGE' });
  });
});
