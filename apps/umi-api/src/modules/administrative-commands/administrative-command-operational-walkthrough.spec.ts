import { describe, expect, it, vi } from 'vitest';
import { AdministrativeCommandExecutionService } from './administrative-command-execution.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = {
  id: id(1),
  email: 'owner@example.test',
  sessionId: id(2),
  deviceId: null,
  commandContextType: 'dashboard_administrative' as const,
};
const access = {
  merchantId: id(3),
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: id(4),
  role: 'owner',
  roles: ['owner'],
  permissions: ['*'],
  locationId: id(5),
};

describe('Gate 5A operational command walkthrough', () => {
  it('dispatches the P0 journey through each canonical domain service', async () => {
    const contexts = {
      create: vi.fn(async (_user, _access, request) => ({
        type: 'dashboard_administrative',
        actorUserId: user.id,
        membershipId: access.membershipId,
        merchantId: access.merchantId,
        locationId: request.locationId,
        sessionId: user.sessionId,
        permission: 'walkthrough',
        operation: request.operation,
        targetAggregateId: request.targetAggregateId,
        targetVersion: request.targetVersion,
        commandId: request.commandId,
        idempotencyKey: request.idempotencyKey,
        fingerprint: 'a'.repeat(64),
        approvalId: request.approvalId,
        origin: 'dashboard',
        issuedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-10T00:05:00.000Z',
      })),
      execute: vi.fn(async (_context, action) =>
        action({ commandRecordId: id(90), correlationId: 'walkthrough' }),
      ),
    };
    const refunds = domain([
      'previewAdministrative',
      'commitAdministrative',
      'recoverAdministrative',
    ]);
    const inventory = domain(['executeAdministrative', 'recoveryAdministrative']);
    const hardware = domain([
      'configureAdministrative',
      'executeAdministrative',
      'administrativeCommandStatus',
    ]);
    const customerValue = domain([
      'pointsAccountCustomer',
      'previewPointsAdjustmentAdministrative',
      'commitPointsAdjustmentAdministrative',
      'previewGiftCardIssuanceAdministrative',
      'issueGiftCardAdministrative',
      'revealGiftCardSecretAdministrative',
      'commandAdministrative',
    ]);
    customerValue.pointsAccountCustomer.mockResolvedValue(id(30));
    const repository = domain(['configureRegister', 'queryOriginalCommand']);
    const kitchen = domain(['createStation', 'createRoute', 'updateDevice']);
    const catalog = domain(['detailAdministrative', 'executeAdministrative']);
    const service = new AdministrativeCommandExecutionService(
      contexts as never,
      refunds as never,
      inventory as never,
      {} as never,
      hardware as never,
      customerValue as never,
      repository as never,
      kitchen as never,
      catalog as never,
    );
    let sequence = 100;
    const execute = (
      operation: Parameters<AdministrativeCommandExecutionService['execute']>[2]['operation'],
      targetAggregateId: string,
      parameters: Record<string, unknown> = {},
      targetVersion: number | null = 1,
    ) => {
      sequence += 1;
      return service.execute(user, access, {
        operation,
        locationId: id(5),
        targetAggregateId,
        targetVersion,
        commandId: id(sequence),
        idempotencyKey: id(sequence + 100),
        approvalId: null,
        parameters,
      });
    };
    const inventoryCommon = {
      inventoryLocationId: id(11),
      expectedVersion: 1,
      policyFingerprint: 'b'.repeat(64),
      approvalFingerprint: null,
      businessDate: '2026-08-10',
    };

    await execute('catalog.detail', id(10), {}, 1);
    await execute('catalog.update', id(10), { name: 'Latte' });
    await execute('register.configure', id(12), { displayName: 'Caja norte', enabled: true });
    await execute('hardware.assign', id(13), { expectedVersion: 1, registerId: id(12) });
    await execute('hardware.diagnostic', id(13), {
      hardwareId: id(13),
      expectedConfigurationVersion: 1,
    });
    await execute('hardware.command.status', id(14), {}, null);
    await execute('inventory.adjustment', id(15), {
      ...inventoryCommon,
      direction: 'increase',
      quantity: { value: 1, scale: 0, unit: 'unit' },
      reason: 'count_correction',
      note: null,
    });
    await execute('inventory.count.create', id(11), {
      ...inventoryCommon,
      scope: 'full_location',
      itemIds: [],
    });
    await execute('inventory.count.submit', id(16), {
      ...inventoryCommon,
      countId: id(16),
      attempt: 1,
      snapshotLedgerSequence: 0,
      lines: [
        { inventoryItemId: id(15), counted: { value: 1, scale: 0, unit: 'unit' }, note: null },
      ],
    });
    await execute('inventory.count.reconcile', id(16), {
      ...inventoryCommon,
      countId: id(16),
      countAttempt: 1,
      snapshotLedgerSequence: 0,
      reasons: { [id(15)]: 'physical_count' },
    });
    await execute('inventory.recovery', id(17), {}, null);
    await execute('refund.preview', id(18), {
      exceptionType: 'partial_refund',
      reason: 'incorrect_item',
      note: null,
      lines: [{ saleLineId: id(19), quantity: 1, restockDecision: 'restock' }],
      expectedSaleVersion: 1,
    });
    await execute('refund.commit', id(18), {
      previewId: id(20),
      previewFingerprint: 'c'.repeat(64),
      approvalId: null,
      expectedSaleVersion: 1,
      offline: false,
    });
    await execute('refund.recovery', id(18), {
      commandId: id(21),
      idempotencyKey: id(22),
    });
    const adjustment = {
      direction: 'increase',
      points: 10,
      reason: 'operational_correction',
      note: null,
      expectedVersion: 1,
      approvalId: null,
      approvalFingerprint: null,
    };
    await execute('loyalty.adjustment.preview', id(23), {
      mutationCommandId: id(24),
      mutationIdempotencyKey: id(25),
      command: adjustment,
    });
    await execute('loyalty.adjustment', id(23), adjustment);
    const issuance = {
      currency: 'MXN',
      initialValueMinorUnits: 10000,
      customerId: null,
      saleId: null,
      saleLineId: null,
      approvalId: null,
      approvalFingerprint: null,
    };
    await execute('gift_card.promotional_issue.preview', id(26), {
      mutationCommandId: id(27),
      mutationIdempotencyKey: id(28),
      command: issuance,
    });
    await execute('gift_card.promotional_issue', id(26), issuance);
    await execute('gift_card.reveal', id(26), {
      deliveryToken: 'delivery-token-value-1234567890123456',
    });
    await execute('gift_card.recovery', id(27), {}, null);
    await execute('kitchen.station.create', id(31), { name: 'Barra' }, null);
    await execute('kitchen.route.update', id(32), {
      create: true,
      stationId: id(31),
      routePriority: 100,
    });
    await execute('kitchen.device.assign', id(33), { station_id: id(31) });
    await execute('recovery.query_original', id(34), {}, null);

    expect(catalog.detailAdministrative).toHaveBeenCalledOnce();
    expect(catalog.executeAdministrative).toHaveBeenCalledOnce();
    expect(repository.configureRegister).toHaveBeenCalledOnce();
    expect(hardware.configureAdministrative).toHaveBeenCalledOnce();
    expect(hardware.executeAdministrative).toHaveBeenCalledOnce();
    expect(hardware.administrativeCommandStatus).toHaveBeenCalledOnce();
    expect(inventory.executeAdministrative).toHaveBeenCalledTimes(4);
    expect(inventory.recoveryAdministrative).toHaveBeenCalledOnce();
    expect(refunds.previewAdministrative).toHaveBeenCalledOnce();
    expect(refunds.commitAdministrative).toHaveBeenCalledOnce();
    expect(refunds.recoverAdministrative).toHaveBeenCalledOnce();
    expect(customerValue.commitPointsAdjustmentAdministrative).toHaveBeenCalledOnce();
    expect(customerValue.issueGiftCardAdministrative).toHaveBeenCalledOnce();
    expect(customerValue.revealGiftCardSecretAdministrative).toHaveBeenCalledOnce();
    expect(kitchen.createStation).toHaveBeenCalledOnce();
    expect(kitchen.createRoute).toHaveBeenCalledOnce();
    expect(kitchen.updateDevice).toHaveBeenCalledOnce();
    expect(repository.queryOriginalCommand).toHaveBeenCalledOnce();
  });
});

function domain(methods: string[]) {
  return Object.fromEntries(methods.map((method) => [method, vi.fn().mockResolvedValue({})]));
}
