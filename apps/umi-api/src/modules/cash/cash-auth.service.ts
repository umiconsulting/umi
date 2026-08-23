import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from '../auth/auth.repository';
import { upgradeCredentialIfLegacy } from '../auth/credential-upgrade';
import { PasswordService } from '../../shared/auth/password.service';
import { CustomerSessionService } from './customer-session.service';
import { legacyRole, type LegacyRole } from './cash-roles';

/** umi-cash's exact refusal. One body for every reason, deliberately. */
const REFUSED = { error: 'Credenciales inválidas' };

/**
 * AB#115. Distinct from `REFUSED` on purpose, and safe to be distinct: it is only
 * ever returned AFTER the password has verified, so it tells an attacker nothing
 * they did not already hold. `REFUSED` is uniform precisely to keep "no such
 * account" and "wrong password" indistinguishable — this is neither.
 */
const MFA_ENROLLED = {
  error: 'Esta cuenta usa verificación en dos pasos. Inicia sesión en el panel.',
  code: 'MFA_ENROLLED_USE_DASHBOARD',
};

/**
 * A salt and hash that verify against nothing, used to spend scrypt time on the
 * no-account path. The hash is not the hash of any password — it is 64 bytes of
 * a fixed value, so the comparison always fails.
 */
const DECOY_SALT = '00000000000000000000000000000000';
const DECOY_HASH = 'ff'.repeat(64);

export interface CashLoginInput {
  identifier: string;
  password: string;
}

export interface CashLoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string | null; role: LegacyRole; email: string | null };
}

/**
 * The register's own login.
 *
 * IT READS THE SAME ACCOUNTS AS THE DASHBOARD. `umi.user` is one table, so a café
 * owner signs in here with the credential she uses there. What differs is the
 * SHAPE of the session: the dashboard issues a cookie pair on `JWT_SECRET`, and
 * the register holds a Bearer access token plus a refresh cookie on
 * `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, because that is what the frozen
 * umi-cash client sends and stores.
 *
 * BOTH SCHEMES, because production still holds both and nobody should be made to
 * reset a password they still remember. `PasswordService` dispatches on the row's
 * `password_algorithm`, and a `legacy-sha256-v1` row is re-hashed to scrypt the
 * moment its owner signs in — so the weak scheme drains away by itself rather
 * than by a cutover-morning reset. See AB#109.
 *
 * ⚠️ NO SECOND FACTOR HERE, matching umi-cash — so an MFA-ENROLLED ACCOUNT IS
 * REFUSED INSTEAD (AB#115). A user who enrolled MFA for the dashboard cannot be
 * challenged here: the frozen umi-cash client posts `{identifier, password}`,
 * expects `{accessToken, user}` or an error, and has no screen for a code and no
 * state for a half-authenticated session. Issuing a challenge it cannot answer
 * would lock that user out with no way through.
 *
 * The remaining choice is which door an enrolled account uses, and the answer is
 * the dashboard. Refusing here removes the bypass rather than papering over it:
 * a second factor is worth nothing if the same password opens a till unchallenged.
 * The till stays available to accounts that have NOT enrolled — every barista
 * today — so this refuses nobody until an account deliberately enrols.
 *
 * ⚠️ WHAT THE OPERATOR ACTUALLY SEES. Nothing specific. The frozen client
 * hardcodes `Credenciales inválidas` for every non-2xx and never reads the body
 * (`apps/umi-cash/src/app/[slug]/(auth)/admin-login/page.tsx`). The distinct code
 * and message below are for the API contract, the logs, and the next client — not
 * for the screen. A café whose owner enrols will need telling out of band.
 *
 * This is a stopgap for the model `merchant.staff` already describes: the till is
 * a PIN door (device authorises the terminal, PIN authorises the action and names
 * the actor), and no password belongs at a register at all. Until that path
 * exists, keeping password-holders with a second factor off the till is the
 * cheapest thing that is not a lie.
 */
@Injectable()
export class CashAuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: CustomerSessionService,
  ) {}

  async login(merchantId: string, input: CashLoginInput): Promise<CashLoginResult> {
    const email = input.identifier.trim().toLowerCase();
    const credential = await this.repo.findCredentialByEmail(email);

    // HASH EVEN WHEN THERE IS NO ACCOUNT. scrypt is deliberately slow, so
    // returning early on an unknown address makes "no such account" measurably
    // faster than "wrong password" — which hands an anonymous caller a way to
    // discover who works at a café, one guess at a time. The decoy spends the
    // same work against a fixed salt and can never succeed. Do not "simplify"
    // this into a short-circuit; the wasted CPU is the point.
    let passwordOk = false;
    if (credential) {
      passwordOk = this.passwords.verify(
        input.password,
        credential.passwordSalt,
        credential.passwordHash,
        credential.passwordAlgorithm,
      );
    } else {
      this.passwords.verify(input.password, DECOY_SALT, DECOY_HASH, 'scrypt-sha256-v1');
    }
    if (!credential || !passwordOk) throw new UnauthorizedException(REFUSED);

    // AB#115 — AFTER the password check, never before. Refusing on the enrolment
    // flag alone would answer "does this address hold a second factor?" to an
    // anonymous caller, which is the enumeration `REFUSED` and the decoy hash
    // exist to prevent. The account is proven before we tell it to use the panel.
    if (credential.mfaMethod) throw new ForbiddenException(MFA_ENROLLED);

    // Verified — so a legacy row can be re-hashed with the password just
    // confirmed. Never reached on the decoy path: there is no row to upgrade.
    upgradeCredentialIfLegacy(this.repo, this.passwords, credential, input.password);

    const role = await this.registerRole(merchantId, credential.userId);
    const { accessToken, refreshToken } = await this.sessions.createSession(
      credential.userId,
      role,
      merchantId,
    );
    return {
      accessToken,
      refreshToken,
      user: {
        id: credential.userId,
        name: credential.displayName,
        role,
        email: credential.email,
      },
    };
  }

  /**
   * A new access token, if the session is still live AND the person still works
   * here. Both halves matter: the session answers "was this logged out", and the
   * role lookup answers "may she still do this". The access token is short-lived
   * so that losing a role takes effect in minutes — reusing the role baked into
   * the expiring token would keep an ex-manager a manager until the refresh token
   * itself aged out.
   */
  async refresh(merchantId: string, refreshToken: string): Promise<{ accessToken: string }> {
    const session = await this.sessions.staffSessionByRefreshToken(merchantId, refreshToken);
    if (!session) throw new UnauthorizedException(REFUSED);

    // AB#115 — the same refusal as login, because a check only at login is a check
    // with a hole in it. A till signed in BEFORE its owner enrolled would otherwise
    // keep minting access tokens for the refresh token's whole life, and the
    // bypass would outlive the enrolment that was supposed to end it. Enrolling
    // must close the till on the next refresh, not eventually.
    if (await this.repo.mfaMethodByUserId(session.userId)) {
      throw new ForbiddenException(MFA_ENROLLED);
    }

    const role = await this.registerRole(merchantId, session.userId);
    const accessToken = await this.sessions.signAccessToken(session.userId, role, merchantId);
    return { accessToken };
  }

  /** The register role this user holds at this café, or a refusal. */
  private async registerRole(merchantId: string, userId: string): Promise<LegacyRole> {
    const access = await this.repo.findMembershipAccess(userId, merchantId);
    const role = access ? legacyRole(access.roles) : null;
    if (!role) throw new UnauthorizedException(REFUSED);
    return role;
  }
}
