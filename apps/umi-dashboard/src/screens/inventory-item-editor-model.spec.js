import { describe, expect, it } from 'vitest';
import {
  itemNegativeStockPolicy,
  itemQuantityDraft,
  itemQuantityParameters,
  parseInitialCost,
  initialCostDraft,
  initialCostParameters,
} from './inventory-item-editor-model.js';

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

describe('initial cost in exact centavos', () => {
  it.each([
    ['100.25', 10025],
    ['100,25', 10025],
    ['', null],
    ['  ', null],
    ['0', 0],
    ['0.01', 1],
    ['90071992547409.91', 9007199254740991],
  ])('parses %s exactly', (text, value) => {
    expect(parseInitialCost(text)).toEqual({ valid: true, value });
  });
  it.each(['-1', '1e3', '1.001', '90071992547409.92', '.', '+1', '1,000.00', 'Infinity'])(
    'refuses %s',
    (text) => {
      expect(parseInitialCost(text)).toEqual({ valid: false, value: null });
    },
  );
  it('opens every saved cent exactly, including the safe boundary', () => {
    expect(initialCostDraft(null)).toBe('');
    expect(initialCostDraft(0)).toBe('0.00');
    expect(initialCostDraft(10025)).toBe('100.25');
    expect(initialCostDraft(9007199254740991)).toBe('90071992547409.91');
  });
  it('creates absent, zero and positive values explicitly', () => {
    expect(initialCostParameters('', null)).toEqual({ initialUnitCostMinor: null });
    expect(initialCostParameters('0', null)).toEqual({ initialUnitCostMinor: 0 });
    expect(initialCostParameters('100,25', null)).toEqual({ initialUnitCostMinor: 10025 });
  });
  it('preserves unchanged amounts and sends explicit clear or changes', () => {
    expect(initialCostParameters('100.25', { initialUnitCostMinor: 10025 })).toEqual({});
    expect(initialCostParameters('', { initialUnitCostMinor: null })).toEqual({});
    expect(initialCostParameters('0.00', { initialUnitCostMinor: 0 })).toEqual({});
    expect(initialCostParameters('', { initialUnitCostMinor: 10025 })).toEqual({
      initialUnitCostMinor: null,
    });
    expect(initialCostParameters('120', { initialUnitCostMinor: 10025 })).toEqual({
      initialUnitCostMinor: 12000,
    });
    expect(initialCostParameters('1.001', { initialUnitCostMinor: 10025 })).toBeNull();
  });
});

describe('negative stock policy when the editor opens', () => {
  it('starts only a new item with permission for a negative balance', () => {
    expect(itemNegativeStockPolicy(null)).toBe('allow_and_flag');
    expect(itemNegativeStockPolicy(undefined)).toBe('allow_and_flag');
  });

  it.each(['block', 'manager_override', 'allow_and_flag', 'backorder', 'not_applicable'])(
    'preserves an existing explicit %s policy on unrelated edits',
    (negativeStockPolicy) => {
      expect(itemNegativeStockPolicy({ negativeStockPolicy })).toBe(negativeStockPolicy);
    },
  );

  it('keeps the previous fallback for an existing item without a saved policy', () => {
    expect(itemNegativeStockPolicy({})).toBe('block');
  });
});
