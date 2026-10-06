/**
 * The purchasing arithmetic, in one place, in integers (plan §8E step 3).
 *
 * WHY THIS FILE EXISTS. A purchase order carries two money figures per line — the
 * unit cost the supplier quoted and the extended total they will invoice — and a
 * scaled quantity, because a café buys coffee by the kilogram and receives it in
 * grams. Relating those three requires a rounding step, and a rounding step is
 * exactly the kind of thing that grows a second implementation the moment two
 * modules need it. There is one implementation, it is here, it uses BigInt, and it
 * is unit-tested (`procurement-domain.spec.ts`) on the cases that actually bite.
 *
 * NO FLOAT EVER TOUCHES MONEY. `Number` division would turn 12.05 into 12.049999
 * and a half-up rule into a coin flip, so every operation below is BigInt until the
 * result is known to be an integer within the safe range.
 */

/** A scaled quantity: `value` units of `10^-scale` of `unit`. */
export interface ScaledQuantity {
  value: number;
  scale: number;
  unit: string;
}

const safe = (value: number, code: string): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError(code);
  return value;
};

/**
 * The extended amount for a line: `quantity × unitCost`, rounded HALF UP to whole
 * minor units.
 *
 * Half-up is the rule a supplier's own document uses in Mexico, and it is why the
 * rounding is not "truncate": a 250 g line at $3.00/kg is $0.75, and truncating
 * would quietly lose a centavo on every such line, in the direction that makes the
 * books disagree with the invoice.
 */
export const extendedLineTotalMinor = (input: {
  value: number;
  scale: number;
  unitCostMinor: number;
}): number => {
  const { value, scale, unitCostMinor } = input;
  safe(value, 'PURCHASE_ORDER_QUANTITY_OUT_OF_RANGE');
  safe(unitCostMinor, 'PURCHASE_ORDER_MONEY_OUT_OF_RANGE');
  if (value <= 0) throw new RangeError('PURCHASE_ORDER_QUANTITY_INVALID');
  if (unitCostMinor < 0) throw new RangeError('PURCHASE_ORDER_MONEY_INVALID');
  if (!Number.isInteger(scale) || scale < 0 || scale > 6)
    throw new RangeError('PURCHASE_ORDER_SCALE_INVALID');
  const numerator = BigInt(value) * BigInt(unitCostMinor);
  const denominator = 10n ** BigInt(scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('PURCHASE_ORDER_MONEY_OUT_OF_RANGE');
  return Number(rounded);
};

/**
 * How far a typed line total may sit from the computed one, in minor units.
 *
 * ONE, AND DELIBERATELY NOT ZERO. A supplier's document is allowed to have rounded
 * its own arithmetic — three items at $3.33 is $9.99, not $10.00 — and an API that
 * refused that would refuse a real invoice. One centavo per line is the largest
 * difference a rounded document can produce; anything beyond it is a transcription
 * error, and it is refused with the line named so the person holding the paper can
 * see which one.
 */
export const LINE_TOTAL_TOLERANCE_MINOR = 1;

export const lineTotalWithinRounding = (input: {
  value: number;
  scale: number;
  unitCostMinor: number;
  lineTotalMinor: number;
  toleranceMinor?: number;
}): { ok: boolean; expectedMinor: number } => {
  const expectedMinor = extendedLineTotalMinor(input);
  const tolerance = input.toleranceMinor ?? LINE_TOTAL_TOLERANCE_MINOR;
  return { ok: Math.abs(input.lineTotalMinor - expectedMinor) <= tolerance, expectedMinor };
};

/** Ordered minus received. Never negative: over-receipt is refused, not clamped. */
export const outstandingQuantity = (ordered: number, received: number): number => {
  safe(ordered, 'PURCHASE_ORDER_QUANTITY_OUT_OF_RANGE');
  safe(received, 'PURCHASE_ORDER_QUANTITY_OUT_OF_RANGE');
  return Math.max(0, ordered - received);
};

/**
 * The status a received order lands in: `received` when every line is complete,
 * `partially_received` otherwise. Derived from the lines rather than tracked
 * separately, because a counter of its own is one more thing that can disagree
 * with the quantities it is counting.
 */
export const statusAfterReceipt = (
  lines: ReadonlyArray<{ orderedQuantity: number; receivedQuantity: number }>,
): 'received' | 'partially_received' => {
  if (lines.length === 0) throw new RangeError('PURCHASE_ORDER_HAS_NO_LINES');
  return lines.every((line) => line.receivedQuantity >= line.orderedQuantity)
    ? 'received'
    : 'partially_received';
};

/**
 * THE over-receipt check, and the reason this module exists in the plan.
 *
 * Given the lines as the database holds them and the quantities this receipt is
 * asking for, return the FIRST line that would be over-received, or null. It is
 * called for every line BEFORE anything is written, so a two-line receipt whose
 * second line is too large refuses without posting the first — the "nothing moves"
 * half of the invariant, which a database constraint alone cannot provide because
 * a constraint is evaluated per row as it is written.
 */
export const overReceivedLine = (
  lines: ReadonlyArray<{ id: string; orderedQuantity: number; receivedQuantity: number }>,
  requested: ReadonlyArray<{ purchaseOrderLineId: string; quantity: number }>,
): { purchaseOrderLineId: string; outstanding: number; requested: number } | null => {
  const byId = new Map(lines.map((line) => [line.id, line]));
  for (const line of requested) {
    const existing = byId.get(line.purchaseOrderLineId);
    if (!existing)
      return {
        purchaseOrderLineId: line.purchaseOrderLineId,
        outstanding: 0,
        requested: line.quantity,
      };
    const outstanding = outstandingQuantity(existing.orderedQuantity, existing.receivedQuantity);
    if (line.quantity > outstanding)
      return {
        purchaseOrderLineId: line.purchaseOrderLineId,
        outstanding,
        requested: line.quantity,
      };
  }
  return null;
};

/**
 * The receipt's money total, summed in integers from the lines actually delivered.
 * The header's `total_minor` is this sum and nothing else, which is what keeps a
 * header and its lines from telling two different stories.
 */
export const receiptTotalMinor = (lines: ReadonlyArray<{ lineTotalMinor: number }>): number =>
  lines.reduce((total, line) => {
    safe(line.lineTotalMinor, 'PURCHASE_ORDER_MONEY_OUT_OF_RANGE');
    if (line.lineTotalMinor < 0) throw new RangeError('PURCHASE_ORDER_MONEY_INVALID');
    return safe(total + line.lineTotalMinor, 'PURCHASE_ORDER_MONEY_OUT_OF_RANGE');
  }, 0);
