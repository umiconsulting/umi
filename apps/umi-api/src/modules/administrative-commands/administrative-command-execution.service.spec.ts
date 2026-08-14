import { describe, expect, it, vi } from 'vitest';
import { exceptionCommandFingerprint } from '../pos-exception/pos-exception.service';
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
  permissions: ['sale.refund.partial'],
  locationId: id(5),
};

describe('Dashboard administrative command execution', () => {
  const context = (operation: string) => ({
    create: vi.fn(async (_user, _access, input) => ({
      type: 'dashboard_administrative',
      actorUserId: user.id,
      membershipId: access.membershipId,
      merchantId: access.merchantId,
      locationId: input.locationId,
      sessionId: user.sessionId,
      permission: 'inventory.adjust.increase',
      operation,
      targetAggregateId: input.targetAggregateId,
      targetVersion: input.targetVersion,
      commandId: id(6),
      idempotencyKey: id(7),
      fingerprint: 'a'.repeat(64),
      approvalId: null,
      origin: 'dashboard',
      issuedAt: '2026-08-10T00:00:00.000Z',
      expiresAt: '2026-08-10T00:05:00.000Z',
    })),
    execute: vi.fn(async (_command, action) => action()),
  });

  it('executes refund preview through the canonical exception service', async () => {
    const commandContext = context('refund.preview');
    const refunds = {
      previewAdministrative: vi.fn().mockResolvedValue({ previewId: id(9) }),
    };
    const service = new AdministrativeCommandExecutionService(
      commandContext as never,
      refunds as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.execute(user, access, {
      operation: 'refund.preview',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: 1,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {
        exceptionType: 'partial_refund',
        reason: 'incorrect_item',
        note: null,
        lines: [{ saleLineId: id(10), quantity: 1, restockDecision: 'restock' }],
        expectedSaleVersion: 1,
      },
    });

    expect(refunds.previewAdministrative).toHaveBeenCalledWith(
      user,
      access,
      expect.objectContaining({ type: 'dashboard_administrative' }),
      id(8),
      expect.objectContaining({ exceptionType: 'partial_refund' }),
    );
    expect(result).toEqual({ previewId: id(9) });
  });

  it('derives the refund approval fingerprint on the server', async () => {
    const refunds = { approvalAdministrative: vi.fn().mockResolvedValue({ approvalId: id(20) }) };
    const service = new AdministrativeCommandExecutionService(
      context('refund.approval') as never,
      refunds as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const previewId = id(21);
    const previewFingerprint = 'c'.repeat(64);
    const mutationCommandId = id(22);
    await service.execute(user, access, {
      operation: 'refund.approval',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: 1,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {
        previewId,
        commandId: mutationCommandId,
        previewFingerprint,
        commandFingerprint: 'client-value-is-not-trusted',
        managerPin: '1234',
      },
    });
    expect(refunds.approvalAdministrative).toHaveBeenCalledWith(
      user,
      access,
      expect.any(Object),
      id(8),
      expect.objectContaining({
        commandFingerprint: exceptionCommandFingerprint(
          id(8),
          previewId,
          previewFingerprint,
          mutationCommandId,
        ),
      }),
    );
  });

  it('executes an inventory adjustment through the canonical inventory service', async () => {
    const inventory = { executeAdministrative: vi.fn().mockResolvedValue({ ledgerSequence: '7' }) };
    const service = new AdministrativeCommandExecutionService(
      context('inventory.adjustment') as never,
      {} as never,
      inventory as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.execute(user, access, {
      operation: 'inventory.adjustment',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: 3,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {
        inventoryLocationId: id(9),
        direction: 'increase',
        quantity: { value: 2, scale: 0, unit: 'unit' },
        reason: 'count_correction',
        note: 'Cycle count correction',
        expectedVersion: 3,
        policyFingerprint: 'b'.repeat(64),
        approvalFingerprint: null,
        businessDate: '2026-08-10',
      },
    });
    expect(inventory.executeAdministrative).toHaveBeenCalledWith(
      user,
      access,
      expect.objectContaining({ type: 'dashboard_administrative' }),
      'inventory.adjustment',
      expect.objectContaining({ inventoryItemId: id(8), direction: 'increase' }),
    );
    expect(result).toEqual({ ledgerSequence: '7' });
  });

  it('executes count creation through the canonical inventory service', async () => {
    const inventory = { executeAdministrative: vi.fn().mockResolvedValue({ countId: id(11) }) };
    const service = new AdministrativeCommandExecutionService(
      context('inventory.count.create') as never,
      {} as never,
      inventory as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.execute(user, access, {
      operation: 'inventory.count.create',
      locationId: id(5),
      targetAggregateId: id(9),
      targetVersion: 1,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {
        inventoryLocationId: id(9),
        expectedVersion: 1,
        policyFingerprint: 'b'.repeat(64),
        approvalFingerprint: null,
        businessDate: '2026-08-10',
        scope: 'cycle_count',
        itemIds: [id(8)],
      },
    });
    expect(inventory.executeAdministrative).toHaveBeenCalledWith(
      user,
      access,
      expect.any(Object),
      'inventory.count.create',
      expect.objectContaining({ inventoryLocationId: id(9), scope: 'cycle_count' }),
    );
  });

  it('executes register configuration through the administrative repository', async () => {
    const repository = {
      configureRegister: vi.fn().mockResolvedValue({ id: id(8), version: 2 }),
    };
    const service = new AdministrativeCommandExecutionService(
      context('register.configure') as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      repository as never,
      {} as never,
      {} as never,
    );
    await service.execute(user, access, {
      operation: 'register.configure',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: 1,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: { displayName: 'Caja norte', enabled: true },
    });
    expect(repository.configureRegister).toHaveBeenCalledWith(
      expect.objectContaining({ registerId: id(8), expectedVersion: 1, enabled: true }),
    );
  });

  it('routes kitchen configuration to the existing KDS authority', async () => {
    const kitchen = { createStation: vi.fn().mockResolvedValue({ station: { id: id(8) } }) };
    const service = new AdministrativeCommandExecutionService(
      context('kitchen.station.create') as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      kitchen as never,
      {} as never,
    );
    await service.execute(user, access, {
      operation: 'kitchen.station.create',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: null,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: { name: 'Barra' },
    });
    expect(kitchen.createStation).toHaveBeenCalledWith(access.merchantId, id(5), { name: 'Barra' });
  });

  it('routes product updates to the canonical catalog command', async () => {
    const catalog = { executeAdministrative: vi.fn().mockResolvedValue({ id: id(8), version: 2 }) };
    const service = new AdministrativeCommandExecutionService(
      context('catalog.update') as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      catalog as never,
    );
    await service.execute(user, access, {
      operation: 'catalog.update',
      locationId: id(5),
      targetAggregateId: id(8),
      targetVersion: 1,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: { name: 'Latte' },
    });
    expect(catalog.executeAdministrative).toHaveBeenCalledWith(
      user,
      access,
      expect.any(Object),
      'catalog.update',
      { name: 'Latte' },
    );
  });

  it('queries the terminal relay result through the hardware authority', async () => {
    const hardware = {
      administrativeCommandStatus: vi.fn().mockResolvedValue({ command: { status: 'succeeded' } }),
    };
    const service = new AdministrativeCommandExecutionService(
      context('hardware.command.status') as never,
      {} as never,
      {} as never,
      {} as never,
      hardware as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.execute(user, access, {
      operation: 'hardware.command.status',
      locationId: id(5),
      targetAggregateId: id(23),
      targetVersion: null,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {},
    });
    expect(hardware.administrativeCommandStatus).toHaveBeenCalledWith(
      user,
      access,
      expect.objectContaining({ targetAggregateId: id(23) }),
    );
  });

  it('returns a gift-card delivery token once and excludes it from command persistence', async () => {
    let persistedResult: unknown;
    const commandContext = context('gift_card.promotional_issue');
    commandContext.execute = vi.fn(
      async (
        _command: unknown,
        action: () => Promise<unknown>,
        transform: (result: unknown) => unknown,
      ) => {
        const result = await action();
        persistedResult = transform(result);
        return result;
      },
    );
    const customerValue = {
      issueGiftCardAdministrative: vi.fn().mockResolvedValue({
        card: { id: id(30), maskedCode: '****-1234' },
        deliveryToken: 'secret-delivery-token',
        deliveryExpiresAt: '2026-08-10T00:05:00.000Z',
        recovered: false,
        fundingAssignment: null,
      }),
    };
    const service = new AdministrativeCommandExecutionService(
      commandContext as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      customerValue as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.execute(user, access, {
      operation: 'gift_card.promotional_issue',
      locationId: id(5),
      targetAggregateId: id(30),
      targetVersion: null,
      commandId: id(6),
      idempotencyKey: id(7),
      approvalId: null,
      parameters: {
        currency: 'MXN',
        initialValueMinorUnits: 5000,
        expectedVersion: null,
        saleId: null,
        saleLineId: null,
        customerId: null,
        approvalFingerprint: null,
      },
    });

    expect(result).toMatchObject({ deliveryToken: 'secret-delivery-token' });
    expect(persistedResult).toEqual({
      card: { id: id(30), maskedCode: '****-1234' },
      deliveryExpiresAt: '2026-08-10T00:05:00.000Z',
      recovered: false,
      fundingAssignment: null,
      deliveryStatus: 'issued_once',
    });
  });
});
