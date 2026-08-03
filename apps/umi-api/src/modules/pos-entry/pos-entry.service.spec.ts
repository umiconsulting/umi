import { describe, expect, it, vi } from 'vitest';
import { PosEntryService } from './pos-entry.service';

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
    const repo = { startOperator: vi.fn().mockResolvedValue(operator) };
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
    expect(repo.grantManagerElevation).toHaveBeenCalledWith(
      expect.objectContaining({
        managerUserId: '00000000-0000-4000-8000-000000000011',
        commandFingerprint: fingerprint,
      }),
    );
  });
});
