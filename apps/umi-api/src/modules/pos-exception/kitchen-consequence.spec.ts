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
