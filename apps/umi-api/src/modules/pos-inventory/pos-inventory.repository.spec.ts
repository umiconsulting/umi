import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { PosInventoryRepository } from './pos-inventory.repository';

const merchantId = '10000000-0000-4000-8000-000000000001';
const locationId = '10000000-0000-4000-8000-000000000002';
const inventoryLocationId = '10000000-0000-4000-8000-000000000003';

const dto = {
  locationId,
  inventoryLocationId,
  operatorSessionId: '10000000-0000-4000-8000-000000000004',
  commandId: '10000000-0000-4000-8000-000000000005',
  idempotencyKey: '10000000-0000-4000-8000-000000000006',
  expectedVersion: 1,
  policyFingerprint: 'a'.repeat(64),
  approvalId: null,
  approvalFingerprint: null,
  businessDate: '2026-10-11',
  scope: 'full_location' as const,
  itemIds: [],
};

const authorization = {
  operatorId: '10000000-0000-4000-8000-000000000007',
  deviceId: '10000000-0000-4000-8000-000000000008',
  credentialVersion: 1,
} as unknown as Parameters<PosInventoryRepository['createCount']>[2];

/**
 * The count that is already open wins.
 *
 * `inventory_count_active_scope_uidx` allows one active count per inventory
 * location, whoever started it. The till asked for a second one on the iMin
 * D3-504 on 2026-10-11 — after a restart, because a new operator session cannot
 * see the count the previous one started — and got a raw `duplicate key value
 * violates unique constraint` as a 500. The guard is here so the refusal has a
 * name; the index stays the race guard.
 */
describe('PosInventoryRepository count admission', () => {
  it('refuses a second count in the same warehouse with a named conflict', async () => {
    const repository = new PosInventoryRepository({} as PgService);
    const client = {
      query: vi
        .fn()
        // the current policy, which the command must be fingerprinted against
        .mockResolvedValueOnce({
          rows: [{ fingerprint: dto.policyFingerprint }],
          rowCount: 1,
        })
        // the location version
        .mockResolvedValueOnce({ rows: [{ version: 1 }], rowCount: 1 })
        // the count already open in that warehouse
        .mockResolvedValueOnce({
          rows: [{ id: '10000000-0000-4000-8000-000000000009' }],
          rowCount: 1,
        }),
    } as unknown as PoolClient;

    await expect(
      repository.createCount(client, merchantId, authorization, dto, 'correlation-1'),
    ).rejects.toMatchObject({ response: { code: 'INVENTORY_COUNT_ALREADY_ACTIVE' } });
    // Three reads and no INSERT: the refusal happens before the write.
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
  });

  it('lets the count through when the warehouse has none open', async () => {
    const repository = new PosInventoryRepository({} as PgService);
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ fingerprint: dto.policyFingerprint }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ version: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // the scope read finds no items, which is the next refusal in the flow
        .mockResolvedValueOnce({ rows: [{ itemIds: [] }], rowCount: 1 }),
    } as unknown as PoolClient;

    await expect(
      repository.createCount(client, merchantId, authorization, dto, 'correlation-2'),
    ).rejects.toMatchObject({ response: { code: 'INVENTORY_COUNT_SCOPE_MISMATCH' } });
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });
});
