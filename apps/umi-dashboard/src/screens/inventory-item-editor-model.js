import { formatScaled } from './inventory-model.js';
import { scaledQuantityText } from './recipe-model.js';

/** Keep the draft in the item's unit, even when a new item's precision changes. */
export function itemQuantityDraft(item) {
  return {
    lowStockThreshold: formatScaled(item?.lowStockThreshold, item?.quantityScale) ?? '',
    parQuantity: formatScaled(item?.parQuantity, item?.quantityScale) ?? '',
  };
}

/** Null blocks a save. An empty field clears only that optional quantity. */
export function itemQuantityParameters(draft, scale) {
  const parameters = {};
  for (const key of ['lowStockThreshold', 'parQuantity']) {
    const text = String(draft[key] ?? '')
      .trim()
      .replace(',', '.');
    if (text === '') {
      parameters[key] = null;
      continue;
    }
    const value = scaledQuantityText(text, scale, { allowZero: true });
    if (value === null) return null;
    parameters[key] = Number(value);
  }
  return parameters;
}
