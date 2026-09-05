import { describe, expect, it, vi } from 'vitest';
import { PosEntryService } from './pos-entry.service';
import { posCardLookupHash } from '../../shared/auth/pos-pin';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'operator@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: '00000000-0000-4000-8000-000000000003',
};

describe('PosEntryService', () => {
  it('requires a server-verified device before entry context', async () => {
    const repo = { entryContext: vi.fn() };
    const service = new PosEntryService(repo as never, {} as never, {} as never);
    expect(() => service.entryContext({ ...user, deviceId: null })).toThrow();
    expect(repo.entryContext).not.toHaveBeenCalled();
  });

  it('starts an operator only from repository-authorized scope intersection', async () => {
    const operator = { id: 'operator-session' };
    const repo = {
      startOperator: vi.fn().mockResolvedValue(operator),
      deviceLocation: vi.fn().mockResolvedValue(null),
    };
    const service = new PosEntryService(repo as never, {} as never, {} as never);
    await expect(service.start(user, 'tenant', 'branch')).resolves.toBe(operator);
    expect(repo.startOperator).toHaveBeenCalledWith(
      expect.objectContaining({
        durableSessionId: user.sessionId,
        userId: user.id,
        deviceId: user.deviceId,
      }),
    );
  });

  it('rate-lock boundary rejects a locked PIN before verification', async () => {
    const repo = {
      deviceLocation: vi.fn().mockResolvedValue(null),
      pinRecord: vi.fn().mockResolvedValue({
        staffId: 'staff',
        salt: 'salt',
        hash: 'hash',
        attempts: 5,
        lockedUntil: new Date(Date.now() + 60_000),
      }),
    };
    const passwords = { verify: vi.fn() };
    const service = new PosEntryService(repo as never, passwords as never, {} as never);
    await expect(
      service.verifyPin(user, {
        pin: '1234',
        merchantId: 'tenant',
        locationId: 'branch',
        permission: 'future.action',
      }),
    ).rejects.toMatchObject({ response: { code: 'PIN_LOCKED' } });
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('anchors the operator branch to a pinned device, not to the request', async () => {
    const operator = { id: 'operator-session' };
    const repo = {
      startOperator: vi.fn().mockResolvedValue(operator),
      deviceLocation: vi.fn().mockResolvedValue('branch-the-device-stands-in'),
    };
    const service = new PosEntryService(repo as never, {} as never, {} as never);

    await service.start(user, 'tenant', 'branch-the-operator-asked-for');

    // The till decides. An operator who also administers another branch cannot
    // move this drawer's takings by switching branch in the UI.
    expect(repo.startOperator).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'branch-the-device-stands-in' }),
    );
  });

  it('lets a floating device take the requested branch', async () => {
    const operator = { id: 'operator-session' };
    const repo = {
      startOperator: vi.fn().mockResolvedValue(operator),
      deviceLocation: vi.fn().mockResolvedValue(null),
    };
    const service = new PosEntryService(repo as never, {} as never, {} as never);

    await service.start(user, 'tenant', 'branch-the-operator-asked-for');

    expect(repo.startOperator).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'branch-the-operator-asked-for' }),
    );
  });

  it('refuses when the device is not a registered active device', async () => {
    const repo = {
      startOperator: vi.fn(),
      deviceLocation: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PosEntryService(repo as never, {} as never, {} as never);

    await expect(service.start(user, 'tenant', 'branch')).rejects.toMatchObject({
      response: { code: 'DEVICE_NOT_REGISTERED' },
    });
    expect(repo.startOperator).not.toHaveBeenCalled();
  });

  it('verifies a PIN against the branch the device stands in', async () => {
    const repo = {
      deviceLocation: vi.fn().mockResolvedValue('branch-the-device-stands-in'),
      pinRecord: vi.fn().mockResolvedValue(null),
    };
    const service = new PosEntryService(repo as never, { verify: vi.fn() } as never, {} as never);

    await expect(
      service.verifyPin(user, {
        pin: '1234',
        merchantId: 'tenant',
        locationId: 'branch-the-operator-asked-for',
        permission: 'future.action',
      }),
    ).rejects.toBeDefined();

    // Without this, a device pinned elsewhere disappears under the device RLS
    // narrowing and a correct PIN reads as wrong.
    expect(repo.pinRecord).toHaveBeenCalledWith(
      user.id,
      'tenant',
      'branch-the-device-stands-in',
      user.deviceId,
    );
  });

  it('accepts a manager card as an alternative to the typed PIN', async () => {
    const repo = {
      managerPinRecord: vi.fn().mockResolvedValue({
        staffId: '00000000-0000-4000-8000-000000000010',
        userId: '00000000-0000-4000-8000-000000000011',
        salt: 'salt',
        hash: 'hash',
        credential: 'manager_card',
        lockedUntil: null,
      }),
      grantManagerElevation: vi.fn().mockResolvedValue({
        id: 'elevation',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    };
    const passwords = { verify: vi.fn().mockReturnValue(true) };
    const config = { get: vi.fn().mockReturnValue('secret') };
    const service = new PosEntryService(repo as never, passwords as never, config as never);

    const grant = await service.approveByManager(user, {
      operatorSessionId: '00000000-0000-4000-8000-000000000020',
      managerCard: 'card-token-from-the-magnetic-stripe',
      permission: 'sale.void',
      merchantId: 'tenant',
      locationId: 'branch',
      commandFingerprint: null,
    });

    // The card token is what gets verified, and the grant says how it was approved.
    expect(passwords.verify).toHaveBeenCalledWith(
      'card-token-from-the-magnetic-stripe',
      'salt',
      'hash',
    );
    expect(grant.method).toBe('manager_card');
    // The lookup must not be the PIN-domain hash, or a card could be replayed as a PIN.
    expect(repo.managerPinRecord.mock.calls[0][0]).toBe(
      posCardLookupHash('secret', 'tenant', 'card-token-from-the-magnetic-stripe'),
    );
  });

  it('refuses a request that carries both a PIN and a card', async () => {
    const repo = { managerPinRecord: vi.fn() };
    const service = new PosEntryService(
      repo as never,
      {} as never,
      { get: vi.fn().mockReturnValue('secret') } as never,
    );

    await expect(
      service.approveByManager(user, {
        operatorSessionId: '00000000-0000-4000-8000-000000000020',
        managerPin: '1234',
        managerCard: 'card-token-from-the-magnetic-stripe',
        permission: 'sale.void',
        merchantId: 'tenant',
        locationId: 'branch',
        commandFingerprint: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    expect(repo.managerPinRecord).not.toHaveBeenCalled();
  });

  it('refuses a request that carries neither a PIN nor a card', async () => {
    const repo = { managerPinRecord: vi.fn() };
    const service = new PosEntryService(
      repo as never,
      {} as never,
      { get: vi.fn().mockReturnValue('secret') } as never,
    );

    await expect(
      service.approveByManager(user, {
        operatorSessionId: '00000000-0000-4000-8000-000000000020',
        permission: 'sale.void',
        merchantId: 'tenant',
        locationId: 'branch',
        commandFingerprint: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
    expect(repo.managerPinRecord).not.toHaveBeenCalled();
  });

  it('binds a different manager PIN approval to one checkout fingerprint', async () => {
    const repo = {
      managerPinRecord: vi.fn().mockResolvedValue({
        staffId: '00000000-0000-4000-8000-000000000010',
        userId: '00000000-0000-4000-8000-000000000011',
        salt: 'salt',
        hash: 'hash',
        lockedUntil: null,
      }),
      grantManagerElevation: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000012',
        expiresAt: new Date('2026-07-29T20:05:00.000Z'),
      }),
    };
    const passwords = { verify: vi.fn().mockReturnValue(true) };
    const config = { get: vi.fn().mockReturnValue('test-jwt-secret-with-enough-length') };
    const service = new PosEntryService(repo as never, passwords as never, config as never);
    const fingerprint = 'a'.repeat(64);
    const grant = await service.approveByManager(user, {
      operatorSessionId: '00000000-0000-4000-8000-000000000013',
      managerPin: '3333',
      permission: 'checkout.discount.approve',
      merchantId: '00000000-0000-4000-8000-000000000014',
      locationId: '00000000-0000-4000-8000-000000000015',
      commandFingerprint: fingerprint,
    });
    expect(grant.commandFingerprint).toBe(fingerprint);
    expect(repo.managerPinRecord).toHaveBeenCalledWith(
      expect.any(String),
      '00000000-0000-4000-8000-000000000014',
      '00000000-0000-4000-8000-000000000015',
      'checkout.discount.approve',
      '00000000-0000-4000-8000-000000000013',
      user.id,
      user.sessionId,
      user.deviceId,
    );
    expect(repo.grantManagerElevation).toHaveBeenCalledWith(
      expect.objectContaining({
        managerUserId: '00000000-0000-4000-8000-000000000011',
        commandFingerprint: fingerprint,
      }),
    );
  });

  it('binds Dashboard manager approval to its session and exact fingerprint', async () => {
    const repo = {
      administrativeManagerPinRecord: vi.fn().mockResolvedValue({
        staffId: '00000000-0000-4000-8000-000000000010',
        userId: '00000000-0000-4000-8000-000000000011',
        salt: 'salt',
        hash: 'hash',
        lockedUntil: null,
      }),
      grantAdministrativeManagerElevation: vi.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000012',
        expiresAt: new Date('2026-08-10T20:05:00.000Z'),
      }),
    };
    const service = new PosEntryService(
      repo as never,
      { verify: vi.fn().mockReturnValue(true) } as never,
      { get: vi.fn().mockReturnValue('test-jwt-secret-with-enough-length') } as never,
    );
    const fingerprint = 'a'.repeat(64);
    const grant = await service.approveAdministrativeByManager(
      { ...user, deviceId: null },
      { merchantId: '00000000-0000-4000-8000-000000000014' } as never,
      {
        dashboardSessionId: user.sessionId,
        managerPin: '3333',
        permission: 'loyalty.adjust.approve',
        locationId: '00000000-0000-4000-8000-000000000015',
        commandFingerprint: fingerprint,
      },
    );
    expect(grant.commandFingerprint).toBe(fingerprint);
    expect(repo.grantAdministrativeManagerElevation).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardSessionId: user.sessionId,
        commandFingerprint: fingerprint,
      }),
    );
  });

  it('rate-limits invalid Dashboard approval PIN attempts', async () => {
    const repo = {
      administrativeManagerPinRecord: vi.fn().mockResolvedValue(null),
      recordAdministrativePinFailure: vi.fn(),
    };
    const service = new PosEntryService(
      repo as never,
      { verify: vi.fn() } as never,
      { get: vi.fn().mockReturnValue('test-jwt-secret-with-enough-length') } as never,
    );
    await expect(
      service.approveAdministrativeByManager(
        { ...user, deviceId: null },
        { merchantId: '00000000-0000-4000-8000-000000000014' } as never,
        {
          dashboardSessionId: user.sessionId,
          managerPin: '0000',
          permission: 'inventory.adjust.approve',
          locationId: '00000000-0000-4000-8000-000000000015',
          commandFingerprint: 'b'.repeat(64),
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    expect(repo.recordAdministrativePinFailure).toHaveBeenCalledOnce();
  });
});
