import { describe, expect, it } from 'vitest';
import {
  LINE_TOTAL_TOLERANCE_MINOR,
  extendedLineTotalMinor,
  lineTotalWithinRounding,
  outstandingQuantity,
  overReceivedLine,
  receiptTotalMinor,
  statusAfterReceipt,
} from './procurement-domain';

/** A kilogram at $120.50, ordered as 12.5 kg with scale 3. */
const TWELVE_AND_A_HALF_KG = { value: 12500, scale: 3, unitCostMinor: 12050 };

describe('purchasing arithmetic', () => {
  it('extends a scaled quantity exactly when the division is exact', () => {
    // 12.500 kg × $120.50 = $1,506.25
    expect(extendedLineTotalMinor(TWELVE_AND_A_HALF_KG)).toBe(150625);
  });

  it('rounds half up, not half to even and not toward zero', () => {
    // 2.500 kg × $3.00 = $7.50 — an exact half, and the invoice says $0.08.
    expect(extendedLineTotalMinor({ value: 2500, scale: 3, unitCostMinor: 3 })).toBe(8);
    // 1 g at $120.50/kg = $0.1205 → 12 centavos, not 13 and not 0.
    expect(extendedLineTotalMinor({ value: 1, scale: 3, unitCostMinor: 12050 })).toBe(12);
    // A whole-unit item never rounds at all.
    expect(extendedLineTotalMinor({ value: 7, scale: 0, unitCostMinor: 2599 })).toBe(18193);
  });

  it('stays exact where a float would drift', () => {
    // 0.003 × 4294967295 would not survive a Number multiplication.
    expect(extendedLineTotalMinor({ value: 3, scale: 3, unitCostMinor: 4294967295 })).toBe(
      12884902,
    );
  });

  it('refuses a quantity or a scale the schema would refuse', () => {
    expect(() => extendedLineTotalMinor({ value: 0, scale: 3, unitCostMinor: 1 })).toThrow(
      'PURCHASE_ORDER_QUANTITY_INVALID',
    );
    expect(() => extendedLineTotalMinor({ value: 1, scale: 7, unitCostMinor: 1 })).toThrow(
      'PURCHASE_ORDER_SCALE_INVALID',
    );
    expect(() => extendedLineTotalMinor({ value: 1, scale: 0, unitCostMinor: -1 })).toThrow(
      'PURCHASE_ORDER_MONEY_INVALID',
    );
  });

  it('accepts a document that rounded its own arithmetic, and refuses a typo', () => {
    // Three cans at $3.33: the computed total is $9.99 and $10.00 is a real invoice.
    const rounded = { value: 3, scale: 0, unitCostMinor: 333 };
    expect(lineTotalWithinRounding({ ...rounded, lineTotalMinor: 999 }).ok).toBe(true);
    expect(lineTotalWithinRounding({ ...rounded, lineTotalMinor: 1000 }).ok).toBe(true);
    // A hundred pesos on a ten-peso line is not a rounding difference.
    expect(lineTotalWithinRounding({ ...rounded, lineTotalMinor: 1099 }).ok).toBe(false);
    expect(lineTotalWithinRounding({ ...rounded, lineTotalMinor: 899 }).ok).toBe(false);
    expect(LINE_TOTAL_TOLERANCE_MINOR).toBe(1);
  });

  it('counts what is still outstanding', () => {
    expect(outstandingQuantity(12500, 0)).toBe(12500);
    expect(outstandingQuantity(12500, 5000)).toBe(7500);
    expect(outstandingQuantity(12500, 12500)).toBe(0);
  });

  it('closes an order only when every line is complete', () => {
    expect(
      statusAfterReceipt([
        { orderedQuantity: 10, receivedQuantity: 10 },
        { orderedQuantity: 5, receivedQuantity: 5 },
      ]),
    ).toBe('received');
    expect(
      statusAfterReceipt([
        { orderedQuantity: 10, receivedQuantity: 10 },
        { orderedQuantity: 5, receivedQuantity: 4 },
      ]),
    ).toBe('partially_received');
  });

  it('names the first line that would be over-received, and only that one', () => {
    const lines = [
      { id: 'line-a', orderedQuantity: 10000, receivedQuantity: 2500 },
      { id: 'line-b', orderedQuantity: 2000, receivedQuantity: 0 },
    ];
    expect(
      overReceivedLine(lines, [
        { purchaseOrderLineId: 'line-a', quantity: 7500 },
        { purchaseOrderLineId: 'line-b', quantity: 2000 },
      ]),
    ).toBeNull();
    // One gram too many on the second line: the FIRST line is still legal, and the
    // offender is named so the caller can say which one.
    expect(
      overReceivedLine(lines, [
        { purchaseOrderLineId: 'line-a', quantity: 7000 },
        { purchaseOrderLineId: 'line-b', quantity: 2001 },
      ]),
    ).toEqual({ purchaseOrderLineId: 'line-b', outstanding: 2000, requested: 2001 });
    // A line that is not on this order at all is named, with nothing outstanding.
    expect(overReceivedLine(lines, [{ purchaseOrderLineId: 'line-z', quantity: 1 }])).toEqual({
      purchaseOrderLineId: 'line-z',
      outstanding: 0,
      requested: 1,
    });
  });

  it('sums a receipt in integers', () => {
    expect(receiptTotalMinor([{ lineTotalMinor: 150625 }, { lineTotalMinor: 1 }])).toBe(150626);
    expect(receiptTotalMinor([])).toBe(0);
  });
});
