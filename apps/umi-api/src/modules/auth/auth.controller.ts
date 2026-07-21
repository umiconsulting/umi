import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { decodeJwt } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../shared/config/config.schema';
import { AuthService, type LoginResult } from './auth.service';
import { AuthGuard } from './auth.guard';
import { buildCookieOptions, parseDurationSeconds } from './cookies';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  REMEMBER_COOKIE,
  type AuthUser,
} from './auth.types';
import type { SessionEnvelope, SessionResponse } from '@umi/contract';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/**
 * Auth ingress (D9). Issues/clears the httpOnly JWT cookies and returns the
 * session body the dashboard frontend renders. Cookie wiring lives here; the
 * service stays transport-agnostic.
 */
@UseGuards(AuthGuard)
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Public()
  @Post('local/login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const result = await this.auth.login(dto.username, dto.password);
    this.setAuthCookies(reply, result, dto.remember ?? false);
    return { session: toSession(result, this.accessExpiresIn()) };
  }

  @Public()
  @Post('local/refresh')
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('authentication_required');
    const result = await this.auth.refresh(token);
    // Preserve the persistent-vs-session choice from login across rotations.
    const remember = req.cookies?.[REMEMBER_COOKIE] === '1';
    this.setAuthCookies(reply, result, remember);
    return { session: toSession(result, this.accessExpiresIn()) };
  }

  @Public()
  @Post('local/logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply): { ok: true } {
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE, REMEMBER_COOKIE]) {
      reply.clearCookie(name, { path: '/' });
    }
    return { ok: true };
  }

  @Public()
  @Post('local/forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto.email);
    return { ok: true };
  }

  @Public()
  @Post('local/reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto.token, dto.password);
    return { ok: true };
  }

  /** Cookie-based session bootstrap for the SPA (authed). */
  @Get('me')
  async me(@Req() req: FastifyRequest, @CurrentUser() user: AuthUser): Promise<SessionResponse> {
    const session = await this.auth.session(user.id);
    return {
      session: {
        ...session,
        provider: 'local',
        accessExpiresIn: this.remainingAccessSeconds(req),
      },
    };
  }

  /**
   * Full access-token lifetime in seconds. Accurate right after login/refresh,
   * which reissue the cookie; the SPA uses it to schedule a proactive refresh
   * just before expiry (the token is httpOnly and unreadable client-side).
   */
  private accessExpiresIn(): number {
    return parseDurationSeconds(this.config.get('JWT_ACCESS_TTL', { infer: true }));
  }

  /**
   * Remaining lifetime (seconds) of the caller's access cookie. /me does NOT
   * reissue the cookie, so it must report the token's actual remaining `exp` —
   * returning the full configured TTL here would let the SPA schedule its
   * proactive refresh too late. Falls back to the configured TTL if the token
   * can't be decoded.
   */
  private remainingAccessSeconds(req: FastifyRequest): number {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (token) {
      try {
        const { exp } = decodeJwt(token);
        if (typeof exp === 'number') {
          return Math.max(0, exp - Math.floor(Date.now() / 1000));
        }
      } catch {
        // malformed/unreadable — fall back to the configured TTL below
      }
    }
    return this.accessExpiresIn();
  }

  private setAuthCookies(reply: FastifyReply, result: LoginResult, remember: boolean): void {
    reply.setCookie(
      ACCESS_COOKIE,
      result.accessToken,
      buildCookieOptions(this.config, 'access', remember),
    );
    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      buildCookieOptions(this.config, 'refresh', remember),
    );
    // Double-submit CSRF token: readable cookie, echoed by the SPA in a header
    // on mutations (CsrfGuard wiring is a follow-up; the token is issued now).
    reply.setCookie(
      CSRF_COOKIE,
      randomBytes(18).toString('hex'),
      buildCookieOptions(this.config, 'csrf', remember),
    );
    // Persist the choice so /refresh reissues with the same lifetime.
    reply.setCookie(
      REMEMBER_COOKIE,
      remember ? '1' : '0',
      buildCookieOptions(this.config, 'refresh', remember),
    );
  }
}

function toSession(result: LoginResult, accessExpiresIn: number): SessionEnvelope {
  return {
    user: result.user,
    tenants: result.tenants,
    provider: 'local',
    accessExpiresIn,
  };
}
