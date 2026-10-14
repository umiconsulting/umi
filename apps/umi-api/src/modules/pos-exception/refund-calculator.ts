export interface RefundSourceLine {
  id: string;
  quantity: number;
  merchandise: number;
  tax: number;
  discount: number;
  tip: number;
}

export interface RefundSourceTender {
  id: string;
  type: 'cash' | 'manual_terminal' | 'bank_transfer' | 'wallet' | 'gift_card';
  amount: number;
  refunded: number;
}

export interface RefundSource {
  currency: string;
  lines: RefundSourceLine[];
  tenders: RefundSourceTender[];
}

export interface RefundSelection {
  lineId: string;
  quantity: number;
}

export type RefundAllocationPolicy = 'proportional' | 'terminal_first' | 'cash_first';

const safe = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError('REFUND_AMOUNT_OUT_OF_RANGE');
  return value;
};

const allocateQuantity = (amount: number, quantity: number, selected: number): number => {
  safe(amount);
  if (amount < 0 || quantity <= 0 || selected <= 0 || selected > quantity) {
    throw new RangeError('REFUND_QUANTITY_EXCEEDS_REMAINING');
  }
  return safe(Number((BigInt(amount) * BigInt(selected)) / BigInt(quantity)));
};

export function calculateRefundPreview(
  source: RefundSource,
  selections: RefundSelection[],
  policy: RefundAllocationPolicy,
) {
  if (
    selections.length === 0 ||
    new Set(selections.map((item) => item.lineId)).size !== selections.length
  ) {
    throw new RangeError('REFUND_SELECTION_INVALID');
  }
  const lines = selections.map((selection) => {
    const line = source.lines.find((candidate) => candidate.id === selection.lineId);
    if (!line || selection.quantity <= 0 || selection.quantity > line.quantity) {
      throw new RangeError('REFUND_QUANTITY_EXCEEDS_REMAINING');
    }
    const merchandise = allocateQuantity(line.merchandise, line.quantity, selection.quantity);
    const discount = allocateQuantity(line.discount, line.quantity, selection.quantity);
    const tip = allocateQuantity(line.tip, line.quantity, selection.quantity);
    const proportionalTax = allocateQuantity(line.tax, line.quantity, selection.quantity);
    /**
     * THE PARTS MUST ADD UP TO WHAT THE CUSTOMER PAID FOR THESE UNITS.
     *
     * Each component used to be allocated with its own integer division, and they then summed to
     * LESS than the line's own share whenever a division dropped a cent. A line of two Lattes at
     * MXN 65.00 stores merchandise 11207 and tax 1793, and refunding ONE of them allocated
     * 11207/2 = 5603 and 1793/2 = 896: **MXN 64.99 refunded for a cup the customer paid MXN 65.00
     * for**. Measured on the iMin on 2026-10-11 — `merchant.pos_sale_exception` came back with
     * merchandise 5603, tax 896, total 6499 against a receipt line of 13000 for quantity 2.
     *
     * The share of the line's total is exact, because a counter sale's line total is
     * `unitPrice x quantity`. So the tax takes the remainder — the convention the receipt itself
     * uses, where the net is rounded and the tax is `total - net` — and the line's components add
     * up to its share again. A one-quantity line is untouched: share, merchandise and tax are the
     * same numbers they always were. `proportionalTax` remains the answer for a line whose discount
     * and tip would make the residual negative.
     */
    const share = allocateQuantity(
      line.merchandise - line.discount + line.tax + line.tip,
      line.quantity,
      selection.quantity,
    );
    const residual = safe(share - merchandise + discount - tip);
    const tax = residual >= 0 ? residual : proportionalTax;
    return {
      lineId: line.id,
      quantity: selection.quantity,
      merchandise,
      tax,
      discount,
      tip,
      total: safe(merchandise - discount + tax + tip),
    };
  });
  const total = lines.reduce((sum, line) => safe(sum + line.total), 0);
  if (total <= 0) throw new RangeError('REFUND_TOTAL_INVALID');
  const available = source.tenders.map((tender) => ({
    ...tender,
    available: safe(tender.amount - tender.refunded),
  }));
  if (available.some((tender) => tender.available < 0)) {
    throw new RangeError('REFUND_TENDER_ALREADY_EXCEEDED');
  }
  const ordered =
    policy === 'cash_first'
      ? [...available].sort((a, b) => Number(b.type === 'cash') - Number(a.type === 'cash'))
      : policy === 'terminal_first'
        ? [...available].sort(
            (a, b) => Number(b.type === 'manual_terminal') - Number(a.type === 'manual_terminal'),
          )
        : available;
  let remaining = total;
  const tenders: Array<{ id: string; type: RefundSourceTender['type']; amount: number }> = [];
  if (policy === 'proportional') {
    const totalAvailable = available.reduce((sum, tender) => safe(sum + tender.available), 0);
    if (totalAvailable < total) {
      throw new RangeError('REFUND_TENDER_ALLOCATION_INCOMPLETE');
    }
    let allocated = 0;
    available.forEach((tender, index) => {
      const amount =
        index === available.length - 1
          ? total - allocated
          : Math.min(
              tender.available,
              safe(Number((BigInt(total) * BigInt(tender.available)) / BigInt(totalAvailable))),
            );
      if (amount > 0) {
        tenders.push({ id: tender.id, type: tender.type, amount });
        allocated = safe(allocated + amount);
      }
    });
    remaining = total - allocated;
  } else {
    for (const tender of ordered) {
      const amount = Math.min(remaining, tender.available);
      if (amount > 0) tenders.push({ id: tender.id, type: tender.type, amount });
      remaining = safe(remaining - amount);
      if (remaining === 0) break;
    }
  }
  if (remaining !== 0) throw new RangeError('REFUND_TENDER_ALLOCATION_INCOMPLETE');
  return { currency: source.currency, lines, total, tenders };
}
