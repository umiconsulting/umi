import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

function make() {
  const repo = {
    findCredentialByEmail: vi.fn(),
    findUserById: vi.fn(),
    findTenantsForUser: vi.fn().mockResolvedValue([]),
    insertResetToken: vi.fn().mockResolvedValue(undefined),
    findResetToken: vi.fn(),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    markResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(undefined),
    writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
    findSession: vi.fn(),
    rotateSession: vi.fn(),
    revokeSession: vi.fn(),
    revokeSessionFamily: vi.fn(),
    revokeUserSessions: vi.fn(),
    deviceAllowedForUser: vi.fn().mockResolvedValue(true),
    findPosPinStaff: vi.fn(),
    findLegacyPosPinCandidates: vi.fn().mockResolvedValue([]),
    recordPosPinFailure: vi.fn().mockResolvedValue(undefined),
    confirmPosPin: vi.fn().mockResolvedValue(true),
    effectiveEntitlement: vi.fn().mockResolvedValue({
      featureKey: 'pos',
      enabled: true,
      limit: null,
      subscriptionStatus: 'active',
    }),
  };
  const passwords = { verify: vi.fn(), hash: vi.fn() };
  const jwt = {
    signAccess: vi.fn().mockResolvedValue('access-tok'),
    signRefresh: vi.fn().mockResolvedValue('refresh-tok'),
    verifyRefresh: vi.fn(),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn().mockReturnValue('https://app.test') };
  const rateLimit = {
    hit: vi.fn().mockReturnValue({
      allowed: true,
      remaining: 9,
      resetAt: Date.now() + 60_000,
    }),
  };
  const svc = new AuthService(
    repo as never,
    passwords,
    jwt as never,
    email as never,
    config as never,
    rateLimit as never,
  );
  return { svc, repo, passwords, jwt, email, rateLimit };
}

const CRED = {
  userId: 'u1',
  email: 'owner@kala.co',
  displayName: 'Owner',
  passwordSalt: 'salt',
  passwordHash: 'hash',
};
const CLIENT = {
  app: 'dashboard' as const,
  deviceId: null,
  ip: '127.0.0.1',
  userAgent: 'test',
};

const POS_CLIENT = {
  app: 'pos' as const,
  deviceId: '00000000-0000-4000-8000-000000000099',
  installationId: '00000000-0000-4000-8000-000000000098',
  deviceCredential: 'device-secret',
  ip: '127.0.0.1',
  userAgent: 'test',
};

const PIN_STAFF = {
  staffId: '00000000-0000-4000-8000-000000000010',
  userId: 'u1',
  email: 'cashier@umipos.local',
  displayName: 'Cashier',
  pinSalt: 'pin-salt',
  pinHash: 'pin-hash',
  failedAttempts: 0,
  lockedUntil: null,
};

