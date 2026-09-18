import { describe, expect, it } from 'vitest';
import {
  activeConversionFor,
  conversionDivides,
  conversionRatio,
  conversionSummary,
  filterItems,
  filterByView,
  formatScaled,
  mergeConversions,
  onHandDisplay,
  optionalText,
  allergenCodeValid,
  attentionQueue,
  itemNeeds,
  itemSignals,
  matchesView,
  paginate,
  rowActionFor,
  sortByUrgency,
  viewCounts,
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

/* ============================================================
   THE WORKBENCH RULES (redesign plan §3, §5, §8)
   ============================================================ */

function item(overrides = {}) {
  return {
    id: 'i1',
    displayName: 'Leche entera',
    publicReference: 'ING-0001',
    baseUnit: 'liter',
    quantityScale: 2,
    itemType: 'ingredient',
    trackingPolicy: 'tracked',
    active: true,
    lowStockThreshold: null,
    onHand: [{ locationId: 'loc1', onHand: 1200 }],
    ...overrides,
  };
}

const COSTED = (ids) => new Set(ids);

describe('the state of one item', () => {
  it('is unknown, not zero, when the branch has no balance row', () => {
    const signals = itemSignals(item({ onHand: [] }), 'loc1', COSTED(['i1']));
    expect(signals.stockState).toBe('unknown');
  });

  it('is out at an exact zero', () => {
    const signals = itemSignals(
      item({ onHand: [{ locationId: 'loc1', onHand: 0 }] }),
      'loc1',
      COSTED(['i1']),
    );
    expect(signals.stockState).toBe('out');
  });

  it('is low at the threshold and above it is ok', () => {
    const at = itemSignals(item({ lowStockThreshold: 1200 }), 'loc1', COSTED(['i1']));
    const above = itemSignals(item({ lowStockThreshold: 1199 }), 'loc1', COSTED(['i1']));
    expect(at.stockState).toBe('low');
    expect(above.stockState).toBe('ok');
  });

  it('has no threshold state when the item sets none', () => {
    const signals = itemSignals(
      item({ onHand: [{ locationId: 'loc1', onHand: 1 }] }),
      'loc1',
      COSTED(['i1']),
    );
    expect(signals.stockState).toBe('ok');
    expect(signals.threshold).toBeNull();
  });

  it('reports not-tracked before it reports a balance', () => {
    const signals = itemSignals(item({ trackingPolicy: 'not_tracked' }), 'loc1', COSTED(['i1']));
    expect(signals.stockState).toBe('not_tracked');
  });

  it('reports archived before every other state', () => {
    const signals = itemSignals(
      item({ active: false, trackingPolicy: 'not_tracked' }),
      'loc1',
      new Set(),
    );
    expect(signals.stockState).toBe('archived');
  });

  it('reads the cost from the second, narrower read', () => {
    expect(itemSignals(item(), 'loc1', COSTED(['i1'])).hasCost).toBe(true);
    expect(itemSignals(item(), 'loc1', COSTED([])).hasCost).toBe(false);
    expect(itemSignals(item(), 'loc1', null).hasCost).toBe(false);
  });
});

describe('what the item needs, in order', () => {
  it('asks for a count before it asks for a cost', () => {
    const signals = itemSignals(item({ onHand: [] }), 'loc1', COSTED([]));
    expect(itemNeeds(signals)).toEqual(['count', 'set_cost']);
  });

  it('asks for a cost alone when the stock is healthy', () => {
    const signals = itemSignals(item(), 'loc1', COSTED([]));
    expect(itemNeeds(signals)).toEqual(['set_cost']);
  });

  it('offers the inverse action for an archived item and nothing else', () => {
    expect(itemNeeds(itemSignals(item({ active: false }), 'loc1', COSTED([])))).toEqual([
      'activate',
    ]);
  });

  it('asks for nothing when the item is healthy and costed', () => {
    const signals = itemSignals(item(), 'loc1', COSTED(['i1']));
    expect(itemNeeds(signals)).toEqual([]);
    expect(rowActionFor(signals)).toBeNull();
  });

  it('promotes the first need to the row action', () => {
    const signals = itemSignals(
      item({ lowStockThreshold: 5000, onHand: [{ locationId: 'loc1', onHand: 900 }] }),
      'loc1',
      COSTED([]),
    );
    expect(rowActionFor(signals)).toBe('review_stock');
  });
});

describe('the saved views', () => {
  const items = [
    item({ id: 'a', displayName: 'A', onHand: [{ locationId: 'loc1', onHand: 1200 }] }),
    item({
      id: 'b',
      displayName: 'B',
      lowStockThreshold: 2000,
      onHand: [{ locationId: 'loc1', onHand: 1500 }],
    }),
    item({ id: 'c', displayName: 'C', onHand: [] }),
    item({ id: 'd', displayName: 'D', active: false }),
  ];
  const costed = COSTED(['a', 'b', 'c']); // d is archived and uncosted

  it('counts every view in one pass', () => {
    expect(viewCounts(items, 'loc1', costed)).toEqual({
      all: 3,
      low_stock: 1,
      no_cost: 0,
      no_balance: 1,
      archived: 1,
    });
  });

  it('agrees with the rows the view returns', () => {
    const counts = viewCounts(items, 'loc1', costed);
    for (const view of ['all', 'low_stock', 'no_cost', 'no_balance', 'archived']) {
      expect(filterByView(items, view, 'loc1', costed)).toHaveLength(counts[view]);
    }
  });

  it('hides an archived item from every view except its own', () => {
    for (const view of ['all', 'low_stock', 'no_cost', 'no_balance']) {
      expect(matchesView(itemSignals(items[3], 'loc1', costed), view)).toBe(false);
    }
    expect(matchesView(itemSignals(items[3], 'loc1', costed), 'archived')).toBe(true);
  });

  it('keeps an archived item out of the uncosted view even when it has no cost', () => {
    const archived = item({ id: 'z', active: false });
    expect(filterByView([archived], 'no_cost', 'loc1', COSTED([]))).toHaveLength(0);
  });

  it('applies the search inside the view, not beside it', () => {
    const rows = filterByView(items, 'low_stock', 'loc1', costed, { query: 'a' });
    expect(rows.map((row) => row.id)).toEqual([]);
    expect(filterByView(items, 'all', 'loc1', costed, { query: 'a' })).toHaveLength(1);
  });
});

describe('the attention queue', () => {
  it('drops a question with no record behind it', () => {
    expect(attentionQueue({ no_balance: 0, low_stock: 4, no_cost: 0 })).toEqual([
      { key: 'low_stock', view: 'low_stock', action: 'review_stock', count: 4 },
    ]);
  });

  it('orders the unknown balance before the missing cost', () => {
    const queue = attentionQueue({ no_balance: 1, low_stock: 2, no_cost: 3 });
    expect(queue.map((entry) => entry.key)).toEqual(['no_balance', 'low_stock', 'no_cost']);
  });

  it('caps the queue', () => {
    expect(attentionQueue({ no_balance: 1, low_stock: 1, no_cost: 1 }, 2)).toHaveLength(2);
  });

  it('answers an empty queue when the shop is in order', () => {
    expect(attentionQueue({ no_balance: 0, low_stock: 0, no_cost: 0 })).toEqual([]);
    expect(attentionQueue(null)).toEqual([]);
  });
});

describe('the page slice', () => {
  const rows = Array.from({ length: 128 }, (unused, index) => ({ id: String(index) }));

  it('caps a page at fifty rows', () => {
    const page = paginate(rows, 0);
    expect(page.rows).toHaveLength(50);
    expect(page.pages).toBe(3);
    expect([page.from, page.to]).toEqual([1, 50]);
  });

  it('prints the last range honestly', () => {
    const page = paginate(rows, 2);
    expect([page.from, page.to]).toEqual([101, 128]);
  });

  it('clamps a page past the end instead of answering nothing', () => {
    expect(paginate(rows, 99).page).toBe(2);
    expect(paginate(rows, -4).page).toBe(0);
  });

  it('answers one empty page for an empty list, not zero pages', () => {
    const page = paginate([], 0);
    expect(page.pages).toBe(1);
    expect([page.from, page.to]).toEqual([0, 0]);
  });
});

describe('the urgency order', () => {
  it('puts the worst stock first and the healthy item last', () => {
    const items = [
      item({ id: 'ok', displayName: 'Z', onHand: [{ locationId: 'loc1', onHand: 900 }] }),
      item({ id: 'out', displayName: 'M', onHand: [{ locationId: 'loc1', onHand: 0 }] }),
      item({ id: 'unknown', displayName: 'A', onHand: [] }),
    ];
    const sorted = sortByUrgency(items, 'loc1', COSTED(['ok', 'out', 'unknown']));
    expect(sorted.map((row) => row.id)).toEqual(['out', 'unknown', 'ok']);
  });

  it('breaks a tie on the missing cost, then on the name', () => {
    const items = [
      item({ id: 'b', displayName: 'B', onHand: [{ locationId: 'loc1', onHand: 10 }] }),
      item({ id: 'a', displayName: 'A', onHand: [{ locationId: 'loc1', onHand: 10 }] }),
      item({ id: 'c', displayName: 'C', onHand: [{ locationId: 'loc1', onHand: 10 }] }),
    ];
    const sorted = sortByUrgency(items, 'loc1', COSTED(['a', 'b']));
    expect(sorted.map((row) => row.id)).toEqual(['c', 'a', 'b']);
  });
});
