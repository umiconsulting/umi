/**
 * Pure helpers for the console's Recetas tab (recipes module plan §7 and §11,
 * Phase 2).
 *
 * No React and no JSX, so the arithmetic runs in a test without a browser
 * (recipe-model.spec.js). The screen decides the words; this file decides the
 * numbers and the states.
 *
 * THE ONE RULE IS THE COSTING SCREEN'S RULE. A cost the server did not fully
 * price is UNKNOWN, not zero. A recipe with a component no receipt has ever
 * priced, or with a quantity that does not divide at the item's scale, shows a
 * NAMED STATE and no number. A real zero is a price and stays readable.
 *
 * THE ARITHMETIC IS THE SERVER'S OWN. `merchant.explode_inventory_recipe` in
 * `76_recipes_inventory.sql` and `plateCostMinor` in
 * `apps/umi-api/src/modules/inventory-costing/inventory-costing-domain.ts` fix
 * the two formulas repeated here:
 *
 *   - the quantity of a component per ONE unit of yield, at the item's scale, is
 *     quantity x conversionNumerator x 10^(yieldScale + itemScale)
 *     divided by yieldQuantity x conversionDenominator x 10^quantityScale;
 *   - the cost is that quantity x the item's unit cost, rounded half up ONCE for
 *     the whole recipe, never per line.
 *
 * A preview that disagreed with that arithmetic would move the number on the
 * save, and a number that moves on the save is the defect the live cost exists
 * to prevent.
 */

import { formatScaled } from './inventory-model.js';

const MAX_SAFE = 9007199254740991n;

/** A scale the database stores: 0 to 6. Anything else reads as 0. */
function scaleOf(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return 0;
  return Math.min(number, 6);
}

/**
 * 10 to a non-negative integer power. The exponent is NOT clamped to the item
 * scale: the explosion multiplies by `10^(yieldScale + itemScale)`, which can be
 * 10^12.
 */
export function pow10(exponent) {
  const number = Number(exponent);
  if (!Number.isInteger(number) || number < 0) return 1n;
  return 10n ** BigInt(number);
}

/** A non-negative integer as a BigInt, from a number, a string or a BigInt. */
function toCount(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'bigint') return value >= 0n && value <= MAX_SAFE ? value : null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return BigInt(number);
}

/**
 * A positive scaled quantity, which is what a yield and a component line are.
 * Null when the value is absent, zero, negative or not an integer: zero is not a
 * quantity, and a zero yield would price every batch as free.
 */
function readPositiveQuantity(quantity) {
  if (!quantity) return null;
  const value = toCount(quantity.value);
  if (value === null || value <= 0n) return null;
  return { value, scale: scaleOf(quantity.scale), unit: quantity.unit || null };
}

/** True when the payload is a quantity the database and the contract accept. */
export function yieldIsValid(quantity) {
  return readPositiveQuantity(quantity) !== null;
}

/** A value from a Map or from a plain object, without throwing on a missing key. */
function lookup(source, key) {
  if (!key || !source) return null;
  if (source instanceof Map) return source.get(key) ?? null;
  const found = source[key];
  return found === undefined ? null : found;
}

/**
 * `numerator / denominator` rounded half away from zero, in integers. It is the
 * platform's money rule; the API has the same function in
 * `inventory-costing-domain.ts`.
 */
export function divideRoundHalfUp(numerator, denominator) {
  if (denominator <= 0n) throw new Error('divideRoundHalfUp needs a positive denominator');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}

/**
 * One component's quantity per ONE unit of yield, at the item's own scale.
 *
 * `exact` is the question the server answers before it prices anything: the
 * rational either lands on a whole unit at this item's scale, or the recipe is
 * one the sale path would refuse, and no cost is published for it.
 */
export function componentBaseQuantity(component, yieldQuantity, itemScale) {
  const quantity = readPositiveQuantity(component && component.quantity);
  const yieldQ = readPositiveQuantity(yieldQuantity);
  const numeratorFactor = toCount(
    component && component.conversionNumerator != null ? component.conversionNumerator : 1,
  );
  const denominatorFactor = toCount(
    component && component.conversionDenominator != null ? component.conversionDenominator : 1,
  );
  if (
    !quantity ||
    !yieldQ ||
    numeratorFactor === null ||
    numeratorFactor <= 0n ||
    denominatorFactor === null ||
    denominatorFactor <= 0n
  ) {
    return { state: 'invalid', value: null };
  }
  const numerator = quantity.value * numeratorFactor * pow10(yieldQ.scale + scaleOf(itemScale));
  const denominator = yieldQ.value * denominatorFactor * pow10(quantity.scale);
  if (numerator % denominator !== 0n) return { state: 'not_exact', value: null };
  return { state: 'exact', value: numerator / denominator };
}

