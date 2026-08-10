import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService, isMfaChallenge, type LoginOutcome } from './auth.service';

function make() {
  const repo = {
    findCredentialByEmail: vi.fn(),
    findUserById: vi.fn(),
    findMerchantsForUser: vi.fn().mockResolvedValue([]),
    insertResetToken: vi.fn().mockResolvedValue(undefined),
    findResetToken: vi.fn(),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    markResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    validatePosSession: vi.fn(),
    rotatePosSessionToken: vi.fn().mockResolvedValue(true),
    revokePosSession: vi.fn().mockResolvedValue(undefined),
    revokePosSessionsForOperator: vi.fn().mockResolvedValue(undefined),
    createDashboardSession: vi.fn().mockResolvedValue(undefined),
    validateDashboardSession: vi.fn().mockResolvedValue(true),
    rotateDashboardSession: vi.fn().mockResolvedValue(true),
    revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
    revokeDashboardSessionsForUser: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = { verify: vi.fn(), hash: vi.fn() };
  const jwt = {
    signAccess: vi.fn().mockResolvedValue('access-tok'),
    signRefresh: vi.fn().mockResolvedValue('refresh-tok'),
    signMfaChallenge: vi.fn().mockResolvedValue('challenge-tok'),
    verifyMfaChallenge: vi.fn().mockResolvedValue('u1'),
    verifyRefresh: vi.fn().mockResolvedValue({ sub: 'u1', sessionId: 'session-1' }),
  };
  const email = { send: vi.fn().mockResolvedValue({ messageId: 'm1' }) };
  const config = { get: vi.fn().mockReturnValue('https://app.test') };
  const mfa = {
    ttlSeconds: 300,
    issueChallenge: vi.fn().mockResolvedValue(undefined),
    verifyCode: vi.fn().mockResolvedValue(undefined),
  };
  const rateLimit = {
    hit: vi.fn().mockReturnValue({ allowed: true, resetAt: Date.now() + 1_000 }),
  };
  const svc = new AuthService(
    repo as never,
    passwords,
    jwt as never,
    email as never,
    config as never,
    mfa as never,
    rateLimit as never,
  );
  return { svc, repo, passwords, jwt, email, mfa };
}

/** Narrow for assertions; fails loudly rather than silently reading undefined. */
function asSession(outcome: LoginOutcome) {
  if (isMfaChallenge(outcome)) throw new Error('expected a session, got an MFA challenge');
  return outcome;
}

const CRED = {
  userId: 'u1',
  email: 'owner@kala.co',
  displayName: 'Owner',
  passwordSalt: 'salt',
  passwordHash: 'hash',
  mfaMethod: null,
};

describe('AuthService.login', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('issues tokens + session on valid credentials (and lowercases username)', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(true);

    const r = asSession(await h.svc.login('  Owner@Kala.co ', 'pw'));

    expect(h.repo.findCredentialByEmail).toHaveBeenCalledWith('owner@kala.co');
    expect(r.accessToken).toBe('access-tok');
    expect(r.refreshToken).toBe('refresh-tok');
    expect(r.user).toEqual({
      id: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
    expect(h.repo.createDashboardSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String), userId: 'u1' }),
    );
  });

  it('401s on wrong password', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(CRED);
    h.passwords.verify.mockReturnValue(false);
    await expect(h.svc.login('owner@kala.co', 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401s (no enumeration) on unknown user', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(null);
    await expect(h.svc.login('nobody@x.co', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService POS session lifecycle', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findUserById.mockResolvedValue({
      userId: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
  });

  it('rotates a device-bound POS session', async () => {
    h.repo.validatePosSession.mockResolvedValue({ deviceId: 'device-1' });
    const result = await h.svc.posRefresh({
      refreshToken: 'old-refresh',
      installationId: 'installation-1',
      deviceCredential: 'credential-1',
    });
    expect(result.deviceId).toBe('device-1');
    expect(h.repo.rotatePosSessionToken).toHaveBeenCalledWith('session-1', expect.any(String));
  });

  it('rejects refresh after device authority ends', async () => {
    h.repo.validatePosSession.mockResolvedValue(null);
    await expect(
      h.svc.posRefresh({
        refreshToken: 'old-refresh',
        installationId: 'installation-1',
        deviceCredential: 'credential-1',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the original session on logout', async () => {
    await h.svc.posLogout('refresh-token');
    expect(h.repo.revokePosSession).toHaveBeenCalledWith('session-1', 'u1', expect.any(String));
  });
});

describe('AuthService.login — second factor', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  const MFA_CRED = { ...CRED, mfaMethod: 'email_otp' };

  it('withholds tokens and returns a challenge when a factor is enrolled', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(MFA_CRED);
    h.passwords.verify.mockReturnValue(true);

    const r = await h.svc.login('owner@kala.co', 'pw');

    expect(isMfaChallenge(r)).toBe(true);
    if (!isMfaChallenge(r)) throw new Error('unreachable');
    expect(r.challengeToken).toBe('challenge-tok');
    expect(r.method).toBe('email_otp');
    // The whole point: a correct password alone yields nothing usable.
    expect(h.jwt.signAccess).not.toHaveBeenCalled();
    expect(h.jwt.signRefresh).not.toHaveBeenCalled();
  });

  it('does not leak the merchant list before the factor is checked', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(MFA_CRED);
    h.passwords.verify.mockReturnValue(true);
    await h.svc.login('owner@kala.co', 'pw');
    expect(h.repo.findMerchantsForUser).not.toHaveBeenCalled();
  });

  it('mails a code for email_otp', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(MFA_CRED);
    h.passwords.verify.mockReturnValue(true);
    await h.svc.login('owner@kala.co', 'pw');
    expect(h.mfa.issueChallenge).toHaveBeenCalledOnce();
  });

  it('mails nothing for totp — the authenticator already holds the secret', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue({ ...CRED, mfaMethod: 'totp' });
    h.passwords.verify.mockReturnValue(true);
    const r = await h.svc.login('owner@kala.co', 'pw');
    expect(isMfaChallenge(r)).toBe(true);
    expect(h.mfa.issueChallenge).not.toHaveBeenCalled();
  });

  it('still rejects a wrong password before ever issuing a challenge', async () => {
    h.repo.findCredentialByEmail.mockResolvedValue(MFA_CRED);
    h.passwords.verify.mockReturnValue(false);
    await expect(h.svc.login('owner@kala.co', 'bad')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.mfa.issueChallenge).not.toHaveBeenCalled();
    expect(h.jwt.signMfaChallenge).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyMfa', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findUserById.mockResolvedValue({
      userId: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
  });

  it('issues the real tokens once the code checks out', async () => {
    const r = await h.svc.verifyMfa('challenge-tok', '123456');
    expect(h.mfa.verifyCode).toHaveBeenCalledWith('u1', '123456');
    expect(r.accessToken).toBe('access-tok');
    expect(r.refreshToken).toBe('refresh-tok');
  });

  it('issues nothing when the code is rejected', async () => {
    h.mfa.verifyCode.mockRejectedValue(new UnauthorizedException('Código inválido o expirado'));
    await expect(h.svc.verifyMfa('challenge-tok', '000000')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(h.jwt.signAccess).not.toHaveBeenCalled();
  });

  it('rejects a bad challenge token without ever checking the code', async () => {
    h.jwt.verifyMfaChallenge.mockRejectedValue(new UnauthorizedException('invalid_token'));
    await expect(h.svc.verifyMfa('forged', '123456')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.mfa.verifyCode).not.toHaveBeenCalled();
  });

  it('requires both halves', async () => {
    await expect(h.svc.verifyMfa('', '123456')).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.verifyMfa('challenge-tok', '')).rejects.toBeInstanceOf(BadRequestException);
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
