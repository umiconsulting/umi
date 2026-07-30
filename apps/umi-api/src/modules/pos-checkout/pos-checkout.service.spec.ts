import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { PaymentSummary } from '@umi/contract';
import { describe, expect, it, vi } from 'vitest';
import { PosCheckoutService } from './pos-checkout.service';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const user = { id: id(1), email: 'operator@example.test', sessionId: id(2), deviceId: id(3) };
const base = {
  cartId: id(4),
  branchId: id(5),
  operatorSessionId: id(6),
  expectedCartVersion: 3,
  paymentMethod: 'cash' as const,
  totalsFingerprint: null,
  idempotencyKey: id(7),
  commandId: id(17),
  tenderDrafts: [
    {
      id: id(18),
      type: 'cash' as const,
      amount: { minorUnits: 23200, currency: 'MXN' },
      amountReceived: { minorUnits: 23200, currency: 'MXN' },
      status: 'draft' as const,
      correlationId: null,
    },
  ],
  tipDraft: null,
  discountDrafts: [],
  approvalIds: [],
  receiptDelivery: {
    destination: 'display' as const,
    channel: null,
    customerContactId: null,
  },
};
const cart = {
  id: id(4),
  tenantId: id(1),
  branchId: id(5),
  operatorSessionId: id(6),
  version: 3,
  businessDate: '2026-07-28',
  tenantName: 'Umi Café',
  branchName: 'Centro',
  operatorName: 'Ada',
  lines: [
    {
      id: id(8),
      productId: id(9),
      variantId: null,
      quantity: 2,
      note: null,
      modifiers: [],
    },
  ],
};

function harness() {
  const repo = {
    authorize: vi.fn().mockResolvedValue({
      operatorName: 'Ada',
      permissions: ['checkout.commit', 'checkout.discount.apply', 'checkout.terminal.confirm'],
    }),
    lockCart: vi.fn().mockResolvedValue(cart),
    policy: vi.fn().mockResolvedValue({
      version: '1',
      manualTerminalEnabled: true,
      mixedTenderEnabled: true,
      maximumTenderLines: 8,
      manualTerminalApprovalThreshold: { minorUnits: 50000, currency: 'MXN' },
      manualTerminalApprovalPermission: 'checkout.terminal.approve',
      tip: {
        enabled: true,
        presetBasisPoints: [1000, 1500],
        customPercentageEnabled: true,
        customFixedEnabled: true,
        maximumTip: { minorUnits: 5000, currency: 'MXN' },
        requiredPermission: null,
        version: '1',
      },
      discount: {
        enabled: true,
        maximumBasisPoints: 3000,
        maximumAmount: { minorUnits: 5000, currency: 'MXN' },
        cashierThreshold: { minorUnits: 1000, currency: 'MXN' },
        customRequiresApproval: true,
        requiredPermission: 'checkout.discount.apply',
        approvalPermission: 'checkout.discount.approve',
        version: '1',
      },
    }),
    saveDraft: vi.fn().mockResolvedValue({ id: id(19), version: 1 }),
    consumeApprovals: vi.fn().mockResolvedValue({ approved: true, missingPermission: null }),
    unknownTerminal: vi.fn(
      async (
        _client: unknown,
        _cart: unknown,
        _checkoutId: string,
        tender: PaymentSummary['tenders'][number],
        correlationId: string,
      ) => ({
        attempt: {
          id: id(30),
          method: 'external_terminal',
          amount: tender.applied,
          status: 'unknown',
          expiresAt: '2026-07-28T19:10:00.000Z',
          correlationId,
          queryOnly: true,
          createdAt: '2026-07-28T19:00:00.000Z',
        },
        ambiguity: {
          paymentRef: id(30),
          status: 'unknown',
          queryOnly: true,
          canRetryAsNew: false,
          queryAfter: '2026-07-28T19:10:00.000Z',
          correlationId,
        },
      }),
    ),
    reserve: vi.fn().mockResolvedValue({
      id: id(10),
      status: 'reserved',
      expiresAt: '2026-07-28T19:10:00.000Z',
      lineCount: 1,
    }),
    payments: vi.fn(
      async (
        _client: unknown,
        _cart: unknown,
        _checkoutId: string,
        summary: PaymentSummary,
        correlationId: string,
      ) =>
        summary.tenders.map((tender, index) => ({
          attempt: {
            id: id(20 + index),
            method: tender.type === 'cash' ? 'cash' : 'external_terminal',
            amount: tender.applied,
            status: 'succeeded',
            expiresAt: null,
            correlationId,
            queryOnly: false,
            createdAt: '2026-07-28T19:00:00.000Z',
          },
          ambiguity: null,
        })),
    ),
    commit: vi.fn().mockResolvedValue({
      id: id(12),
      orderId: id(13),
      receiptId: id(14),
      receiptRef: `POS-${id(11)}`,
      status: 'committed',
      committedAt: '2026-07-28T19:00:00.000Z',
      totals: {},
    }),
    saveCommittedResult: vi.fn().mockResolvedValue(undefined),
    recovery: vi.fn().mockResolvedValue(null),
    cancelDraft: vi.fn().mockResolvedValue({ id: id(19), blocked: false }),
  };
  const carts = {
    price: vi.fn().mockResolvedValue({
      productId: id(9),
      productName: 'Café',
      variantId: null,
      variantName: null,
      variantAttributes: {},
      basePrice: 11600,
      variantDelta: 0,
      taxRateBasisPoints: 1600,
      currency: 'MXN',
      modifiers: [],
    }),
  };
  const integrity = {
    execute: vi.fn(async (_command, operation) => {
      const result = await operation({
        client: {},
        commandId: id(14),
        correlationId: 'checkout-correlation',
        appendAudit: vi.fn(),
        appendFinancial: vi.fn(),
      });
      return result.ok
        ? { status: 'succeeded', result: result.value }
        : { status: 'failed', failureCode: result.code };
    }),
  };
  return {
    service: new PosCheckoutService(repo as never, carts as never, integrity as never),
    repo,
  };
}

