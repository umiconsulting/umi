/**
 * The costing screen's arithmetic, as pure functions.
 *
 * WHY THIS IS A SEPARATE MODULE. The screen exists because of D47: the day read once
 * reported cost 0 and a 100 percent margin for a café that had no recipes, because a
 * zero stood in for an unknown. The rule that prevents a repeat is "never render a
 * number the server did not fully price", and a rule like that has to be in one place
 * a test can reach — not scattered through a JSX tree where the only way to check it
 * is to render the whole console.
 *
 * SO: every function here that could produce a cost or a margin returns `null` when
 * the server did not fully price the thing it is about, and the screen renders a
 * named state for that `null` rather than a dash or a zero. `null` is not a formatting
 * detail in this file; it is the answer.
 *
 * The unit of money is the centavo (the contract's integer minor units) and the unit
 * of a quantity is `{ value, scale }` — `value` 12000 at `scale` 3 is 12.000 base
 * units. Nothing here divides a quantity by its scale except `scaledToNumber`, which
 * exists for display and is the only place a float appears.
 */

/** The range the screen opens on, and the window the plan names for the forecast. */
export const DEFAULT_RANGE_DAYS = 28;

/** The ranges a person actually asks for. */
export const RANGE_CHOICES = [7, 14, 28];

/**
 * A scaled quantity as a JS number, for display only.
 *
 * `value` is a `safe` integer on the wire, so the division is exact down to the
 * scales the platform allows (max 6), and the result is only ever used to feed
 * `Intl.NumberFormat`. Returns null for anything that is not a quantity, so a
 * missing field reads as missing rather than as zero.
 */
export function scaledToNumber(quantity) {
  if (!quantity || typeof quantity.value !== 'number' || typeof quantity.scale !== 'number') {
    return null;
  }
  return quantity.value / 10 ** quantity.scale;
}

/** Is this plate fully priced? The server's own verdict, not a guess from the fields. */
export function plateIsCosted(plate) {
  return plate?.state === 'complete' && plate.costMinor != null && plate.marginMinor != null;
}

/**
 * A plate's margin, or null.
 *
 * A plate the server reported `incomplete` or `not_costed` has NO margin — not a zero
 * one — and this returns null for it even if a margin field somehow arrived, because
 * the state is the server's statement about its own numbers and it wins.
 */
export function plateMargin(plate) {
  if (!plateIsCosted(plate)) return null;
  return {
    marginMinor: plate.marginMinor,
    marginBasisPoints: plate.marginBasisPoints ?? null,
  };
}

/** Is this day fully priced? Same rule, one level up. */
export function dayIsCosted(day) {
  return day?.state === 'complete' && day.costMinor != null && day.marginMinor != null;
}

export function dayMargin(day) {
  if (!dayIsCosted(day)) return null;
  return {
    marginMinor: day.marginMinor,
    marginBasisPoints: day.marginBasisPoints ?? null,
  };
}

/** Basis points as a percentage number (9178 bps is 91.78), or null. */
export function basisPointsToPercent(basisPoints) {
  if (basisPoints == null || !Number.isFinite(Number(basisPoints))) return null;
  return Number(basisPoints) / 100;
}

/**
 * A business date, formatted as the day it is.
 *
 * `new Date('2026-09-16')` is UTC midnight, and rendering that with a locale format in
 * Mexico's timezone (UTC-7) prints the 15th. A business date is a NAME for a day, not
 * an instant — the day a sale was rung up belongs to the café — so it is read as its
 * own three numbers and formatted in UTC, where no shift can happen. Returns null for
 * anything that is not a plain business date, so a caller renders a state rather than
 * "Invalid Date".
 */
export function formatBusinessDate(
  iso,
  tag = 'es-MX',
  options = { day: 'numeric', month: 'short' },
) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!parts) return null;
  const date = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
  return new Intl.DateTimeFormat(tag, { ...options, timeZone: 'UTC' }).format(date);
}

/**
 * The period's totals, and the honest verdict on them.
 *
 * REVENUE AND COUNTS ALWAYS SUM: they come from receipts, which are facts whether or
 * not anybody recorded what the products consume. COST AND MARGIN SUM ONLY WHEN EVERY
 * DAY IN THE WINDOW THAT SOLD SOMETHING IS FULLY PRICED. A period whose cost is the
 * total of eight costed days and omits two untracked ones is not "the period's cost",
 * and reporting it with the period's revenue beside it produces exactly the
 * hundred-percent margin D47 was written about.
 *
 * So: `costMinor` and `marginMinor` are null unless every trading day is costed, and
 * `uncostedDays` plus `uncostedProducts` say what to fix. A day with no sales is not
 * uncosted — it is a day that did not trade, and it contributes nothing.
 */
