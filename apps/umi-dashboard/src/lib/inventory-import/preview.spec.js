import { describe, expect, it } from 'vitest';
import { buildImportPreview } from './preview.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const merchantId = id(1);
const item = {
  id: id(2),
  publicReference: 'MILK',
  displayName: 'Milk',
  itemType: 'ingredient',
  baseUnit: 'liter',
  quantityScale: 3,
  active: true,
  version: 2,
  initialUnitCostMinor: 1250,
  lowStockThreshold: 1000,
  parQuantity: null,
  shelfLifeDays: 7,
  conversions: [],
};
const target = {
  productId: id(3),
  variantId: null,
  productName: 'Coffee',
  variantName: null,
  productActive: true,
};
const snapshot = { merchantId, items: [item], targets: [target], recipes: [] };
const article = (values = {}, rowNumber = 2, errors = []) => ({
  rowNumber,
  errors,
  values: {
    codigo: 'NEW',
    nombre: 'New',
    tipo: 'ingredient',
    unidad: 'liter',
    decimales: '3',
    costo_unitario: '12.50',
    existencia_minima: '1.250',
    cantidad_preparacion: '',
    vida_util_dias: '',
    ...values,
  },
});
const ingredient = (values = {}, rowNumber = 2, errors = []) => ({
  rowNumber,
  errors,
  values: {
    producto_id: id(3),
    variante_id: '',
    rendimiento: '1',
    unidad_rendimiento: 'unit',
    ingrediente_codigo: 'MILK',
    cantidad: '0.250',
    unidad: 'liter',
    ...values,
  },
});
const preview = (kind, rows, state = snapshot) =>
  buildImportPreview({ kind, parsed: { rows }, snapshot: state });

describe('item previews', () => {
  it('accepts UUID identifiers from the existing merchant contract', () => {
    expect(
      preview('items', [article()], {
        ...snapshot,
        merchantId: '1860305f-e864-d745-29e6-fb0830926cc6',
      }).entries[0].status,
    ).toBe('new');
  });
  it('keeps money and quantities exact and creates only administrative fields', () => {
    const result = preview('items', [article()]);
    expect(result.counts).toEqual({ new: 1, update: 0, unchanged: 0, duplicate: 0, error: 0 });
    expect(result.entries[0].command).toEqual({
      operation: 'inventory.item.create',
      targetAggregateId: null,
      targetVersion: null,
      parameters: {
        publicReference: 'NEW',
        displayName: 'New',
        itemType: 'ingredient',
        baseUnit: 'liter',
        quantityScale: 3,
        initialUnitCostMinor: 1250,
        lowStockThreshold: 1250,
        trackingPolicy: 'tracked',
        negativeStockPolicy: 'allow_and_flag',
      },
    });
    expect(result.entries[0].rowNumbers).toEqual([2]);
  });
  it('omits blank optional updates and retains a real zero cost', () => {
    const entry = preview('items', [
      article({
        codigo: 'MILK',
        nombre: 'Milk',
        costo_unitario: '0',
        existencia_minima: '',
        cantidad_preparacion: '',
        vida_util_dias: '',
      }),
    ]).entries[0];
    expect(entry.command).toEqual({
      operation: 'inventory.item.update',
      targetAggregateId: id(2),
      targetVersion: 2,
      parameters: { initialUnitCostMinor: 0 },
    });
  });
  it('does not create a version for equal fields', () => {
    expect(
      preview('items', [
        article({ codigo: 'MILK', nombre: 'Milk', existencia_minima: '1', vida_util_dias: '7' }),
      ]).entries[0],
    ).toMatchObject({ status: 'unchanged', command: null });
  });
  it('rejects every duplicate code with case-sensitive merchant matching', () => {
    expect(
      preview('items', [article(), article({}, 3)]).entries.map((entry) => entry.status),
    ).toEqual(['duplicate', 'duplicate']);
    expect(preview('items', [article({ codigo: 'milk' })]).entries[0].status).toBe('new');
  });
  it.each([
    [{ codigo: '' }, 'REQUIRED', 'codigo'],
    [{ codigo: 'a b' }, 'INVALID_CODE', 'codigo'],
    [{ nombre: '' }, 'REQUIRED', 'nombre'],
    [{ tipo: 'wrong' }, 'INVALID_ENUM', 'tipo'],
    [{ unidad: 'wrong' }, 'INVALID_ENUM', 'unidad'],
    [{ decimales: '7' }, 'INVALID_SCALE', 'decimales'],
    [{ costo_unitario: '1.001' }, 'PRECISION_OVERFLOW', 'costo_unitario'],
    [{ costo_unitario: '90071992547409.92' }, 'UNSAFE_QUANTITY', 'costo_unitario'],
    [{ existencia_minima: '0.0001' }, 'PRECISION_OVERFLOW', 'existencia_minima'],
    [{ cantidad_preparacion: '-1' }, 'INVALID_NUMBER', 'cantidad_preparacion'],
    [{ vida_util_dias: '3651' }, 'INVALID_SHELF_LIFE', 'vida_util_dias'],
    [{ codigo: 'MILK', unidad: 'gram' }, 'IMMUTABLE_FIELD', 'unidad'],
    [{ codigo: 'MILK', tipo: 'packaging' }, 'IMMUTABLE_FIELD', 'tipo'],
    [{ codigo: 'MILK', decimales: '2' }, 'IMMUTABLE_FIELD', 'decimales'],
  ])('blocks invalid item %j', (values, code, column) => {
    expect(preview('items', [article(values)]).entries[0]).toMatchObject({
      status: 'error',
      command: null,
      errors: expect.arrayContaining([{ code, column, rowNumber: 2 }]),
    });
  });
  it('rejects archived codes and preserves parse errors', () => {
    expect(
      preview('items', [article({ codigo: 'MILK' })], {
        ...snapshot,
        items: [{ ...item, active: false }],
      }).entries[0].errors[0].code,
    ).toBe('ARCHIVED_ITEM');
    expect(
      preview('items', [article({}, 9, [{ code: 'FORMULA_CELL', column: 'nombre' }])]).entries[0]
        .errors,
    ).toContainEqual({ code: 'FORMULA_CELL', column: 'nombre', rowNumber: 9 });
  });
});

