import { describe, expect, it } from 'vitest';
import {
  componentBaseQuantity,
  recipeCostPreview,
  recipeMargin,
  recipeToDraft,
  scaledQuantityText,
  subRecipeCostByItemId,
  subRecipeHint,
  yieldIsValid,
  yieldText,
} from './recipe-model.js';

const FLOUR = { id: 'item-flour', quantityScale: 0, baseUnit: 'gram' };
const EGG = { id: 'item-egg', quantityScale: 0, baseUnit: 'unit' };
const SAUCE = { id: 'item-sauce', quantityScale: 0, baseUnit: 'gram' };

const ONE_PORTION = { value: 1, scale: 0, unit: 'portion' };

function line(inventoryItemId, value, scale = 0, unit = 'gram') {
  return {
    inventoryItemId,
    quantity: { value, scale, unit },
    conversionNumerator: 1,
    conversionDenominator: 1,
    roundingPolicy: 'exact',
    required: true,
  };
}

function items(...records) {
  return new Map(records.map((item) => [item.id, item]));
}

describe('the cost of one unit of yield', () => {
  it('adds every line at the item scale', () => {
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: 2500,
      components: [line('item-flour', 200), line('item-egg', 2, 0, 'unit')],
      itemsById: items(FLOUR, EGG),
      unitCostMinorByItemId: new Map([
        ['item-flour', 3],
        ['item-egg', 500],
      ]),
    });

    expect(preview.state).toBe('costed');
    expect(preview.costMinor).toBe(1600);
    expect(preview.marginMinor).toBe(900);
  });

  it('divides a batch by its yield, in exact scaled integers', () => {
    const grams = { ...FLOUR, quantityScale: 2 };
    const preview = recipeCostPreview({
      yieldQuantity: { value: 1000, scale: 0, unit: 'gram' },
      priceMinor: null,
      components: [line('item-flour', 250)],
      itemsById: items(grams),
      unitCostMinorByItemId: new Map([['item-flour', 12]]),
    });

    // 250 g of a 1000 g batch is 0.25 g per gram of yield, priced at 12 cents a gram.
    expect(preview.costMinor).toBe(3);
    expect(preview.marginMinor).toBeNull();
  });

  it('rounds the whole recipe once, half up, as the server does', () => {
    const first = { id: 'item-first', quantityScale: 2, baseUnit: 'gram' };
    const second = { id: 'item-second', quantityScale: 2, baseUnit: 'gram' };
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: null,
      components: [line('item-first', 50, 2), line('item-second', 50, 2)],
      itemsById: items(first, second),
      unitCostMinorByItemId: new Map([
        ['item-first', 1],
        ['item-second', 1],
      ]),
    });

    // Two halves of a cent are one cent. Rounding each line first would print two.
    expect(preview.costMinor).toBe(1);
  });
});

describe('a cost the server did not fully price', () => {
  it('withholds the cost when a component has no cost basis', () => {
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: 2500,
      components: [line('item-flour', 200)],
      itemsById: items(FLOUR),
      unitCostMinorByItemId: new Map([['item-flour', null]]),
    });

    expect(preview.state).toBe('no_cost');
    expect(preview.costMinor).toBeNull();
    expect(preview.marginMinor).toBeNull();
    expect(preview.missingCost).toEqual(['item-flour']);
  });

  it('reports no cost for an empty recipe instead of a free one', () => {
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: 2500,
      components: [],
      itemsById: items(FLOUR),
      unitCostMinorByItemId: new Map(),
    });

    expect(preview.state).toBe('empty');
    expect(preview.costMinor).toBeNull();
  });
});

