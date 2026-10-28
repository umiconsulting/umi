import { describe, expect, it, vi } from 'vitest';
import type { CashMovementRequest } from '@umi/contract';
import { PosCashRepository } from './pos-cash.repository';

const shiftId = '00000000-0000-4000-8000-000000000009';
const merchantId = '00000000-0000-4000-8000-000000000005';
const locationId = '00000000-0000-4000-8000-000000000006';
const deviceId = '00000000-0000-4000-8000-000000000003';
const operatorId = '00000000-0000-4000-8000-000000000001';

const movement: CashMovementRequest = {
  locationId,
  shiftId,
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  type: 'paid_out',
  amount: { minorUnits: 100, currency: 'MXN' },
  reasonCode: 'test_withdrawal',
  note: null,
  approvalId: null,
  actionFingerprint: null,
  expectedShiftVersion: 14,
  commandId: '00000000-0000-4000-8000-000000000007',
  idempotencyKey: '00000000-0000-4000-8000-000000000010',
};

describe('POS cash movement concurrency', () => {
  it('reports a stale shift version as a recoverable conflict', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            status: 'open',
            registerId: '00000000-0000-4000-8000-000000000008',
            currency: 'MXN',
            businessDate: '2026-10-24',
            version: 20,
            sequence: '20',
            holdingDeviceId: deviceId,
            responsibleOperatorId: operatorId,
          },
        ],
      }),
    };
    const repository = new PosCashRepository({} as never);

    await expect(
      repository.movement(
        client as never,
        merchantId,
        {
          operatorSessionId: movement.operatorSessionId,
          operatorId,
          deviceId,
          credentialVersion: 1,
          permissions: ['cash.movement.paid_out'],
        },
        movement,
      ),
    ).rejects.toMatchObject({
      name: 'CashRefusal',
      code: 'OPTIMISTIC_VERSION_CONFLICT',
      status: 409,
      details: {
        reason: 'shift_changed',
        shiftId,
        shiftStatus: 'open',
        shiftVersion: 20,
        expectedShiftVersion: 14,
      },
    });
  });
});
