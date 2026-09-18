/**
 * The costing arithmetic (plan §8E steps 5 and 6), as pure functions.
 *
 * WHY IT IS PURE AND WHY IT IS SEPARATE. Every number this workstream produces is a
 * money number an owner will use to decide whether a plate is worth selling, and the
 * failure mode is not a crash — it is a cost that is quietly a centavo out, or a
 * margin of exactly one hundred percent because something rounded a missing cost to
 * zero. So the arithmetic is kept out of SQL and out of the repository, in functions
 * that take integers and return integers, and the properties that must hold are
 * asserted over generated inputs (`inventory-costing-domain.spec.ts`) rather than
 * over the three examples a person happened to think of.
 *
 * THE ONE RULE THAT MAKES IT EXACT. Everything is a rational with a power of ten for
 * a denominator, and there is exactly ONE rounding step per answer. A quantity is an
 * integer at some scale (`12500` at scale 3 is 12.5 kilograms); a unit cost is minor
 * units per WHOLE base unit (`12050` is $120.50 per kilogram). So a line's cost is
 * `quantity * unitCost / 10^scale`, and several such lines are summed at a COMMON
 * denominator and rounded once, instead of being rounded per line and then added.
 *
 * WHY THE COMMON DENOMINATOR IS THE MAXIMUM SCALE. Summing `a/10^2 + b/10^3` needs a
 * denominator both divide into; the largest of the scales always works, needs no
 * factorisation, and cannot lose precision. A property in the spec asserts that
 * picking a larger one would have produced the same integer, so the choice is
 * provably harmless rather than merely plausible.
 *
 * There is no float anywhere. `bigint` division truncates toward zero, which is why
 * `divideRoundHalfUp` works on magnitudes and reapplies the sign.
 */

