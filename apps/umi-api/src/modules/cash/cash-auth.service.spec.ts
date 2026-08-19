import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { CashAuthService } from './cash-auth.service';

const MERCHANT = '9f000000-0000-4000-8000-00000000f001';
const USER = '9f000000-0000-4000-8000-00000000f002';

const CREDENTIAL = {
  userId: USER,
  email: 'ana@kalala.mx',
  displayName: 'Ana',
  passwordSalt: 'salt',
  passwordHash: 'hash',
  passwordAlgorithm: 'scrypt-sha256-v1',
  mfaMethod: null,
};

function harness(over: Partial<Record<string, unknown>> = {}) {
  const repo = {
    findCredentialByEmail: vi.fn().mockResolvedValue(CREDENTIAL),
    upgradeCredential: vi.fn().mockResolvedValue(undefined),
    findMembershipAccess: vi.fn().mockResolvedValue({ roles: ['owner'] }),
    ...over,
  };
  const passwords = {
    verify: vi.fn().mockReturnValue(true),
    hash: vi.fn().mockReturnValue({ salt: 'new-salt', hash: 'new-hash' }),
    needsUpgrade: vi.fn().mockReturnValue(false),
  };
  const sessions = {
    createSession: vi.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    staffSessionByRefreshToken: vi.fn().mockResolvedValue({ userId: USER }),
    signAccessToken: vi.fn().mockResolvedValue('a'),
  };
  const service = new CashAuthService(repo as never, passwords, sessions as never);
  return { service, repo, passwords, sessions };
}

const CREDS = { identifier: 'Ana@Kalala.MX', password: 'correct horse' };

describe('cash staff login', () => {
  it('returns the token pair and the register user', async () => {
    const h = harness();
    const out = await h.service.login(MERCHANT, CREDS);
    expect(out.accessToken).toBe('a');
    expect(out.refreshToken).toBe('r');
    expect(out.user).toEqual({ id: USER, name: 'Ana', role: 'ADMIN', email: 'ana@kalala.mx' });
  });

  it('looks the account up case-insensitively', async () => {
    // The barista types her address however she types it; the register must not
    // refuse her because she capitalised it.
    const h = harness();
    await h.service.login(MERCHANT, CREDS);
    expect(h.repo.findCredentialByEmail).toHaveBeenCalledWith('ana@kalala.mx');
  });

  it('mints the session against THIS cafe, with the derived role', async () => {
    const h = harness();
    await h.service.login(MERCHANT, CREDS);
    expect(h.sessions.createSession).toHaveBeenCalledWith(USER, 'ADMIN', MERCHANT);
  });

  it('refuses an unknown account', async () => {
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(null) });
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(UnauthorizedException);
  });

  it('still hashes when there is no account, so timing cannot enumerate staff', async () => {
    // scrypt is deliberately slow. Returning early on an unknown address makes
    // "no such account" measurably faster than "wrong password", which lets an
    // anonymous caller discover who works at a café one guess at a time. This
    // asserts the work happens; measuring the clock here would only be flaky.
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(null) });
    await h.service.login(MERCHANT, CREDS).catch(() => null);
    expect(h.passwords.verify).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong password', async () => {
    const h = harness();
    h.passwords.verify.mockReturnValue(false);
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses someone with no role at this cafe', async () => {
    const h = harness({ findMembershipAccess: vi.fn().mockResolvedValue(null) });
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(UnauthorizedException);
  });

  it('refuses a platform superadmin who is not cafe staff', async () => {
    // findMembershipAccess falls back to the platform role when there is no café
    // grant. A platform account is not a till login.
    const h = harness({
      findMembershipAccess: vi.fn().mockResolvedValue({ roles: ['super_admin'] }),
    });
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(UnauthorizedException);
  });

  it('says the SAME thing for every refusal', async () => {
    // Distinguishing "no such account" from "wrong password" hands an attacker a
    // free account-enumeration oracle on a public endpoint.
    const bodies: unknown[] = [];
    for (const h of [
      harness({ findCredentialByEmail: vi.fn().mockResolvedValue(null) }),
      harness({ findMembershipAccess: vi.fn().mockResolvedValue(null) }),
    ]) {
      await h.service.login(MERCHANT, CREDS).catch((e) => bodies.push(e.getResponse()));
    }
    const wrongPw = harness();
    wrongPw.passwords.verify.mockReturnValue(false);
    await wrongPw.service.login(MERCHANT, CREDS).catch((e) => bodies.push(e.getResponse()));

    expect(bodies).toEqual([
      { error: 'Credenciales inválidas' },
      { error: 'Credenciales inválidas' },
      { error: 'Credenciales inválidas' },
    ]);
  });
});

describe('cash staff refresh', () => {
  it('issues a new access token for a live session', async () => {
    const h = harness();
    await expect(h.service.refresh(MERCHANT, 'tok')).resolves.toEqual({ accessToken: 'a' });
  });

  it('refuses when the database has no live session', async () => {
    const h = harness();
    h.sessions.staffSessionByRefreshToken.mockResolvedValue(null);
    await expect(h.service.refresh(MERCHANT, 'tok')).rejects.toThrow(UnauthorizedException);
  });

  it('RE-DERIVES the role, so a revoked role cannot refresh', async () => {
    // The access token is short-lived precisely so that losing a role takes effect
    // within minutes. If refresh reused the role baked into the old token, an
    // ex-manager would keep manager access until the refresh token expired.
    const h = harness({ findMembershipAccess: vi.fn().mockResolvedValue(null) });
    await expect(h.service.refresh(MERCHANT, 'tok')).rejects.toThrow(UnauthorizedException);
  });

  it('does not mint a new refresh token', async () => {
    // The frozen client reads only `accessToken` from the body. Rotation is a real
    // improvement but it belongs with the family/replay design, not here.
    const h = harness();
    await h.service.refresh(MERCHANT, 'tok');
    expect(h.sessions.createSession).not.toHaveBeenCalled();
  });
});

describe('cash login · legacy credentials upgrade themselves', () => {
  it('passes the row’s scheme to the verifier', async () => {
    // A barista whose row is still `legacy-sha256-v1` must be able to open the
    // till. Assuming scrypt here refuses her with "Credenciales inválidas" and
    // nothing anywhere says why.
    const h = harness();
    await h.service.login(MERCHANT, CREDS);
    expect(h.passwords.verify).toHaveBeenCalledWith(
      'correct horse',
      'salt',
      'hash',
      'scrypt-sha256-v1',
    );
  });

  it('re-hashes a legacy row after a successful login', async () => {
    const h = harness();
    h.passwords.needsUpgrade.mockReturnValue(true);

    await h.service.login(MERCHANT, CREDS);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).toHaveBeenCalledWith(USER, 'new-salt', 'new-hash');
  });

  it('never re-hashes after a failed login', async () => {
    // Re-hashing a wrong password would overwrite the right one and lock the
    // barista out for good.
    const h = harness();
    h.passwords.verify.mockReturnValue(false);
    h.passwords.needsUpgrade.mockReturnValue(true);

    await h.service.login(MERCHANT, CREDS).catch(() => null);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).not.toHaveBeenCalled();
  });

  it('never re-hashes when the decoy path ran (no such account)', async () => {
    // The no-account path still hashes to keep the timing flat. It must not also
    // write a credential for a user that does not exist.
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(null) });
    h.passwords.needsUpgrade.mockReturnValue(true);

    await h.service.login(MERCHANT, CREDS).catch(() => null);
    await new Promise((r) => setImmediate(r));

    expect(h.repo.upgradeCredential).not.toHaveBeenCalled();
  });
});