describe('the not-exact decision', () => {
  it('names a quantity that does not divide at the item scale', () => {
    const preview = recipeCostPreview({
      yieldQuantity: { value: 3, scale: 0, unit: 'portion' },
      priceMinor: 2500,
      components: [line('item-flour', 2)],
      itemsById: items(FLOUR),
      unitCostMinorByItemId: new Map([['item-flour', 3]]),
    });

    expect(preview.state).toBe('not_exact');
    expect(preview.costMinor).toBeNull();
    expect(preview.notExact).toEqual(['item-flour']);
  });

  it('accepts the same line when the item scale can carry the fraction', () => {
    const quarterLine = [line('item-flour', 2)];
    const wide = recipeCostPreview({
      yieldQuantity: { value: 4, scale: 0, unit: 'portion' },
      priceMinor: null,
      components: quarterLine,
      itemsById: items(FLOUR),
      unitCostMinorByItemId: new Map([['item-flour', 3]]),
    });
    const narrow = recipeCostPreview({
      yieldQuantity: { value: 4, scale: 0, unit: 'portion' },
      priceMinor: null,
      components: quarterLine,
      itemsById: items({ ...FLOUR, quantityScale: 1 }),
      unitCostMinorByItemId: new Map([['item-flour', 3]]),
    });

    expect(wide.state).toBe('not_exact');
    // 2 g of a 4 g batch is half a gram: 5 at scale 1, priced at 3 cents a gram.
    expect(narrow.state).toBe('costed');
    expect(narrow.costMinor).toBe(2);
  });

  it('reports the exactness of one line on its own', () => {
    expect(componentBaseQuantity(line('item-flour', 2), ONE_PORTION, 0)).toEqual({
      state: 'exact',
      value: 2n,
    });
    expect(componentBaseQuantity(line('item-flour', 2), { value: 3, scale: 0 }, 0)).toEqual({
      state: 'not_exact',
      value: null,
    });
    expect(componentBaseQuantity({ inventoryItemId: 'item-flour' }, ONE_PORTION, 0)).toEqual({
      state: 'invalid',
      value: null,
    });
  });
});

describe('the margin', () => {
  it('measures the margin against the price, in basis points', () => {
    expect(recipeMargin(2500, 1600)).toEqual({ marginMinor: 900, marginBasisPoints: 3600 });
  });

  it('keeps a negative margin, because a plate sold below cost is the news', () => {
    expect(recipeMargin(100, 250)).toEqual({ marginMinor: -150, marginBasisPoints: -15000 });
  });

  it('withholds the percentage of a zero price', () => {
    expect(recipeMargin(0, 250)).toEqual({ marginMinor: -250, marginBasisPoints: null });
  });

  it('has no margin without a price', () => {
    expect(recipeMargin(null, 250)).toBeNull();
  });
});

describe('the sub-recipe', () => {
  const sauceRecipe = {
    id: 'recipe-sauce',
    targetItemId: 'item-sauce',
    costMinor: 100,
    yieldQuantity: { value: 1000, scale: 0, unit: 'gram' },
    active: true,
    usedInRecipeCount: 2,
  };

  it('is offered as a sub-recipe with the count of recipes that use it', () => {
    expect(subRecipeHint('item-sauce', [sauceRecipe])).toMatchObject({
      recipeId: 'recipe-sauce',
      usedInRecipeCount: 2,
    });
    expect(subRecipeHint('item-flour', [sauceRecipe])).toBeNull();
    expect(subRecipeHint('', [sauceRecipe])).toBeNull();
  });

  it('ignores a retired sub-recipe', () => {
    expect(subRecipeHint('item-sauce', [{ ...sauceRecipe, active: false }])).toBeNull();
  });

  it('rolls the sub-recipe cost up into the plate', () => {
    const byItemId = subRecipeCostByItemId([sauceRecipe], items(SAUCE));
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: 2500,
      components: [line('item-sauce', 200)],
      itemsById: items(SAUCE),
      unitCostMinorByItemId: new Map(),
      subRecipeByItemId: byItemId,
    });

    // The sauce costs 100 cents for 1000 g, so 200 g of it is 20 cents.
    expect(preview.state).toBe('costed');
    expect(preview.costMinor).toBe(20);
  });

  it('refuses to roll up a sub-recipe that yields another base unit', () => {
    const kilograms = { ...sauceRecipe, yieldQuantity: { value: 1, scale: 0, unit: 'kilogram' } };
    expect(subRecipeCostByItemId([kilograms], items(SAUCE)).size).toBe(0);
  });

  it('charges a produced item through its recipe, not through its own basis', () => {
    const byItemId = subRecipeCostByItemId([sauceRecipe], items(SAUCE));
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: null,
      components: [line('item-sauce', 200)],
      itemsById: items(SAUCE),
      // A prep that is also bought would be charged twice if its basis won.
      unitCostMinorByItemId: new Map([['item-sauce', 999]]),
      subRecipeByItemId: byItemId,
    });

    expect(preview.costMinor).toBe(20);
  });

  it('withholds the cost of a produced item whose own recipe is not priced', () => {
    const unpriced = { ...sauceRecipe, costMinor: null };
    const byItemId = subRecipeCostByItemId([unpriced], items(SAUCE));
    const preview = recipeCostPreview({
      yieldQuantity: ONE_PORTION,
      priceMinor: null,
      components: [line('item-sauce', 200)],
      itemsById: items(SAUCE),
      unitCostMinorByItemId: new Map([['item-sauce', 999]]),
      subRecipeByItemId: byItemId,
    });

    expect(preview.state).toBe('no_cost');
    expect(preview.costMinor).toBeNull();
  });
});