describe('AuthService.login', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('issues tokens + session on valid credentials (and lowercases username)', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(true);

    const r = await h.svc.login('  Owner@Kala.co ', 'pw', CLIENT);

    expect(h.repo.findCredentialByEmail).toHaveBeenCalledWith('owner@kala.co');
    expect(r.accessToken).toBe('access-tok');
    expect(r.refreshToken).toBe('refresh-tok');
    expect(r.user).toEqual({
      id: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
  });

  it('401s on wrong password', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(false);
    await expect(h.svc.login('owner@kala.co', 'bad', CLIENT)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s (no enumeration) on unknown user', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(null);
    await expect(h.svc.login('nobody@x.co', 'pw', CLIENT)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a device outside the user tenant and branch scope', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(true);
    h.repo.deviceAllowedForUser.mockResolvedValue(false);
    await expect(
      h.svc.login('owner@kala.co', 'pw', {
        ...CLIENT,
        app: 'pos',
        deviceId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.repo.createSession).not.toHaveBeenCalled();
  });
});

describe('AuthService.pinLogin', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findPosPinStaff.mockResolvedValue(PIN_STAFF);
    h.passwords.verify.mockReturnValue(true);
  });

  it('creates a device-bound session for the staff identity', async () => {
    const result = await h.svc.pinLogin(
      '2468',
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      POS_CLIENT,
    );

    expect(result.user.email).toBe('cashier@umipos.local');
    expect(h.repo.deviceAllowedForUser).toHaveBeenCalledWith(
      'u1',
      POS_CLIENT.deviceId,
      'pos',
      expect.any(String),
      expect.any(String),
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
    );
    expect(h.repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', deviceId: POS_CLIENT.deviceId, app: 'pos' }),
    );
    expect(h.repo.writeSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'authentication.pin_succeeded' }),
    );
  });

  it('upgrades one matching legacy PIN to the keyed lookup', async () => {
    h.repo.findPosPinStaff.mockResolvedValue(null);
    h.repo.findLegacyPosPinCandidates.mockResolvedValue([PIN_STAFF]);

    await h.svc.pinLogin(
      '2468',
      '10000000-0000-4000-8000-000000000101',
      '20000000-0000-4000-8000-000000000101',
      POS_CLIENT,
    );

    expect(h.repo.confirmPosPin).toHaveBeenCalledWith(
      PIN_STAFF.staffId,
      '10000000-0000-4000-8000-000000000101',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it('fails closed when the POS entitlement is disabled', async () => {
    h.repo.effectiveEntitlement.mockResolvedValue(null);

    await expect(
      h.svc.pinLogin(
        '2468',
        '10000000-0000-4000-8000-000000000101',
        '20000000-0000-4000-8000-000000000101',
        POS_CLIENT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.repo.createSession).not.toHaveBeenCalled();
  });

  it('fails closed when the trusted device does not match the tenant and branch', async () => {
    h.repo.deviceAllowedForUser.mockResolvedValue(false);

    await expect(
      h.svc.pinLogin(
        '2468',
        '10000000-0000-4000-8000-000000000101',
        '20000000-0000-4000-8000-000000000101',
        POS_CLIENT,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.repo.createSession).not.toHaveBeenCalled();
  });

  it('rejects an ambiguous legacy PIN', async () => {
    h.repo.findPosPinStaff.mockResolvedValue(null);
    h.repo.findLegacyPosPinCandidates.mockResolvedValue([PIN_STAFF, { ...PIN_STAFF, staffId: 's2' }]);

    await expect(
      h.svc.pinLogin(
        '2468',
        '10000000-0000-4000-8000-000000000101',
        '20000000-0000-4000-8000-000000000101',
        POS_CLIENT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.repo.createSession).not.toHaveBeenCalled();
  });

  it('enforces the bounded device attempt rate', async () => {
    h.rateLimit.hit.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    await expect(
      h.svc.pinLogin(
        '2468',
        '10000000-0000-4000-8000-000000000101',
        '20000000-0000-4000-8000-000000000101',
        POS_CLIENT,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(h.repo.findPosPinStaff).not.toHaveBeenCalled();
  });
});

describe('AuthService durable sessions', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findUserById.mockResolvedValue({
      userId: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
    h.jwt.verifyRefresh.mockResolvedValue({ sub: 'u1', sessionId: 'session-old' });
    h.repo.findSession.mockResolvedValue({
      id: 'session-old',
      userId: 'u1',
      deviceId: null,
      app: 'dashboard',
      tokenHash: '75da00f6378d098bbe2e19dd7ce73a633c0f0f56aa876e9741e37974f1e68ed9',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    h.repo.rotateSession.mockResolvedValue(true);
    h.repo.revokeUserSessions.mockResolvedValue(3);
  });

  it('rotates a durable refresh session and invalidates the old record', async () => {
    const result = await h.svc.refresh('refresh-tok', CLIENT);
    expect(result.refreshToken).toBe('refresh-tok');
    expect(h.repo.rotateSession).toHaveBeenCalledOnce();
  });

  it('rejects a replay when the stored refresh fingerprint differs', async () => {
    h.repo.findSession.mockResolvedValue({
      ...(await h.repo.findSession()),
      id: 'session-old',
      userId: 'u1',
      app: 'dashboard',
      deviceId: null,
      tokenHash: 'different',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    await expect(h.svc.refresh('refresh-tok', CLIENT)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.repo.revokeSessionFamily).toHaveBeenCalledWith('session-old', 'refresh_replay');
  });

  it('revokes all user sessions and audits global logout', async () => {
    await expect(h.svc.globalLogout('u1', 'session-old', false)).resolves.toBe(3);
    expect(h.repo.revokeUserSessions).toHaveBeenCalledWith('u1', null);
    expect(h.repo.writeSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'session.global_logout' }),
    );
  });
});

describe('AuthService.forgotPassword', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('does nothing (no email, no token) for an unknown address', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(null);
    await h.svc.forgotPassword('ghost@x.co');
    expect(h.repo.insertResetToken).not.toHaveBeenCalled();
    expect(h.email.send).not.toHaveBeenCalled();
  });

  it('persists a token and sends the reset email for a real user', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    await h.svc.forgotPassword('owner@kala.co');
    expect(h.repo.insertResetToken).toHaveBeenCalledOnce();
    expect(h.email.send).toHaveBeenCalledOnce();
    const arg = h.email.send.mock.calls[0][0];
    expect(arg.to).toBe('owner@kala.co');
    expect(arg.html).toContain('/reset-password?token=');
  });
});

describe('AuthService.resetPassword', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.passwords.hash.mockReturnValue({ salt: 'ns', hash: 'nh' });
  });

  it('updates the password and consumes the token when valid', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    });
    await h.svc.resetPassword('tok', 'newpassword');
    expect(h.repo.updatePassword).toHaveBeenCalledWith('u1', 'ns', 'nh');
    expect(h.repo.markResetTokenUsed).toHaveBeenCalledWith('t1');
  });

  it('rejects an unknown token', async () => {
    h.repo.findResetToken.mockResolvedValue(null);
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an already-used token', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(),
    });
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.repo.updatePassword).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    h.repo.findResetToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1),
      usedAt: null,
    });
    await expect(h.svc.resetPassword('x', 'newpassword')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
