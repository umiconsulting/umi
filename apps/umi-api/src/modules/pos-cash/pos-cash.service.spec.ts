import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PosCashService } from './pos-cash.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'cashier@example.test', sessionId: id(2), deviceId: id(3) };
const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });

const pilotMatrix = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../config/umipos-pilot-role-grants.json'), 'utf8'),
) as { profiles: Array<{ role: string; permissions: string[] }> };
const cashierPermissions = pilotMatrix.profiles.find(
  (profile) => profile.role === 'cashier',
)!.permissions;

const authorization = {
  operatorSessionId: id(4),
  operatorId: id(1),
  deviceId: id(3),
  credentialVersion: 1,
  permissions: cashierPermissions,
};

describe('Gate 3C cash application boundary', () => {
  it('executes the canonical Cashier cash journey without super_admin', async () => {
    const calls: string[] = [];
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      openShift: vi.fn().mockImplementation(async () => {
        calls.push('open');
        return { shift: { id: id(9) }, register: { publicReference: 'REG-01' } };
      }),
      movement: vi.fn().mockImplementation(async () => {
        calls.push('paid_in');
        return { ledgerEntry: { sequence: 2 } };
      }),
      submitCount: vi.fn().mockImplementation(async () => {
        calls.push('count');
        return {
          count: { id: id(11), ledgerSequence: 2 },
          variance: { outcome: 'balanced', signedVariance: money(0) },
        };
      }),
      reconcile: vi.fn().mockImplementation(async () => {
        calls.push('reconcile');
        return { id: id(12), outcome: 'balanced', ledgerSequence: 2 };
      }),
      close: vi.fn().mockImplementation(async () => {
        calls.push('close');
        return { summary: { expectedCash: { ledgerSequence: 2 } } };
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          commandId: id(7),
          correlationId: 'cashier-journey',
          appendAudit: vi.fn(),
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      }),
    };
    const service = new PosCashService(repo as never, integrity as never);

    await service.open(user, id(5), {
      locationId: id(6),
      registerId: id(8),
      operatorSessionId: id(4),
      openingFloat: money(2_000),
      denominations: [],
      businessDate: '2026-07-29',
      note: null,
      commandId: id(7),
      idempotencyKey: id(10),
      expectedRegisterVersion: 1,
    });
    await service.movement(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      type: 'paid_in',
      amount: money(100),
      reasonCode: 'pilot_float',
      note: null,
      approvalId: null,
      expectedShiftVersion: 2,
      commandId: id(7),
      idempotencyKey: id(10),
    });
    await service.count(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      countedCash: money(2_100),
      denominations: [],
      expectedShiftVersion: 3,
      expectedLedgerSequence: 2,
      note: null,
      commandId: id(7),
      idempotencyKey: id(10),
    });
    await service.reconcile(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      countAttemptId: id(11),
      resolutionId: null,
      expectedShiftVersion: 4,
      commandId: id(7),
      idempotencyKey: id(10),
    });
    await service.close(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      countAttemptId: id(11),
      reconciliationId: id(12),
      approvalId: null,
      approvalFingerprint: null,
      expectedShiftVersion: 5,
      commandId: id(7),
      idempotencyKey: id(10),
    });

    expect(calls).toEqual(['open', 'paid_in', 'count', 'reconcile', 'close']);
    expect(cashierPermissions).not.toContain('*');
    expect(cashierPermissions).not.toContain('cash.shift.close.approve');
  });

  it('opens one shift through the idempotent transaction boundary', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      openShift: vi.fn().mockResolvedValue({
        shift: { id: id(9) },
        register: { publicReference: 'REG-01' },
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          commandId: id(7),
          correlationId: 'cash-open',
          appendAudit: vi.fn(),
        });
        return {
          status: 'succeeded',
          result: outcome.value,
          failureCode: null,
        };
      }),
    };
    const service = new PosCashService(repo as never, integrity as never);
    const result = await service.open(user, id(5), {
      locationId: id(6),
      registerId: id(8),
      operatorSessionId: id(4),
      openingFloat: money(2_000),
      denominations: [],
      businessDate: '2026-07-29',
      note: null,
      commandId: id(7),
      idempotencyKey: id(10),
      expectedRegisterVersion: 1,
    });
    expect(integrity.execute).toHaveBeenCalledOnce();
    expect(repo.openShift).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ shift: { id: id(9) } });
  });

  it('fails closed when an operator lacks the movement permission', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue({ ...authorization, permissions: ['cash.shift.read'] }),
    };
    const service = new PosCashService(repo as never, { execute: vi.fn() } as never);
    await expect(
      service.movement(user, id(5), id(9), {
        locationId: id(6),
        shiftId: id(9),
        operatorSessionId: id(4),
        type: 'paid_in',
        amount: money(100),
        reasonCode: 'float_correction',
        note: null,
        approvalId: null,
        expectedShiftVersion: 2,
        commandId: id(7),
        idempotencyKey: id(10),
      }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('submits a blind count before it returns a variance', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      submitCount: vi.fn().mockResolvedValue({
        count: { id: id(11) },
        variance: { signedVariance: money(-100) },
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          commandId: id(7),
          correlationId: 'cash-count',
          appendAudit: vi.fn(),
        });
        return {
          status: 'succeeded',
          result: outcome.value,
          failureCode: null,
        };
      }),
    };
    const service = new PosCashService(repo as never, integrity as never);
    const result = await service.count(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      countedCash: money(7_400),
      denominations: [],
      expectedShiftVersion: 3,
      expectedLedgerSequence: 6,
      note: null,
      commandId: id(7),
      idempotencyKey: id(10),
    });
    expect(repo.submitCount).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ count: { id: id(11) } });
  });

  it('rejects a shift ID that differs between the path and command', async () => {
    const service = new PosCashService({} as never, { execute: vi.fn() } as never);
    await expect(
      service.count(user, id(5), id(90), {
        locationId: id(6),
        shiftId: id(91),
        operatorSessionId: id(4),
        countedCash: money(0),
        denominations: [],
        expectedShiftVersion: 1,
        expectedLedgerSequence: 0,
        note: null,
        commandId: id(7),
        idempotencyKey: id(10),
      }),
    ).rejects.toMatchObject({ response: { code: 'CASH_SHIFT_SCOPE_VIOLATION' } });
  });

  it('rejects a cash mutation when the device is not enrolled', async () => {
    const service = new PosCashService(
      { authorize: vi.fn() } as never,
      { execute: vi.fn() } as never,
    );
    await expect(
      service.open({ ...user, deviceId: null }, id(5), {
        locationId: id(6),
        registerId: id(8),
        operatorSessionId: id(4),
        openingFloat: money(0),
        denominations: [],
        businessDate: '2026-07-29',
        note: null,
        commandId: id(7),
        idempotencyKey: id(10),
        expectedRegisterVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('audits a no-sale request without claiming hardware success', async () => {
    const appendAudit = vi.fn();
    const repo = {
      authorize: vi.fn().mockResolvedValue({
        ...authorization,
        permissions: ['cash.drawer.no_sale'],
      }),
      noSale: vi.fn().mockResolvedValue({
        id: id(12),
        shiftId: id(9),
        status: 'requested',
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          commandId: id(7),
          correlationId: 'cash-drawer',
          appendAudit,
        });
        return {
          status: 'succeeded',
          result: outcome.value,
          failureCode: null,
        };
      }),
    };
    const service = new PosCashService(repo as never, integrity as never);
    await service.noSale(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      reasonCode: 'operator_request',
      approvalId: id(11),
      approvalFingerprint: 'a'.repeat(64),
      commandId: id(7),
      idempotencyKey: id(10),
    });
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        publicData: { hardwareVerified: false },
      }),
    );
  });

  it('passes the authorized operator scope into shift close', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      close: vi.fn().mockResolvedValue({
        summary: { expectedCash: { ledgerSequence: 4 } },
      }),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          commandId: id(7),
          correlationId: 'cash-close',
          appendAudit: vi.fn(),
        });
        return {
          status: 'succeeded',
          result: outcome.value,
          failureCode: null,
        };
      }),
    };
    const service = new PosCashService(repo as never, integrity as never);
    await service.close(user, id(5), id(9), {
      locationId: id(6),
      shiftId: id(9),
      operatorSessionId: id(4),
      countAttemptId: id(11),
      reconciliationId: id(12),
      approvalId: null,
      approvalFingerprint: null,
      expectedShiftVersion: 5,
      commandId: id(7),
      idempotencyKey: id(10),
    });
    expect(repo.close).toHaveBeenCalledWith(
      expect.anything(),
      id(5),
      authorization,
      expect.objectContaining({ shiftId: id(9) }),
      'cash-close',
    );
  });

  it('queries one original cash command before a client retry', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      commandRecovery: vi.fn().mockResolvedValue({
        commandId: id(7),
        commandType: 'pos.cash.paid_in',
        status: 'succeeded',
        retryable: false,
        failureCode: null,
        correlationId: 'cash-recovered',
      }),
    };
    const service = new PosCashService(repo as never, { execute: vi.fn() } as never);
    const result = await service.commandRecovery(user, id(5), id(7), {
      locationId: id(6),
      operatorSessionId: id(4),
      commandId: id(7),
      idempotencyKey: id(10),
    });
    expect(result.status).toBe('succeeded');
    expect(repo.commandRecovery).toHaveBeenCalledWith(user.id, id(5), id(6), id(7), id(10));
  });
});
