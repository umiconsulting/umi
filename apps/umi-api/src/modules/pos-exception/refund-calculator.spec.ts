import { describe, expect, it } from 'vitest';
import { calculateRefundPreview } from './refund-calculator';
import { refundApprovalRequired } from './pos-exception.repository';

describe('Gate 3D refund allocation', () => {
  it('requires approval above the dedicated cash threshold', () => {
    expect(refundApprovalRequired('partial_refund', 500, 1000, 500, 400, false, false)).toBe(true);
  });

  const sale = {
    currency: 'MXN',
    lines: [
      { id: 'a', quantity: 3, merchandise: 1000, tax: 160, discount: 100, tip: 30 },
      { id: 'b', quantity: 2, merchandise: 700, tax: 112, discount: 70, tip: 20 },
    ],
    tenders: [
      { id: 'cash', type: 'cash' as const, amount: 700, refunded: 0 },
      { id: 'terminal', type: 'manual_terminal' as const, amount: 1152, refunded: 0 },
    ],
  };

  it('uses historical integers and deterministic remainders', () => {
    const result = calculateRefundPreview(sale, [{ lineId: 'a', quantity: 1 }], 'cash_first');
    expect(result.lines[0]).toEqual({
      lineId: 'a',
      quantity: 1,
      merchandise: 333,
      tax: 53,
      discount: 33,
      tip: 10,
      total: 363,
    });
    expect(result.total).toBe(363);
    expect(result.tenders).toEqual([{ id: 'cash', type: 'cash', amount: 363 }]);
  });

  it('rejects a quantity above the remaining quantity', () => {
    expect(() =>
      calculateRefundPreview(sale, [{ lineId: 'a', quantity: 4 }], 'proportional'),
    ).toThrow('REFUND_QUANTITY_EXCEEDS_REMAINING');
  });

  it('never allocates more than an original tender', () => {
    const result = calculateRefundPreview(
      sale,
      [
        { lineId: 'a', quantity: 3 },
        { lineId: 'b', quantity: 2 },
      ],
      'terminal_first',
    );
    expect(result.total).toBe(1852);
    expect(result.tenders).toEqual([
      { id: 'terminal', type: 'manual_terminal', amount: 1152 },
      { id: 'cash', type: 'cash', amount: 700 },
    ]);
  });

  it('rejects duplicate line selections', () => {
    expect(() =>
      calculateRefundPreview(
        sale,
        [
          { lineId: 'a', quantity: 1 },
          { lineId: 'a', quantity: 1 },
        ],
        'cash_first',
      ),
    ).toThrow('REFUND_SELECTION_INVALID');
  });

  it('rejects an allocation when original tender capacity is insufficient', () => {
    expect(() =>
      calculateRefundPreview(
        {
          ...sale,
          tenders: [{ id: 'cash', type: 'cash', amount: 100, refunded: 99 }],
        },
        [{ lineId: 'a', quantity: 1 }],
        'proportional',
      ),
    ).toThrow('REFUND_TENDER_ALLOCATION_INCOMPLETE');
  });

  it('uses integer-safe allocation near the maximum safe amount', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const result = calculateRefundPreview(
      {
        currency: 'MXN',
        lines: [
          {
            id: 'large',
            quantity: 3,
            merchandise: maximum - 2,
            tax: 0,
            discount: 0,
            tip: 0,
          },
        ],
        tenders: [{ id: 'cash', type: 'cash', amount: maximum - 2, refunded: 0 }],
      },
      [{ lineId: 'large', quantity: 2 }],
      'proportional',
    );
    expect(result.total).toBe(6004799503160659);
  });
});
