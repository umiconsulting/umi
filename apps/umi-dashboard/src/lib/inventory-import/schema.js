export const IMPORT_LIMITS = Object.freeze({
  maxBytes: 2097152,
  maxRows: 500,
  maxRecipes: 100,
  maxComponents: 200,
  timeoutMs: 15000,
});

export const ITEM_COLUMNS = Object.freeze([
  'codigo',
  'nombre',
  'tipo',
  'unidad',
  'decimales',
  'costo_unitario',
  'existencia_minima',
  'cantidad_preparacion',
  'vida_util_dias',
]);
export const RECIPE_COLUMNS = Object.freeze([
  'producto_id',
  'variante_id',
  'rendimiento',
  'unidad_rendimiento',
  'ingrediente_codigo',
  'cantidad',
  'unidad',
]);
export const ITEM_TYPES = Object.freeze([
  'ingredient',
  'physical_product',
  'variant_stock',
  'packaging',
  'composite_component',
  'bundle_component',
  'operational_supply',
]);
export const UNITS = Object.freeze([
  'unit',
  'gram',
  'kilogram',
  'milliliter',
  'liter',
  'portion',
  'package',
  'box',
]);

export const EXAMPLES = {
  items: {
    codigo: 'LECHE-001',
    nombre: 'Leche entera', // eslint-disable-line lingui/no-unlocalized-strings -- Example data, not UI copy.
    tipo: 'ingredient',
    unidad: 'liter',
    decimales: '3',
    costo_unitario: '28.50',
    existencia_minima: '2',
    cantidad_preparacion: '',
    vida_util_dias: '7',
  },
  recipes: {
    producto_id: 'producto-id',
    variante_id: '',
    rendimiento: '1',
    unidad_rendimiento: 'unit',
    ingrediente_codigo: 'LECHE-001',
    cantidad: '0.250',
    unidad: 'liter',
  },
};

export function columnsFor(kind) {
  if (kind === 'items') return ITEM_COLUMNS;
  if (kind === 'recipes') return RECIPE_COLUMNS;
  throw fileError('UNSUPPORTED_KIND');
}

export function requiredColumnsFor(kind) {
  return kind === 'items'
    ? ITEM_COLUMNS.slice(0, 5)
    : columnsFor(kind).filter((key) => key !== 'variante_id');
}

export function fileError(code) {
  return Object.assign(new Error(code), { code });
}
