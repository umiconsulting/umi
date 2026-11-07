import { describe, expect, it } from 'vitest';
import { analyzeCategorySales } from './category-sales';
import type { AnalysisSale } from './sales-analysis';

const query = {
  from: '2026-11-01',
  to: '2026-11-07',
  refundView: 'sale_result' as const,
  basketUnit: 'ticket' as const,
};
const products = [
  { id: 'bread', categoryId: 'bakery', category: 'Bakery', categoryColor: '#eaa55a' },
  { id: 'coffee', categoryId: 'drinks', category: 'Drinks', categoryColor: '#2783c1' },
];
const sale = (overrides: Partial<AnalysisSale> = {}): AnalysisSale => ({
  id: 'sale',
  locationId: 'location',
  locationName: 'Centro',
  day: '2026-11-03',
  hour: '09',
  weekday: '2',
  visitId: null,
  merchandiseMinorUnits: 11000,
  tipsMinorUnits: 1000,
  discountsMinorUnits: 2000,
  legacyDiscount: false,
  lines: [
    { id: 'a', productId: 'bread', name: 'Bread', quantity: 1, merchandiseMinorUnits: 7000 },
    { id: 'b', productId: 'coffee', name: 'Coffee', quantity: 1, merchandiseMinorUnits: 4000 },
  ],
  refunds: [],
  ...overrides,
});
describe('Category sales', () => {
  it('uses frozen discounted line money and saved category colors without tips', () => {
    expect(analyzeCategorySales([sale()], query, products)).toEqual([
      {
        key: 'category:bakery',
        categoryId: 'bakery',
        label: 'Bakery',
        color: '#eaa55a',
        merchandiseMinorUnits: 7000,
        refundsMinorUnits: 0,
        netMinorUnits: 7000,
      },
      {
        key: 'category:drinks',
        categoryId: 'drinks',
        label: 'Drinks',
        color: '#2783c1',
        merchandiseMinorUnits: 4000,
        refundsMinorUnits: 0,
        netMinorUnits: 4000,
      },
    ]);
  });
  it('subtracts the actual tax-inclusive refund from its category in the selected period', () => {
    const refunded = sale({
      refunds: [
        {
          id: 'refund',
          day: '2026-11-08',
          hour: '12',
          weekday: '7',
          merchandiseMinorUnits: 2000,
          tipsMinorUnits: 500,
          quantities: [{ lineId: 'b', quantity: 1, merchandiseMinorUnits: 2000 }],
        },
      ],
    });
    expect(
      analyzeCategorySales([refunded], query, products).find((row) => row.categoryId === 'drinks')
        ?.netMinorUnits,
    ).toBe(2000);
    expect(
      analyzeCategorySales([refunded], { ...query, refundView: 'period_movements' }, products).find(
        (row) => row.categoryId === 'drinks',
      )?.netMinorUnits,
    ).toBe(4000);
    expect(
      analyzeCategorySales(
        [refunded],
        { ...query, from: '2026-11-08', to: '2026-11-08', refundView: 'period_movements' },
        products,
      ),
    ).toEqual([
      {
        key: 'category:drinks',
        categoryId: 'drinks',
        label: 'Drinks',
        color: '#2783c1',
        merchandiseMinorUnits: 0,
        refundsMinorUnits: 2000,
        netMinorUnits: -2000,
      },
    ]);
  });
  it('keeps unknown financial allocation separate from products without a category', () => {
    const legacy = sale({ lines: [{ id: 'a', productId: 'bread', name: 'Bread', quantity: 1 }] });
    const uncategorized = sale({
      merchandiseMinorUnits: 3000,
      lines: [
        { id: 'c', productId: null, name: 'Open item', quantity: 1, merchandiseMinorUnits: 3000 },
      ],
    });
    expect(analyzeCategorySales([legacy, uncategorized], query, products)).toEqual([
      {
        key: 'unattributed',
        categoryId: null,
        label: null,
        color: null,
        merchandiseMinorUnits: 11000,
        refundsMinorUnits: 0,
        netMinorUnits: 11000,
      },
      {
        key: 'uncategorized',
        categoryId: null,
        label: null,
        color: null,
        merchandiseMinorUnits: 3000,
        refundsMinorUnits: 0,
        netMinorUnits: 3000,
      },
    ]);
  });
  it('preserves a receipt total when historical line amounts do not reconcile', () => {
    expect(analyzeCategorySales([sale({ merchandiseMinorUnits: 9000 })], query, products)).toEqual([
      {
        key: 'unattributed',
        categoryId: null,
        label: null,
        color: null,
        merchandiseMinorUnits: 9000,
        refundsMinorUnits: 0,
        netMinorUnits: 9000,
      },
    ]);
  });
  it('does not invent categories for an empty period', () => {
    expect(analyzeCategorySales([], query, products)).toEqual([]);
  });
});
