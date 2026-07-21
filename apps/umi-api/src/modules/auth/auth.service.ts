import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { PasswordService } from '../../shared/auth/password.service';
import { JwtService } from '../../shared/auth/jwt.service';
import { EmailAdapter } from '../../shared/adapters/email.adapter';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthRepository, type TenantMembershipSummary } from './auth.repository';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends TokenPair {
  user: SessionUser;
  tenants: TenantMembershipSummary[];
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
  ) {}

  async login(usernameRaw: string, password: string): Promise<LoginResult> {
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
    const [tenants, tokens] = await Promise.all([
      this.repo.findTenantsForUser(user.id),
      this.issueTokens(user),
    ]);
    return { user, tenants, ...tokens };
  }

  /** Rotate the access token from a valid refresh token. */
  async refresh(refreshToken: string): Promise<LoginResult> {
    const userId = await this.jwt.verifyRefresh(refreshToken);
    const summary = await this.repo.findUserById(userId);
    if (!summary) throw new UnauthorizedException('invalid_token');
    const user: SessionUser = {
      id: summary.userId,
      email: summary.email,
      displayName: summary.displayName,
    };
    const [tenants, tokens] = await Promise.all([
      this.repo.findTenantsForUser(user.id),
      this.issueTokens(user),
    ]);
    return { user, tenants, ...tokens };
  }

  /** Rehydrate the session for `/me` from a verified access cookie. */
  async session(
    userId: string,
  ): Promise<{ user: SessionUser; tenants: TenantMembershipSummary[] }> {
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

  private async issueTokens(user: SessionUser): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAccess({ sub: user.id, email: user.email }),
      this.jwt.signRefresh(user.id),
    ]);
    return { accessToken, refreshToken };
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
  }
}