/**
 * The cost of ONE WHOLE base unit of an item, as a rational in minor units.
 *
 * A PRODUCED ITEM IS CHARGED THROUGH ITS OWN RECIPE, and never through its own
 * receipt basis as well: plan D5 rolls a sub-recipe's cost up into everything that
 * consumes it, and the server's explosion prices the raw items a prep reaches. A
 * bought ingredient is charged its receipt basis, which is what the supplier
 * actually charged.
 */
function unitCostFor(item, unitCostMinorByItemId, subRecipeByItemId) {
  const sub = lookup(subRecipeByItemId, item.id);
  if (sub) {
    const cost = toCount(sub.costMinor);
    const yieldQuantity = readPositiveQuantity(sub.yieldQuantity);
    if (cost === null || !yieldQuantity) return null;
    return { numerator: cost * pow10(yieldQuantity.scale), denominator: yieldQuantity.value };
  }

  const basis = toCount(lookup(unitCostMinorByItemId, item.id));
  if (basis !== null) return { numerator: basis, denominator: 1n };
  return null;
}

/**
 * The live arithmetic the editor shows before a save.
 *
 * Returns a NAMED STATE, never a zero for an unknown:
 *
 *   costed    every line divides and every line has a cost; `costMinor` is the
 *             cost of ONE unit of yield, and `marginMinor` needs a price;
 *   not_exact a line does not divide at the item's scale, so no cost exists;
 *   no_cost   a line has no cost basis and no sub-recipe cost to roll up;
 *   empty     no line names an item yet.
 *
 * `notExact` and `missingCost` name the items, because a person can only fix what
 * the screen names.
 */
export function recipeCostPreview(input) {
  const yieldQuantity = input && input.yieldQuantity;
  const components = Array.isArray(input && input.components) ? input.components : [];
  const itemsById = (input && input.itemsById) || null;
  const unitCostMinorByItemId = (input && input.unitCostMinorByItemId) || null;
  const subRecipeByItemId = (input && input.subRecipeByItemId) || null;
  const priceMinor = toCount(input && input.priceMinor);

  const notExact = [];
  const missingCost = [];
  let sumNumerator = 0n;
  let sumDenominator = 1n;
  let lines = 0;

  for (const component of components) {
    const itemId = component && component.inventoryItemId;
    const item = lookup(itemsById, itemId);
    if (!item) continue;
    lines += 1;
    const quantity = componentBaseQuantity(component, yieldQuantity, item.quantityScale);
    if (quantity.state !== 'exact') {
      notExact.push(itemId);
      continue;
    }
    const unitCost = unitCostFor(item, unitCostMinorByItemId, subRecipeByItemId);
    if (!unitCost) {
      missingCost.push(itemId);
      continue;
    }
    const termNumerator = quantity.value * unitCost.numerator;
    const termDenominator = pow10(scaleOf(item.quantityScale)) * unitCost.denominator;
    sumNumerator = sumNumerator * termDenominator + termNumerator * sumDenominator;
    sumDenominator *= termDenominator;
  }

  let state = 'costed';
  if (lines === 0) state = 'empty';
  else if (notExact.length > 0) state = 'not_exact';
  else if (missingCost.length > 0) state = 'no_cost';

  if (state !== 'costed') {
    return {
      state,
      costMinor: null,
      marginMinor: null,
      marginBasisPoints: null,
      notExact,
      missingCost,
    };
  }

  const costMinor = Number(divideRoundHalfUp(sumNumerator, sumDenominator));
  const margin = priceMinor === null ? null : recipeMargin(priceMinor, costMinor);
  return {
    state,
    costMinor,
    marginMinor: margin ? margin.marginMinor : null,
    marginBasisPoints: margin ? margin.marginBasisPoints : null,
    notExact,
    missingCost,
  };
}

