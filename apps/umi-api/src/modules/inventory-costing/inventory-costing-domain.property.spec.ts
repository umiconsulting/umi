import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  divideRoundHalfUp,
  margin,
  plateCostMinor,
  pow10,
  sumScaled,
  weightedAverageUnitCost,
} from './inventory-costing-domain';

/**
 * THE PROPERTIES THE MONEY AND THE QUANTITIES REST ON (plan §12.2).
 *
 * The page tests elsewhere in this module check EXAMPLES. These check the rules, over
 * ranges of inputs nobody would think to write down: every scale from 0 to 6, values
 * up to the safe-integer ceiling, and the conversions this cluster performs in both
 * directions. A scaled-integer bug in this cluster does not throw — it puts a plate
 * cost one decimal place out — so an example that happens to divide cannot find it.
 *
 * `fast-check@4.10.1` is the house tool and a direct devDependency of `@umi/api`.
 */

const scale = () => fc.integer({ min: 0, max: 6 });
const value = () => fc.bigInt({ min: 0n, max: 10n ** 15n });
const minorUnits = () => fc.bigInt({ min: 0n, max: 10n ** 12n });

describe('scaled-integer arithmetic never loses a unit (plan §12.2)', () => {
  it('sums one quantity at its own scale exactly', () => {
    fc.assert(
      fc.property(value(), scale(), scale(), (quantity, from, target) => {
        const result = sumScaled([{ value: quantity, scale: from }], target);
        if (target >= from) {
          // Scaling UP is exact: every unit survives the conversion.
          expect(result).toBe(quantity * pow10(target - from));
        } else {
          // Scaling DOWN rounds ONCE at the target scale, which is the declared
          // policy. The assertion is the policy, not the exact value: 0.1 read at
          // scale 0 is 0, and that is the answer the plan asks for.
          expect(result).toBe(divideRoundHalfUp(quantity, pow10(from - target)));
        }
      }),
      { numRuns: 300 },
    );
  });

  it('round-trips a conversion from one scale to another and back', () => {
    fc.assert(
      fc.property(value(), scale(), scale(), (quantity, from, to) => {
        const converted = sumScaled([{ value: quantity, scale: from }], to);
        const back = sumScaled([{ value: converted, scale: to }], from);
        if (to >= from) {
          // WITHIN THE DECLARED ROUNDING POLICY, which is what §12.2 asks: an exact
          // conversion up and back is the identity.
          expect(back).toBe(quantity);
        } else {
          // A lossy conversion is allowed to move the number by at most HALF a unit
          // of the scale it was rounded to, and no more. The difference is SIGNED:
          // half-up rounds 0.5 up, so the round trip may come back larger than it
          // started. The bound is the declared policy; the direction is not.
          const moved = quantity > back ? quantity - back : back - quantity;
          expect(moved * 2n <= pow10(from - to)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('adds quantities at different scales without adding raw integers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(value(), scale()), { minLength: 1, maxLength: 8 }),
        scale(),
        (parts, target) => {
          const summed = sumScaled(
            parts.map(([v, s]) => ({ value: v, scale: s })),
            target,
          );
          // The exact rational sum, computed independently, rounded once.
          const common = Math.max(target, ...parts.map(([, s]) => s));
          const numerator = parts.reduce((total, [v, s]) => total + v * pow10(common - s), 0n);
          const expected =
            common === target ? numerator : divideRoundHalfUp(numerator, pow10(common - target));
          expect(summed).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('the one rounding step behaves as its policy says (plan §12.2)', () => {
  it('is exact when the division divides', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 6n }),
        (q, d) => {
          expect(divideRoundHalfUp(q * d, d)).toBe(q);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('is never more than half a unit away from the exact answer', () => {
    fc.assert(
      fc.property(value(), fc.bigInt({ min: 1n, max: 10n ** 6n }), (n, d) => {
        const rounded = divideRoundHalfUp(n, d);
        const error = rounded * d - n;
        expect(error <= d / 2n).toBe(true);
        expect(-error <= d / 2n + 1n).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('agrees with the same rule on negatives', () => {
    fc.assert(
      fc.property(value(), fc.bigInt({ min: 1n, max: 10n ** 6n }), (n, d) => {
        expect(divideRoundHalfUp(-n, d)).toBe(-divideRoundHalfUp(n, d));
      }),
      { numRuns: 200 },
    );
  });
});

describe('a plate cost keeps money whole (plan §12.2)', () => {
  it('prices a whole quantity as quantity times the unit cost', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        minorUnits(),
        (quantity, unitCostMinor) => {
          expect(plateCostMinor([{ quantity, scale: 0, unitCostMinor }])).toBe(
            quantity * unitCostMinor,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never returns a negative cost, and rises with quantity', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        minorUnits(),
        (smaller, extra, unitCostMinor) => {
          const base = plateCostMinor([{ quantity: smaller, scale: 0, unitCostMinor }]);
          const larger = plateCostMinor([{ quantity: smaller + extra, scale: 0, unitCostMinor }]);
          expect(base >= 0n).toBe(true);
          expect(larger >= base).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('the basis and the margin keep their stated shapes (plan §12.2)', () => {
  it('a margin is the price less the cost, and can be negative', () => {
    fc.assert(
      fc.property(minorUnits(), minorUnits(), (price, cost) => {
        const result = margin(price, cost);
        expect(result.marginMinor).toBe(price - cost);
        // Basis points are null ONLY when the price is zero: a share of nothing has
        // no answer, and zero would claim a margin of nothing.
        if (price === 0n) expect(result.marginBasisPoints).toBeNull();
        else expect(typeof result.marginBasisPoints).toBe('bigint');
      }),
      { numRuns: 200 },
    );
  });

  it('a weighted average of one price is that price', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        minorUnits(),
        scale(),
        (quantity, unitCostMinor, atScale) => {
          const basis = weightedAverageUnitCost([{ quantity, scale: atScale, unitCostMinor }]);
          expect(basis?.unitCostMinor).toBe(unitCostMinor);
          expect(basis?.lowestUnitCostMinor).toBe(unitCostMinor);
          expect(basis?.highestUnitCostMinor).toBe(unitCostMinor);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('an item with no receipts has NO cost, never a zero', () => {
    expect(weightedAverageUnitCost([])).toBeNull();
  });
});
