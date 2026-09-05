import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
} from 'node:crypto';

function deviceProofFor(installationId: string, timestampIso: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const message = Buffer.from(`${installationId}|${timestampIso}`, 'utf8');
  const signature = edSign(null, message, privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return { publicKey: jwk.x, signature };
}
import { AuthService, isMfaChallenge, type LoginOutcome } from './auth.service';

function make() {
  const repo = {
    findCredentialByEmail: vi.fn(),
    upgradeCredential: vi.fn().mockResolvedValue(undefined),
    findUserById: vi.fn(),
    findMerchantsForUser: vi.fn().mockResolvedValue([]),
    // Most logins hold no platform grant, which is the default worth testing.
    platformRole: vi.fn().mockResolvedValue(null),
    startDashboardSession: vi.fn().mockResolvedValue(undefined),
    rotateDashboardSession: vi.fn().mockResolvedValue(true),
    revokeDashboardSession: vi.fn().mockResolvedValue(true),
    insertResetToken: vi.fn().mockResolvedValue(undefined),
    findResetToken: vi.fn(),
    updatePassword: vi.fn().mockResolvedValue(undefined),
    markResetTokenUsed: vi.fn().mockResolvedValue(undefined),
    validatePosDevice: vi.fn(),
    findPosPinStaff: vi.fn(),
    recordPosPinFailure: vi.fn().mockResolvedValue(undefined),
    validatePosSession: vi.fn(),
    rotatePosSessionToken: vi.fn().mockResolvedValue(true),
    revokePosSession: vi.fn().mockResolvedValue(undefined),
    revokePosSessionsForOperator: vi.fn().mockResolvedValue(undefined),
    revokeDashboardSessionsForUser: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = {
    verify: vi.fn(),
    hash: vi.fn().mockReturnValue({ salt: 'new-salt', hash: 'new-hash' }),
    needsUpgrade: vi.fn().mockReturnValue(false),
  };
  const jwt = {
    signAccess: vi.fn().mockResolvedValue('access-tok'),
    signRefresh: vi.fn().mockResolvedValue('refresh-tok'),
    refreshExpiresAt: vi.fn().mockReturnValue(new Date('2026-09-20T00:00:00Z')),
    signMfaChallenge: vi.fn().mockResolvedValue('challenge-tok'),
    verifyMfaChallenge: vi.fn().mockResolvedValue('u1'),
    // `sid` names the refresh family (dashboard) or the POS session; both read it.
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

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

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
    expect(h.repo.startDashboardSession).toHaveBeenCalledWith(
      'u1',
      hashOf('refresh-tok'),
      new Date('2026-09-20T00:00:00Z'),
      // The refresh-family id, minted here and carried as the token's `sid`.
      expect.any(String),
    );
    expect(r.sessionId).toBe(h.repo.startDashboardSession.mock.calls[0][3]);
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

describe('AuthService.refresh and logout · stateful dashboard session', () => {
  let h: ReturnType<typeof make>;

  beforeEach(() => {
    h = make();
    h.repo.findUserById.mockResolvedValue({
      userId: 'u1',
      email: 'owner@kala.co',
      displayName: 'Owner',
    });
  });

  it('rejects a signed refresh token that has no live session row', async () => {
    h.repo.rotateDashboardSession.mockResolvedValue(false);

    await expect(h.svc.refresh('signed-but-untracked')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('replaces the current refresh session before it returns new tokens', async () => {
    await expect(h.svc.refresh('refresh-old')).resolves.toMatchObject({
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
    });

    expect(h.repo.rotateDashboardSession).toHaveBeenCalledWith(
      'u1',
      hashOf('refresh-old'),
      hashOf('refresh-tok'),
      new Date('2026-09-20T00:00:00Z'),
      // The family id the refresh token named; rotation stays inside it.
      'session-1',
    );
  });

  it('keeps the same session id across a rotation', async () => {
    // The id is the refresh FAMILY, not the token row, so a POS administrative
    // command bound to it survives the dashboard's own refresh cycle.
    const r = await h.svc.refresh('refresh-old');
    expect(r.sessionId).toBe('session-1');
  });

  it('revokes the session family when the user logs out', async () => {
    await h.svc.logout('refresh-old');

    expect(h.repo.revokeDashboardSession).toHaveBeenCalledWith(hashOf('refresh-old'));
  });

  it('does not report a successful logout when revocation fails', async () => {
    h.repo.revokeDashboardSession.mockRejectedValue(new Error('database unavailable'));

    await expect(h.svc.logout('refresh-old')).rejects.toThrow('database unavailable');
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
    h.repo.validatePosSession.mockResolvedValue({
      deviceId: 'device-1',
      ephemeralPublicKey: null,
    });
    const result = await h.svc.posRefresh({
      refreshToken: 'old-refresh',
      installationId: 'installation-1',
      deviceCredential: 'credential-1',
      deviceProof: null,
      deviceProofTimestamp: null,
      deviceProofAlgorithm: null,
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
        deviceProof: null,
        deviceProofTimestamp: null,
        deviceProofAlgorithm: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes the original session on logout', async () => {
    await h.svc.posLogout('refresh-token');
    expect(h.repo.revokePosSession).toHaveBeenCalledWith('session-1', 'u1', expect.any(String));
  });
});

describe('AuthService.pinLogin — device possession proof', () => {
  const installationId = 'installation-1';

  function pinLoginInput(overrides: Record<string, unknown>) {
    return {
      pin: '2468',
      merchantId: 'm1',
      locationId: 'l1',
      installationId,
      deviceId: 'device-1',
      deviceCredential: 'credential-1',
      deviceProof: null,
      deviceProofTimestamp: null,
      deviceProofAlgorithm: null,
      ip: null,
      ...overrides,
    } as Parameters<AuthService['pinLogin']>[0];
  }

  it('rejects a keyed device that sends no proof', async () => {
    const h = make();
    const { publicKey } = deviceProofFor(installationId, new Date().toISOString());
    h.repo.validatePosDevice.mockResolvedValue({
      allowed: true,
      ephemeralPublicKey: publicKey,
    });
    await expect(h.svc.pinLogin(pinLoginInput({}))).rejects.toMatchObject({
      response: { code: 'DEVICE_PROOF_REQUIRED' },
    });
    expect(h.repo.findPosPinStaff).not.toHaveBeenCalled();
  });

  it('rejects a keyed device that sends a bad signature', async () => {
    const h = make();
    const timestamp = new Date().toISOString();
    const { publicKey } = deviceProofFor(installationId, timestamp);
    h.repo.validatePosDevice.mockResolvedValue({
      allowed: true,
      ephemeralPublicKey: publicKey,
    });
    await expect(
      h.svc.pinLogin(
        pinLoginInput({ deviceProof: 'AAAA', deviceProofTimestamp: timestamp }),
      ),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_PROOF_INVALID' } });
    expect(h.repo.findPosPinStaff).not.toHaveBeenCalled();
  });

  it('passes a valid proof through to the PIN check', async () => {
    const h = make();
    const timestamp = new Date().toISOString();
    const proof = deviceProofFor(installationId, timestamp);
    h.repo.validatePosDevice.mockResolvedValue({
      allowed: true,
      ephemeralPublicKey: proof.publicKey,
    });
    h.repo.findPosPinStaff.mockResolvedValue(undefined);
    await expect(
      h.svc.pinLogin(
        pinLoginInput({
          deviceProof: proof.signature,
          deviceProofTimestamp: timestamp,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.repo.findPosPinStaff).toHaveBeenCalled();
  });

  it('allows a legacy device that never registered a key', async () => {
    const h = make();
    h.repo.validatePosDevice.mockResolvedValue({
      allowed: true,
      ephemeralPublicKey: null,
    });
    h.repo.findPosPinStaff.mockResolvedValue(undefined);
    await expect(h.svc.pinLogin(pinLoginInput({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(h.repo.findPosPinStaff).toHaveBeenCalled();
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

describe('AuthService · legacy credentials upgrade themselves', () => {
  const LEGACY = {
    userId: 'u1',
    email: 'barista@kala.co',
    displayName: 'Ana',
    passwordSalt: 'old-salt',
    passwordHash: 'old-hash',
    passwordAlgorithm: 'legacy-sha256-v1',
    mfaMethod: null,
  };

  it('passes the row’s scheme to the verifier', async () => {
    // Without this the verifier assumes scrypt and a legacy account cannot log
    // in at all — a silent lockout, since the refusal looks like a bad password.
    const h = make();
    h.repo.findCredentialByEmail.mockResolvedValue(LEGACY);
    h.passwords.verify.mockReturnValue(true);

    await h.svc.login(LEGACY.email, 'pw').catch(() => null);

    expect(h.passwords.verify).toHaveBeenCalledWith(
      'pw',
      'old-salt',
      'old-hash',
      'legacy-sha256-v1',
    );
  });

  it('re-hashes the row after a successful legacy login', async () => {
    const h = make();
    h.repo.findCredentialByEmail.mockResolvedValue(LEGACY);
    h.passwords.verify.mockReturnValue(true);
    h.passwords.needsUpgrade.mockReturnValue(true);

    await h.svc.login(LEGACY.email, 'pw').catch(() => null);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).toHaveBeenCalledWith('u1', 'new-salt', 'new-hash');
  });

  it('does NOT re-hash a credential that is already scrypt', async () => {
    const h = make();
    h.repo.findCredentialByEmail.mockResolvedValue({
      ...LEGACY,
      passwordAlgorithm: 'scrypt-sha256-v1',
    });
    h.passwords.verify.mockReturnValue(true);
    h.passwords.needsUpgrade.mockReturnValue(false);

    await h.svc.login(LEGACY.email, 'pw').catch(() => null);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).not.toHaveBeenCalled();
  });

  it('never re-hashes after a FAILED login', async () => {
    // Otherwise a wrong password would rewrite the credential — and with the
    // wrong password's hash, locking the owner out permanently.
    const h = make();
    h.repo.findCredentialByEmail.mockResolvedValue(LEGACY);
    h.passwords.verify.mockReturnValue(false);
    h.passwords.needsUpgrade.mockReturnValue(true);

    await h.svc.login(LEGACY.email, 'wrong').catch(() => null);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).not.toHaveBeenCalled();
  });

  it('a failing upgrade does not fail the login', async () => {
    // The user is already authenticated. A database hiccup during a background
    // re-hash must not turn a good login into a 500.
    const h = make();
    h.repo.findCredentialByEmail.mockResolvedValue(LEGACY);
    h.passwords.verify.mockReturnValue(true);
    h.passwords.needsUpgrade.mockReturnValue(true);
    h.repo.upgradeCredential.mockRejectedValue(new Error('pg down'));

    await expect(h.svc.login(LEGACY.email, 'pw')).resolves.toBeTruthy();
  });
});

describe('the session says what platform grant the login holds', () => {
  function grantHolder(role: string) {
    const h = make();
    h.repo.findUserById.mockResolvedValue({
      userId: 'u1',
      email: 'ops@umiconsulting.co',
      displayName: 'Ops',
    });
    h.repo.platformRole.mockResolvedValue(role);
    return h;
  }

  /**
   * ⚠️ IT COULD ONLY BE INFERRED BEFORE, AND THE INFERENCE WAS WRONG.
   * `merchants[].roles` carries the platform role only as a FALLBACK — for cafés
   * where the user has no `merchant.staff` row. So a platform operator who also
   * works at one café appeared as ordinary staff THERE, and a client reading the
   * array could not tell a `developer` from a `super_admin` without knowing
   * which keys are platform keys.
   */
  it('reports super_admin on every entry point, not only /me', async () => {
    const h = grantHolder('super_admin');
    // The ways a session begins must agree; they build one envelope now.
    expect((await h.svc.session('u1')).platformRole).toBe('super_admin');
    // `verifyMfa` is the other entry point that used to build the envelope by
    // hand. Both go through `loginResultFor` now.
    expect((await h.svc.verifyMfa('challenge-tok', '123456')).platformRole).toBe('super_admin');
  });

  it('keeps developer distinct from super_admin', async () => {
    // Reach and authority are two axes. A client that collapses them shows a
    // read-only operator the buttons that change things.
    const h = grantHolder('developer');
    expect((await h.svc.session('u1')).platformRole).toBe('developer');
  });

  it('reports a role the contract does not name as NO grant', async () => {
    // Fail closed. A key added to `umi.role` reaches a client only once the
    // contract says what it means; until then a client gating on an unknown
    // enum would fall through to its default, which is the permissive branch.
    const h = grantHolder('tech_assist');
    expect((await h.svc.session('u1')).platformRole).toBeNull();
  });
});