describe('PosCheckoutService', () => {
  it('requires explicit confirmation of freshly repriced totals', async () => {
    const { service, repo } = harness();
    const result = await service.checkout(user, id(1), base);
    expect(result.status).toBe('confirmation_required');
    expect(result.confirmation.totals.grandTotal.minorUnits).toBe(23200);
    expect(repo.lockCart).toHaveBeenCalledWith(
      expect.anything(),
      id(1),
      base.branchId,
      base.operatorSessionId,
      base.cartId,
      base.expectedCartVersion,
      'Ada',
    );
    expect(repo.reserve).not.toHaveBeenCalled();
  });

  it('commits one cash sale after explicit fingerprint confirmation', async () => {
    const { service, repo } = harness();
    const preview = await service.checkout(user, id(1), base);
    const result = await service.checkout(user, id(1), {
      ...base,
      idempotencyKey: id(15),
      totalsFingerprint: preview.confirmation.fingerprint,
    });
    expect(result.status).toBe('completed');
    expect(result.receipt?.grandTotal.minorUnits).toBe(23200);
    expect(repo.commit).toHaveBeenCalledOnce();
  });

  it('makes an unknown terminal outcome query-only and never commits', async () => {
    const { service, repo } = harness();
    const preview = await service.checkout(user, id(1), base);
    const result = await service.checkout(user, id(1), {
      ...base,
      paymentMethod: 'external_terminal',
      idempotencyKey: id(16),
      totalsFingerprint: preview.confirmation.fingerprint,
      tenderDrafts: [
        {
          id: id(18),
          type: 'manual_terminal',
          amount: { minorUnits: 23200, currency: 'MXN' },
          amountReceived: null,
          status: 'outcome_unknown',
          correlationId: 'terminal-test',
        },
      ],
    });
    expect(result.status).toBe('payment_unknown');
    expect(result.recoveryState).toBe('terminal_outcome_unknown');
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('persists manual terminal success before explicit checkout confirmation', async () => {
    const { service, repo } = harness();
    const result = await service.checkout(user, id(1), {
      ...base,
      paymentMethod: 'external_terminal',
      tenderDrafts: [
        {
          id: id(18),
          type: 'manual_terminal',
          amount: { minorUnits: 23200, currency: 'MXN' },
          amountReceived: null,
          status: 'confirmed_success',
          correlationId: 'terminal-test',
        },
      ],
    });
    expect(result.status).toBe('confirmation_required');
    expect(repo.saveDraft).toHaveBeenCalledWith(
      expect.anything(),
      user.deviceId,
      cart,
      expect.objectContaining({ paymentMethod: 'external_terminal' }),
      'selecting_tender',
      expect.anything(),
      'none',
      result.confirmation.fingerprint,
    );
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('cancels draft checkout state but blocks terminal facts that need recovery', async () => {
    const { service, repo } = harness();
    const request = {
      branchId: base.branchId,
      operatorSessionId: base.operatorSessionId,
      reason: 'operator_cancelled',
      checkoutFingerprint: null,
      approvalIds: [],
      idempotencyKey: id(40),
    };
    const result = await service.cancel(user, id(1), base.cartId, request);
    expect(result.state).toBe('ready');

    repo.cancelDraft.mockResolvedValueOnce({ id: id(19), blocked: true });
    await expect(
      service.cancel(user, id(1), base.cartId, {
        ...request,
        idempotencyKey: id(41),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires separate approvals for a discount and a sensitive terminal allocation', async () => {
    const { service, repo } = harness();
    repo.policy.mockResolvedValue({
      ...(await repo.policy()),
      manualTerminalApprovalThreshold: { minorUnits: 10000, currency: 'MXN' },
    });
    repo.consumeApprovals.mockResolvedValueOnce({
      approved: false,
      missingPermission: 'checkout.terminal.approve',
    });
    const request = {
      ...base,
      paymentMethod: 'external_terminal' as const,
      tenderDrafts: [
        {
          id: id(18),
          type: 'manual_terminal' as const,
          amount: { minorUnits: 21200, currency: 'MXN' },
          amountReceived: null,
          status: 'confirmed_success' as const,
          correlationId: 'terminal-test',
        },
      ],
      discountDrafts: [
        {
          id: id(42),
          type: 'order_fixed' as const,
          lineId: null,
          basisPoints: null,
          fixedAmount: { minorUnits: 2000, currency: 'MXN' },
          reason: 'Manager discount',
        },
      ],
      approvalIds: [id(43)],
    };
    const preview = await service.checkout(user, id(1), request);
    const result = await service.checkout(user, id(1), {
      ...request,
      totalsFingerprint: preview.confirmation.fingerprint,
    });
    expect(repo.consumeApprovals).toHaveBeenCalledWith(
      expect.anything(),
      [id(43)],
      expect.objectContaining({
        permissions: ['checkout.discount.approve', 'checkout.terminal.approve'],
        fingerprint: preview.confirmation.fingerprint,
      }),
    );
    expect(result.failure?.requiredPermission).toBe('checkout.terminal.approve');
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('returns the immutable committed result during restart recovery', async () => {
    const { service, repo } = harness();
    const committed = {
      status: 'completed' as const,
      confirmation: {} as never,
      payment: null,
      payments: [],
      reservation: null,
      sale: null,
      receipt: null,
      failure: null,
      paymentSummary: null,
      recoveryState: 'none' as const,
      receiptDelivery: base.receiptDelivery,
      policy: null,
    };
    repo.recovery.mockResolvedValueOnce({
      checkoutId: id(19),
      cartId: base.cartId,
      checkoutVersion: 2,
      state: 'completed',
      tenderDrafts: base.tenderDrafts,
      tipDraft: null,
      discountDrafts: [],
      receiptDelivery: base.receiptDelivery,
      paymentSummary: null,
      paymentOutcome: null,
      result: committed,
      recoveryState: 'none',
      checkoutFingerprint: 'a'.repeat(64),
      updatedAt: '2026-07-29T19:00:00.000Z',
    });
    const result = await service.recovery(user, id(1), base.cartId, {
      branchId: base.branchId,
      operatorSessionId: base.operatorSessionId,
    });
    expect(result.result).toEqual(committed);
    expect(repo.recovery).toHaveBeenCalledWith(
      id(1),
      base.branchId,
      base.operatorSessionId,
      base.cartId,
      user.id,
      false,
    );
  });

  it('fails closed before checkout without a trusted device', async () => {
    const { service } = harness();
    await expect(service.checkout({ ...user, deviceId: null }, id(1), base)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