/** Ten to a non-negative power, as an exact integer. */
export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 18) {
    throw new Error(`pow10: exponent out of range: ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/**
 * `numerator / denominator`, rounded half away from zero, in integers.
 *
 * SQL's `round()` on `numeric` does the same, and half-up is the rule the platform
 * already uses for money: `inventory_unit_conversion.rounding_policy` names
 * `half_up` as the money-safe one. A denominator of zero is a programming error and
 * is thrown rather than answered.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('divideRoundHalfUp: denominator must be positive');
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const rounded = (2n * magnitude + denominator) / (2n * denominator);
  return negative ? -rounded : rounded;
}

/** A quantity at a scale. `value` 12500 at scale 3 is 12.5 base units. */
export type ScaledQuantity = {
  readonly value: bigint;
  readonly scale: number;
};

/**
 * Several quantities at several scales, added and expressed at one scale.
 *
 * Needed because the same item's stock can be recorded at more than one scale: an
 * item whose `quantity_scale` was changed re-reads its own history differently, and a
 * report that summed the raw integers would add 12.5 to 125 and call it 137.5. The sum
 * happens at a common denominator and is rounded ONCE, at the target scale, so a
 * converted total is wrong by less than one unit of the target — never by a factor of
 * ten.
 */
export function sumScaled(quantities: readonly ScaledQuantity[], targetScale: number): bigint {
  if (quantities.length === 0) return 0n;
  let scale = targetScale;
  for (const quantity of quantities) {
    if (quantity.value < 0n) throw new Error('sumScaled: a negative quantity');
    if (quantity.scale > scale) scale = quantity.scale;
  }
  let numerator = 0n;
  for (const quantity of quantities) {
    numerator += quantity.value * pow10(scale - quantity.scale);
  }
  if (scale === targetScale) return numerator;
  return divideRoundHalfUp(numerator, pow10(scale - targetScale));
}

/**
 * One receipt price, aggregated by the database into (how much came in, at what
 * scale, at what unit cost). Buckets rather than raw rows because a merchant with
 * four thousand deliveries of the same bean at the same price has ONE price, and
 * the arithmetic does not care how many invoices carried it.
 */
export type CostBucket = {
  readonly quantity: bigint;
  readonly scale: number;
  readonly unitCostMinor: bigint;
};

export type WeightedAverageCost = {
  /** Minor units per whole base unit, rounded half-up exactly once. */
  readonly unitCostMinor: bigint;
  /** The total quantity the average was weighted by, at `scale`. */
  readonly quantity: bigint;
  readonly scale: number;
  readonly lowestUnitCostMinor: bigint;
  readonly highestUnitCostMinor: bigint;
};

/**
 * THE cost basis: the quantity-weighted average of the ACTUAL received unit costs.
 *
 * Null when there are no receipts, and that null is the whole point — see the
 * contract's note. An item nobody has delivered has no cost, and zero is not a
 * conservative stand-in for it; zero is a hundred percent margin.
 */
export function weightedAverageUnitCost(
  buckets: readonly CostBucket[],
): WeightedAverageCost | null {
  if (buckets.length === 0) return null;

  let scale = 0;
  let lowest = buckets[0].unitCostMinor;
  let highest = buckets[0].unitCostMinor;
  for (const bucket of buckets) {
    if (bucket.quantity <= 0n) {
      throw new Error('weightedAverageUnitCost: a receipt of zero or negative quantity');
    }
    if (bucket.unitCostMinor < 0n) {
      throw new Error('weightedAverageUnitCost: a negative unit cost');
    }
    if (bucket.scale > scale) scale = bucket.scale;
    if (bucket.unitCostMinor < lowest) lowest = bucket.unitCostMinor;
    if (bucket.unitCostMinor > highest) highest = bucket.unitCostMinor;
  }

  // Both sides carry the same weights, so the ratio is a pure average of the unit
  // costs and is therefore bounded by them — asserted as a property, not assumed.
  let weightedCost = 0n;
  let weight = 0n;
  for (const bucket of buckets) {
    const normalised = bucket.quantity * pow10(scale - bucket.scale);
    weight += normalised;
    weightedCost += normalised * bucket.unitCostMinor;
  }
  if (weight === 0n) return null;

  return {
    unitCostMinor: divideRoundHalfUp(weightedCost, weight),
    quantity: weight,
    scale,
    lowestUnitCostMinor: lowest,
    highestUnitCostMinor: highest,
  };
}

/** A plate's component, priced at the cost basis for its item. */
export type CostedComponent = {
  /** The quantity ONE plate consumes, at `scale`, in the item's base unit. */
  readonly quantity: bigint;
  readonly scale: number;
  readonly unitCostMinor: bigint;
};

/**
 * A plate's cost: the component costs summed at a common denominator and rounded
 * ONCE, which is the difference between this and a kitchen costing spreadsheet that
 * is a centavo high on every plate.
 */
export function plateCostMinor(components: readonly CostedComponent[]): bigint {
  if (components.length === 0) return 0n;

  let scale = 0;
  for (const component of components) {
    if (component.quantity < 0n) {
      throw new Error('plateCostMinor: a negative component quantity');
    }
    if (component.unitCostMinor < 0n) {
      throw new Error('plateCostMinor: a negative unit cost');
    }
    if (component.scale > scale) scale = component.scale;
  }

  const denominator = pow10(scale);
  let numerator = 0n;
  for (const component of components) {
    const normalised = component.quantity * pow10(scale - component.scale);
    numerator += normalised * component.unitCostMinor;
  }
  return divideRoundHalfUp(numerator, denominator);
}

/** What a sale line's quantity of one item cost, for the per-day cost of goods. */
export function quantityCostMinor(quantity: ScaledQuantity, unitCostMinor: bigint): bigint {
  if (quantity.value < 0n) throw new Error('quantityCostMinor: a negative quantity');
  if (unitCostMinor < 0n) throw new Error('quantityCostMinor: a negative unit cost');
  const numerator = quantity.value * unitCostMinor;
  if (numerator === 0n) return 0n;
  return divideRoundHalfUp(numerator, pow10(quantity.scale));
}

export type Margin = {
  readonly marginMinor: bigint;
  /** Basis points of the price: 4200 is 42 percent. Null when the price is zero. */
  readonly marginBasisPoints: bigint | null;
};

/**
 * Margin against the price. It may be NEGATIVE, and that is information rather than
 * an error: a plate sold below its ingredients' cost is exactly what this view
 * exists to reveal, so nothing here clamps.
 */
export function margin(priceMinor: bigint, costMinor: bigint): Margin {
  const marginMinor = priceMinor - costMinor;
  if (priceMinor === 0n) return { marginMinor, marginBasisPoints: null };
  return {
    marginMinor,
    marginBasisPoints: divideRoundHalfUp(marginMinor * 10_000n, priceMinor),
  };
}

/**
 * The consumption rate per day, at the item's own scale, rounded half-up.
 *
 * `observedDays` is passed in rather than assumed to be the window: see
 * `observedDays` below. Zero days of observation has no rate, and returns null.
 */
export function dailyRateQuantity(consumedQuantity: bigint, observedDays: number): bigint | null {
  if (observedDays <= 0) return null;
  if (consumedQuantity <= 0n) return 0n;
  return divideRoundHalfUp(consumedQuantity, BigInt(observedDays));
}

/**
 * Days of cover, floored — the day the shelf runs out, not the day after.
 *
 * COMPUTED IN ONE EXACT STEP rather than from the rounded daily rate: an item with
 * one unit on hand and a rate of a third of a unit a day has three days of cover, and
 * rounding the rate to zero first would have called it infinite. Null when nothing
 * is being consumed, because "no cover needed" and "unlimited cover" are the same
 * number and different facts.
 */
export function daysOfCover(
  onHand: bigint,
  consumedQuantity: bigint,
  observedDays: number,
): number | null {
  if (consumedQuantity <= 0n || observedDays <= 0) return null;
  if (onHand <= 0n) return 0;
  const cover = (onHand * BigInt(observedDays)) / consumedQuantity;
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(cover > ceiling ? ceiling : cover);
}

/**
 * THE HONEST DENOMINATOR for a rate.
 *
 * The window asked for, clamped to the days since the item's FIRST consumption — an
 * item that started selling four days ago has four days of history, and dividing by
 * a twenty-eight-day window would average in twenty-four days of silence the
 * business never had. An item with no consumption at all has no history and returns
 * zero, which `dailyRateQuantity` reads as "no rate".
 */
export function observedDays(
  windowDays: number,
  from: string,
  to: string,
  firstConsumption: string | null,
): number {
  if (!firstConsumption) return 0;
  const start = from > firstConsumption ? from : firstConsumption;
  if (start > to) return 0;
  return Math.min(windowDays, daysBetween(start, to) + 1);
}

/** Whole days between two business dates. UTC arithmetic: no DST, no drift. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(`daysBetween: not a business date: ${from} .. ${to}`);
  }
  return Math.round((end - start) / 86_400_000);
}

/** A business date shifted by whole days. Used to default the reporting windows. */
export function shiftBusinessDate(date: string, days: number): string {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed)) throw new Error(`shiftBusinessDate: not a business date: ${date}`);
  return new Date(parsed + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * A bigint from a value the database returned as text, refusing anything that is not
 * an integer. `pg` hands `bigint` and `numeric` over as strings; parsing one with
 * `Number` would silently round a value above 2^53 and put a wrong cost on a screen.
 */
export function toBigInt(value: string | number | bigint | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`toBigInt: not an integer: ${value}`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value)) throw new Error(`toBigInt: not an integer: ${value}`);
  return BigInt(value);
}

/**
 * A bigint for the contract, which speaks safe integers. Anything larger cannot be
 * told apart from its neighbours on the wire, so it is refused here rather than
 * rounded and shown.
 */
export function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`toSafeNumber: ${value} exceeds the safe integer range`);
  }
  return Number(value);
}