describe('recipe previews', () => {
  it('builds one complete product recipe with exact input quantities', () => {
    const entry = preview('recipes', [ingredient()]).entries[0];
    expect(entry.command).toEqual({
      operation: 'inventory.recipe.create',
      targetAggregateId: null,
      targetVersion: null,
      parameters: {
        targetKind: 'product',
        productId: id(3),
        yieldQuantity: { value: 1, scale: 0, unit: 'unit' },
        components: [
          {
            inventoryItemId: id(2),
            quantity: { value: 25, scale: 2, unit: 'liter' },
            conversionNumerator: 1,
            conversionDenominator: 1,
            roundingPolicy: 'exact',
            required: true,
          },
        ],
      },
    });
  });
  it('accepts numerically equal yields and exact active conversions', () => {
    const second = {
      ...item,
      id: id(4),
      publicReference: 'BEANS',
      baseUnit: 'gram',
      quantityScale: 0,
      conversions: [
        {
          fromUnit: 'kilogram',
          toUnit: 'gram',
          numerator: 1000,
          denominator: 1,
          roundingPolicy: 'exact',
          active: true,
        },
      ],
    };
    const entry = preview(
      'recipes',
      [
        ingredient({ rendimiento: '1.00' }),
        ingredient(
          { ingrediente_codigo: 'BEANS', rendimiento: '1', cantidad: '0.020', unidad: 'kilogram' },
          3,
        ),
      ],
      { ...snapshot, items: [item, second] },
    ).entries[0];
    expect(entry.status).toBe('new');
    expect(entry.rowNumbers).toEqual([2, 3]);
    expect(entry.command.parameters.components[1].conversionNumerator).toBe(1000);
  });
  it.each([
    [{ rendimiento: '2' }, 'INCONSISTENT_YIELD'],
    [{ unidad_rendimiento: 'portion' }, 'INCONSISTENT_YIELD'],
    [{ ingrediente_codigo: 'MISSING' }, 'MISSING_INGREDIENT'],
    [{ cantidad: '0.0001' }, 'INEXACT_COMPONENT'],
    [{ cantidad: '0' }, 'INVALID_NUMBER'],
    [{ unidad: 'kilogram' }, 'UNSUPPORTED_UNIT'],
    [{ cantidad: '9007199254740992' }, 'UNSAFE_QUANTITY'],
  ])('rejects the whole group when a component fails %j', (values, code) => {
    const rows = [ingredient(), ingredient({ ingrediente_codigo: 'OTHER', ...values }, 3)];
    const other = { ...item, id: id(4), publicReference: 'OTHER' };
    const entry = preview('recipes', rows, { ...snapshot, items: [item, other] }).entries[0];
    expect(entry).toMatchObject({ status: 'error', command: null, rowNumbers: [2, 3] });
    expect(entry.errors.some((error) => error.code === code)).toBe(true);
  });
  it('rejects repeated ingredients and groups larger than 200 components', () => {
    expect(
      preview('recipes', [ingredient(), ingredient({}, 3)]).entries[0].errors.some(
        (error) => error.code === 'DUPLICATE_INGREDIENT',
      ),
    ).toBe(true);
    expect(
      preview(
        'recipes',
        Array.from({ length: 201 }, (_, n) => ingredient({}, n + 2)),
      ).entries[0].errors.some((error) => error.code === 'TOO_MANY_COMPONENTS'),
    ).toBe(true);
  });
  it('rejects absent and inactive exact product or variant targets', () => {
    for (const state of [
      { ...snapshot, targets: [] },
      { ...snapshot, targets: [{ ...target, productActive: false }] },
    ]) {
      expect(preview('recipes', [ingredient()], state).entries[0].errors[0].code).toBe(
        'MISSING_TARGET',
      );
    }
    expect(preview('recipes', [ingredient({ variante_id: id(8) })]).entries[0].errors[0].code).toBe(
      'WRONG_VARIANT',
    );
  });
  it('blocks the file if a row has no usable grouping key', () => {
    expect(
      preview('recipes', [ingredient(), ingredient({ producto_id: '' }, 3)]).entries.every(
        (entry) => entry.status === 'error' && entry.command === null,
      ),
    ).toBe(true);
  });
  it('compares semantic inputs independent of order, scale representation, and conversion fraction', () => {
    const component = {
      inventoryItemId: id(2),
      quantity: { value: 250, scale: 3, unit: 'liter' },
      conversionNumerator: 2,
      conversionDenominator: 2,
      roundingPolicy: 'exact',
      required: true,
    };
    const recipe = {
      id: id(5),
      targetKind: 'product',
      productId: id(3),
      variantId: null,
      active: true,
      version: 4,
      yieldQuantity: { value: 100, scale: 2, unit: 'unit' },
      shelfLifeDays: 8,
      components: [component],
    };
    expect(
      preview('recipes', [ingredient()], { ...snapshot, recipes: [recipe] }).entries[0],
    ).toMatchObject({ status: 'unchanged', command: null });
    const entry = preview('recipes', [ingredient({ cantidad: '0.5' })], {
      ...snapshot,
      recipes: [recipe],
    }).entries[0];
    expect(entry.command).toMatchObject({
      operation: 'inventory.recipe.update',
      targetAggregateId: id(5),
      targetVersion: 4,
    });
    expect(Object.keys(entry.command.parameters).sort()).toEqual(['components', 'yieldQuantity']);
  });
  it('ignores ingredient order and bounds recipe counts and per-yield quantities', () => {
    const other = { ...item, id: id(4), publicReference: 'OTHER' };
    const component = {
      inventoryItemId: id(2),
      quantity: { value: 25, scale: 2, unit: 'liter' },
      conversionNumerator: 1,
      conversionDenominator: 1,
      roundingPolicy: 'exact',
      required: true,
    };
    const recipe = {
      id: id(5),
      targetKind: 'product',
      productId: id(3),
      variantId: null,
      active: true,
      version: 4,
      yieldQuantity: { value: 1, scale: 0, unit: 'unit' },
      components: [{ ...component, inventoryItemId: id(4) }, component],
    };
    const state = { ...snapshot, items: [item, other], recipes: [recipe] };
    expect(
      preview('recipes', [ingredient(), ingredient({ ingrediente_codigo: 'OTHER' }, 3)], state)
        .entries[0].status,
    ).toBe('unchanged');
    expect(
      preview('recipes', [
        ingredient({ cantidad: '9007199254740991', rendimiento: '0.000001' }),
      ]).entries[0].errors.some((error) => error.code === 'UNSAFE_QUANTITY'),
    ).toBe(true);
    expect(() =>
      preview(
        'recipes',
        Array.from({ length: 101 }, (_, n) => ingredient({ producto_id: id(n + 100) }, n + 2)),
      ),
    ).toThrow('TOO_MANY_RECIPES');
  });
  it('does not use archived ingredients or rounded or inactive conversions', () => {
    for (const changes of [
      { active: false },
      {
        conversions: [
          {
            fromUnit: 'gram',
            toUnit: 'liter',
            numerator: 1,
            denominator: 1,
            roundingPolicy: 'floor',
            active: true,
          },
        ],
      },
      {
        conversions: [
          {
            fromUnit: 'gram',
            toUnit: 'liter',
            numerator: 1,
            denominator: 1,
            roundingPolicy: 'exact',
            active: false,
          },
        ],
      },
    ]) {
      expect(
        preview('recipes', [ingredient({ unidad: changes.active === false ? 'liter' : 'gram' })], {
          ...snapshot,
          items: [{ ...item, ...changes }],
        }).entries[0].status,
      ).toBe('error');
    }
  });
  it('bounds complete files and does not mutate source rows or snapshots', () => {
    const input = structuredClone(snapshot);
    const rows = [ingredient()];
    preview('recipes', rows, input);
    expect(input).toEqual(snapshot);
    expect(rows).toEqual([ingredient()]);
    expect(() =>
      preview(
        'items',
        Array.from({ length: 501 }, () => article()),
      ),
    ).toThrow('TOO_MANY_ROWS');
  });
});
