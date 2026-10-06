import { describe, expect, it } from 'vitest';
import {
  basisPointsOf,
  basisPointsToPercent,
  filterPlates,
  forecastCounts,
  formatBusinessDate,
  plateComponents,
  plateIsCosted,
  plateMargin,
  scaledToNumber,
  sortForecast,
  splitPlates,
  summarizeDays,
  uncostedItemsOf,
} from './costing-model.js';

// ── fixtures ────────────────────────────────────────────────────────────────

function plate(overrides = {}) {
  return {
    productId: 'p1',
    productName: 'Pumpkin Spice Latte',
    variantId: null,
    variantName: null,
    mappingType: 'recipe',
    priceMinor: 9100,
    costMinor: 748,
    marginMinor: 8352,
    marginBasisPoints: 9178,
    state: 'complete',
    defects: [],
    uncostedItems: [],
    components: [],
    ...overrides,
  };
}

function day(overrides = {}) {
  return {
    businessDate: '2026-09-16',
    revenueMinor: 10000,
    grandTotalMinor: 11600,
    costMinor: 2000,
    marginMinor: 8000,
    marginBasisPoints: 8000,
    salesCount: 1,
    platesSold: 2,
    salesLinesWithoutMapping: 0,
    uncostedProducts: [],
    state: 'complete',
    uncostedItems: [],
    ...overrides,
  };
}

// ── the D47 rule, stated as tests ───────────────────────────────────────────

describe('a number the server did not fully price is never rendered', () => {
  it('gives an incomplete plate no margin, even if a margin field arrived', () => {
    // The server sends null for an incomplete plate. This asserts the screen does not
    // depend on that: the STATE is what decides, so a future server that sent a
    // partial margin would still not be shown as one.
    expect(plateMargin(plate({ state: 'incomplete' }))).toBeNull();
    expect(plateMargin(plate({ state: 'not_costed' }))).toBeNull();
    expect(
      plateMargin(plate({ state: 'incomplete', marginMinor: 100, marginBasisPoints: 10 })),
    ).toBeNull();
    expect(plateIsCosted(plate({ state: 'incomplete', costMinor: 1 }))).toBe(false);
  });

  it('gives a plate no margin when the cost is present but the margin is not', () => {
    expect(plateIsCosted(plate({ marginMinor: null }))).toBe(false);
    expect(plateIsCosted(plate({ costMinor: null }))).toBe(false);
  });

  it('sums a period cost only when every trading day is costed', () => {
    const days = [day(), day({ businessDate: '2026-09-15' })];
    const all = summarizeDays(days);
    expect(all.costMinor).toBe(4000);
    expect(all.marginMinor).toBe(16000);
    expect(all.revenueMinor).toBe(20000);
    expect(all.uncostedDays).toBe(0);

    // One untracked day: revenue still sums, cost does NOT.
    const mixed = summarizeDays([
      day(),
      day({
        businessDate: '2026-09-15',
        revenueMinor: 5000,
        costMinor: null,
        marginMinor: null,
        marginBasisPoints: null,
        state: 'incomplete',
        salesLinesWithoutMapping: 3,
        uncostedProducts: [{ productId: 'p9', productName: 'Concha' }],
      }),
    ]);
    expect(mixed.revenueMinor).toBe(15000);
    expect(mixed.costMinor).toBeNull();
    expect(mixed.marginMinor).toBeNull();
    expect(mixed.marginBasisPoints).toBeNull();
    expect(mixed.uncostedDays).toBe(1);
    expect(mixed.costedDays).toBe(1);
    expect(mixed.salesLinesWithoutMapping).toBe(3);
    expect(mixed.uncostedProducts).toEqual([{ productId: 'p9', productName: 'Concha' }]);
  });

  it('does not call a day that never traded uncosted, and does not invent a margin for a silent period', () => {
    const quiet = summarizeDays([day({ revenueMinor: 0, salesCount: 0, platesSold: 0 })]);
    expect(quiet.days).toBe(0);
    expect(quiet.uncostedDays).toBe(0);
    // Nothing sold: there is no ratio, so there is no percentage.
    expect(quiet.marginBasisPoints).toBeNull();
  });

  it('treats a period with no days at all as empty rather than as zero margin', () => {
    const empty = summarizeDays([]);
    expect(empty.days).toBe(0);
    expect(empty.costMinor).toBeNull();
    expect(empty.revenueMinor).toBe(0);
    expect(summarizeDays(null).revenueMinor).toBe(0);
  });

  it('reports the period margin in basis points from its own totals', () => {
    // 748 cost on 9100 revenue is a margin of 8352, which is 9178 bps — the plate's own
    // number, so a period of one plate must reproduce it.
    const one = summarizeDays([
      day({ revenueMinor: 9100, costMinor: 748, marginMinor: 8352, marginBasisPoints: 9178 }),
    ]);
    expect(one.marginBasisPoints).toBe(9178);
  });
});

