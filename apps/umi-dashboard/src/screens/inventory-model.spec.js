import { describe, expect, it } from 'vitest';
import {
  activeConversionFor,
  conversionDivides,
  conversionRatio,
  conversionSummary,
  filterItems,
  formatScaled,
  mergeConversions,
  onHandDisplay,
  optionalText,
  allergenCodeValid,
} from './inventory-model.js';

describe('conversion summary', () => {
  it('reads one gram as a thousandth of a kilogram', () => {
    expect(
      conversionSummary(
        { fromUnit: 'gram', toUnit: 'kilogram', numerator: 1, denominator: 1000, targetScale: 3 },
        (unit) => ({ gram: 'g', kilogram: 'kg' })[unit] || unit,
      ),
    ).toBe('1 g = 0.001 kg');
  });

  it('keeps a lossy conversion honest instead of rounding it to a whole', () => {
    const ratio = conversionRatio({
      fromUnit: 'unit',
      toUnit: 'portion',
      numerator: 1,
      denominator: 3,
      targetScale: 0,
    });
    expect(ratio.sampleText).toBe('0.3333');
    expect(ratio.divides).toBe(false);
  });
});

describe('the does-this-divide hint', () => {
  it('accepts a conversion that lands on a whole unit at the item scale', () => {
    expect(conversionDivides({ numerator: 1000, denominator: 1, targetScale: 0 })).toBe(true);
    expect(conversionDivides({ numerator: 1, denominator: 1000, targetScale: 3 })).toBe(true);
  });

  it('refuses a fraction the exact policy would reject', () => {
    expect(conversionDivides({ numerator: 3, denominator: 4, targetScale: 0 })).toBe(false);
    expect(conversionDivides({ numerator: 1, denominator: 3, targetScale: 2 })).toBe(false);
  });

  it('reports no hint for a numerator or denominator that is not a positive integer', () => {
    expect(conversionRatio({ numerator: 0, denominator: 2, targetScale: 0 })).toBeNull();
    expect(conversionRatio({ numerator: 2, denominator: '', targetScale: 0 })).toBeNull();
  });
});

describe('on-hand: empty is not zero', () => {
  const item = {
    quantityScale: 2,
    trackingPolicy: 'tracked',
    onHand: [{ locationId: 'loc-1', inventoryLocationId: 'inv-1', onHand: 0 }],
  };

  it('renders a real zero as zero', () => {
    expect(onHandDisplay(item, 'loc-1')).toMatchObject({ state: 'value', text: '0' });
  });

  it('renders an absent row as an empty state, not as zero', () => {
    expect(onHandDisplay(item, 'loc-2')).toMatchObject({ state: 'empty', text: null });
  });

  it('renders an absent read as empty', () => {
    expect(onHandDisplay({ quantityScale: 0, onHand: [] }, 'loc-1').state).toBe('empty');
  });

  it('totals branches when the console is not scoped to one', () => {
    const wide = {
      quantityScale: 2,
      trackingPolicy: 'tracked',
      onHand: [
        { locationId: 'loc-1', onHand: 150 },
        { locationId: 'loc-2', onHand: 50 },
      ],
    };
    expect(onHandDisplay(wide, '')).toMatchObject({ state: 'total', text: '2', count: 2 });
  });

  it('says not counted instead of printing zero for untracked stock', () => {
    expect(onHandDisplay({ trackingPolicy: 'not_tracked', onHand: [] }, 'loc-1').state).toBe(
      'not_tracked',
    );
  });
});

describe('scaled quantities', () => {
  it('formats and trims scaled integers', () => {
    expect(formatScaled(1333, 3)).toBe('1.333');
    expect(formatScaled(1000, 3)).toBe('1');
    expect(formatScaled(0, 2)).toBe('0');
    expect(formatScaled(-150, 2)).toBe('-1.5');
  });

  it('names the empty state of an optional number', () => {
    expect(optionalText(null, (value) => String(value), 'Sin umbral')).toBe('Sin umbral');
    expect(optionalText(0, (value) => String(value), 'Sin umbral')).toBe('0');
  });
});

describe('list and conversion merge rules', () => {
  it('hides archived items unless they are requested', () => {
    const items = [
      { id: 'a', displayName: 'Harina', publicReference: 'HAR', active: true },
      { id: 'b', displayName: 'Azúcar', publicReference: 'AZU', active: false },
    ];
    expect(filterItems(items, {}).map((item) => item.id)).toEqual(['a']);
    expect(filterItems(items, { includeArchived: true }).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('searches by name and by reference', () => {
    const items = [
      { id: 'a', displayName: 'Harina', publicReference: 'HAR-01' },
      { id: 'b', displayName: 'Azúcar', publicReference: 'AZU-02' },
    ];
    expect(filterItems(items, { query: 'har' }).map((item) => item.id)).toEqual(['a']);
    expect(filterItems(items, { query: 'azu-02' }).map((item) => item.id)).toEqual(['b']);
  });

  it("prefers the item read and ignores another item's flat conversion", () => {
    const item = {
      id: 'item-1',
      conversions: [
        {
          id: 'c1',
          inventoryItemId: 'item-1',
          fromUnit: 'gram',
          toUnit: 'kilogram',
          numerator: 1,
          denominator: 1000,
          targetScale: 3,
          active: true,
          version: 1,
        },
      ],
    };
    const merged = mergeConversions(item, [
      item.conversions[0],
      { id: 'c2', inventoryItemId: 'item-2', fromUnit: 'unit', toUnit: 'unit' },
    ]);
    expect(merged.map((conversion) => conversion.id)).toEqual(['c1']);
  });

  it('names the version a set must expect', () => {
    const conversions = [
      { id: 'old', fromUnit: 'gram', toUnit: 'kilogram', active: true, version: 1 },
      { id: 'new', fromUnit: 'gram', toUnit: 'kilogram', active: true, version: 3 },
      { id: 'other', fromUnit: 'unit', toUnit: 'kilogram', active: true, version: 9 },
    ];
    expect(activeConversionFor(conversions, 'gram', 'kilogram').id).toBe('new');
    expect(activeConversionFor(conversions, 'liter', 'kilogram')).toBeNull();
  });

  it('accepts only the database allergen code shape', () => {
    expect(allergenCodeValid('gluten')).toBe(true);
    expect(allergenCodeValid('lacteos_2')).toBe(true);
    expect(allergenCodeValid('Gluten')).toBe(false);
    expect(allergenCodeValid('a')).toBe(false);
  });
});
