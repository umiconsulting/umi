/**
 * Pure helpers for the console's Variacion and Ingenieria de menu tabs (recipes
 * module plan 9.3, 9.5, D7 and D16, phase 4).
 *
 * No React and no JSX, so the arithmetic runs in a test without a browser
 * (variance-model.spec.js). The screen decides the layout; this file decides the
 * order, the check and the chip.
 *
 * THE ONE RULE. Actual usage minus theoretical usage is a single number, and a
 * single number hides the reason (plan D7). The report names the parts: waste,
 * damage, count correction and yield loss. What is left over is the unexplained
 * remainder, and that remainder is what the owner acts on. So this file sorts by
 * it and the screen makes it the loudest number in the row.
 *
 * THE ARITHMETIC IS THE SERVER'S. The read states `varianceQuantity` and each
 * named part. This file never re-derives a variance from the ledger; it checks
 * that the answer adds up, and it refuses to show a number the answer did not
 * fully account for.
 */

import { msg } from '@lingui/core/macro';
import { formatMoney } from '@/lib/format.js';
import { clampScale, formatScaled } from './inventory-model.js';

/** The four named effects, in the order the report reads them. */
export const NAMED_VARIANCE_KEYS = [
  'wasteQuantity',
  'damageQuantity',
  'countCorrectionQuantity',
  'yieldLossQuantity',
];

/** Every part of the decomposition, the unexplained remainder included. */
export const DECOMPOSITION_KEYS = [...NAMED_VARIANCE_KEYS, 'unexplainedQuantity'];

/** The five menu classes, in the stable order the report shows them. */
export const MENU_CLASS_ORDER = ['star', 'plow_horse', 'puzzle', 'dog', 'unclassified'];

/**
 * The class chip uses the tones the app already has. A star is good news, a plow
 * horse is a normal seller with thin money, a puzzle needs visibility, a dog needs
 * a decision, and an item nobody can cost has no class at all.
 */
export const MENU_CLASS_TONE = {
  star: 'active',
  plow_horse: 'info',
  puzzle: 'trial',
  dog: 'susp',
  unclassified: 'neutral',
};

/** What the basis of the variance read means, in the words the operator uses. */
const BASIS_LABEL = {
  available_stock: msg`existencia disponible`,
};

/** The label for the variance basis, or null when the answer named a new one. */
export function basisLabel(basis) {
  return BASIS_LABEL[basis] ?? null;
}

// ── scaled integers ─────────────────────────────────────────────────────────
//
// Every quantity is `{ value, scale, unit }`, and `value` is an integer at that
// scale: 1500 at scale 3 is 1.5. Two lines can carry different scales, so a
// comparison re-expresses both at one scale and does the arithmetic in BigInt.
// A float would lose a unit at the safe-integer ceiling, and a lost unit is how
// a decomposition stops adding up.

function toBig(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'bigint') return value;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) return null;
  return BigInt(number);
}

function absBig(value) {
  return value < 0n ? -value : value;
}

/** A scaled quantity re-expressed at `scale`, exactly. Null when it is absent. */
export function scaledAtScale(quantity, scale) {
  const value = toBig(quantity && quantity.value);
  if (value == null) return null;
  const from = clampScale(quantity && quantity.scale);
  const to = clampScale(scale);
  if (to === from) return value;
  if (to > from) return value * 10n ** BigInt(to - from);
  return value / 10n ** BigInt(from - to);
}

/**
 * The scale the line's own numbers are read at. The line states one, and the
 * quantities state theirs; the widest of them keeps every digit.
 */
export function lineScale(line) {
  let scale = clampScale(line && line.quantityScale);
  for (const key of ['varianceQuantity', ...DECOMPOSITION_KEYS]) {
    const quantity = line && line[key];
    if (quantity && quantity.scale != null) {
      scale = Math.max(scale, clampScale(quantity.scale));
    }
  }
  return scale;
}

/** Compares two scaled quantities. Negative when `left` reads first (ascending). */
function compareScaled(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  const leftScale = clampScale(left.scale);
  const rightScale = clampScale(right.scale);
  const leftValue = toBig(left.value);
  const rightValue = toBig(right.value);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const compared = leftValue * 10n ** BigInt(rightScale) - rightValue * 10n ** BigInt(leftScale);
  if (compared < 0n) return -1;
  if (compared > 0n) return 1;
  return 0;
}

/** Compares two scaled quantities by size, ignoring the sign. */
function compareScaledSize(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return compareScaled(
    { value: absBig(toBig(left.value) ?? 0n), scale: left.scale },
    { value: absBig(toBig(right.value) ?? 0n), scale: right.scale },
  );
}

