import { describe, expect, it, vi } from 'vitest';
import { DashboardOperationsRepository } from './dashboard-operations.repository';

function make(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  const pg = {
    runWithMerchant: vi.fn(
      (
        _merchantId: string,
        _userId: string,
        operation: (client: { query: typeof query }) => unknown,
      ) => operation({ query }),
    ),
  };
  return { repository: new DashboardOperationsRepository(pg as never), pg, query };
}

describe('DashboardOperationsRepository', () => {
  it('binds a location as text and keeps the query bounded', async () => {
    const fixture = make();
    await fixture.repository.list(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { domain: 'sales', locationId: undefined, cursor: 20, limit: 20 },
      '00000000-0000-4000-8000-000000000003',
    );

    const [sql, params] = fixture.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('operation."locationId"=$2::text');
    expect(sql).toContain('LIMIT $3 OFFSET $4');
    expect(params).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      21,
      20,
    ]);
  });

  it('keeps merchant-level product facts available in a location context', async () => {
    const fixture = make();
    await fixture.repository.list(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { domain: 'catalog', locationId: undefined, cursor: 0, limit: 20 },
      '00000000-0000-4000-8000-000000000003',
    );

    const [sql, params] = fixture.query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('operation."locationId"');
    expect(params).toEqual(['00000000-0000-4000-8000-000000000002', 21, 0]);
  });

  it('uses the business command start time for recovery rows', async () => {
    const fixture = make();
    await fixture.repository.list(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { domain: 'recovery', locationId: undefined, cursor: 0, limit: 20 },
      '00000000-0000-4000-8000-000000000003',
    );

    const [sql] = fixture.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('coalesce(c.completed_at,c.started_at)');
    expect(sql).not.toContain('c.created_at');
  });

  it('bounds text and rejects unsafe integer projections', async () => {
    const fixture = make([
      {
        id: 'i'.repeat(200),
        publicReference: 'r'.repeat(200),
        title: 't'.repeat(300),
        detail: 'd'.repeat(600),
        status: 's'.repeat(120),
        locationId: null,
        occurredAt: null,
        amountMinorUnits: '9007199254740992',
        currency: 'MXN',
        version: '-1',
        correlationId: 'c'.repeat(200),
      },
    ]);
    const result = await fixture.repository.list(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      { domain: 'organization', locationId: undefined, cursor: 0, limit: 20 },
      null,
    );

    expect(result[0]).toMatchObject({ amountMinorUnits: null, version: null });
    expect(result[0].title).toHaveLength(240);
    expect(result[0].detail).toHaveLength(500);
    expect(result[0].correlationId).toHaveLength(160);
  });
});
