import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosHardwareService } from './pos-hardware.service';
import { hardwareCommandFingerprint } from './hardware-fingerprint';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'operator@example.test', sessionId: id(2), deviceId: id(3) };
const scope = { locationId: id(4), operatorSessionId: id(5) };
const receipt = {
  receiptId: 'receipt-1',
  merchantName: 'Umi',
  locationName: 'Pilot',
  registerName: null,
  receiptNumber: 'R-1',
  businessDate: '2026-08-09',
  currency: 'MXN',
  items: [],
  subtotalMinorUnits: 100,
  discountMinorUnits: 0,
  taxMinorUnits: 0,
  tipMinorUnits: 0,
  totalMinorUnits: 100,
  tenders: [{ type: 'cash' as const, amountMinorUnits: 100, maskedReference: null }],
  changeMinorUnits: 0,
  loyaltySummary: null,
  customerValueSummary: null,
  exceptionMarker: null,
  qrValue: null,
  footer: null,
};

const command = (overrides: Record<string, unknown> = {}) => {
  const value = {
    ...scope,
    registerId: null,
    commandId: id(7),
    idempotencyKey: 'hardware-command-1',
    targetHardwareId: id(8),
    commandType: 'print_receipt' as const,
    sourceAggregateType: 'receipt',
    sourceAggregateId: 'R-1',
    expectedConfigurationVersion: 1,
    payloadFingerprint: '',
    drawer: null,
    display: null,
    printPayload: receipt,
    ...overrides,
  };
  value.payloadFingerprint = hardwareCommandFingerprint(value);
  return value;
};

const integrity = {
  execute: vi.fn(async (_input, operation) => {
    const outcome = await operation({ client: {}, appendAudit: vi.fn(), correlationId: 'hw-test' });
    return { status: 'succeeded', result: outcome.value, failureCode: null };
  }),
};

describe('Gate 3G-A hardware application boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects direct command use without a trusted POS device', async () => {
    const service = new PosHardwareService({} as never, integrity as never);
    await expect(
      service.command({ ...user, deviceId: null }, id(6), command()),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('updates pilot policy through exact hardware management permission', async () => {
    const result = {
      merchantId: id(6),
      locationId: scope.locationId,
      registerId: null,
      policy: {
        autoPrintReceipt: true,
        openDrawerOnCashSale: true,
        openDrawerOnCashRefund: true,
        allowNoSale: false,
        receiptCopiesDefault: 1,
        hardwareRetryLimit: 2,
        hardwareHealthIntervalSeconds: 30,
        scannerEnabled: true,
        customerDisplayEnabled: false,
      },
      version: 2,
      updatedAt: '2026-08-09T00:00:00.000Z',
    };
    const repo = {
      authorize: vi.fn().mockResolvedValue({ operatorId: user.id, deviceId: user.deviceId }),
      updatePolicy: vi.fn().mockResolvedValue(result),
    };
    const service = new PosHardwareService(repo as never, integrity as never);

    await expect(
      service.updatePolicy(user, id(6), {
        ...scope,
        registerId: null,
        commandId: id(9),
        idempotencyKey: 'hardware-policy-1',
        expectedVersion: 1,
        policy: result.policy,
      }),
    ).resolves.toEqual(result);
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      id(6),
      scope.locationId,
      scope.operatorSessionId,
      user.deviceId,
      'hardware.manage',
    );
  });

  it('uses command-specific permission and command integrity for receipt print', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue({ operatorId: user.id, deviceId: user.deviceId }),
      createCommand: vi.fn().mockResolvedValue({
        command: { commandId: id(7), status: 'pending' },
        recovered: false,
        failure: null,
      }),
      currentCommand: vi.fn().mockResolvedValue({
        command: { commandId: id(7), status: 'pending' },
        recovered: true,
        failure: null,
      }),
    };
    const service = new PosHardwareService(repo as never, integrity as never);
    await service.command(user, id(6), command());
    expect(repo.authorize).toHaveBeenNthCalledWith(
      1,
      user.id,
      user.sessionId,
      id(6),
      scope.locationId,
      scope.operatorSessionId,
      user.deviceId,
      'hardware.command.execute',
    );
    expect(repo.authorize).toHaveBeenNthCalledWith(
      2,
      user.id,
      user.sessionId,
      id(6),
      scope.locationId,
      scope.operatorSessionId,
      user.deviceId,
      'hardware.printer.print',
    );
    expect(integrity.execute).toHaveBeenCalledOnce();
    expect(repo.currentCommand).toHaveBeenCalledWith(user.id, id(6), scope.locationId, id(7));
  });

  it('returns the live command state after an idempotent response retry', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue({ operatorId: user.id, deviceId: user.deviceId }),
      createCommand: vi.fn().mockResolvedValue({
        command: { commandId: id(7), status: 'pending' },
        recovered: false,
        failure: null,
      }),
      currentCommand: vi.fn().mockResolvedValue({
        command: { commandId: id(7), status: 'succeeded' },
        recovered: true,
        failure: null,
      }),
    };
    const service = new PosHardwareService(repo as never, integrity as never);
    const result = await service.command(user, id(6), command());
    expect(result.command.status).toBe('succeeded');
  });

  it('keeps an unknown physical result terminal and query-only', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue({ operatorId: user.id, deviceId: user.deviceId }),
      transition: vi.fn().mockResolvedValue({
        command: { commandId: id(7), status: 'unknown' },
        recovered: false,
        failure: {
          code: 'unknown_outcome',
          retryable: false,
          operatorGuidance: 'verify_physical_result',
        },
      }),
    };
    const service = new PosHardwareService(repo as never, integrity as never);
    const result = await service.transition(user, id(6), id(7), {
      ...scope,
      status: 'unknown',
      failureCode: 'unknown_outcome',
      safeResultMetadata: {},
    });
    expect(result.failure?.retryable).toBe(false);
    expect(repo.transition).toHaveBeenCalledOnce();
  });

  it('blocks payment-terminal and scale execution at the service boundary', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue({ operatorId: user.id, deviceId: user.deviceId }),
    };
    const service = new PosHardwareService(repo as never, integrity as never);
    for (const commandType of ['terminal_connect_foundation', 'scale_read_foundation'] as const) {
      await expect(
        service.command(user, id(6), {
          ...scope,
          registerId: null,
          commandId: id(7),
          idempotencyKey: `hardware-${commandType}`,
          targetHardwareId: id(8),
          commandType,
          sourceAggregateType: 'diagnostic',
          sourceAggregateId: 'foundation',
          expectedConfigurationVersion: 1,
          payloadFingerprint: 'b'.repeat(64),
          drawer: null,
          display: null,
          printPayload: null,
        }),
      ).rejects.toMatchObject({ response: { code: 'HARDWARE_CAPABILITY_UNSUPPORTED' } });
    }
  });
});
