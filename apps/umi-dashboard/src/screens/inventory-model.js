/**
 * Pure helpers for the console's Inventario tab (recipes module plan §7).
 *
 * No React and no JSX, so the arithmetic and the list rules are tested without a
 * browser (inventory-model.spec.js). The screen decides the words; this file
 * decides the numbers and the states.
 *
 * THE ONE RULE. A zero is data and an absent row is not. An item with an on-hand
 * row of zero HAS zero, and the list must say so. An item with no on-hand row for
 * this branch has NO READ, and the list must say that instead of printing zero.
 * The same rule holds for the optional item fields: a null threshold has no
 * value, and it must not render as `0`.
 */

const MAX_SAFE = 9007199254740991n;

/** A positive integer from `Number` input, an API string, or a BigInt. Null when invalid. */
function toPositiveInteger(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'bigint') return value > 0n && value <= MAX_SAFE ? value : null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return BigInt(number);
}

/** The item scale is 0..6, the database's own range. Anything else reads as 0. */
export function clampScale(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return 0;
  return Math.min(number, 6);
}

/**
 * A scaled integer as a decimal string: (value, 2) with 1333 reads "13.33".
 * Trailing zeros are trimmed, so (value, 3) with 1000 reads "1". BigInt keeps a
 * quantity near the safe-integer ceiling exact where a float would round it.
 */
