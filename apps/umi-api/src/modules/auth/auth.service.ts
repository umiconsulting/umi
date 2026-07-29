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
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { AuthRepository } from './auth.repository';
import { parseDurationSeconds } from './cookies';
import type { SessionUser, TenantMembership } from '@umi/contract';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string | null;
}

export interface LoginResult extends TokenPair {
  user: SessionUser;
  tenants: TenantMembership[];
}

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 min, mirrors the dashboard

export interface SessionClient {
  app: 'dashboard' | 'kds' | 'pos';
  deviceId: string | null;
  ip: string | null;
  userAgent: string | null;
  installationId?: string | null;
  deviceCredential?: string | null;
}

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
    private readonly rateLimit: RateLimitService,
  ) {}

  async login(usernameRaw: string, password: string, client: SessionClient): Promise<LoginResult> {
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
    if (
      client.deviceId &&
      !(await this.repo.deviceAllowedForUser(
        user.id,
        client.deviceId,
        client.app,
        client.installationId ? tokenHash(client.installationId) : null,
        client.deviceCredential ? tokenHash(client.deviceCredential) : null,
      ))
    ) {
      await this.repo.writeSecurityAudit({
        actorUserId: user.id,
        sessionId: null,
        eventType: 'authentication.denied',
        entityType: 'device',
        entityId: client.deviceId,
        outcome: 'denied',
        reasonCode: 'device_not_allowed',
        metadata: { app: client.app },
      });
      throw new UnauthorizedException('device_not_allowed');
    }
    const [tenants, tokens] = await Promise.all([
      this.repo.findTenantsForUser(user.id),
      this.createSession(user, client),
    ]);
    return { user, tenants, ...tokens };
  }

  async pinLogin(
    pin: string,
    tenantId: string,
    branchId: string,
    client: SessionClient,
  ): Promise<LoginResult> {
    if (
      client.app !== 'pos' ||
      !client.deviceId ||
      !client.installationId ||
      !client.deviceCredential
    ) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    this.enforcePinRateLimit(`pos-pin:ip:${client.ip ?? 'unknown'}`, 20, 5 * 60_000);
    this.enforcePinRateLimit(`pos-pin:device:${client.deviceId}`, 10, 5 * 60_000);
    this.enforcePinRateLimit(`pos-pin:tenant:${tenantId}`, 100, 5 * 60_000);

    const lookupHash = this.pinLookupHash(tenantId, pin);
    let record = await this.repo.findPosPinStaff(tenantId, branchId, lookupHash);
    if (!record) {
      const candidates = await this.repo.findLegacyPosPinCandidates(tenantId, branchId);
      const matches = candidates.filter((candidate) =>
        this.passwords.verify(pin, candidate.pinSalt, candidate.pinHash),
      );
      if (matches.length !== 1) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      }
      record = matches[0];
    }
    if ((record.lockedUntil?.getTime() ?? 0) > Date.now() || record.failedAttempts >= 10) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (!this.passwords.verify(pin, record.pinSalt, record.pinHash)) {
      await this.repo.recordPosPinFailure(record.staffId);
      await this.repo.writeSecurityAudit({
        actorUserId: record.userId,
        sessionId: null,
        businessId: tenantId,
        branchId,
        eventType: 'authentication.pin_denied',
        entityType: 'staff',
        entityId: record.staffId,
        outcome: 'denied',
        reasonCode: 'pin_invalid',
        metadata: { app: 'pos' },
      });
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const allowed = await this.repo.deviceAllowedForUser(
      record.userId,
      client.deviceId,
      client.app,
      tokenHash(client.installationId),
      tokenHash(client.deviceCredential),
      tenantId,
      branchId,
    );
    if (!allowed) {
      throw new UnauthorizedException({ code: 'DEVICE_NOT_ALLOWED' });
    }
    const entitlement = await this.repo.effectiveEntitlement(tenantId, 'pos');
    if (
      !entitlement?.enabled ||
      !['trialing', 'active'].includes(entitlement.subscriptionStatus)
    ) {
      throw new ForbiddenException({ code: 'ENTITLEMENT_DISABLED' });
    }
    try {
      if (!(await this.repo.confirmPosPin(record.staffId, tenantId, lookupHash))) {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      }
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      }
      throw error;
    }

    const user: SessionUser = {
      id: record.userId,
      email: record.email,
      displayName: record.displayName,
    };
    const [tenants, tokens] = await Promise.all([
      this.repo.findTenantsForUser(user.id),
      this.createSession(user, client),
    ]);
    await this.repo.writeSecurityAudit({
      actorUserId: user.id,
      sessionId: tokens.sessionId,
      businessId: tenantId,
      branchId,
      eventType: 'authentication.pin_succeeded',
      entityType: 'staff',
      entityId: record.staffId,
      outcome: 'success',
      metadata: { app: 'pos' },
    });
    return { user, tenants, ...tokens };
  }

  /** Rotate the access token from a valid refresh token. */
  async refresh(refreshToken: string, client: SessionClient): Promise<LoginResult> {
    const claims = await this.jwt.verifyRefresh(refreshToken);
    const current = await this.repo.findSession(claims.sessionId);
    if (
      !current ||
      current.userId !== claims.sub ||
      current.tokenHash !== tokenHash(refreshToken) ||
      current.revokedAt ||
      new Date(current.expiresAt) <= new Date()
    ) {
      if (current) {
        await this.repo.revokeSessionFamily(current.id, 'refresh_replay');
        await this.repo.writeSecurityAudit({
          actorUserId: claims.sub,
          sessionId: current.id,
          eventType: 'authentication.refresh_replay',
          entityType: 'session',
          entityId: current.id,
          outcome: 'denied',
          reasonCode: 'refresh_replay',
        });
      }
      throw new UnauthorizedException('invalid_token');
    }
    if (
      current.deviceId &&
      !(await this.repo.deviceAllowedForUser(
        claims.sub,
        current.deviceId,
        current.app,
        client.installationId ? tokenHash(client.installationId) : null,
        client.deviceCredential ? tokenHash(client.deviceCredential) : null,
      ))
    ) {
      await this.repo.revokeSession(current.id, 'device_not_allowed');
      throw new UnauthorizedException('device_not_allowed');
    }
    const summary = await this.repo.findUserById(claims.sub);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    const [tenants, tokens] = await Promise.all([
      this.repo.findTenantsForUser(user.id),
      this.rotateSession(user, current, refreshToken, client),
    ]);
    return { user, tenants, ...tokens };
  }

  /** Rehydrate the session for `/me` from a verified access cookie. */
  async session(userId: string): Promise<{ user: SessionUser; tenants: TenantMembership[] }> {
    const summary = await this.repo.findUserById(userId);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const [tenants] = await Promise.all([this.repo.findTenantsForUser(userId)]);
    return {
      user: {
        id: summary.userId,
        email: summary.email,
        displayName: summary.displayName,
      },
      tenants,
    };
  }

  private async createSession(user: SessionUser, client: SessionClient): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = await this.jwt.signRefresh(user.id, sessionId);
    const accessToken = await this.jwt.signAccess({
      sub: user.id,
      email: user.email,
      sessionId,
      deviceId: client.deviceId,
    });
    await this.repo.createSession({
      id: sessionId,
      userId: user.id,
      deviceId: client.deviceId,
      app: client.app,
      tokenHash: tokenHash(refreshToken),
      expiresAt: this.refreshExpiry(),
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { accessToken, refreshToken, sessionId, deviceId: client.deviceId };
  }

  private pinLookupHash(tenantId: string, pin: string): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for POS PIN authentication');
    return posPinLookupHash(secret, tenantId, pin);
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

  private async rotateSession(
    user: SessionUser,
    current: {
      id: string;
      deviceId: string | null;
      app: 'dashboard' | 'kds' | 'pos';
    },
    oldRefreshToken: string,
    client: SessionClient,
  ): Promise<TokenPair> {
    const sessionId = randomUUID();
    const deviceId = current.deviceId ?? client.deviceId;
    const refreshToken = await this.jwt.signRefresh(user.id, sessionId);
    const accessToken = await this.jwt.signAccess({
      sub: user.id,
      email: user.email,
      sessionId,
      deviceId,
    });
    const rotated = await this.repo.rotateSession(current.id, tokenHash(oldRefreshToken), {
      id: sessionId,
      userId: user.id,
      deviceId,
      app: current.app,
      tokenHash: tokenHash(refreshToken),
      expiresAt: this.refreshExpiry(),
      ip: client.ip,
      userAgent: client.userAgent,
    });
    if (!rotated) throw new UnauthorizedException('invalid_token');
    return { accessToken, refreshToken, sessionId, deviceId };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const claims = await this.jwt.verifyRefresh(refreshToken);
      await this.repo.revokeSession(claims.sessionId, 'logout');
      await this.repo.writeSecurityAudit({
        actorUserId: claims.sub,
        sessionId: claims.sessionId,
        eventType: 'session.revoked',
        entityType: 'session',
        entityId: claims.sessionId,
        outcome: 'success',
        reasonCode: 'logout',
      });
    } catch {
      // Logout remains idempotent. Invalid cookies are cleared by the controller.
    }
  }

  async globalLogout(userId: string, sessionId: string, exceptCurrent: boolean): Promise<number> {
    const count = await this.repo.revokeUserSessions(userId, exceptCurrent ? sessionId : null);
    await this.repo.writeSecurityAudit({
      actorUserId: userId,
      sessionId,
      eventType: 'session.global_logout',
      entityType: 'user',
      entityId: userId,
      outcome: 'success',
      metadata: { revokedSessionCount: count, exceptCurrent },
    });
    return count;
  }

  private refreshExpiry(): Date {
    const ttl = parseDurationSeconds(this.config.get('JWT_REFRESH_TTL', { infer: true }));
    return new Date(Date.now() + ttl * 1000);
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
    await this.repo.revokeUserSessions(record.userId, null);
    await this.repo.writeSecurityAudit({
      actorUserId: record.userId,
      sessionId: null,
      eventType: 'identity.password_changed',
      entityType: 'user',
      entityId: record.userId,
      outcome: 'success',
      reasonCode: 'password_reset',
    });
  }
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
