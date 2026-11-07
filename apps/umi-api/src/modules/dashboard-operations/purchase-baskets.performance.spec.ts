import { describe, expect, it } from 'vitest';
import { analyzePurchases, type AnalysisSale } from './sales-analysis';

const query = {
  from: '2026-11-01',
  to: '2026-11-01',
  basketUnit: 'ticket' as const,
  refundView: 'sale_result' as const,
};
function sale(id: string, products: string[]): AnalysisSale {
  return {
    id,
    locationId: 'one',
    locationName: 'One',
    day: query.from,
    hour: '12',
    weekday: '7',
    visitId: null,
    merchandiseMinorUnits: 1000,
    tipsMinorUnits: 0,
    discountsMinorUnits: 0,
    legacyDiscount: false,
    lines: products.map((productId) => ({
      id: productId,
      productId,
      name: productId,
      quantity: 1,
    })),
    refunds: [],
  };
}
describe('bounded purchase analysis', () => {
  it('preserves ticket weights, product presence and selected group denominators for repeated baskets', () => {
    const report = analyzePurchases(
      [
        sale('one', ['bread', 'coffee', 'bread']),
        sale('two', ['coffee', 'bread']),
        sale('three', ['bread']),
        sale('four', []),
      ],
      { ...query, groupA: 'bread', groupB: 'coffee' },
      [
        { key: 'bread', name: 'Bread', productIds: ['bread'] },
        { key: 'coffee', name: 'Coffee', productIds: ['coffee'] },
      ],
    );
    expect(report.coverage.baskets).toBe(4);
    expect(report.pairs[0]).toMatchObject({
      baskets: 2,
      basketsWithA: 3,
      basketsWithB: 2,
      support: 0.5,
      confidenceAtoB: 2 / 3,
      confidenceBtoA: 1,
      lift: 4 / 3,
    });
    expect(report.selectedGroups).toMatchObject({
      basketsWithA: 3,
      basketsWithB: 2,
      basketsWithBoth: 2,
      support: 0.5,
    });
    expect(report.unitsDistribution).toEqual([
      { units: 0, tickets: 1 },
      { units: 1, tickets: 1 },
      { units: 2, tickets: 1 },
      { units: 3, tickets: 1 },
    ]);
  });
  it('rejects excessive pair work even when distinct pairs stay below the cardinality limit', () => {
    let state = 12345;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const sales = Array.from({ length: 5000 }, (_, i) => {
      const products = Array.from({ length: 100 }, (_, j) => `product-${j}`);
      for (let j = products.length - 1; j > 0; j--) {
        const k = random() % (j + 1);
        [products[j], products[k]] = [products[k], products[j]];
      }
      return sale(String(i), products.slice(0, 50));
    });
    expect(() => analyzePurchases(sales, query, [])).toThrow('REPORT_RANGE_TOO_COMPLEX');
  });
});
