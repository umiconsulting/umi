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

/* ============================================================
   THE WORKBENCH RULES (redesign plan §3, §5)

   These functions decide the state of one item and the shape of the list. They
   hold every rule the screen would otherwise spread through JSX, so the rules are
   testable without a browser.

   The model returns KEYS, never sentences. The screen owns the words, because the
   words are translated and the arithmetic is not.
   ============================================================ */

/** The saved views, in the order the chip row renders them. */
export const VIEW_KEYS = ['all', 'low_stock', 'no_cost', 'no_balance', 'archived'];

/**
 * Polaris states the page size twice — once for the index table and once for the
 * resource list. Fifty is the number it states.
 */
export const PAGE_SIZE = 50;

/** The attention queue caps at five. A sixth entry would become a second list. */
export const ATTENTION_CAP = 5;

/**
 * The state of one item, as facts. No sentence, no colour, no element.
 *
 * `stockState` is the one ordered vocabulary in this file:
 *   `archived`   — the item is retired
 *   `not_tracked`— the item is not counted, by policy
 *   `unknown`    — the read returned no balance row for this branch. NOT zero.
 *   `out`        — the balance is exactly zero
 *   `low`        — the balance is at or below the item's own threshold
 *   `ok`         — the balance is above the threshold, or no threshold is set
 */
export function itemSignals(item, locationId, costedIds) {
  const onHand = onHandDisplay(item, locationId);
  const threshold = item?.lowStockThreshold == null ? null : Number(item.lowStockThreshold);
  const value = onHand.value == null ? null : Number(onHand.value);
  const hasCost = costedIds instanceof Set ? costedIds.has(item?.id) : false;
  let stockState = 'ok';
  if (item?.active === false) stockState = 'archived';
  else if (item?.trackingPolicy === 'not_tracked') stockState = 'not_tracked';
  else if (onHand.state === 'empty') stockState = 'unknown';
  else if (value === 0) stockState = 'out';
  else if (threshold != null && value != null && value <= threshold) stockState = 'low';
  return { onHand, value, threshold, stockState, hasCost, unit: item?.baseUnit ?? null };
}

/**
 * What the item needs, most important first. The screen renders the first need as
 * the row action and the rest in the row menu, which is why the order is fixed
 * here rather than at the call site.
 */
export function itemNeeds(signals) {
  const needs = [];
  if (signals.stockState === 'archived') return ['activate'];
  if (signals.stockState === 'unknown') needs.push('count');
  if (signals.stockState === 'out' || signals.stockState === 'low') needs.push('review_stock');
  if (!signals.hasCost) needs.push('set_cost');
  if (signals.stockState === 'not_tracked') needs.push('enable_tracking');
  return needs;
}

/**
 * The single action a row shows at rest, or `null` when the row is healthy.
 *
 * Decision D4: a healthy row shows no button until the pointer or the focus
 * arrives. A row that needs something shows its verb at rest. Fifty competing
 * buttons would stop the eye from reading the list.
 */
export function rowActionFor(signals) {
  const needs = itemNeeds(signals);
  return needs.length === 0 ? null : needs[0];
}

/** Does the item belong to the view? `all` is the archive-off default. */
export function matchesView(signals, view) {
  switch (view) {
    case 'low_stock':
      return signals.stockState === 'low' || signals.stockState === 'out';
    case 'no_cost':
      return !signals.hasCost && signals.stockState !== 'archived';
    case 'no_balance':
      return signals.stockState === 'unknown';
    case 'archived':
      return signals.stockState === 'archived';
    default:
      return signals.stockState !== 'archived';
  }
}

/**
 * One count per view, over one pass of the list. The chip row renders the count
 * beside the name, and the two must agree with the rows the view returns, so both
 * come from this function.
 */
export function viewCounts(items, locationId, costedIds) {
  const counts = Object.fromEntries(VIEW_KEYS.map((key) => [key, 0]));
  for (const item of Array.isArray(items) ? items : []) {
    const signals = itemSignals(item, locationId, costedIds);
    for (const key of VIEW_KEYS) {
      if (matchesView(signals, key)) counts[key] += 1;
    }
  }
  return counts;
}

/**
 * The attention queue. One entry per real question, each with the count and the
 * view that answers it. The order is the order of harm: a missing cost breaks the
 * margin report, an unknown balance breaks the sale.
 */
const ATTENTION_ORDER = [
  { key: 'no_balance', view: 'no_balance', action: 'count' },
  { key: 'low_stock', view: 'low_stock', action: 'review_stock' },
  { key: 'no_cost', view: 'no_cost', action: 'set_cost' },
];

export function attentionQueue(counts, cap = ATTENTION_CAP) {
  return ATTENTION_ORDER.filter((entry) => Number(counts?.[entry.key] || 0) > 0)
    .map((entry) => ({ ...entry, count: Number(counts[entry.key]) }))
    .slice(0, cap);
}

/** The list query: the view, then the search, then the archive rule. */
export function filterByView(items, view, locationId, costedIds, options = {}) {
  const includeArchived = view === 'archived';
  const searched = filterItems(items, { query: options.query, includeArchived });
  return searched.filter((item) => matchesView(itemSignals(item, locationId, costedIds), view));
}

/** A stable page slice, plus the range the footer prints. */
export function paginate(list, page, size = PAGE_SIZE) {
  const rows = Array.isArray(list) ? list : [];
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const from = current * size;
  const slice = rows.slice(from, from + size);
  return {
    rows: slice,
    page: current,
    pages,
    total,
    from: total === 0 ? 0 : from + 1,
    to: from + slice.length,
  };
}

/**
 * Urgency order for the attention views: the worst stock state first, then the
 * name. The default list keeps the name order, because a re-read must not
 * reshuffle the list under the pointer.
 */
const URGENCY_RANK = { out: 0, low: 1, unknown: 2, ok: 3, not_tracked: 4, archived: 5 };

export function sortByUrgency(items, locationId, costedIds) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const left = itemSignals(a, locationId, costedIds);
    const right = itemSignals(b, locationId, costedIds);
    const rank = URGENCY_RANK[left.stockState] - URGENCY_RANK[right.stockState];
    if (rank !== 0) return rank;
    const cost = Number(left.hasCost) - Number(right.hasCost);
    if (cost !== 0) return cost;
    return String(a?.displayName || '').localeCompare(String(b?.displayName || ''));
  });
}
