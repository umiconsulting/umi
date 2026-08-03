import { describe, expect, it } from 'vitest';
import type { CheckoutCommand, CheckoutPolicy, TotalsConfirmation } from '@umi/contract';
import { calculateCheckout } from './checkout-calculator';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });
const confirmation: TotalsConfirmation = {
  cartVersion: 1,
  fingerprint: 'a'.repeat(64),
  totals: {
    subtotal: money(10_000),
    tax: money(1_379),
    discounts: { total: money(0), entries: [] },
    grandTotal: money(10_000),
    businessDate: '2026-07-29',
  },
  taxes: {
    total: money(1_379),
    entries: [{ rateBasisPoints: 1600, taxableAmount: money(10_000), taxAmount: money(1_379) }],
  },
  discounts: { total: money(0), entries: [] },
  catalogVersion: 'catalog-1',
  pricingVersion: 'pricing-1',
  taxVersion: 'tax-1',
  snapshotAt: '2026-07-29T18:00:00.000Z',
  confirmedAt: null,
};
const policy: CheckoutPolicy = {
  version: '1',
  manualTerminalEnabled: true,
  mixedTenderEnabled: true,
  maximumTenderLines: 8,
  manualTerminalApprovalThreshold: money(50_000),
  manualTerminalApprovalPermission: 'checkout.terminal.approve',
  tip: {
    enabled: true,
    presetBasisPoints: [1000, 1500, 2000],
    customPercentageEnabled: true,
    customFixedEnabled: true,
    maximumTip: money(5_000),
    requiredPermission: null,
    version: '1',
  },
  discount: {
    enabled: true,
    maximumBasisPoints: 3000,
    maximumAmount: money(5_000),
    cashierThreshold: money(1_000),
    customRequiresApproval: true,
    requiredPermission: 'checkout.discount.apply',
    approvalPermission: 'checkout.discount.approve',
    version: '1',
  },
};
const command: CheckoutCommand = {
  cartId: id(1),
  locationId: id(2),
  operatorSessionId: id(3),
  expectedCartVersion: 1,
  paymentMethod: 'cash',
  totalsFingerprint: null,
  idempotencyKey: id(4),
  commandId: id(5),
  tenderDrafts: [],
  tipDraft: null,
  discountDrafts: [],
  approvalIds: [],
  receiptDelivery: { destination: 'display', channel: null, customerContactId: null },
};

