import { describe, expect, it, vi } from 'vitest';
import { exceptionCommandFingerprint, PosExceptionService } from './pos-exception.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'cashier@example.test', sessionId: id(2), deviceId: id(3) };
const authorization = {
  operatorSessionId: id(4),
  durableSessionId: id(2),
  operatorId: id(1),
  operatorReference: 'Cashier',
  locationId: id(6),
  deviceId: id(3),
  credentialVersion: 1,
  permissions: ['sale.exception.read', 'sale.refund.partial'],
};

describe('Gate 3D exception application boundary', () => {
  it('fails closed without the exact refund permission', async () => {
    const repo = { authorize: vi.fn().mockResolvedValue(authorization) };
    const service = new PosExceptionService(repo as never, {} as never, {} as never);
    await expect(
      service.preview(user, id(5), id(7), {
        locationId: id(6),
        operatorSessionId: id(4),
        exceptionType: 'full_refund',
        reason: 'customer_changed_mind',
        note: null,
        lines: [],
        expectedSaleVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('binds manager approval to the sale, preview, and command', async () => {
    const commandFingerprint = exceptionCommandFingerprint(id(7), id(12), 'a'.repeat(64), id(8));
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      assertPreview: vi.fn(),
      approvalActor: vi.fn().mockResolvedValue('Manager'),
    };
    const entry = {
      approveByManager: vi.fn().mockResolvedValue({
        elevationId: id(9),
        expiresAt: '2026-08-03T20:00:00.000Z',
      }),
    };
    const service = new PosExceptionService(repo as never, {} as never, entry as never);
    const result = await service.approval(user, id(5), id(7), {
      locationId: id(6),
      operatorSessionId: id(4),
      saleId: id(7),
      previewId: id(12),
      commandId: id(8),
      previewFingerprint: 'a'.repeat(64),
      commandFingerprint,
      managerPin: '2468',
    });
    expect(entry.approveByManager).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ commandFingerprint, permission: 'sale.refund.approve' }),
    );
    expect(result.oneUse).toBe(true);
  });

  it('rejects a manager fingerprint that belongs to another command', async () => {
    const repo = { authorize: vi.fn().mockResolvedValue(authorization) };
    const service = new PosExceptionService(repo as never, {} as never, {} as never);
    await expect(
      service.approval(user, id(5), id(7), {
        locationId: id(6),
        operatorSessionId: id(4),
        saleId: id(7),
        previewId: id(12),
        commandId: id(8),
        previewFingerprint: 'a'.repeat(64),
        commandFingerprint: 'b'.repeat(64),
        managerPin: '2468',
      }),
    ).rejects.toMatchObject({ response: { code: 'APPROVAL_FINGERPRINT_MISMATCH' } });
  });

  it('commits once through the integrity boundary', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      commit: vi.fn().mockResolvedValue({
        exceptionId: id(10),
        exceptionType: 'partial_refund',
        status: 'committed',
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          correlationId: 'refund',
          appendAudit: vi.fn(),
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      }),
    };
    const service = new PosExceptionService(repo as never, integrity as never, {} as never);
    const result = await service.commit(user, id(5), id(7), {
      locationId: id(6),
      operatorSessionId: id(4),
      previewId: id(12),
      previewFingerprint: 'a'.repeat(64),
      approvalId: null,
      expectedSaleVersion: 1,
      commandId: id(8),
      idempotencyKey: id(9),
      offline: false,
    });
    expect(result).toMatchObject({ exceptionId: id(10) });
    expect(integrity.execute).toHaveBeenCalledOnce();
    expect(repo.commit).toHaveBeenCalledOnce();
  });

  it('requires an enrolled device for every exception mutation', async () => {
    const service = new PosExceptionService(
      { authorize: vi.fn() } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.preview({ ...user, deviceId: null }, id(5), id(7), {
        locationId: id(6),
        operatorSessionId: id(4),
        exceptionType: 'partial_refund',
        reason: 'incorrect_item',
        note: null,
        lines: [{ saleLineId: id(11), quantity: 1, restockDecision: 'restock' }],
        expectedSaleVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });
});
