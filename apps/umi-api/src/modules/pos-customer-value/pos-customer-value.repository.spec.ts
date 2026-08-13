import { describe, expect, it, vi } from 'vitest';
import { PosCustomerValueRepository } from './pos-customer-value.repository';

describe('PosCustomerValueRepository authorization expiry', () => {
  it('uses the worker wrapper for authorization expiry', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'merchant' }] })
      .mockResolvedValueOnce({ rows: [{ count: 2 }] });
    const repository = new PosCustomerValueRepository({ query } as never, {} as never);

    await expect(repository.expireAllAuthorizations()).resolves.toBe(2);
    expect(query.mock.calls[1][0]).toContain('expire_customer_value_authorizations_worker');
  });

  it('reads cart currency from the merchant business record', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pg = {
      runWithMerchant: vi.fn(async (_merchantId, _userId, callback) => callback({ query })),
    };
    const repository = new PosCustomerValueRepository(pg as never, {} as never);

    await expect(
      repository.preview('user', '10000000-0000-4000-8000-000000000101', {
        locationId: '20000000-0000-4000-8000-000000000101',
        operatorSessionId: '30000000-0000-4000-8000-000000000101',
        saleId: '40000000-0000-4000-8000-000000000101',
        checkoutVersion: 1,
        customerId: null,
        checkoutFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toBeDefined();

    expect(query.mock.calls[0][0]).toContain('JOIN merchant.merchant business');
    expect(query.mock.calls[0][0]).toContain('business.currency');
    expect(query.mock.calls[0][0]).not.toContain('c.currency');
  });

  it('casts the stored-value amount inside the ledger JSON payload', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: '1',
            currency: 'MXN',
            status: 'active',
            version: 1,
            customerId: 'c',
            available: 5000,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ createdAt: '2026-08-13T00:00:00.000Z', expiresAt: '2026-08-13T00:05:00.000Z' }],
      })
      .mockResolvedValueOnce({ rows: [{}] });
    const repository = new PosCustomerValueRepository({} as never, {} as never);

    await repository.authorizeStoredValue(
      { query } as never,
      '10000000-0000-4000-8000-000000000101',
      {
        locationId: '20000000-0000-4000-8000-000000000101',
        operatorSessionId: '30000000-0000-4000-8000-000000000101',
        commandId: '40000000-0000-4000-8000-000000000101',
        idempotencyKey: '50000000-0000-4000-8000-000000000101',
        expectedVersion: null,
        accountType: 'wallet',
        accountId: '60000000-0000-4000-8000-000000000101',
        customerId: 'c',
        saleId: '70000000-0000-4000-8000-000000000101',
        checkoutVersion: 1,
        amount: { minorUnits: 1000, currency: 'MXN' },
        checkoutFingerprint: 'a'.repeat(64),
        allocationId: '80000000-0000-4000-8000-000000000101',
        allocationOrder: 0,
        accountPublicReference: 'WAL-1',
      },
      {
        operatorId: '90000000-0000-4000-8000-000000000101',
        deviceId: '91000000-0000-4000-8000-000000000101',
        credentialVersion: 1,
      } as never,
      'correlation-1',
    );

    expect(query.mock.calls[2][0]).toContain("'amountMinorUnits',$3::bigint");
  });

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