describe('Gate 3B checkout calculator', () => {
  it('calculates exact cash and change with integer money', () => {
    const result = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(10_000),
            amountReceived: money(20_000),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.partialPaymentState).toBe('fully_covered');
    expect(result.summary.change.minorUnits).toBe(10_000);
  });

  it('supports a deterministic cash and manual-terminal split', () => {
    const result = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(4_000),
            amountReceived: money(4_000),
            status: 'draft',
            correlationId: null,
          },
          {
            id: id(7),
            type: 'manual_terminal',
            amount: money(6_000),
            amountReceived: null,
            status: 'confirmed_success',
            correlationId: 'terminal-1',
          },
        ],
      },
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.remainingBalance.minorUnits).toBe(0);
    expect(result.summary.tenders.map((item) => item.type)).toEqual(['cash', 'manual_terminal']);
  });

  it('blocks partial payment, over-allocation, and unknown terminal outcomes', () => {
    const partial = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(4_000),
            amountReceived: money(4_000),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    expect(partial).toMatchObject({ ok: false, code: 'REMAINING_BALANCE' });

    const over = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'manual_terminal',
            amount: money(10_001),
            amountReceived: null,
            status: 'confirmed_success',
            correlationId: 'terminal-1',
          },
        ],
      },
      policy,
    );
    expect(over).toMatchObject({ ok: false, code: 'TENDER_OVERALLOCATION' });

    const unknown = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'manual_terminal',
            amount: money(10_000),
            amountReceived: null,
            status: 'outcome_unknown',
            correlationId: 'terminal-1',
          },
        ],
      },
      policy,
    );
    expect(unknown).toMatchObject({ ok: false, code: 'TERMINAL_OUTCOME_UNKNOWN' });

    const failed = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'manual_terminal',
            amount: money(10_000),
            amountReceived: null,
            status: 'operator_reported_failure',
            correlationId: 'terminal-1',
          },
        ],
      },
      policy,
    );
    expect(failed).toMatchObject({ ok: false, code: 'TERMINAL_REPORTED_FAILURE' });

    const invalid = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(0),
            amountReceived: money(0),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    expect(invalid).toMatchObject({ ok: false, code: 'INVALID_TENDER_AMOUNT' });
  });

  it('applies server policy for tips and discounts', () => {
    const result = calculateCheckout(
      confirmation,
      {
        ...command,
        tipDraft: { kind: 'percentage', basisPoints: 1000, fixedAmount: null },
        discountDrafts: [
          {
            id: id(8),
            type: 'order_percentage',
            lineId: null,
            basisPoints: 1000,
            fixedAmount: null,
            reason: 'Equipo',
          },
        ],
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(9_900),
            amountReceived: money(10_000),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmation.discounts.total.minorUnits).toBe(1_000);
    expect(result.summary.tip?.amount.minorUnits).toBe(900);
    expect(result.summary.amountDue.minorUnits).toBe(9_900);
    expect(result.summary.change.minorUnits).toBe(100);
  });

  it('calculates a line discount from the authoritative line value', () => {
    const lineId = id(9);
    const result = calculateCheckout(
      confirmation,
      {
        ...command,
        discountDrafts: [
          {
            id: id(8),
            type: 'line_percentage',
            lineId,
            basisPoints: 1000,
            fixedAmount: null,
            reason: 'Artículo dañado',
          },
        ],
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(9_600),
            amountReceived: money(9_600),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
      new Map([[lineId, 4_000]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmation.discounts.total.minorUnits).toBe(400);
    expect(result.summary.amountDue.minorUnits).toBe(9_600);
  });

  it('fails closed for disabled tips, disabled discounts, and stale approval state', () => {
    const tip = calculateCheckout(
      confirmation,
      {
        ...command,
        tipDraft: { kind: 'fixed', basisPoints: null, fixedAmount: money(100) },
      },
      { ...policy, tip: { ...policy.tip, enabled: false } },
    );
    expect(tip).toMatchObject({ ok: false, code: 'TIP_REJECTED' });

    const discount = calculateCheckout(
      confirmation,
      {
        ...command,
        discountDrafts: [
          {
            id: id(8),
            type: 'order_fixed',
            lineId: null,
            basisPoints: null,
            fixedAmount: money(2_000),
            reason: 'Manual',
          },
        ],
      },
      { ...policy, discount: { ...policy.discount, enabled: false } },
    );
    expect(discount).toMatchObject({ ok: false, code: 'DISCOUNT_REJECTED' });

    const approval = calculateCheckout(
      confirmation,
      {
        ...command,
        discountDrafts: [
          {
            id: id(8),
            type: 'order_fixed',
            lineId: null,
            basisPoints: null,
            fixedAmount: money(2_000),
            reason: 'Manual',
          },
        ],
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(8_000),
            amountReceived: money(8_000),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    expect(approval).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
  });

  it('binds the confirmation fingerprint to the tender allocation', () => {
    const cash = calculateCheckout(
      confirmation,
      {
        ...command,
        tenderDrafts: [
          {
            id: id(6),
            type: 'cash',
            amount: money(10_000),
            amountReceived: money(10_000),
            status: 'draft',
            correlationId: null,
          },
        ],
      },
      policy,
    );
    const terminal = calculateCheckout(
      confirmation,
      {
        ...command,
        paymentMethod: 'external_terminal',
        tenderDrafts: [
          {
            id: id(7),
            type: 'manual_terminal',
            amount: money(10_000),
            amountReceived: null,
            status: 'confirmed_success',
            correlationId: 'terminal-1',
          },
        ],
      },
      policy,
    );
    expect(cash.confirmation.fingerprint).not.toBe(terminal.confirmation.fingerprint);
  });

  it('rejects a full discount without a valid tender fact', () => {
    const result = calculateCheckout(
      confirmation,
      {
        ...command,
        discountDrafts: [
          {
            id: id(8),
            type: 'order_percentage',
            lineId: null,
            basisPoints: 10_000,
            fixedAmount: null,
            reason: 'Full discount',
          },
        ],
      },
      {
        ...policy,
        discount: {
          ...policy.discount,
          maximumBasisPoints: 10_000,
          maximumAmount: money(10_000),
          cashierThreshold: money(10_000),
          customRequiresApproval: false,
        },
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'DISCOUNT_REJECTED' });
  });
});
