import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dailyRateQuantity,
  daysOfCover,
  divideRoundHalfUp,
  margin,
  observedDays,
  plateCostMinor,
  pow10,
  quantityCostMinor,
  shiftBusinessDate,
  toBigInt,
  toSafeNumber,
  weightedAverageUnitCost,
  type CostBucket,
} from './inventory-costing-domain';

/**
 * The costing arithmetic, by property.
 *
 * WHY PROPERTIES AND NOT EXAMPLES. The plan names `fast-check` for exactly this
 * arithmetic, and the reason is that the interesting failures here are not cases a
 * person writes down — they are the one input in ten thousand where a rounding step
 * lands on a half, where a scale is the item's own and not the recipe's, or where
 * the sum of two component costs rounds differently from the two rounded costs
 * added. The examples below pin the behaviour; the properties are what make it true
 * rather than observed.
 *
 * Every property states what it would mean for the invariant to break, because a
 * property test whose failure message is "expected true to be false" tells the next
 * reader nothing at three in the morning.
 */

/** A quantity at a scale, as the database and the recipe expansion hand it over. */
const quantityAtScale = (scale: number) =>
  fc
    .bigInt({ min: 1n, max: 10n ** BigInt(scale + 4) })
    .map((value) => ({ value, scale: Math.max(0, Math.min(6, scale)) }));

/**
 * A price in minor units per whole base unit. Bounded so the weighted sum stays
 * inside what a real supplier invoice can carry, and so a counterexample prints a
 * number a person can read.
 */
const unitCost = fc.bigInt({ min: 0n, max: 5_000_000n });

const bucket = (scale: number): fc.Arbitrary<CostBucket> =>
  fc.record({
    quantity: quantityAtScale(scale).map((q) => q.value),
    scale: fc.constant(scale),
    unitCostMinor: unitCost,
  });

/** One to four receipts, each at its own scale, exactly as receiving writes them. */
const receiptSet = fc.array(fc.oneof(bucket(0), bucket(1), bucket(2), bucket(3), bucket(6)), {
  minLength: 1,
  maxLength: 4,
});

const RUNS = 400;