// ── the three groups ────────────────────────────────────────────────────────

describe('splitting plates', () => {
  const plates = [
    plate({ productId: 'a' }),
    plate({
      productId: 'b',
      state: 'incomplete',
      costMinor: null,
      marginMinor: null,
      defects: ['no_cost_basis'],
    }),
    plate({
      productId: 'c',
      state: 'not_costed',
      mappingType: null,
      costMinor: null,
      marginMinor: null,
      defects: ['no_inventory_mapping'],
    }),
  ];

  it('keeps "no cost basis yet" apart from "nobody said what it consumes"', () => {
    const groups = splitPlates(plates);
    expect(groups.counts).toEqual({ all: 3, costed: 1, uncosted: 1, notCosted: 1 });
    expect(groups.uncosted[0].productId).toBe('b');
    expect(groups.notCosted[0].productId).toBe('c');
  });

  it('shows the costed plates by default and counts the rest in the labels', () => {
    expect(filterPlates(plates, { view: 'costed' }).rows.map((p) => p.productId)).toEqual(['a']);
    expect(filterPlates(plates, { view: 'uncosted' }).counts.uncosted).toBe(1);
    // The "sin costo" view holds both kinds, because to a person they are one question.
    expect(filterPlates(plates, { view: 'uncosted' }).rows.map((p) => p.productId)).toEqual([
      'b',
      'c',
    ]);
    expect(filterPlates(plates, { view: 'all' }).rows).toHaveLength(3);
  });

  it('searches without punishing the person for their accents', () => {
    const rows = [plate({ productName: 'Café Americano' }), plate({ productName: 'Té chai' })];
    expect(filterPlates(rows, { query: 'cafe' }).rows).toHaveLength(1);
    expect(filterPlates(rows, { query: 'CAFÉ' }).rows).toHaveLength(1);
    expect(filterPlates(rows, { query: 'te' }).rows.map((p) => p.productName)).toEqual(['Té chai']);
    expect(filterPlates(rows, { query: '  ' }).rows).toHaveLength(2);
  });
});

describe('the ingredients behind an uncosted plate', () => {
  it('names each item once even when it carries two defects', () => {
    const items = uncostedItemsOf(
      plate({
        state: 'incomplete',
        uncostedItems: [
          {
            inventoryItemId: 'i1',
            publicReference: 'CAFE',
            displayName: 'Café en grano',
            defect: 'no_cost_basis',
          },
          {
            inventoryItemId: 'i1',
            publicReference: 'CAFE',
            displayName: 'Café en grano',
            defect: 'unit_conversion_not_exact',
          },
          {
            inventoryItemId: 'i2',
            publicReference: 'LECHE',
            displayName: 'Leche entera',
            defect: 'no_cost_basis',
          },
        ],
      }),
    );
    expect(items.map((item) => item.inventoryItemId)).toEqual(['i1', 'i2']);
  });

  it('separates what the recipe is made of from what sales consumed outside it', () => {
    const parts = plateComponents(
      plate({
        components: [
          { inventoryItemId: 'i1', source: 'recipe_component' },
          { inventoryItemId: 'i2', source: 'direct' },
          { inventoryItemId: 'i3', source: 'modifier_component' },
        ],
      }),
    );
    expect(parts.recipe.map((c) => c.inventoryItemId)).toEqual(['i1', 'i2']);
    expect(parts.fromSales.map((c) => c.inventoryItemId)).toEqual(['i3']);
  });
});

