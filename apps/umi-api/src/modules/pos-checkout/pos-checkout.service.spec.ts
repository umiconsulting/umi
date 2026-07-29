import { UnauthorizedException } from '@nestjs/common';
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
    authorize: vi.fn().mockResolvedValue({ operatorName: 'Ada' }),
    lockCart: vi.fn().mockResolvedValue(cart),
    reserve: vi.fn().mockResolvedValue({
      id: id(10),
      status: 'reserved',
      expiresAt: '2026-07-28T19:10:00.000Z',
      lineCount: 1,
    }),
    payment: vi.fn(async (_client, _cart, method, confirmation, correlationId) => ({
      attempt: {
        id: id(11),
        method,
        amount: confirmation.totals.grandTotal,
        status: method === 'cash' ? 'succeeded' : 'unknown',
        expiresAt: method === 'cash' ? null : '2026-07-28T19:10:00.000Z',
        correlationId,
        queryOnly: method !== 'cash',
        createdAt: '2026-07-28T19:00:00.000Z',
      },
      ambiguity:
        method === 'cash'
          ? null
          : {
              paymentRef: id(11),
              status: 'unknown',
              queryOnly: true,
              canRetryAsNew: false,
              queryAfter: '2026-07-28T19:10:00.000Z',
              correlationId,
            },
    })),
    commit: vi.fn().mockResolvedValue({
      id: id(12),
      orderId: id(13),
      receiptRef: `POS-${id(11)}`,
      status: 'committed',
      committedAt: '2026-07-28T19:00:00.000Z',
      totals: {},
    }),
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
    });
    expect(result.status).toBe('payment_unknown');
    expect(result.payment?.ambiguity?.canRetryAsNew).toBe(false);
    expect(repo.commit).not.toHaveBeenCalled();
  });

  it('fails closed before checkout without a trusted device', async () => {
    const { service } = harness();
    await expect(service.checkout({ ...user, deviceId: null }, id(1), base)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
