import { describe, expect, it } from 'vitest';
import { itemQuantityDraft, itemQuantityParameters } from './inventory-item-editor-model.js';

describe('item quantities in the item unit', () => {
  it('opens stored quantities as ordinary quantities', () => {
    expect(itemQuantityDraft({ quantityScale: 2, lowStockThreshold: 250, parQuantity: 0 })).toEqual(
      { lowStockThreshold: '2.5', parQuantity: '0' },
    );
    expect(
      itemQuantityDraft({ quantityScale: 2, lowStockThreshold: null, parQuantity: null }),
    ).toEqual({ lowStockThreshold: '', parQuantity: '' });
  });

  it('saves decimal quantities and a comma as exact stored integers', () => {
    expect(itemQuantityParameters({ lowStockThreshold: '2.5', parQuantity: '3,25' }, 2)).toEqual({
      lowStockThreshold: 250,
      parQuantity: 325,
    });
  });

  it('keeps an unset quantity separate from a real zero', () => {
    expect(itemQuantityParameters({ lowStockThreshold: ' ', parQuantity: '0.00' }, 2)).toEqual({
      lowStockThreshold: null,
      parQuantity: 0,
    });
  });

  it.each(['2.555', '-1', '1e2', '.', '2.5.0', '90071992547409.92'])(
    'blocks an invalid quantity: %s',
    (text) => {
      expect(itemQuantityParameters({ lowStockThreshold: text, parQuantity: '' }, 2)).toBeNull();
      expect(itemQuantityParameters({ lowStockThreshold: '', parQuantity: text }, 2)).toBeNull();
    },
  );

  it('keeps the safe integer boundary exact', () => {
    expect(
      itemQuantityParameters({ lowStockThreshold: '90071992547409.91', parQuantity: '' }, 2),
    ).toEqual({ lowStockThreshold: 9007199254740991, parQuantity: null });
  });

  it('retains the physical quantity when selected precision changes', () => {
    const draft = { lowStockThreshold: '2.5', parQuantity: '3' };
    expect(itemQuantityParameters(draft, 2)).toEqual({ lowStockThreshold: 250, parQuantity: 300 });
    expect(itemQuantityParameters(draft, 3)).toEqual({
      lowStockThreshold: 2500,
      parQuantity: 3000,
    });
    expect(itemQuantityParameters(draft, 0)).toBeNull();
  });
});
