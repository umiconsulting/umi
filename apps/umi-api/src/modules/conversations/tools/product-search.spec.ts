import { describe, expect, it } from 'vitest';
import {
  buildStrippedSearchQuery,
  chooseBestProductMatch,
  formatCartSummary,
  formatMoney,
  inferVariantFiltersFromText,
  rankProducts,
  resolveVariant,
  type ProductRecord,
} from './product-search';

const latte: ProductRecord = {
  id: 'p-latte',
  name: 'Latte',
  price: 50,
  variants: [
    { name: 'CH, CALIENTE', price: 50 },
    { name: 'GDE, CALIENTE', price: 60 },
  ],
};
const matcha: ProductRecord = { id: 'p-matcha', name: 'Matcha Latte', price: 65, variants: [] };

describe('product ranking', () => {
  it('ranks an exact name match first', () => {
    const ranked = rankProducts([matcha, latte], 'latte');
    expect(ranked[0].id).toBe('p-latte'); // exact "Latte" beats "Matcha Latte"
  });

  it('chooseBestProductMatch returns one product on a strong match', () => {
    const chosen = chooseBestProductMatch([latte, matcha], 'latte');
    expect(chosen).toHaveLength(1);
    expect(chosen[0].id).toBe('p-latte');
  });
});

describe('resolveVariant', () => {
  it('returns the product price when there are no variants', () => {
    const r = resolveVariant(matcha, {});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.variant).toBeNull();
      expect(r.unitPrice).toBe(65);
    }
  });

  it('resolves a single variant by size filter', () => {
    const r = resolveVariant(latte, { size: 'grande' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.variant?.name).toBe('GDE, CALIENTE');
      expect(r.unitPrice).toBe(60);
    }
  });

  it('asks for clarification when size is ambiguous', () => {
    const r = resolveVariant(latte, {});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.needs_clarification).toContain('tamano');
  });
});

describe('variant filter inference', () => {
  it('extracts size + temp from free text', () => {
    const f = inferVariantFiltersFromText('latte grande caliente');
    expect(f.size).toBe('GDE');
    expect(f.temp).toBe('CALIENTE');
  });

  it('strips variant tokens from a query', () => {
    expect(buildStrippedSearchQuery('latte grande con leche de coco', 'GDE', undefined, 'COCO')).toBe(
      'latte',
    );
  });
});

describe('money + cart summary (pesos)', () => {
  it('formats pesos', () => {
    expect(formatMoney(60)).toBe('$60');
  });

  it('summarizes a cart with line + total', () => {
    const summary = formatCartSummary({
      items: [
        { product_id: 'p-latte', product_name: 'Latte', variant_name: 'GDE, CALIENTE', quantity: 2, unit_price: 60 },
      ],
      updated_at: new Date(0).toISOString(),
      customer_note: null,
    });
    expect(summary).toContain('2x Latte');
    expect(summary).toContain('$120'); // 2 × 60
  });
});
