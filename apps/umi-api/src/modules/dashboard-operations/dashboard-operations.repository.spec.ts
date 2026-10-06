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

describe('DashboardOperationsRepository.salesSummary — channel attribution', () => {
  // The channel wedge reads FROZEN money-truth (receipt_snapshot.grand_total) and groups by
  // the origin_channel denormalized onto the committed sale at checkout — never the mutable
  // order_total (a working/owed quote). See docs/architecture/2026-09-13-pos-channel-attribution-adr.md.
  function makeSales(channelRows: unknown[]) {
    const query = vi.fn((sql: string) => {
      if (/origin_channel/.test(sql)) return Promise.resolve({ rows: channelRows });
      if (/m\.timezone/.test(sql))
        return Promise.resolve({
          rows: [{ timezone: 'America/Mexico_City', currency: 'MXN', today: '2026-09-13' }],
        });
      return Promise.resolve({ rows: [] });
    });
    const pg = {
      runWithMerchant: vi.fn(
        (_m: string, _u: string, op: (c: { query: typeof query }) => unknown) => op({ query }),
      ),
    };
    return { repository: new DashboardOperationsRepository(pg as never), pg, query };
  }

  it('attributes committed revenue by the frozen origin_channel, defaulting to walk_in', async () => {
    const fixture = makeSales([
      { channel: 'whatsapp', net: '50000', orders: '3' },
      { channel: 'walk_in', net: '78700', orders: '10' },
    ]);

    const summary = await fixture.repository.salesSummary(
      '00000000-0000-4000-8000-000000000003',
      '1860305f-e864-d745-29e6-fb8830926cc6',
      { range: 'last_7_days', locationId: undefined },
      null,
    );

    expect(fixture.pg.runWithMerchant).toHaveBeenCalled();

    const channelCall = fixture.query.mock.calls.find(([sql]) => /origin_channel/.test(sql));
    expect(channelCall).toBeDefined();
    const sql = channelCall![0];
    // Frozen money-truth, never the working/owed total (ORDER_MODEL §4).
    expect(sql).toContain('r.grand_total');
    expect(sql).not.toContain('order_total');
    expect(sql).toContain("coalesce(s.origin_channel,'walk_in')");
    expect(sql).toMatch(/GROUP BY/i);

    // channelMix reconciles to the same committed-sale set the top-line net sums.
    expect(summary.channelMix).toEqual([
      { channel: 'whatsapp', netSalesMinorUnits: 50000, orders: 3 },
      { channel: 'walk_in', netSalesMinorUnits: 78700, orders: 10 },
    ]);
  });
});
