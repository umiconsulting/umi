import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PosSaleRepository } from './pos-sale.repository';

const merchantId = '00000000-0000-4000-8000-000000000001';
const locationId = '00000000-0000-4000-8000-000000000002';
const operatorSessionId = '00000000-0000-4000-8000-000000000003';
const actorId = '00000000-0000-4000-8000-000000000004';
const cartId = '00000000-0000-4000-8000-000000000005';

const request = {
  locationId,
  operatorSessionId,
  idempotencyKey: '00000000-0000-4000-8000-000000000006',
  accounts: [{ cartId, expectedVersion: 3 }],
  reasonCode: 'other' as const,
  reason: 'Cierre manual de un día anterior',
};

function harness(overrides: Record<string, unknown> = {}) {
  const account = {
    id: cartId,
    version: 3,
    status: 'prepared',
    state: 'suspended',
    businessDate: '2026-10-13',
    today: '2026-10-14',
    ownerId: actorId,
    tableId: null,
    committed: false,
    ...overrides,
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT table_id::text AS "tableId"')) return { rows: [{ tableId: null }] };
    if (sql.includes('FOR UPDATE OF c')) return { rows: [account] };
    if (sql.includes("UPDATE merchant.pos_cart SET status='abandoned'")) return { rowCount: 1 };
    if (sql.includes('FROM merchant.pos_cart cart')) {
      return {
        rows: [
          {
            id: cartId,
            state: 'cancelled',
            label: null,
            customerId: null,
            originalOperatorSessionId: operatorSessionId,
            currentOperatorSessionId: operatorSessionId,
            suspendedAt: null,
            cancelledAt: '2026-10-14T12:00:00Z',
            cancellationReasonCode: 'other',
            cancellationReason: request.reason,
            committedSaleId: null,
            sourceOrderId: null,
            receiptId: null,
            receiptRef: null,
            updatedAt: '2026-10-14T12:00:00Z',
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const carts = {
    assertFinanciallyMutable: vi.fn().mockResolvedValue(undefined),
    snapshotWithClient: vi.fn().mockResolvedValue({ id: cartId, version: 4, firedOrderId: null }),
  };
  const repo = new PosSaleRepository({} as never, carts as never);
  return { repo, query, carts, client: { query } as never };
}

describe('selected carried-over account cancellation', () => {
  it('cancels a saved account without claiming it as the current account', async () => {
    const { repo, client, query, carts } = harness();
    const cancelled = await repo.cancelCarriedOver(client, merchantId, actorId, false, request);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].state).toBe('cancelled');
    expect(carts.assertFinanciallyMutable).toHaveBeenCalledWith(client, merchantId, cartId);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE merchant.pos_cart SET status='abandoned'"),
      ),
    ).toBe(true);
  });

  it('rejects a current-day account before any write', async () => {
    const { repo, client, query } = harness({ businessDate: '2026-10-14' });
    await expect(
      repo.cancelCarriedOver(client, merchantId, actorId, false, request),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE merchant.pos_cart SET status='abandoned'"),
      ),
    ).toBe(false);
  });

  it('requires sale.resume.any for an account owned by another operator', async () => {
    const { repo, client } = harness({ ownerId: '00000000-0000-4000-8000-000000000009' });
    await expect(
      repo.cancelCarriedOver(client, merchantId, actorId, false, request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unresolved payments before the cart update', async () => {
    const { repo, client, query, carts } = harness();
    carts.assertFinanciallyMutable.mockRejectedValueOnce(
      new ConflictException({ code: 'CART_PAYMENT_UNRESOLVED' }),
    );
    await expect(
      repo.cancelCarriedOver(client, merchantId, actorId, false, request),
    ).rejects.toMatchObject({
      response: { code: 'CART_PAYMENT_UNRESOLVED' },
    });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("UPDATE merchant.pos_cart SET status='abandoned'"),
      ),
    ).toBe(false);
  });
});
