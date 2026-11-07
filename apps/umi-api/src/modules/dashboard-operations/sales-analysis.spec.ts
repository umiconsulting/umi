import { describe, expect, it } from 'vitest';
import { analyzePurchases, type AnalysisSale } from './sales-analysis';

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