function compareNames(left, right) {
  const leftName = String((left && left.displayName) || '');
  const rightName = String((right && right.displayName) || '');
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

// ── the variance decomposition ──────────────────────────────────────────────

/**
 * The check D7 promises: variance equals waste plus damage plus count correction
 * plus yield loss plus the unexplained remainder, in the scaled integers the
 * server sent. A residual that is not zero means the answer does not add up, and
 * the screen says so instead of showing a remainder it cannot stand behind.
 */
export function decompositionCheck(line) {
  const scale = lineScale(line);
  const variance = scaledAtScale(line && line.varianceQuantity, scale);
  if (variance == null) return { balanced: false, residual: null, scale };
  let sum = 0n;
  for (const key of DECOMPOSITION_KEYS) {
    const part = scaledAtScale(line && line[key], scale);
    if (part == null) return { balanced: false, residual: null, scale };
    sum += part;
  }
  const residual = variance - sum;
  return { balanced: residual === 0n, residual: { value: residual, scale }, scale };
}

/** True when the named parts and the remainder add up to the variance. */
export function decompositionBalances(line) {
  return decompositionCheck(line).balanced;
}

/** Variance minus the four named effects. The remainder the read should report. */
export function derivedUnexplained(line) {
  const scale = lineScale(line);
  const variance = scaledAtScale(line && line.varianceQuantity, scale);
  if (variance == null) return null;
  let named = 0n;
  for (const key of NAMED_VARIANCE_KEYS) {
    const part = scaledAtScale(line && line[key], scale);
    if (part == null) return null;
    named += part;
  }
  return { value: variance - named, scale };
}

/**
 * How alarming the unexplained remainder is.
 *
 * `none`    nothing is unexplained, so the named effects account for the line;
 * `low`     the remainder is a minor part of the variance;
 * `high`    the remainder is at least half of the variance, or the variance is
 *           zero while a remainder is reported. This is the number to act on;
 * `unknown` the answer did not carry a remainder.
 */
export function unexplainedSeverity(line) {
  const scale = lineScale(line);
  const unexplained = scaledAtScale(line && line.unexplainedQuantity, scale);
  if (unexplained == null) return 'unknown';
  if (unexplained === 0n) return 'none';
  const variance = scaledAtScale(line && line.varianceQuantity, scale);
  if (variance == null) return 'unknown';
  if (variance === 0n) return 'high';
  const share = Number(absBig(unexplained)) / Number(absBig(variance));
  return share >= 0.5 ? 'high' : 'low';
}

/**
 * The report order: the largest unexplained remainder first.
 *
 * "Largest" is the size, not the sign. A large negative remainder is the same
 * defect seen from the other side, because the sales say more stock was used
 * than the ledger shows. An owner who sorted by the signed number alone would never
 * see it. Ties put the positive remainder first, and lines with no remainder last.
 */
export function sortVarianceLines(lines) {
  const rows = Array.isArray(lines) ? lines.slice() : [];
  return rows.sort((left, right) => {
    const leftRemainder = left && left.unexplainedQuantity;
    const rightRemainder = right && right.unexplainedQuantity;
    const bySize = compareScaledSize(rightRemainder, leftRemainder);
    if (bySize !== 0) return bySize;
    const bySign = compareScaled(rightRemainder, leftRemainder);
    if (bySign !== 0) return bySign;
    return compareNames(left, right);
  });
}

/** How many lines carry a remainder, and how many of them are large. */
export function varianceCounts(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  let high = 0;
  let explained = 0;
  for (const line of rows) {
    const severity = unexplainedSeverity(line);
    if (severity === 'high') high += 1;
    else if (severity === 'none') explained += 1;
  }
  return { all: rows.length, high, explained };
}

// ── menu engineering (plan D16 and 9.5) ─────────────────────────────────────

/** The tone the class chip uses, from the app's existing badge tones. */
export function menuClassTone(classification) {
  return MENU_CLASS_TONE[classification] ?? MENU_CLASS_TONE.unclassified;
}

/** Where a class sits in the stable visual order. An unknown class reads last. */
export function menuClassRank(classification) {
  const index = MENU_CLASS_ORDER.indexOf(classification);
  return index === -1 ? MENU_CLASS_ORDER.length : index;
}

/**
 * The menu order: the four classes in their stable order, and inside a class the
 * biggest margin first. An item nobody can cost has no margin and waits at the
 * end of its class. The name breaks a tie so the table keeps one order between
 * reads.
 */
export function sortMenuItems(items) {
  const rows = Array.isArray(items) ? items.slice() : [];
  return rows.sort((left, right) => {
    const byClass =
      menuClassRank(left && left.classification) - menuClassRank(right && right.classification);
    if (byClass !== 0) return byClass;
    const leftMargin = toBig(left && left.marginMinor);
    const rightMargin = toBig(right && right.marginMinor);
    if (leftMargin != null && rightMargin != null && leftMargin !== rightMargin) {
      return rightMargin > leftMargin ? 1 : -1;
    }
    if (leftMargin == null && rightMargin != null) return 1;
    if (leftMargin != null && rightMargin == null) return -1;
    const bySold =
      Number((right && right.soldQuantity) || 0) - Number((left && left.soldQuantity) || 0);
    if (bySold !== 0) return bySold;
    const leftName = String((left && left.productName) || '');
    const rightName = String((right && right.productName) || '');
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
}

/**
 * The money a plate cost renders as. A cost the server did not price is NOT
 * zero: the class of that item is `unclassified` and its cell names the missing
 * recipe. So the answer is null, and the screen shows the named state.
 */
export function menuCostText(plateCostMinor, format = formatMoney) {
  if (plateCostMinor == null || !Number.isFinite(Number(plateCostMinor))) return null;
  return format(plateCostMinor);
}

/** The same rule for a margin, which can also legitimately be zero. */
export function menuMarginText(marginMinor, format = formatMoney) {
  return menuCostText(marginMinor, format);
}

// ── quantity text ───────────────────────────────────────────────────────────

/** A scaled quantity as "1.5 kg", with the unit the payload carries. */
export function quantityText(quantity, unitOf = (unit) => unit) {
  if (!quantity) return null;
  const text = formatScaled(quantity.value, quantity.scale);
  if (text == null) return null;
  return quantity.unit ? `${text} ${unitOf(quantity.unit)}` : text;
}

/**
 * A signed quantity as "+1.5 kg" or "-1.5 kg". The sign is part of the fact: a
 * positive variance means the kitchen used more than the sales say.
 */
export function signedQuantityText(quantity, unitOf = (unit) => unit) {
  const text = quantityText(quantity, unitOf);
  if (text == null) return null;
  if (text.startsWith('-')) return text;
  const value = toBig(quantity && quantity.value);
  return value != null && value > 0n ? `+${text}` : text;
}