/**
 * Margin against the price. It can be NEGATIVE, and that is information: a plate
 * sold below the cost of its ingredients is what this surface exists to show. A
 * price of zero has no percentage, because every percentage of zero is a lie.
 */
export function recipeMargin(priceMinor, costMinor) {
  const price = toCount(priceMinor);
  const cost = toCount(costMinor);
  if (price === null || cost === null) return null;
  const marginMinor = Number(price - cost);
  const marginBasisPoints =
    price === 0n ? null : Number(divideRoundHalfUp((price - cost) * 10_000n, price));
  return { marginMinor, marginBasisPoints };
}

/**
 * A sub-recipe is an item, and its own recipe says so (plan D1). This is the
 * answer the editor needs to offer the item as a SUB-RECIPE and to show
 * `usedInRecipeCount`, the number of other recipes that name it.
 */
export function subRecipeHint(itemId, recipes) {
  if (!itemId) return null;
  const recipe = (Array.isArray(recipes) ? recipes : []).find(
    (entry) => entry && entry.targetItemId === itemId && entry.active !== false,
  );
  if (!recipe) return null;
  const count = Number(recipe.usedInRecipeCount);
  return {
    recipeId: recipe.id,
    usedInRecipeCount: Number.isFinite(count) && count > 0 ? count : 0,
    recipe,
  };
}

/**
 * The cost to roll up for each item that is itself produced.
 *
 * A sub-recipe is only usable when it yields the item's OWN base unit. A
 * sub-recipe measured in kilograms for an item held in grams needs a unit
 * conversion, and assuming one would print a cost off by a factor of a thousand.
 * The unknown case stays unknown on purpose.
 */
export function subRecipeCostByItemId(recipes, itemsById) {
  const byItemId = new Map();
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    if (!recipe || !recipe.targetItemId) continue;
    if (recipe.active === false) continue;
    const item = lookup(itemsById, recipe.targetItemId);
    if (!item) continue;
    const yieldQuantity = readPositiveQuantity(recipe.yieldQuantity);
    if (!yieldQuantity) continue;
    if (yieldQuantity.unit && item.baseUnit && yieldQuantity.unit !== item.baseUnit) continue;
    byItemId.set(recipe.targetItemId, {
      // Null is kept: it says "produced, and not priced yet", which is not the same
      // answer as "bought, and priced".
      costMinor: recipe.costMinor == null ? null : recipe.costMinor,
      yieldQuantity: recipe.yieldQuantity,
    });
  }
  return byItemId;
}

/**
 * A scaled integer from the text a person typed in the item's unit.
 *
 * "12.5" at scale 2 is 1250. More decimals than the item's scale is refused
 * rather than rounded: the operator can see the refusal, and the server stores
 * exactly what the screen showed.
 */
export function scaledQuantityText(text, scale) {
  const digits = scaleOf(scale);
  const trimmed = String(text == null ? '' : text).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > digits) return null;
  const value = BigInt(whole) * pow10(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (value <= 0n || value > MAX_SAFE) return null;
  return value;
}

/** "15 g" - a scaled quantity with the unit in the operator's language. */
export function yieldText(quantity, unitOf = (unit) => unit) {
  const read = readPositiveQuantity(quantity);
  if (!read) return null;
  const text = formatScaled(read.value, read.scale);
  return read.unit ? `${text} ${unitOf(read.unit)}` : text;
}

/**
 * A stored recipe as the editor's draft. The target is not part of the draft: an
 * update writes a new version of the same target, and the contract refuses a new
 * one (`InventoryRecipeUpdateRequest` carries no target).
 */
export function recipeToDraft(recipe) {
  return {
    yieldQuantity: (recipe && recipe.yieldQuantity) || null,
    shelfLifeDays: recipe && recipe.shelfLifeDays != null ? Number(recipe.shelfLifeDays) : null,
    components: ((recipe && recipe.components) || []).map((component) => ({
      key: component.id,
      inventoryItemId: component.inventoryItemId,
      quantity: component.quantity,
      conversionNumerator:
        component.conversionNumerator != null ? component.conversionNumerator : 1,
      conversionDenominator:
        component.conversionDenominator != null ? component.conversionDenominator : 1,
      roundingPolicy: component.roundingPolicy || 'exact',
      required: component.required !== false,
    })),
  };
}
