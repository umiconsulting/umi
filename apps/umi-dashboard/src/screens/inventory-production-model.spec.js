import { describe, expect, it } from 'vitest';
import {
  preparationQuantity,
  preparationSelectionKey,
  preparationPreviewMatches,
  preparationRecipes,
  loadPreparationPages,
} from './inventory-production-model.js';

const item = { id: 'bread', quantityScale: 2, baseUnit: 'kilogram' };
describe('exact preparation quantities', () => {
  it('accepts Spanish decimals at the item scale', () => {
    expect(preparationQuantity('2,5', item)).toEqual({ value: 250, scale: 2, unit: 'kilogram' });
    expect(preparationQuantity('0.29', item)?.value).toBe(29);
  });
  it.each(['0', '-1', '0.001', '', '.', '1e3', '1,2.3', '9007199254740992'])(
    'refuses invalid quantity %s',
    (text) => {
      expect(preparationQuantity(text, item)).toBeNull();
    },
  );
});
describe('reviewed preparation', () => {
  const selection = {
    itemId: 'bread',
    locationId: 'branch',
    inventoryLocationId: 'room',
    quantity: { value: 5, scale: 0, unit: 'unit' },
  };
  const reviewed = {
    selectionKey: preparationSelectionKey(selection),
    result: { recipeFingerprint: 'server' },
  };
  it('retains a preview for the exact reviewed selection', () => {
    expect(preparationPreviewMatches(reviewed, selection)).toBe(true);
  });
  it.each([
    { itemId: 'other' },
    { locationId: 'other' },
    { inventoryLocationId: 'other' },
    { quantity: { value: 20, scale: 0, unit: 'unit' } },
    { quantity: null },
  ])('invalidates a changed selection %j', (change) => {
    expect(preparationPreviewMatches(reviewed, { ...selection, ...change })).toBe(false);
  });
  it('offers only active item recipes, independent of par', () => {
    const items = [item, { id: 'archived', archivedAt: '2026-10-30T00:00:00Z' }];
    const recipes = [
      { id: 'valid', active: true, targetItemId: item.id },
      { id: 'sales', targetProductId: 'p' },
      { id: 'old', active: false, targetItemId: item.id },
      { id: 'archived', targetItemId: 'archived' },
    ];
    expect(preparationRecipes(recipes, items).map((entry) => entry.recipe.id)).toEqual(['valid']);
  });
});
describe('complete preparation selection', () => {
  it('loads recipes beyond the first page', async () => {
    const rows = await loadPreparationPages(
      async (cursor) =>
        cursor
          ? { recipes: ['last'], page: { hasMore: false } }
          : { recipes: Array(100).fill('first'), page: { hasMore: true, nextCursor: 'next' } },
      'recipes',
    );
    expect(rows).toHaveLength(101);
    expect(rows[100]).toBe('last');
  });
  it('keeps page failures and repeated cursors as errors', async () => {
    await expect(
      loadPreparationPages(async () => {
        throw new Error('unavailable');
      }, 'recipes'),
    ).rejects.toThrow('unavailable');
    await expect(
      loadPreparationPages(
        async () => ({ recipes: [], page: { hasMore: true, nextCursor: 'same' } }),
        'recipes',
      ),
    ).rejects.toThrow();
  });
});
