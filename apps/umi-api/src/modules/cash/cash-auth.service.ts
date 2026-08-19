import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from '../auth/auth.repository';
import { PasswordService } from '../../shared/auth/password.service';
import { CustomerSessionService } from './customer-session.service';
import { legacyRole, type LegacyRole } from './cash-roles';

/** umi-cash's exact refusal. One body for every reason, deliberately. */
const REFUSED = { error: 'Credenciales inválidas' };

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
 * SCRYPT ONLY, and that is not an omission. umi-cash accepted a bare `salt:hash`
 * sha256 as well, and porting that branch would carry a crackable scheme into
 * build-v3. It is unnecessary: `backfill_identity.sql` force-resets every
 * `legacy-sha256-v1` credential (and every shared hash) to null with
 * `status='invited'`, so no legacy hash survives the cutover. Two accounts reset
 * their password once — see AB#109.
 *
 * ⚠️ NO SECOND FACTOR HERE, matching umi-cash. A user who enrolled MFA for the
 * dashboard is not challenged for it at the register, so the register is the
 * weaker of the two doors into the same account. Adding the challenge needs a
 * client that can answer it, and the umi-cash front end is frozen. Tracked
 * separately — do not read this comment as approval.
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
      );
    } else {
      this.passwords.verify(input.password, DECOY_SALT, DECOY_HASH);
    }
    if (!credential || !passwordOk) throw new UnauthorizedException(REFUSED);

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
