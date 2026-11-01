import { componentBaseQuantity } from '../../screens/recipe-model.js';
import { IMPORT_LIMITS, UNITS, fileError } from './schema.js';
import {
  MAX_SAFE,
  UUID,
  cell,
  issue,
  entryFor,
  collect,
  decimal,
  sameQuantity,
} from './preview-values.js';

function equalComponent(a, b) {
  return (
    a.inventoryItemId === b.inventoryItemId &&
    sameQuantity(a.quantity, b.quantity) &&
    BigInt(a.conversionNumerator ?? 1) * BigInt(b.conversionDenominator ?? 1) ===
      BigInt(b.conversionNumerator ?? 1) * BigInt(a.conversionDenominator ?? 1) &&
    (a.roundingPolicy ?? 'exact') === (b.roundingPolicy ?? 'exact') &&
    (a.required ?? true) === (b.required ?? true)
  );
}

function sameRecipe(recipe, yieldQuantity, components) {
  return (
    sameQuantity(recipe.yieldQuantity, yieldQuantity) &&
    recipe.components.length === components.length &&
    components.every((component) =>
      recipe.components.some((existing) => equalComponent(existing, component)),
    )
  );
}

export function planRecipes(rows, snapshot) {
  const groups = new Map();
  let ungrouped = false;
  for (const row of rows) {
    const product = cell(row, 'producto_id');
    const variant = cell(row, 'variante_id');
    const usable = UUID.test(product) && (!variant || UUID.test(variant));
    if (!usable) ungrouped = true;
    const key = usable ? `${product}/${variant}` : `invalid:${row.rowNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  if (groups.size > IMPORT_LIMITS.maxRecipes) throw fileError('TOO_MANY_RECIPES');
  return [...groups.values()].map((group) => {
    const first = group[0];
    const productId = cell(first, 'producto_id');
    const variantId = cell(first, 'variante_id') || null;
    const target = snapshot.targets.find(
      (target) =>
        target.productActive === true &&
        target.productId === productId &&
        (target.variantId ?? null) === variantId,
    );
    const entry = entryFor(
      group,
      `${productId}/${variantId || ''}`,
      target ? target.variantName || target.productName : productId,
    );
    const add = (code, column, row = first) =>
      entry.errors.push(issue(code, column, row.rowNumber));
    if (ungrouped) add('UNGROUPED_RECIPE_ROW', 'producto_id');
    if (!target)
      add(
        variantId &&
          snapshot.targets.some((target) => target.productId === productId && target.productActive)
          ? 'WRONG_VARIANT'
          : 'MISSING_TARGET',
        variantId ? 'variante_id' : 'producto_id',
      );
    if (group.length > IMPORT_LIMITS.maxComponents) add('TOO_MANY_COMPONENTS', null);
    let yieldQuantity = null;
    const components = [];
    const seen = new Set();
    for (const row of group) {
      const yieldUnit = cell(row, 'unidad_rendimiento');
      const yieldValue = collect(entry, row, 'rendimiento', () =>
        decimal(cell(row, 'rendimiento'), 6, { positive: true }),
      );
      if (!UNITS.includes(yieldUnit)) add('INVALID_ENUM', 'unidad_rendimiento', row);
      const currentYield = yieldValue ? { ...yieldValue, unit: yieldUnit } : null;
      if (currentYield) {
        if (yieldQuantity && !sameQuantity(yieldQuantity, currentYield))
          add('INCONSISTENT_YIELD', 'rendimiento', row);
        yieldQuantity ??= currentYield;
      }
      const code = cell(row, 'ingrediente_codigo');
      const matches = snapshot.items.filter(
        (item) => item.active === true && item.publicReference === code,
      );
      const item = matches[0];
      if (matches.length !== 1)
        add(matches.length ? 'DUPLICATE_TARGET' : 'MISSING_INGREDIENT', 'ingrediente_codigo', row);
      if (seen.has(code)) add('DUPLICATE_INGREDIENT', 'ingrediente_codigo', row);
      seen.add(code);
      const unit = cell(row, 'unidad');
      const quantity = collect(entry, row, 'cantidad', () =>
        decimal(cell(row, 'cantidad'), 6, { positive: true }),
      );
      if (!UNITS.includes(unit)) add('INVALID_ENUM', 'unidad', row);
      if (!item || !quantity) continue;
      let conversion = { numerator: 1, denominator: 1 };
      if (unit !== item.baseUnit) {
        conversion = (item.conversions || []).find(
          (conversion) =>
            conversion.active === true &&
            conversion.roundingPolicy === 'exact' &&
            conversion.fromUnit === unit &&
            conversion.toUnit === item.baseUnit,
        );
        if (!conversion) {
          add('UNSUPPORTED_UNIT', 'unidad', row);
          continue;
        }
      }
      const component = {
        inventoryItemId: item.id,
        quantity: { ...quantity, unit },
        conversionNumerator: conversion.numerator,
        conversionDenominator: conversion.denominator,
        roundingPolicy: 'exact',
        required: true,
      };
      const base = componentBaseQuantity(component, currentYield, item.quantityScale);
      if (base.state !== 'exact') add('INEXACT_COMPONENT', 'cantidad', row);
      else if (base.value < 1n || base.value > MAX_SAFE) add('UNSAFE_QUANTITY', 'cantidad', row);
      components.push(component);
    }
    const recipes = snapshot.recipes.filter(
      (recipe) =>
        recipe.active === true &&
        recipe.targetKind === 'product' &&
        recipe.productId === productId &&
        (recipe.variantId ?? null) === variantId,
    );
    if (recipes.length > 1) add('DUPLICATE_TARGET', 'producto_id');
    const recipe = recipes[0];
    if (!entry.errors.length) {
      entry.status = recipe
        ? sameRecipe(recipe, yieldQuantity, components)
          ? 'unchanged'
          : 'update'
        : 'new';
      if (entry.status !== 'unchanged')
        entry.command = {
          operation: recipe ? 'inventory.recipe.update' : 'inventory.recipe.create',
          targetAggregateId: recipe?.id ?? null,
          targetVersion: recipe?.version ?? null,
          parameters: recipe
            ? { yieldQuantity, components }
            : {
                targetKind: 'product',
                productId,
                ...(variantId ? { variantId } : {}),
                yieldQuantity,
                components,
              },
        };
    }
    return entry;
  });
}