describe('the quantity the operator types', () => {
  it('reads the text at the item scale', () => {
    expect(scaledQuantityText('250', 0)).toBe(250n);
    expect(scaledQuantityText('12.5', 2)).toBe(1250n);
    expect(scaledQuantityText('0.05', 2)).toBe(5n);
  });

  it('refuses a quantity with more decimals than the item scale', () => {
    expect(scaledQuantityText('0.555', 2)).toBeNull();
    expect(scaledQuantityText('1.5', 0)).toBeNull();
  });

  it('refuses zero and text that is not a number', () => {
    expect(scaledQuantityText('0', 0)).toBeNull();
    expect(scaledQuantityText('', 0)).toBeNull();
    expect(scaledQuantityText('-4', 0)).toBeNull();
    expect(scaledQuantityText('dos', 0)).toBeNull();
  });
});

describe('the yield', () => {
  it('reads as a quantity with its unit', () => {
    expect(yieldText({ value: 1500, scale: 2, unit: 'gram' })).toBe('15 gram');
    expect(yieldText({ value: 1, scale: 0, unit: 'portion' }, () => 'porcion')).toBe('1 porcion');
    expect(yieldText(null)).toBeNull();
  });

  it('refuses a zero yield and accepts a positive one', () => {
    expect(yieldIsValid({ value: 0, scale: 0, unit: 'portion' })).toBe(false);
    expect(yieldIsValid({ value: 1, scale: 0, unit: 'portion' })).toBe(true);
  });
});

describe('a stored recipe as an editor draft', () => {
  it('keeps the yield, the shelf life and every component', () => {
    const draft = recipeToDraft({
      id: 'recipe-1',
      yieldQuantity: { value: 1, scale: 0, unit: 'portion' },
      shelfLifeDays: 3,
      components: [
        {
          id: 'component-1',
          inventoryItemId: 'item-flour',
          quantity: { value: 200, scale: 0, unit: 'gram' },
          conversionNumerator: 1,
          conversionDenominator: 1,
          roundingPolicy: 'exact',
          required: true,
        },
      ],
    });

    expect(draft.shelfLifeDays).toBe(3);
    expect(draft.components).toHaveLength(1);
    expect(draft.components[0]).toMatchObject({
      key: 'component-1',
      inventoryItemId: 'item-flour',
      quantity: { value: 200, scale: 0, unit: 'gram' },
    });
  });

  it('reads an empty recipe as an empty draft', () => {
    expect(recipeToDraft(null)).toEqual({
      yieldQuantity: null,
      shelfLifeDays: null,
      components: [],
    });
  });
});
