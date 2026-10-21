import { describe, expect, it } from 'vitest';
import {
  blankOptionGroup,
  blankVariant,
  catalogChoicesPayload,
  optionGroupFromServer,
  variantFromServer,
  variantPrice,
} from './catalog-product-draft.js';

describe('catalog product choices', () => {
  it('keeps the final price as base plus the exact integer delta', () => {
    expect(variantPrice(6000, 1000)).toBe(7000);
    expect(variantPrice(6000, -500)).toBe(5500);
  });

  it('drops blank editor rows and keeps complete variants and options', () => {
    const variant = { ...blankVariant('v1'), name: ' Frío ', priceDelta: 1000 };
    const blank = blankVariant('v2');
    const group = {
      ...blankOptionGroup('g1'),
      name: ' Leche ',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      modifiers: [
        { ...blankOptionGroup('g2').modifiers[0], id: 'm1', name: ' Avena ', priceDelta: 500 },
        { ...blankOptionGroup('g3').modifiers[0], id: 'm2', name: '   ' },
      ],
    };
    const payload = catalogChoicesPayload([variant, blank], [group]);
    expect(payload.variants).toEqual([
      expect.objectContaining({ id: 'v1', name: 'Frío', priceDelta: 1000 }),
    ]);
    expect(payload.optionGroups).toEqual([
      expect.objectContaining({
        id: 'g1',
        name: 'Leche',
        required: true,
        minSelections: 1,
        maxSelections: 1,
        modifiers: [expect.objectContaining({ id: 'm1', name: 'Avena', priceDelta: 500 })],
      }),
    ]);
  });

  it('loads server rows without losing ids or retired rows', () => {
    const variant = variantFromServer(
      {
        id: 'v',
        name: 'Caliente',
        priceDelta: 0,
        active: false,
        attributes: { estilo: 'Caliente' },
        displayOrder: 3,
      },
      0,
    );
    const group = optionGroupFromServer(
      {
        id: 'g',
        name: 'Extras',
        minSelections: 0,
        maxSelections: 2,
        active: false,
        modifiers: [{ id: 'm', name: 'Queso', priceDelta: 100, active: false }],
      },
      0,
    );
    expect(variant).toMatchObject({ id: 'v', active: false, displayOrder: 3 });
    expect(group).toMatchObject({
      id: 'g',
      active: false,
      maxSelections: 2,
      modifiers: [expect.objectContaining({ id: 'm', active: false })],
    });
  });
});
