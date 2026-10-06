/**
 * Pure helpers for the console's Preparacion tab (recipes module plan 8.4, D13
 * and 11 Phase 3).
 *
 * No React and no JSX, so the list rules run in a test without a browser
 * (prep-model.spec.js). The screen decides the layout; this file decides the
 * numbers, the order and the words that belong to the data.
 *
 * THE ONE RULE. A prep quantity is a shortcut for a real work order. An item
 * with no par has NO work order, so the list says "sin par" instead of printing
 * a zero. A real zero is a par the cafe already meets, and that stays readable.
 *
 * The server owns the arithmetic: `prepQuantity` is par minus on hand minus the
 * forecast usage over the shelf-life window, floored at zero (plan D13). This
 * file never repeats that formula.
 */

import { t } from '@lingui/core/macro';
import { clampScale, formatScaled } from './inventory-model.js';

/** A scaled quantity as "1.5 kg". Null when the payload is absent. */
export function scaledQuantityText(quantity, unitOf = (unit) => unit) {
  if (!quantity) return null;
  const text = formatScaled(quantity.value, quantity.scale);
  if (text == null) return null;
  return quantity.unit ? `${text} ${unitOf(quantity.unit)}` : text;
}

/** A scaled quantity as BigInt at its own scale, for an exact comparison. */
function magnitude(quantity) {
  if (!quantity || quantity.value == null) return null;
  const value = Number(quantity.value);
  if (!Number.isFinite(value)) return null;
  return { value: BigInt(Math.trunc(value)), scale: clampScale(quantity.scale) };
}

/** Compares two magnitudes. Zero when they are equal. */
function compareMagnitudes(left, right) {
  const leftScaled = left.value * 10n ** BigInt(right.scale);
  const rightScaled = right.value * 10n ** BigInt(left.scale);
  if (leftScaled < rightScaled) return -1;
  if (leftScaled > rightScaled) return 1;
  return 0;
}

/**
 * The quantity-to-make cell. An item with no par has no work order, so the cell
 * is a NAMED state and never a zero. The quantity otherwise comes from the
 * server, which already floored it at zero.
 */
export function prepQuantityCell(item) {
  if (!item || item.parQuantity == null) return { state: 'no_par', quantity: null };
  return { state: 'quantity', quantity: item.prepQuantity || null };
}

function compareNames(left, right) {
  const leftName = String((left && left.displayName) || '');
  const rightName = String((right && right.displayName) || '');
  if (leftName < rightName) return -1;
  if (leftName > rightName) return 1;
  return 0;
}

/**
 * The kitchen order: largest quantity to make first. An item with no par has no
 * quantity, so it waits at the end. Equal quantities fall back to the name, so
 * the board keeps one order between reads.
 */
export function sortPrepItems(items) {
  const rows = Array.isArray(items) ? items.slice() : [];
  return rows.sort((left, right) => {
    const leftCell = prepQuantityCell(left);
    const rightCell = prepQuantityCell(right);
    const leftQuantity = leftCell.state === 'quantity' ? magnitude(leftCell.quantity) : null;
    const rightQuantity = rightCell.state === 'quantity' ? magnitude(rightCell.quantity) : null;
    if (leftQuantity && rightQuantity) {
      const compared = compareMagnitudes(rightQuantity, leftQuantity);
      if (compared !== 0) return compared;
    } else if (leftQuantity) {
      return -1;
    } else if (rightQuantity) {
      return 1;
    }
    return compareNames(left, right);
  });
}

/**
 * The window the forecast covered, from the response. The screen prints it, so
 * the operator reads which days the usage came from instead of guessing.
 */
export function forecastWindowText(from, to) {
  if (!from || !to) return null;
  return t`Uso previsto del ${String(from)} al ${String(to)}`;
}

/**
 * The name of the downloaded label sheet. A date in the name is what stops two
 * printed days from looking the same on disk.
 */
export function labelSheetFilename(when) {
  const date = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(date.getTime())) return 'etiquetas-preparacion.png';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `etiquetas-preparacion-${year}-${month}-${day}.png`;
}