describe('the weighted average of received unit costs', () => {
  it('is the quantity-weighted mean, not the mean of the prices', () => {
    // 10 kg at $100 and 30 kg at $200 is $175 per kg. The unweighted mean, $150, is
    // the number a spreadsheet gets wrong when it lists two invoices.
    expect(
      weightedAverageUnitCost([
        { quantity: 10000n, scale: 3, unitCostMinor: 10000n },
        { quantity: 30000n, scale: 3, unitCostMinor: 20000n },
      ])?.unitCostMinor,
    ).toBe(17500n);
  });

  it('weights across scales, where the same item was received in store and in bulk', () => {
    // 12.5 kg at $120.50 plus 0.25 kg at $60.00: 12.75 kg costing $1521.25.
    // That is round(152125000 / 12750) = 11931 centavos per kg — $119.31, which sits
    // between the two prices and much nearer the one that carried the weight.
    const average = weightedAverageUnitCost([
      { quantity: 12500n, scale: 3, unitCostMinor: 12050n },
      { quantity: 250n, scale: 3, unitCostMinor: 6000n },
    ]);
    expect(average?.unitCostMinor).toBe(11931n);
    expect(average?.quantity).toBe(12750n);
    expect(average?.scale).toBe(3);
  });

  it('rounds half up once, at the end', () => {
    // 1 kg at $1.00 and 1 kg at $2.00 → exactly 1.5 → 2 centavos, not 1.
    expect(
      weightedAverageUnitCost([
        { quantity: 1000n, scale: 3, unitCostMinor: 1n },
        { quantity: 1000n, scale: 3, unitCostMinor: 2n },
      ])?.unitCostMinor,
    ).toBe(2n);
  });

  it('reports the receipts it rests on, and the spread between them', () => {
    const average = weightedAverageUnitCost([
      { quantity: 1000n, scale: 3, unitCostMinor: 900n },
      { quantity: 1000n, scale: 3, unitCostMinor: 1100n },
    ]);
    expect(average?.lowestUnitCostMinor).toBe(900n);
    expect(average?.highestUnitCostMinor).toBe(1100n);
  });

  it('has NO answer when nothing was ever received — not zero', () => {
    expect(weightedAverageUnitCost([])).toBeNull();
  });

  it('refuses a receipt of nothing, and a negative price', () => {
    expect(() =>
      weightedAverageUnitCost([{ quantity: 0n, scale: 3, unitCostMinor: 100n }]),
    ).toThrow(/zero or negative quantity/);
    expect(() => weightedAverageUnitCost([{ quantity: 1n, scale: 3, unitCostMinor: -1n }])).toThrow(
      /negative unit cost/,
    );
  });

  it('never lies outside the range of the receipts it averages', () => {
    fc.assert(
      fc.property(receiptSet, (buckets) => {
        const average = weightedAverageUnitCost(buckets)!;
        const costs = buckets.map((b) => b.unitCostMinor);
        const low = costs.reduce((a, b) => (a < b ? a : b));
        const high = costs.reduce((a, b) => (a > b ? a : b));
        return (
          average.unitCostMinor >= low &&
          average.unitCostMinor <= high &&
          // The stronger claim: it is within half a minor unit of the exact rational.
          withinHalfAUnit(average.unitCostMinor, buckets)
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('is unchanged by how finely the same quantity is spelled', () => {
    // 12.5 kg written at scale 3 (12500) and at scale 4 (125000) are the same
    // delivery, so the average must be the same number.
    fc.assert(
      fc.property(receiptSet, fc.integer({ min: 1, max: 3 }), (buckets, extra) => {
        fc.pre(buckets.every((b) => b.scale + extra <= 6));
        const finer = buckets.map((b) => ({
          quantity: b.quantity * pow10(extra),
          scale: b.scale + extra,
          unitCostMinor: b.unitCostMinor,
        }));
        const coarse = weightedAverageUnitCost(buckets)!;
        return weightedAverageUnitCost(finer)!.unitCostMinor === coarse.unitCostMinor;
      }),
      { numRuns: RUNS },
    );
  });

  it('never returns a negative cost', () => {
    fc.assert(
      fc.property(receiptSet, (buckets) => weightedAverageUnitCost(buckets)!.unitCostMinor >= 0n),
      { numRuns: RUNS },
    );
  });
});

/** The exact rational the average approximates, as integer numerator and denominator. */
function exactAverage(buckets: readonly CostBucket[]): { numerator: bigint; denominator: bigint } {
  let scale = 0;
  for (const b of buckets) if (b.scale > scale) scale = b.scale;
  let numerator = 0n;
  let denominator = 0n;
  for (const b of buckets) {
    const weight = b.quantity * pow10(scale - b.scale);
    numerator += weight * b.unitCostMinor;
    denominator += weight;
  }
  return { numerator, denominator };
}

/** True when `rounded` is the half-up integer of the exact rational, within half a unit. */
function withinHalfAUnit(rounded: bigint, buckets: readonly CostBucket[]): boolean {
  const { numerator, denominator } = exactAverage(buckets);
  const error = rounded * denominator - numerator;
  const magnitude = error < 0n ? -error : error;
  return 2n * magnitude <= denominator;
}

describe('a plate’s cost', () => {
  it('sums the components exactly and rounds once', () => {
    // A 12 g dose of $120.50/kg coffee and 200 ml of $35.00/L milk:
    // 12 g → 145 centavos, 200 ml → 700 centavos, so the plate is 845.
    expect(
      plateCostMinor([
        { quantity: 12n, scale: 3, unitCostMinor: 12050n },
        { quantity: 200n, scale: 3, unitCostMinor: 3500n },
      ]),
    ).toBe(845n);
  });

  it('does not drift the way adding rounded lines does', () => {
    // Three components of 0.5 centavos each. Rounded individually: 1 + 1 + 1 = 3.
    // Rounded once: round(1.5) = 2. The plate is two centavos, not three.
    expect(
      plateCostMinor([
        { quantity: 500n, scale: 3, unitCostMinor: 1n },
        { quantity: 500n, scale: 3, unitCostMinor: 1n },
        { quantity: 500n, scale: 3, unitCostMinor: 1n },
      ]),
    ).toBe(2n);
  });

  it('agrees with a single component priced on its own', () => {
    expect(plateCostMinor([{ quantity: 12500n, scale: 3, unitCostMinor: 12050n }])).toBe(
      quantityCostMinor({ value: 12500n, scale: 3 }, 12050n),
    );
  });

  it('refuses a negative quantity and a negative price', () => {
    expect(() => plateCostMinor([{ quantity: -1n, scale: 3, unitCostMinor: 1n }])).toThrow(
      /negative component quantity/,
    );
    expect(() => plateCostMinor([{ quantity: 1n, scale: 3, unitCostMinor: -1n }])).toThrow(
      /negative unit cost/,
    );
  });

  it('is a non-negative integer, and rounds to within half a centavo', () => {
    const component = fc.record({ quantity: quantityAtScale(3), unitCostMinor: unitCost });
    fc.assert(
      fc.property(fc.array(component, { minLength: 0, maxLength: 6 }), (components) => {
        const costed = components.map((c) => ({
          quantity: c.quantity.value,
          scale: c.quantity.scale,
          unitCostMinor: c.unitCostMinor,
        }));
        const cost = plateCostMinor(costed);
        if (cost < 0n) return false;
        if (costed.length === 0) return cost === 0n;
        // Same half-a-unit bound as the average, at the plate's own denominator.
        let scale = 0;
        for (const c of costed) if (c.scale > scale) scale = c.scale;
        let numerator = 0n;
        for (const c of costed) {
          numerator += c.quantity * pow10(scale - c.scale) * c.unitCostMinor;
        }
        const error = cost * pow10(scale) - numerator;
        const magnitude = error < 0n ? -error : error;
        return 2n * magnitude <= pow10(scale);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('margin', () => {
  it('is the price less the cost, in basis points of the price', () => {
    const result = margin(4000n, 1685n);
    expect(result.marginMinor).toBe(2315n);
    // 2315 / 4000 = 57.875 percent.
    expect(result.marginBasisPoints).toBe(5788n);
  });

  it('goes NEGATIVE when a plate is sold below its ingredients', () => {
    const result = margin(1000n, 1200n);
    expect(result.marginMinor).toBe(-200n);
    expect(result.marginBasisPoints).toBe(-2000n);
  });

  it('has no percentage when the price is zero', () => {
    expect(margin(0n, 500n)).toEqual({ marginMinor: -500n, marginBasisPoints: null });
  });

  it('always satisfies margin = price − cost, at any input', () => {
    fc.assert(
      fc.property(unitCost, unitCost, (price, cost) => {
        const result = margin(price, cost);
        if (result.marginMinor !== price - cost) return false;
        if (price === 0n) return result.marginBasisPoints === null;
        const bps = result.marginBasisPoints!;
        const error = bps * price - result.marginMinor * 10_000n;
        const magnitude = error < 0n ? -error : error;
        return 2n * magnitude <= price;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('the low-stock forecast', () => {
  it('divides by the days actually observed, not by the window', () => {
    // Four days of history inside a 28-day window: the rate is over four days.
    expect(observedDays(28, '2026-08-20', '2026-09-16', '2026-09-13')).toBe(4);
    // The whole window when the item is older than it.
    expect(observedDays(28, '2026-08-20', '2026-09-16', '2026-01-01')).toBe(28);
    // Nothing consumed, ever: no history to divide by.
    expect(observedDays(28, '2026-08-20', '2026-09-16', null)).toBe(0);
  });

  it('keeps the fractional rate out of the cover arithmetic', () => {
    // One unit in stock, a third of a unit a day: three days, not "infinite"
    // (a rate rounded to zero) and not "four" (a rate rounded up).
    expect(daysOfCover(1000n, 1000n, 3)).toBe(3);
    expect(dailyRateQuantity(1000n, 3)).toBe(333n);
  });

  it('reports no cover at all when stock is gone', () => {
    expect(daysOfCover(0n, 5000n, 28)).toBe(0);
  });

  it('has no cover figure when nothing is being consumed', () => {
    expect(daysOfCover(5000n, 0n, 28)).toBeNull();
  });

  it('never shrinks as stock grows, and never rounds up', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.integer({ min: 1, max: 180 }),
        (onHand, consumed, observed) => {
          const cover = daysOfCover(onHand, consumed, observed)!;
          const more = daysOfCover(onHand + 1n, consumed, observed)!;
          // Exact: cover * consumed <= onHand * observed < (cover + 1) * consumed.
          return (
            more >= cover &&
            BigInt(cover) * consumed <= onHand * BigInt(observed) &&
            onHand * BigInt(observed) < (BigInt(cover) + 1n) * consumed
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});

describe('the small guards', () => {
  it('rounds half away from zero in both directions', () => {
    expect(divideRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divideRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divideRoundHalfUp(1n, 3n)).toBe(0n);
  });

  it('refuses to divide by zero rather than answering', () => {
    expect(() => divideRoundHalfUp(1n, 0n)).toThrow(/denominator must be positive/);
  });

  it('reads a bigint from text exactly, and refuses a float', () => {
    expect(toBigInt('9007199254740993')).toBe(9007199254740993n);
    expect(toBigInt(null)).toBe(0n);
    expect(toBigInt(7)).toBe(7n);
    expect(() => toBigInt('1.5')).toThrow(/not an integer/);
    expect(() => toBigInt(1.5)).toThrow(/not an integer/);
  });

  it('refuses to hand the wire an integer it cannot carry', () => {
    expect(toSafeNumber(123n)).toBe(123);
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      /exceeds the safe integer range/,
    );
  });

  it('shifts a business date without a timezone in the way', () => {
    expect(shiftBusinessDate('2026-09-16', -27)).toBe('2026-08-20');
    expect(shiftBusinessDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
