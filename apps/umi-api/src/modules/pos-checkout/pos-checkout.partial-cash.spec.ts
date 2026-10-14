import type { PaymentSummary } from '@umi/contract';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/orders/order-writer', () => ({
  writeOrder: vi.fn(async () => ({
    orderId: '00000000-0000-4000-8000-000000000070',
    created: false,
    lineIds: [],
  })),
  appendOrderItems: vi.fn(),
}));
vi.mock('../../shared/orders/cart-order-context', () => ({
  syncCartOrderContext: vi.fn(async () => undefined),
}));
vi.mock('../../shared/receipts/receipt-folio', () => ({
  allocateReceiptFolio: vi.fn(async () => 'REC-0001'),
}));

import { PosCheckoutRepository } from './pos-checkout.repository';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });

describe('cierre con abonos de efectivo', () => {
  it('keeps prior cash in shift A and closes the sale in shift B without posting it twice', async () => {
    const firstShift = id(30);
    const finalShift = id(31);
    const tenders: PaymentSummary['tenders'] = [
      ...[id(8), id(9)].map((tenderId) => ({
        tenderId,
        type: 'cash' as const,
        applied: money(500),
        received: money(600),
        change: money(100),
        status: 'confirmed_success' as const,
      })),
      {
        tenderId: id(10),
        type: 'manual_terminal',
        applied: money(500),
        received: null,
        change: money(0),
        status: 'confirmed_success',
      },
    ];
    const summary: PaymentSummary = {
      checkoutId: id(7),
      state: 'collecting_payment',
      tenders,
      amountDue: money(1500),
      appliedAmount: money(1500),
      remainingBalance: money(0),
      change: money(200),
      partialPaymentState: 'fully_covered',
      tip: null,
      discounts: { total: money(0), entries: [] },
    };
    let saleShift: unknown;
    let receiptDate: unknown;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM merchant.pos_partial_payment p')) {
        return {
          rows: [id(8), id(9)].map((tenderId, index) => ({
            tenderId,
            amount: '500',
            received: '600',
            currency: 'MXN',
            shiftId: firstShift,
            ledgerId: id(20 + index),
            ledgerAmount: '500',
            ledgerReceived: '600',
            ledgerShiftId: firstShift,
          })),
        };
      }
      if (sql.includes('FROM merchant.cash_shift s')) {
        expect(params?.[0]).toBe(finalShift);
        return { rows: [{ businessDate: '2026-10-14' }] };
      }
      if (sql.includes('INSERT INTO merchant.cash_ledger_entry')) {
        throw new Error('A confirmed cash payment was posted twice.');
      }
      if (sql.includes('FROM merchant.pos_cart_line')) return { rows: [] };
      if (sql.includes('INSERT INTO merchant.receipt_snapshot')) {
        receiptDate = params?.[5];
        return { rows: [{ id: id(71) }] };
      }
      if (sql.includes('INSERT INTO merchant.pos_committed_sale')) {
        saleShift = params?.[7];
        return { rows: [{ id: id(72), committedAt: '2026-10-14T12:00:00.000Z' }] };
      }
      if (sql.includes('merchant.commit_customer_value_closeout')) {
        return { rows: [{ result: {} }] };
      }
      return { rows: [], rowCount: 1 };
    });
    const result = await new PosCheckoutRepository({} as never).commit(
      { query } as never,
      {
        id: id(5),
        merchantId: id(1),
        locationId: id(2),
        operatorSessionId: id(3),
        version: 1,
        businessDate: '2026-10-13',
        merchantName: 'Umi',
        merchantLogoUrl: null,
        locationName: 'Local',
        operatorName: 'Cajero',
        customerId: null,
        originOrderId: null,
        originChannel: null,
        fulfillmentType: 'dine_in',
        lines: [],
      },
      { fingerprint: 'a'.repeat(64), totals: { grandTotal: money(1500) } } as never,
      tenders.map((tender, index) => ({
        attempt: {
          id: id(50 + index),
          amount: tender.applied,
          method: tender.type === 'cash' ? 'cash' : 'external_terminal',
        },
      })) as never,
      summary,
      id(7),
      { id: id(73) } as never,
      {
        receiptRef: 'provisional',
        currency: 'MXN',
        grandTotal: money(1500),
        lines: [],
        receiptDestination: 'display',
      } as never,
      finalShift,
      id(74),
      {
        operatorId: id(3),
        deviceId: id(4),
        credentialVersion: 1,
        operatorName: 'Cajero',
        permissions: [],
      },
      'correlation',
      id(75),
      'b'.repeat(64),
      null,
    );
    expect(result.sale.id).toBe(id(72));
    expect(saleShift).toBe(finalShift);
    expect(receiptDate).toBe('2026-10-14');
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO merchant.cash_ledger_entry'),
      ),
    ).toBe(false);
  });
});