// ── quantities, percentages, windows ────────────────────────────────────────

describe('scaled quantities', () => {
  it('divides by the scale the wire carried, not by an assumed one', () => {
    expect(scaledToNumber({ value: 12000, scale: 3, unit: 'kilogram' })).toBe(12);
    expect(scaledToNumber({ value: 200, scale: 3, unit: 'liter' })).toBe(0.2);
    expect(scaledToNumber({ value: 1, scale: 0, unit: 'unit' })).toBe(1);
  });

  it('answers null, not zero, for a quantity it does not have', () => {
    expect(scaledToNumber(null)).toBeNull();
    expect(scaledToNumber(undefined)).toBeNull();
    expect(scaledToNumber({})).toBeNull();
    // Zero is a real quantity here: a component a sale consumed that the recipe does
    // not name has a planned quantity of exactly zero.
    expect(scaledToNumber({ value: 0, scale: 3, unit: 'kilogram' })).toBe(0);
  });
});

describe('percentages', () => {
  it('reads basis points as a percentage and refuses a ratio with no denominator', () => {
    expect(basisPointsToPercent(9178)).toBe(91.78);
    expect(basisPointsToPercent(0)).toBe(0);
    expect(basisPointsToPercent(null)).toBeNull();
    expect(basisPointsOf(8352, 9100)).toBe(9178);
    expect(basisPointsOf(-500, 1000)).toBe(-5000);
    expect(basisPointsOf(100, 0)).toBeNull();
    expect(basisPointsOf(null, 100)).toBeNull();
  });
});

describe('business dates', () => {
  it('prints the day the business date names, never the day before it', () => {
    // `new Date('2026-09-16')` is UTC midnight; formatted in Mexico (UTC-7) it is the
    // 15th. The screen reads dates from Kalala's timezone, so this is the bug it must
    // not have.
    const es = formatBusinessDate('2026-09-16', 'es-MX', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    expect(es).toContain('16');
    expect(es).not.toContain('15');
    const en = formatBusinessDate('2026-01-01', 'en-US', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    expect(en).toContain('1');
    expect(en).not.toMatch(/\b31\b/);
  });

  it('answers null for anything that is not a plain business date', () => {
    expect(formatBusinessDate('2026-09-16T18:00:00-06:00')).toBeNull();
    expect(formatBusinessDate(null)).toBeNull();
    expect(formatBusinessDate('')).toBeNull();
  });
});

// ── the forecast ────────────────────────────────────────────────────────────

describe('the low-stock forecast', () => {
  const item = (overrides = {}) => ({
    inventoryItemId: 'i',
    displayName: 'Item',
    belowThreshold: false,
    daysOfCover: 10,
    insufficientHistory: false,
    hasCostBasis: true,
    ...overrides,
  });

  it('puts what is already below its threshold first, then the soonest to run out', () => {
    const sorted = sortForecast([
      item({ displayName: 'holgado', daysOfCover: 40 }),
      item({ displayName: 'pronto', daysOfCover: 2 }),
      item({ displayName: 'bajo', daysOfCover: 30, belowThreshold: true }),
    ]);
    expect(sorted.map((row) => row.displayName)).toEqual(['bajo', 'pronto', 'holgado']);
  });

  it('sorts an item nobody is using last, because it has no place in a queue', () => {
    const sorted = sortForecast([
      item({ displayName: 'sin consumo', daysOfCover: null }),
      item({ displayName: 'en uso', daysOfCover: 9 }),
    ]);
    expect(sorted.map((row) => row.displayName)).toEqual(['en uso', 'sin consumo']);
  });

  it('counts what needs attention without counting it as covered', () => {
    const counts = forecastCounts([
      item({ belowThreshold: true }),
      item({ insufficientHistory: true }),
      item({ daysOfCover: null }),
      item({ hasCostBasis: false }),
      item(),
    ]);
    expect(counts).toEqual({ all: 5, below: 1, thin: 1, noHistory: 1, withoutBasis: 1 });
  });
});
