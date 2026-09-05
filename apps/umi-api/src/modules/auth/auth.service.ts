import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PasswordService } from '../../shared/auth/password.service';
import { posPinLookupHash } from '../../shared/auth/pos-pin';
import { verifyDeviceProof } from '../devices/device-proof';
import { JwtService } from '../../shared/auth/jwt.service';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import type { AppConfig } from '../../shared/config/config.schema';
import { upgradeCredentialIfLegacy } from './credential-upgrade';

/** The two platform grants `umi.role` carries. Null for everyone else. */
type PlatformRole = 'super_admin' | 'developer' | null;

/**
 * Narrow whatever the catalogue holds to the two roles the CONTRACT names.
 *
 * An unrecognised key is reported as NO grant rather than passed through. A
 * client gating a platform screen on an enum it does not know fails open, and a
 * role added to `umi.role` should reach a client only when the contract says
 * what it means.
 */
function narrowPlatformRole(role: string | null): PlatformRole {
  return role === 'super_admin' || role === 'developer' ? role : null;
}
import { AuthRepository, type MerchantMembershipSummary } from './auth.repository';
import { MfaService } from './mfa.service';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string | null;
}

export interface LoginResult extends TokenPair {
  user: SessionUser;
  merchants: MerchantMembershipSummary[];
  platformRole: PlatformRole;
}

/**
 * A correct password, and a second factor still outstanding. Carries NO tokens and no
 * merchant list — nothing a caller could act on before the code is checked.
 */
export interface MfaChallengeResult {
  mfaRequired: true;
  method: string;
  challengeToken: string;
  expiresInSeconds: number;
}

export type LoginOutcome = LoginResult | MfaChallengeResult;

/**
 * Narrow a login outcome, before it becomes a response body.
 *
 * This one tests only for the KEY, because it reads a value this process built
 * and the type set the literal. `mfaChallenged` in `@umi/contract` reads a parsed
 * HTTP body, which nothing here produced, so it compares against `true`. Keep
 * that difference: a wire predicate must not trust a key alone.
 */
export function isMfaChallenge(outcome: LoginOutcome): outcome is MfaChallengeResult {
  return 'mfaRequired' in outcome;
}

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min, mirrors the dashboard

