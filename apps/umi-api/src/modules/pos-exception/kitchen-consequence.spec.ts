import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { PosExceptionRepository } from './pos-exception.repository';

describe('Gate 4A void kitchen consequence', () => {
  it('cancels pending work and preserves ready physical work', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'kitchen-order', version: '4' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'exception' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PosExceptionRepository({} as never) as unknown as {
      applyVoidKitchenConsequence(
        client: PoolClient,
        merchantId: string,
        locationId: string,
        saleId: string,
        exceptionId: string,
        correlationId: string,
      ): Promise<void>;
    };

    await repository.applyVoidKitchenConsequence(
      { query } as unknown as PoolClient,
      'merchant',
      'location',
      'sale',
      'exception',
      'correlation',
    );

    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[1]?.[0]).toContain("status IN ('queued','preparing','exception')");
    expect(query.mock.calls[2]?.[0]).toContain("bool_or(status='ready')");
    expect(query.mock.calls[3]?.[1]).toEqual(['merchant', 'kitchen-order', 'exception', 5]);
    expect(query.mock.calls[4]?.[0]).toContain("'order_cancelled'");
  });

  it('does nothing when the sale has no kitchen projection', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const repository = new PosExceptionRepository({} as never) as unknown as {
      applyVoidKitchenConsequence(
        client: PoolClient,
        merchantId: string,
        locationId: string,
        saleId: string,
        exceptionId: string,
        correlationId: string,
      ): Promise<void>;
    };

    await repository.applyVoidKitchenConsequence(
      { query } as unknown as PoolClient,
      'merchant',
      'location',
      'sale',
      'exception',
      'correlation',
    );

    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('refund kitchen consequence (line-scoped, state-aware)', () => {
  type RefundConsequence = {
    applyRefundKitchenConsequence(
      client: PoolClient,
      merchantId: string,
      locationId: string,
      saleId: string,
      exceptionId: string,
      lines: ReadonlyArray<{ saleLineId: string; quantity: number }>,
      correlationId: string,
    ): Promise<void>;
  };

  it('cancels un-started work for a refunded line and recomputes the order status', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'kitchen-order', version: '4' }] }) // locate order
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'item-1' }] }) // cancel line
      .mockResolvedValueOnce({ rows: [{ status: 'queued' }] }) // recompute from remaining
      .mockResolvedValueOnce({ rows: [] }) // update kitchen_order
      .mockResolvedValueOnce({ rows: [] }); // event
    const repository = new PosExceptionRepository({} as never) as unknown as RefundConsequence;

    await repository.applyRefundKitchenConsequence(
      { query } as unknown as PoolClient,
      'merchant',
      'location',
      'sale',
      'exception',
      [{ saleLineId: 'line-1', quantity: 1 }],
      'correlation',
    );

    expect(query).toHaveBeenCalledTimes(5);
    // only un-started items are eligible to cancel
    expect(query.mock.calls[1]?.[0]).toContain("status IN ('queued','preparing')");
    // line-scoped + capped at the refunded quantity
    expect(query.mock.calls[1]?.[1]).toEqual(['merchant', 'kitchen-order', 'line-1', 1]);
    // remaining item(s) still queued → order stays queued, version bumped 4→5
    expect(query.mock.calls[3]?.[1]).toEqual(['merchant', 'kitchen-order', 'queued', 5]);
    // a non-cancelling refund emits order_updated, not order_cancelled
    expect(query.mock.calls[4]?.[0]).toContain('sale_refunded');
    expect(query.mock.calls[4]?.[1]?.[4]).toBe('order_updated');
  });

  it('leaves the kitchen order untouched when every refunded item was already made', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'kitchen-order', version: '4' }] }) // locate order
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // nothing un-started to cancel
    const repository = new PosExceptionRepository({} as never) as unknown as RefundConsequence;

    await repository.applyRefundKitchenConsequence(
      { query } as unknown as PoolClient,
      'merchant',
      'location',
      'sale',
      'exception',
      [{ saleLineId: 'line-1', quantity: 1 }],
      'correlation',
    );

    // no status recompute, no update, no event — a refund never downgrades made work
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the sale has no kitchen projection', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const repository = new PosExceptionRepository({} as never) as unknown as RefundConsequence;

    await repository.applyRefundKitchenConsequence(
      { query } as unknown as PoolClient,
      'merchant',
      'location',
      'sale',
      'exception',
      [{ saleLineId: 'line-1', quantity: 1 }],
      'correlation',
    );

    expect(query).toHaveBeenCalledTimes(1);
  });
});
