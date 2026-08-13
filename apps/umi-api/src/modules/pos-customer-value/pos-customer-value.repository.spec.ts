import { describe, expect, it, vi } from 'vitest';
import { PosCustomerValueRepository } from './pos-customer-value.repository';

describe('PosCustomerValueRepository authorization expiry', () => {
  it('orders the distinct projected merchant identifier', async () => {
    const pg = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      tquery: vi.fn(),
    };
    const repository = new PosCustomerValueRepository(pg as never, {} as never);

    await repository.expireAllAuthorizations();

    const sql = String(pg.query.mock.calls[0]?.[0]);
    expect(sql).toContain('merchant_id::text AS id');
    expect(sql).toMatch(/ORDER BY id LIMIT 500/);
  });
});
