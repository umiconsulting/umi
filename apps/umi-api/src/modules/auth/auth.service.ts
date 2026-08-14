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
import { JwtService } from '../../shared/auth/jwt.service';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthRepository, type MerchantMembershipSummary } from './auth.repository';
import { MfaService } from './mfa.service';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { parseDurationSeconds } from './cookies';

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

/** Narrow a login outcome without reaching for `in` at every call site. */
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
      !this.passwords.verify(password, credential.passwordSalt, credential.passwordHash)
    ) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

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

    const [merchants, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.issueDashboardSession(user),
    ]);
    return { user, merchants, ...tokens };
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
    const [merchants, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.issueDashboardSession(user),
    ]);
    return { user, merchants, ...tokens };
  }

  /** Rotate the access token from a valid refresh token. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    if (!(await this.repo.validateDashboardSession(claims.sub, claims.sessionId))) {
      throw new UnauthorizedException('invalid_token');
    }
    const summary = await this.repo.findUserById(claims.sub);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    const [merchants, tokens] = await Promise.all([
      this.repo.findMerchantsForUser(user.id),
      this.issueTokens(user, claims.sessionId),
    ]);
    if (
      !(await this.repo.rotateDashboardSession(
        claims.sessionId,
        claims.sub,
        sha256(refreshToken),
        sha256(tokens.refreshToken),
      ))
    ) {
      throw new UnauthorizedException('invalid_token');
    }
    return { user, merchants, ...tokens };
  }

  async dashboardLogout(refreshToken: string): Promise<void> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    await this.repo.revokeDashboardSession(
      claims.sessionId,
      claims.sub,
      sha256(refreshToken),
      'dashboard_logout',
    );
  }

  async pinLogin(input: {
    pin: string;
    merchantId: string;
    locationId: string;
    installationId: string;
    deviceId: string | null;
    deviceCredential: string | null;
    ip: string | null;
  }): Promise<LoginResult> {
    if (!input.deviceId || !input.deviceCredential) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    this.enforcePinRateLimit(`pos-pin:ip:${input.ip ?? 'unknown'}`, 20, 5 * 60_000);
    this.enforcePinRateLimit(`pos-pin:device:${input.deviceId}`, 10, 5 * 60_000);

    const installationHash = sha256(input.installationId);
    const credentialHash = sha256(input.deviceCredential);
    const deviceAllowed = await this.repo.validatePosDevice({
      deviceId: input.deviceId,
      merchantId: input.merchantId,
      locationId: input.locationId,
      installationHash,
      credentialHash,
    });
    if (!deviceAllowed) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }

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
    return { user, merchants, ...tokens };
  }

  async posRefresh(input: {
    refreshToken: string;
    installationId: string;
    deviceCredential: string | null;
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
    return { user, merchants, ...tokens };
  }

  async posLogout(refreshToken: string): Promise<void> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    await this.repo.revokePosSession(claims.sessionId, claims.sub, sha256(refreshToken));
  }

  async posGlobalLogout(userId: string, sessionId: string, exceptCurrent: boolean): Promise<void> {
    await this.repo.revokePosSessionsForOperator(userId, exceptCurrent ? sessionId : null);
  }

  /** Rehydrate the session for `/me` from a verified access cookie. */
  async session(
    userId: string,
  ): Promise<{ user: SessionUser; merchants: MerchantMembershipSummary[] }> {
    const summary = await this.repo.findUserById(userId);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const [merchants] = await Promise.all([this.repo.findMerchantsForUser(userId)]);
    return {
      user: {
        id: summary.userId,
        email: summary.email,
        displayName: summary.displayName,
      },
      merchants,
    };
  }

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

  private async issueDashboardSession(user: SessionUser): Promise<TokenPair> {
    const sessionId = randomUUID();
    const tokens = await this.issueTokens(user, sessionId);
    const configured = parseDurationSeconds(
      this.config.get('JWT_REFRESH_TTL', { infer: true }) ?? '30d',
    );
    const ttlSeconds = configured > 0 ? configured : 30 * 24 * 60 * 60;
    await this.repo.createDashboardSession({
      id: sessionId,
      userId: user.id,
      tokenHash: sha256(tokens.refreshToken),
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
    });
    return tokens;
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
      createHash('sha256').update(randomBytes(32)).digest('hex');
      return;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
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
    const tokenHash = createHash('sha256').update(token).digest('hex');
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
