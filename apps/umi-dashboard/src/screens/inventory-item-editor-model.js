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

/** Parse decimal text without a binary floating-point money calculation. */
export function parseInitialCost(text) {
  const normalized = String(text ?? '')
    .trim()
    .replace(',', '.');
  if (normalized === '') return { valid: true, value: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return { valid: false, value: null };
  const [whole, fraction = ''] = normalized.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return { valid: false, value: null };
  return { valid: true, value: Number(minor) };
}

export function initialCostDraft(value) {
  if (value == null) return '';
  const minor = BigInt(value);
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

/** Omit an unchanged amount. Null explicitly clears a saved amount. */
export function initialCostParameters(text, item) {
  const parsed = parseInitialCost(text);
  if (!parsed.valid) return null;
  if (item && parsed.value === (item.initialUnitCostMinor ?? null)) return {};
  return { initialUnitCostMinor: parsed.value };
}

/** Preserve a saved policy when the editor opens. */
export function itemNegativeStockPolicy(item) {
  return item ? item.negativeStockPolicy || 'block' : 'allow_and_flag';
}
