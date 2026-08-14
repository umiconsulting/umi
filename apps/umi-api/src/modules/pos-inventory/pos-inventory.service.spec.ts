import { describe, expect, it, vi } from 'vitest';
import { PosInventoryService } from './pos-inventory.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'operator@example.test', sessionId: id(2), deviceId: id(3) };
const authorization = {
  operatorId: id(1),
  deviceId: id(3),
  credentialVersion: 1,
  permissions: ['inventory.read', 'inventory.adjust.decrease', 'inventory.count.reconcile'],
};
const adjustment = {
  locationId: id(4),
  inventoryLocationId: id(5),
  operatorSessionId: id(6),
  commandId: id(7),
  idempotencyKey: id(8),
  expectedVersion: 1,
  policyFingerprint: 'a'.repeat(64),
  approvalId: null,
  approvalFingerprint: null,
  businessDate: '2026-08-05',
  inventoryItemId: id(9),
  direction: 'decrease' as const,
  quantity: { value: 1, scale: 0, unit: 'unit' as const },
  reason: 'operational_correction' as const,
  note: null,
};

describe('Gate 3E inventory application boundary', () => {
  it('requires an enrolled device', async () => {
    const service = new PosInventoryService({ authorize: vi.fn() } as never, {} as never);
    await expect(
      service.overview({ ...user, deviceId: null }, id(10), {
        locationId: id(4),
        operatorSessionId: id(6),
        limit: 50,
      }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('uses effective permissions instead of a role label', async () => {
    const repo = { authorize: vi.fn().mockResolvedValue(null) };
    const service = new PosInventoryService(repo as never, {} as never);
    await expect(
      service.overview({ ...user, role: 'owner' } as never, id(10), {
        locationId: id(4),
        operatorSessionId: id(6),
        limit: 50,
      }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      id(10),
      id(4),
      id(6),
      id(3),
      'inventory.read',
    );
  });

  it('maps database stock conflicts to stable public codes', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      mutationApprovalRequirement: vi.fn().mockResolvedValue(null),
    };
    const integrity = { execute: vi.fn().mockRejectedValue(new Error('NEGATIVE_STOCK_BLOCKED')) };
    const service = new PosInventoryService(repo as never, integrity as never);
    await expect(service.adjustment(user, id(10), adjustment)).rejects.toMatchObject({
      response: { code: 'NEGATIVE_STOCK_BLOCKED' },
    });
  });

  it('commits an authorized adjustment once through command integrity', async () => {
    const result = {
      commandId: adjustment.commandId,
      entries: [],
      balances: [],
      recovered: false,
      correlationId: 'inventory-test',
    };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      mutationApprovalRequirement: vi.fn().mockResolvedValue(null),
      mutate: vi.fn().mockResolvedValue(result),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          correlationId: 'inventory-test',
          appendAudit: vi.fn(),
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      }),
    };
    const service = new PosInventoryService(repo as never, integrity as never);
    await expect(service.adjustment(user, id(10), adjustment)).resolves.toEqual(result);
    expect(repo.mutate).toHaveBeenCalledOnce();
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('returns the exact approval boundary before command integrity starts', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      mutationApprovalRequirement: vi.fn().mockResolvedValue({
        permission: 'inventory.adjust.approve',
        fingerprint: 'b'.repeat(64),
      }),
    };
    const integrity = { execute: vi.fn() };
    const service = new PosInventoryService(repo as never, integrity as never);
    await expect(service.adjustment(user, id(10), adjustment)).rejects.toMatchObject({
      response: {
        code: 'APPROVAL_REQUIRED',
        fieldErrors: {
          approvalPermission: ['inventory.adjust.approve'],
          approvalFingerprint: ['b'.repeat(64)],
        },
      },
    });
    expect(integrity.execute).not.toHaveBeenCalled();
  });

  it('requires a one-use approval before count reconciliation', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      countApprovalRequirement: vi.fn().mockResolvedValue({
        permission: 'inventory.count.approve',
        fingerprint: 'c'.repeat(64),
      }),
    };
    const service = new PosInventoryService(repo as never, {} as never);
    await expect(
      service.reconcileCount(user, id(10), id(11), {
        ...adjustment,
        countId: id(11),
        countAttempt: 1,
        snapshotLedgerSequence: 4,
        reasons: { [id(9)]: 'unknown_difference' },
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'APPROVAL_REQUIRED',
        fieldErrors: {
          approvalPermission: ['inventory.count.approve'],
          approvalFingerprint: ['c'.repeat(64)],
        },
      },
    });
  });

  it('reconciles a count within tolerance without an approval', async () => {
    const result = {
      count: { id: id(11), status: 'committed' },
      variances: [],
      entries: [],
      recovered: false,
      correlationId: 'count-test',
    };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      countApprovalRequirement: vi.fn().mockResolvedValue(null),
      reconcileCount: vi.fn().mockResolvedValue(result),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          correlationId: 'count-test',
          appendAudit: vi.fn(),
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      }),
    };
    const service = new PosInventoryService(repo as never, integrity as never);
    await expect(
      service.reconcileCount(user, id(10), id(11), {
        ...adjustment,
        countId: id(11),
        countAttempt: 1,
        snapshotLedgerSequence: 4,
        reasons: { [id(9)]: 'counting_error' },
      }),
    ).resolves.toEqual(result);
    expect(repo.reconcileCount).toHaveBeenCalledOnce();
  });

  it('uses the negative-stock approval boundary for a count', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      countApprovalRequirement: vi.fn().mockResolvedValue({
        permission: 'inventory.negative_stock.override',
        fingerprint: 'd'.repeat(64),
      }),
    };
    const service = new PosInventoryService(repo as never, {} as never);
    await expect(
      service.reconcileCount(user, id(10), id(11), {
        ...adjustment,
        countId: id(11),
        countAttempt: 1,
        snapshotLedgerSequence: 4,
        reasons: { [id(9)]: 'missing_stock' },
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'APPROVAL_REQUIRED',
        fieldErrors: {
          approvalPermission: ['inventory.negative_stock.override'],
          approvalFingerprint: ['d'.repeat(64)],
        },
      },
    });
  });
});