export function summarizeDays(days) {
  const list = Array.isArray(days) ? days : [];
  const trading = list.filter((day) => day.salesCount > 0 || day.revenueMinor > 0);
  const uncosted = trading.filter((day) => !dayIsCosted(day));

  const total = (pick) => trading.reduce((sum, day) => sum + (Number(pick(day)) || 0), 0);
  const uncostedProducts = new Map();
  for (const day of uncosted) {
    for (const product of day.uncostedProducts ?? []) {
      uncostedProducts.set(product.productId, product);
    }
  }

  const complete = uncosted.length === 0 && trading.length > 0;
  return {
    days: trading.length,
    costedDays: trading.length - uncosted.length,
    uncostedDays: uncosted.length,
    uncostedProducts: [...uncostedProducts.values()],
    salesLinesWithoutMapping: trading.reduce(
      (sum, day) => sum + (Number(day.salesLinesWithoutMapping) || 0),
      0,
    ),
    revenueMinor: total((day) => day.revenueMinor),
    grandTotalMinor: total((day) => day.grandTotalMinor),
    salesCount: total((day) => day.salesCount),
    platesSold: total((day) => day.platesSold),
    costMinor: complete ? total((day) => day.costMinor) : null,
    marginMinor: complete ? total((day) => day.marginMinor) : null,
    marginBasisPoints: complete
      ? basisPointsOf(
          total((day) => day.marginMinor),
          total((day) => day.revenueMinor),
        )
      : null,
  };
}

/** Basis points of `part` in `whole`, rounded half-up, or null when it is not a ratio. */
export function basisPointsOf(part, whole) {
  if (whole == null || Number(whole) <= 0) return null;
  if (part == null || !Number.isFinite(Number(part))) return null;
  return Math.round((Number(part) * 10_000) / Number(whole));
}

/**
 * The three groups a plate can be in, and their counts.
 *
 * `uncosted` is the one that matters: a plate whose recipe exists but whose ingredient
 * has no cost basis is fixable, and the screen has to name the ingredient. `notCosted`
 * is a plate nobody said what it consumes — a different repair, and a different
 * sentence. Collapsing the two would tell the owner to buy an ingredient they have
 * not told the platform they use.
 */
export function splitPlates(plates) {
  const list = Array.isArray(plates) ? plates : [];
  const costed = [];
  const uncosted = [];
  const notCosted = [];
  for (const plate of list) {
    if (plateIsCosted(plate)) costed.push(plate);
    else if (plate.state === 'not_costed') notCosted.push(plate);
    else uncosted.push(plate);
  }
  return {
    costed,
    uncosted,
    notCosted,
    counts: {
      all: list.length,
      costed: costed.length,
      uncosted: uncosted.length,
      notCosted: notCosted.length,
    },
  };
}

/**
 * The items a plate could not be priced without, deduplicated by item, keeping the
 * first defect reported for each. Two defects on one ingredient is still one thing to
 * fix, and a list that shows it twice reads as two.
 */
export function uncostedItemsOf(plate) {
  const seen = new Map();
  for (const item of plate?.uncostedItems ?? []) {
    if (!seen.has(item.inventoryItemId)) seen.set(item.inventoryItemId, item);
  }
  return [...seen.values()];
}

/** The components that make up the recipe cost, and the ones sales consumed outside it. */
export function plateComponents(plate) {
  const components = plate?.components ?? [];
  return {
    recipe: components.filter((component) => component.source !== 'modifier_component'),
    fromSales: components.filter((component) => component.source === 'modifier_component'),
  };
}

/**
 * The forecast rows in the order they should be read: below threshold first, then the
 * soonest to run out. An item with no consumption has no rate and therefore no place
 * in a queue, so it sorts last — it is not "cover forever", it is "not being used".
 */
export function sortForecast(items) {
  const list = Array.isArray(items) ? items : [];
  return [...list].sort((a, b) => {
    if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1;
    const aCover = a.daysOfCover;
    const bCover = b.daysOfCover;
    if (aCover == null && bCover == null) return a.displayName.localeCompare(b.displayName);
    if (aCover == null) return 1;
    if (bCover == null) return -1;
    if (aCover !== bCover) return aCover - bCover;
    return a.displayName.localeCompare(b.displayName);
  });
}

/** How many forecast lines need attention, for the screen's summary line. */
export function forecastCounts(items) {
  const list = Array.isArray(items) ? items : [];
  return {
    all: list.length,
    below: list.filter((item) => item.belowThreshold).length,
    // Not a mutually exclusive bucket: an item can be below its threshold AND resting
    // on four days of history, and both facts are worth seeing on the same row.
    thin: list.filter((item) => item.insufficientHistory).length,
    noHistory: list.filter((item) => item.daysOfCover == null).length,
    withoutBasis: list.filter((item) => !item.hasCostBasis).length,
  };
}

/**
 * Case- and accent-insensitive match, because a person typing "cafe" means "Café en
 * grano" and a filter that refuses their keyboard is a filter they stop using.
 */
export function matchesText(haystack, needle) {
  const norm = (value) =>
    String(value ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const query = norm(needle).trim();
  if (!query) return true;
  return norm(haystack).includes(query);
}

/**
 * The plate table for a chosen view and search text.
 *
 * `view` is 'costed' | 'uncosted' | 'all'. The default is 'costed' because "what does
 * this plate cost me" is the question the screen answers first — and the counts of the
 * other two are rendered in the view's own labels, so choosing that default hides
 * nothing: a person sees "Sin costo (37)" before they click it.
 */
export function filterPlates(plates, { view = 'costed', query = '' } = {}) {
  const groups = splitPlates(plates);
  const pool =
    view === 'all'
      ? [...groups.costed, ...groups.uncosted, ...groups.notCosted]
      : view === 'uncosted'
        ? [...groups.uncosted, ...groups.notCosted]
        : groups.costed;
  const filtered = pool.filter((plate) =>
    matchesText(`${plate.productName} ${plate.variantName ?? ''}`, query),
  );
  return { rows: filtered, counts: groups.counts };
}
