import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
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
    mfaMethodByUserId: vi.fn().mockResolvedValue(null),
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

describe('cash staff login · AB#115 the register refuses an MFA-enrolled account', () => {
  const ENROLLED = { ...CREDENTIAL, mfaMethod: 'totp' };

  it('refuses an account that holds a second factor', async () => {
    // The register cannot challenge — the frozen client has no screen for a code.
    // So the account that enrolled one uses the dashboard, and the till stops
    // being the weaker door into it.
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(ENROLLED) });
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(ForbiddenException);
  });

  it('refuses email_otp too, not only totp', async () => {
    // The rule is "holds a second factor", not "holds a GOOD one". email_otp does
    // not satisfy PCI DSS 8.4.1, but it still means the dashboard challenges and
    // the register would not — which is the asymmetry being closed.
    const h = harness({
      findCredentialByEmail: vi.fn().mockResolvedValue({ ...CREDENTIAL, mfaMethod: 'email_otp' }),
    });
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(ForbiddenException);
  });

  it('lets an UNENROLLED account through, so no barista is locked out today', async () => {
    // Zero of nine accounts are enrolled on the cutover rehearsal. This refusal
    // must cost nothing until someone deliberately enrols.
    const h = harness();
    await expect(h.service.login(MERCHANT, CREDS)).resolves.toMatchObject({ accessToken: 'a' });
  });

  it('checks the password FIRST, so it is not an enumeration oracle', async () => {
    // Refusing on the enrolment flag before verifying would answer "does this
    // address hold a second factor?" to anyone who asks. The wrong-password path
    // must still return the uniform body.
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(ENROLLED) });
    h.passwords.verify.mockReturnValue(false);
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(UnauthorizedException);
    await h.service
      .login(MERCHANT, CREDS)
      .catch((e) => expect(e.getResponse()).toEqual({ error: 'Credenciales inválidas' }));
  });

  it('says something OTHER than "wrong credentials", for the logs and the next client', async () => {
    // Safe to be distinct: it is only reachable with a proven password. The frozen
    // client shows `Credenciales inválidas` regardless — it never reads the body.
    const h = harness({ findCredentialByEmail: vi.fn().mockResolvedValue(ENROLLED) });
    // `rejects` first: a bare `.catch(assert)` passes vacuously when login RESOLVES,
    // so it would report green against a service that never refuses at all.
    await expect(h.service.login(MERCHANT, CREDS)).rejects.toThrow(ForbiddenException);
    const body = await h.service.login(MERCHANT, CREDS).then(
      () => null,
      (e) => e.getResponse(),
    );
    expect(body).toEqual({
      error: 'Esta cuenta usa verificación en dos pasos. Inicia sesión en el panel.',
      code: 'MFA_ENROLLED_USE_DASHBOARD',
    });
  });

  it('does not re-hash a legacy credential on the way out', async () => {
    // The refusal lands before the upgrade, so a refused login leaves the row
    // exactly as it found it.
    const h = harness({
      findCredentialByEmail: vi
        .fn()
        .mockResolvedValue({ ...ENROLLED, passwordAlgorithm: 'legacy-sha256-v1' }),
    });
    h.passwords.needsUpgrade.mockReturnValue(true);
    await h.service.login(MERCHANT, CREDS).catch(() => undefined);
    expect(h.repo.upgradeCredential).not.toHaveBeenCalled();
  });

  it('closes a till that was already open when the account enrolled', async () => {
    // A check only at login is a check with a hole in it: the session predates the
    // enrolment, so refresh would keep it alive for the refresh token's whole life.
    const h = harness({ mfaMethodByUserId: vi.fn().mockResolvedValue('totp') });
    await expect(h.service.refresh(MERCHANT, 'tok')).rejects.toThrow(ForbiddenException);
  });

  it('still refreshes an unenrolled account', async () => {
    const h = harness();
    await expect(h.service.refresh(MERCHANT, 'tok')).resolves.toEqual({ accessToken: 'a' });
    expect(h.repo.mfaMethodByUserId).toHaveBeenCalledWith(USER);
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