/**
 * Auth business logic (D9). Verifies scrypt credentials, issues JWT pairs, and
 * runs the password-reset flow. Cookie handling lives in the controller; this
 * service is transport-agnostic and returns raw tokens.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly email: EmailAdapter,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly mfa: MfaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async login(usernameRaw: string, password: string): Promise<LoginOutcome> {
    const username = usernameRaw.trim().toLowerCase();
    if (!username || !password) {
      throw new BadRequestException('username and password are required');
    }

    const credential = await this.repo.findCredentialByEmail(username);
    // Same generic 401 whether the user is missing or the password is wrong.
    if (
      !credential ||
      !this.passwords.verify(
        password,
        credential.passwordSalt,
        credential.passwordHash,
        credential.passwordAlgorithm,
      )
    ) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    // Verified — so a legacy row can now be re-hashed with the password we just
    // confirmed. Not awaited; see the helper.
    upgradeCredentialIfLegacy(this.repo, this.passwords, credential, password);

    const user: SessionUser = {
      id: credential.userId,
      email: credential.email,
      displayName: credential.displayName,
    };

    // The password is right, and that is ALL it buys when a second factor is
    // enrolled. Nothing below this branch issues a token, loads a merchant list, or
    // tells the caller anything about the account — the challenge token is inert
    // everywhere except POST /auth/mfa/verify.
    if (credential.mfaMethod) {
      const challengeToken = await this.jwt.signMfaChallenge(user.id, this.mfa.ttlSeconds);
      // Only email_otp has anything to send. A totp enrolment already holds its
      // secret, so the challenge alone is the whole prompt.
      if (credential.mfaMethod === 'email_otp') {
        await this.mfa.issueChallenge(user);
      }
      return {
        mfaRequired: true,
        method: credential.mfaMethod,
        challengeToken,
        expiresInSeconds: this.mfa.ttlSeconds,
      };
    }

    return this.loginResultFor(user);
  }

  /**
   * Second half of a two-step login. The challenge token proves the password was
   * already accepted; the code proves the factor. Both are required, and the token
   * alone can do nothing else in the system.
   */
  async verifyMfa(challengeToken: string, code: string): Promise<LoginResult> {
    if (!challengeToken || !code) {
      throw new BadRequestException('challengeToken and code are required');
    }
    const userId = await this.jwt.verifyMfaChallenge(challengeToken);
    await this.mfa.verifyCode(userId, code);

    const summary = await this.repo.findUserById(userId);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    return this.loginResultFor(user);
  }

  /** Rotate a live dashboard session and return its new token pair. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    const summary = await this.repo.findUserById(claims.sub);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    // Complete response reads before rotation. An error after rotation would
    // leave the client with the replaced token. Its retry would
    // look like a replay attack.
    const [merchants, platformRole] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.repo.platformRole(user.id),
    ]);
    // The new tokens keep the SAME `sid`: it is the refresh family, not the token
    // row, and the POS binds administrative work to it across the dashboard's
    // own refresh cycle. The repository verifies the old token belongs to it.
    const tokens = await this.issueTokens(user, claims.sessionId);
    const rotated = await this.repo.rotateDashboardSession(
      user.id,
      hashToken(refreshToken),
      hashToken(tokens.refreshToken),
      this.jwt.refreshExpiresAt(tokens.refreshToken),
      claims.sessionId,
    );
    if (!rotated) throw new UnauthorizedException('invalid_token');

    return { user, merchants, platformRole: narrowPlatformRole(platformRole), ...tokens };
  }

  /** End the dashboard refresh-token family. Cookie clearing stays in the controller. */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.repo.revokeDashboardSession(hashToken(refreshToken));
  }

  /**
   * Enforces the device-possession proof. Once a device has registered a public
   * key at pairing, every PIN login and refresh must carry a fresh Ed25519
   * signature over `installationId|timestamp`. A device with no registered key
   * (a legacy enrolment) passes through unchanged, so the keys roll out one
   * pairing at a time without locking anyone out.
   */
  private enforceDeviceProof(
    publicKey: string | null,
    proof: {
      installationId: string;
      signature: string | null;
      timestamp: string | null;
      algorithm: string | null;
    },
  ): void {
    if (!publicKey) return;
    if (!proof.signature || !proof.timestamp) {
      throw new UnauthorizedException({ code: 'DEVICE_PROOF_REQUIRED' });
    }
    const verified = verifyDeviceProof({
      publicKeyB64Url: publicKey,
      installationId: proof.installationId,
      timestampIso: proof.timestamp,
      signatureB64Url: proof.signature,
      algorithm: proof.algorithm === 'es256' ? 'es256' : 'ed25519',
    });
    if (!verified) {
      throw new UnauthorizedException({ code: 'DEVICE_PROOF_INVALID' });
    }
  }

  async pinLogin(input: {
    pin: string;
    merchantId: string;
    locationId: string;
    installationId: string;
    deviceId: string | null;
    deviceCredential: string | null;
    deviceProof: string | null;
    deviceProofTimestamp: string | null;
    deviceProofAlgorithm: string | null;
    ip: string | null;
  }): Promise<LoginResult> {
    if (!input.deviceId || !input.deviceCredential) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    this.enforcePinRateLimit(`pos-pin:ip:${input.ip ?? 'unknown'}`, 20, 5 * 60_000);
    this.enforcePinRateLimit(`pos-pin:device:${input.deviceId}`, 10, 5 * 60_000);

    const installationHash = sha256(input.installationId);
    const credentialHash = sha256(input.deviceCredential);
    const device = await this.repo.validatePosDevice({
      deviceId: input.deviceId,
      merchantId: input.merchantId,
      locationId: input.locationId,
      installationHash,
      credentialHash,
    });
    if (!device.allowed) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    this.enforceDeviceProof(device.ephemeralPublicKey, {
      installationId: input.installationId,
      signature: input.deviceProof,
      timestamp: input.deviceProofTimestamp,
      algorithm: input.deviceProofAlgorithm,
    });

    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for POS PIN authentication');
    const lookupHash = posPinLookupHash(secret, input.merchantId, input.pin);
    const record = await this.repo.findPosPinStaff(input.merchantId, input.locationId, lookupHash);
    if (!record || !this.passwords.verify(input.pin, record.pinSalt, record.pinHash)) {
      await this.repo.recordPosPinFailure(input.deviceId);
      throw new ForbiddenException({ code: 'PIN_INVALID' });
    }
    if (!record.email) {
      throw new ForbiddenException({ code: 'OPERATOR_LOGIN_UNAVAILABLE' });
    }
    const entitlement = await this.repo.effectiveEntitlement(input.merchantId, 'pos');
    if (!entitlement?.enabled || !['trialing', 'active'].includes(entitlement.subscriptionStatus)) {
      throw new ForbiddenException({ code: 'ENTITLEMENT_DISABLED' });
    }

    await this.repo.clearPosPinFailures(input.deviceId);
    const user: SessionUser = {
      id: record.userId,
      email: record.email,
      displayName: record.displayName,
    };
    const sessionId = randomUUID();
    const [merchants, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.issueTokens(user, sessionId, input.deviceId),
    ]);
    await this.repo.createPosSession({
      id: sessionId,
      merchantId: input.merchantId,
      locationId: input.locationId,
      userId: user.id,
      deviceId: input.deviceId,
      tokenHash: sha256(tokens.refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    });
    // Same envelope as a dashboard login: the contract names `platformRole`, and a
    // platform operator who signs in at a till is still a platform operator.
    return {
      user,
      merchants,
      platformRole: narrowPlatformRole(await this.repo.platformRole(user.id)),
      ...tokens,
    };
  }

  async posRefresh(input: {
    refreshToken: string;
    installationId: string;
    deviceCredential: string | null;
    deviceProof: string | null;
    deviceProofTimestamp: string | null;
    deviceProofAlgorithm: string | null;
  }): Promise<LoginResult> {
    if (!input.deviceCredential) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    const claims = await this.jwt.verifyRefresh(input.refreshToken);
    const session = await this.repo.validatePosSession({
      sessionId: claims.sessionId,
      userId: claims.sub,
      installationHash: sha256(input.installationId),
      credentialHash: sha256(input.deviceCredential),
    });
    if (!session) throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    this.enforceDeviceProof(session.ephemeralPublicKey, {
      installationId: input.installationId,
      signature: input.deviceProof,
      timestamp: input.deviceProofTimestamp,
      algorithm: input.deviceProofAlgorithm,
    });

    const summary = await this.repo.findUserById(claims.sub);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    const [merchants, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.issueTokens(user, claims.sessionId, session.deviceId),
    ]);
    if (!(await this.repo.rotatePosSessionToken(claims.sessionId, sha256(tokens.refreshToken)))) {
      throw new UnauthorizedException('invalid_token');
    }
    // Same envelope as a dashboard login: the contract names `platformRole`, and a
    // platform operator who signs in at a till is still a platform operator.
    return {
      user,
      merchants,
      platformRole: narrowPlatformRole(await this.repo.platformRole(user.id)),
      ...tokens,
    };
  }

  async posLogout(refreshToken: string): Promise<void> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    await this.repo.revokePosSession(claims.sessionId, claims.sub, sha256(refreshToken));
  }

  async posGlobalLogout(userId: string, sessionId: string, exceptCurrent: boolean): Promise<void> {
    await this.repo.revokePosSessionsForOperator(userId, exceptCurrent ? sessionId : null);
  }

  /** Rehydrate the session for `/me` from a verified access cookie. */
  async session(userId: string): Promise<{
    user: SessionUser;
    merchants: MerchantMembershipSummary[];
    platformRole: PlatformRole;
  }> {
    const summary = await this.repo.findUserById(userId);
    if (!summary) throw new UnauthorizedException('invalid_token');
    // Both reads are independent, and the platform grant is one indexed row.
    const [merchants, platformRole] = await Promise.all([
      this.repo.findMerchantsForUser(userId),
      this.repo.platformRole(userId),
    ]);
    return {
      user: {
        id: summary.userId,
        email: summary.email,
        displayName: summary.displayName,
      },
      merchants,
      platformRole: narrowPlatformRole(platformRole),
    };
  }

  /** Password and second-factor login start a new durable session. */
  private async loginResultFor(user: SessionUser): Promise<LoginResult> {
    const [merchants, platformRole, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.repo.platformRole(user.id),
      this.issueSessionTokens(user),
    ]);
    return { user, merchants, platformRole: narrowPlatformRole(platformRole), ...tokens };
  }

  /**
   * Open the dashboard's durable session. The family id is minted HERE and signed
   * into both tokens as `sid` before the row exists, so the id the client holds and
   * the id the database holds are one value — see `startDashboardSession`.
   */
  private async issueSessionTokens(user: SessionUser): Promise<TokenPair> {
    const familyId = randomUUID();
    const tokens = await this.issueTokens(user, familyId);
    await this.repo.startDashboardSession(
      user.id,
      hashToken(tokens.refreshToken),
      this.jwt.refreshExpiresAt(tokens.refreshToken),
      familyId,
    );
    return tokens;
  }

  /**
   * The one signer. A dashboard session passes its family id and no device; a
   * POS session passes its own session id and the enrolled device.
   */
  private async issueTokens(
    user: SessionUser,
    sessionId: string = randomUUID(),
    deviceId: string | null = null,
  ): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAccess({ sub: user.id, email: user.email, sessionId, deviceId }),
      this.jwt.signRefresh(user.id, sessionId),
    ]);
    return { accessToken, refreshToken, sessionId, deviceId };
  }

  private enforcePinRateLimit(key: string, max: number, windowMs: number): void {
    const result = this.rateLimit.hit(key, max, windowMs);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)),
        },
        429,
      );
    }
  }

  /**
   * Always resolves (no user enumeration). Sends a reset email only when the
   * address maps to a real local account.
   */
  async forgotPassword(emailRaw: string): Promise<void> {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;

    const credential = await this.repo.findCredentialByEmail(email);
    if (!credential) {
      // Spend comparable CPU on the no-account path so response timing doesn't
      // leak which emails have local accounts (the real path hashes below).
      hashToken(randomBytes(32).toString('hex'));
      return;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await this.repo.insertResetToken(credential.userId, tokenHash, expiresAt);

    const appUrl = this.config.get('APP_URL', { infer: true }) ?? 'http://localhost:4010';
    const resetLink = `${appUrl}/reset-password?token=${token}`;
    const name = credential.displayName || credential.email;

    const sent = await this.email.send({
      to: credential.email,
      subject: 'Reestablecer contraseña · Umi Dashboard',
      text: `Hola ${name},\n\nRecibimos una solicitud para reestablecer tu contraseña.\n\nEnlace: ${resetLink}\n\nEste enlace expira en 15 minutos. Si no solicitaste esto, puedes ignorar este correo.\n\nUmi Consulting`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px 24px;color:#1a1a1a">
          <div style="font-size:18px;font-weight:700;margin-bottom:24px">umi <em style="color:#888">· dash</em></div>
          <h2 style="font-size:20px;font-weight:700;margin:0 0 8px">Reestablecer contraseña</h2>
          <p style="color:#555;margin:0 0 24px">Hola ${name}, recibimos una solicitud para reestablecer la contraseña de tu cuenta.</p>
          <a href="${resetLink}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px">Reestablecer contraseña</a>
          <p style="color:#888;font-size:12px;margin-top:24px">Este enlace expira en 15 minutos. Si no solicitaste esto, puedes ignorar este correo.</p>
        </div>
      `,
    });
    if (!sent) {
      // The token is already persisted; surface the delivery failure for ops
      // without leaking it to the caller (still returns 200).
      this.logger.error(`reset_email_send_failed user=${credential.userId}`);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const tokenHash = hashToken(token);
    const record = await this.repo.findResetToken(tokenHash);
    if (!record) throw new BadRequestException('Enlace inválido o expirado');
    if (record.usedAt) {
      throw new BadRequestException('Este enlace ya fue utilizado');
    }
    if (new Date(record.expiresAt) < new Date()) {
      throw new BadRequestException('El enlace ha expirado');
    }

    const { salt, hash } = this.passwords.hash(password);
    await this.repo.updatePassword(record.userId, salt, hash);
    await this.repo.markResetTokenUsed(record.id);
    await this.repo.revokeDashboardSessionsForUser(record.userId, 'credential_changed');
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Same digest, the POS code's name for it. One function, two call-site idioms. */
const sha256 = hashToken;