export function formatScaled(value, scale) {
  if (value == null) return null;
  let big;
  try {
    big = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
  } catch {
    return null;
  }
  if (!Number.isFinite(Number(value)) || Number.isNaN(Number(value))) return null;
  const digits = clampScale(scale);
  const negative = big < 0n;
  const absolute = negative ? -big : big;
  const factor = 10n ** BigInt(digits);
  const whole = absolute / factor;
  const fraction = (absolute % factor).toString().padStart(digits, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${text}` : text;
}

/**
 * The decimal for `numerator / denominator` at `scale` digits, plus `extraDigits`
 * more. The extra digits are what a lossy conversion leaves behind: rounding
 * 1/3 away to a whole number in the preview would hide the very fraction the
 * `exact` policy refuses.
 */
function decimalText(numerator, denominator, scale, extraDigits = 4) {
  const digits = clampScale(scale) + Math.min(Math.max(Number(extraDigits) || 0, 0), 6);
  const scaled = (numerator * 10n ** BigInt(digits)) / denominator;
  const padded = scaled.toString().padStart(digits + 1, '0');
  const whole = padded.slice(0, padded.length - digits) || '0';
  const fraction = padded.slice(padded.length - digits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * One unit conversion, read as the API's own arithmetic does. The repository
 * converts a quantity in `fromUnit` into the item's base unit as
 * `value * numerator / denominator` at `targetScale`, so one `fromUnit` is
 * `numerator / denominator` of a `toUnit`.
 *
 * `divides` is the question the editor answers before the save: does one
 * `fromUnit` land on a whole `toUnit` at this scale? An `exact` conversion that
 * does not divide is the write the API refuses with
 * `INVENTORY_UNIT_CONVERSION_INVALID`, so the operator sees the answer first.
 */
export function conversionRatio(conversion) {
  const numerator = toPositiveInteger(conversion?.numerator);
  const denominator = toPositiveInteger(conversion?.denominator);
  if (!numerator || !denominator) return null;
  const targetScale = clampScale(conversion?.targetScale);
  const scaledNumerator = numerator * 10n ** BigInt(targetScale);
  const remainder = scaledNumerator % denominator;
  return {
    numerator,
    denominator,
    targetScale,
    divides: remainder === 0n,
    remainder,
    sampleText: decimalText(numerator, denominator, targetScale),
  };
}

/** True only when one `fromUnit` is a whole number of `toUnit` at the item scale. */
export function conversionDivides(conversion) {
  return conversionRatio(conversion)?.divides === true;
}

/**
 * "1 g = 0.001 kg" — the line the conversion list shows, and the live preview the
 * conversion form shows before the save. `unitOf` maps a unit key to the label in
 * the operator's language; the default keeps the raw key, for the tests.
 */
export function conversionSummary(conversion, unitOf = (unit) => unit) {
  const ratio = conversionRatio(conversion);
  if (!ratio || !conversion?.fromUnit || !conversion?.toUnit) return null;
  return `1 ${unitOf(conversion.fromUnit)} = ${ratio.sampleText} ${unitOf(conversion.toUnit)}`;
}

/**
 * The existing ACTIVE conversion for a `fromUnit -> toUnit` pair, or null. The
 * write's `targetVersion` comes from here: the first set for a pair has no
 * version to expect, and a later set must name the one it read.
 */
export function activeConversionFor(conversions, fromUnit, toUnit) {
  const matches = (conversions || []).filter(
    (conversion) =>
      conversion?.active !== false &&
      conversion?.fromUnit === fromUnit &&
      conversion?.toUnit === toUnit,
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, conversion) =>
    Number(conversion.version) > Number(best.version) ? conversion : best,
  );
}

/**
 * The item's conversions, from the item read and the flat conversions read, with
 * the item read's own copy winning. Two readers can answer, and the item's own
 * list is the one the edit just changed.
 */
export function mergeConversions(item, flatConversions) {
  const merged = new Map();
  for (const conversion of Array.isArray(item?.conversions) ? item.conversions : []) {
    if (conversion?.id) merged.set(conversion.id, conversion);
  }
  for (const conversion of Array.isArray(flatConversions) ? flatConversions : []) {
    if (conversion?.id && conversion.inventoryItemId === item?.id && !merged.has(conversion.id)) {
      merged.set(conversion.id, conversion);
    }
  }
  return [...merged.values()].sort((a, b) => {
    const from = String(a.fromUnit).localeCompare(String(b.fromUnit));
    if (from !== 0) return from;
    const to = String(a.toUnit).localeCompare(String(b.toUnit));
    if (to !== 0) return to;
    return Number(b.version) - Number(a.version);
  });
}

/**
 * The on-hand cell for one item. `locationId` is the branch the console is
 * scoped to. Without one, the cell totals the branches the read returned and says
 * how many it counted.
 *
 * State `empty` is the case the screen must NOT print as zero: the read returned
 * no row for this branch, so the balance is unknown, not zero.
 */
export function onHandDisplay(item, locationId) {
  const scale = clampScale(item?.quantityScale);
  const rows = Array.isArray(item?.onHand) ? item.onHand : [];
  if (item?.trackingPolicy === 'not_tracked') {
    return { state: 'not_tracked', text: null, value: null, count: rows.length };
  }
  if (locationId) {
    const row = rows.find((entry) => entry?.locationId === locationId);
    if (!row || row.onHand == null) return { state: 'empty', text: null, value: null, count: 0 };
    return { state: 'value', text: formatScaled(row.onHand, scale), value: row.onHand, count: 1 };
  }
  if (rows.length === 0) return { state: 'empty', text: null, value: null, count: 0 };
  const total = rows.reduce((sum, row) => sum + Number(row?.onHand || 0), 0);
  return {
    state: rows.length === 1 ? 'value' : 'total',
    text: formatScaled(total, scale),
    value: total,
    count: rows.length,
  };
}

/** A null optional number reads as its named empty state, never as zero. */
export function optionalText(value, format, emptyText) {
  if (value == null) return emptyText;
  return typeof format === 'function' ? format(value) : String(value);
}

/** The list query: active by default, archived on request, and a name/reference search. */
export function filterItems(items, options = {}) {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!options.includeArchived && item?.active === false) return false;
    if (!query) return true;
    return [item?.displayName, item?.publicReference].some((value) =>
      String(value || '')
        .toLowerCase()
        .includes(query),
    );
  });
}

/** A stable name order, so a re-read does not reshuffle the table. */
export function sortItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const byName = String(a?.displayName || '').localeCompare(String(b?.displayName || ''));
    if (byName !== 0) return byName;
    return String(a?.publicReference || '').localeCompare(String(b?.publicReference || ''));
  });
}

/** The database's own `inventory_allergen.code` rule, checked before the write. */
export function allergenCodeValid(code) {
  return /^[a-z][a-z0-9_]{1,39}$/.test(String(code || ''));
}
