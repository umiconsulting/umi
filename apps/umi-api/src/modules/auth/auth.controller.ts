import {
  Body,
  Controller,
  Get,
  HttpException,
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
import { AuthService, isMfaChallenge, type LoginResult } from './auth.service';
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
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';

/**
 * Per-IP ceilings on the unauthenticated auth routes. The window matches the one
 * cash-customer.controller.ts already uses, so there is one rate-limit idiom here.
 *
 * These bound an ANONYMOUS caller. The per-account ceilings that actually protect one
 * user (MFA_OTP_MAX_PER_HOUR, and runtime.otp.attempts) live in MfaService and the
 * database, because an attacker rotating source addresses must not collect a fresh
 * budget with every new IP. Both layers are needed: this one stops the volume, those
 * stop the patient attacker.
 */
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_WINDOW = 20;
const MFA_VERIFY_MAX_PER_WINDOW = 20;

/**
 * Login's other outcome. Not in `@umi/contract` yet on purpose — the dashboard has to
 * learn this shape before an enrolment can safely exist, and promoting it to the
 * shared contract is the change that pairs with the client work.
 */
export interface MfaChallengeResponse {
  mfaRequired: true;
  method: string;
  challengeToken: string;
  expiresInSeconds: number;
}

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
    private readonly rateLimit: RateLimitService,
  ) {}

  /** One rate-limit bucket; on exhaustion set Retry-After and 429. */
  private throttle(reply: FastifyReply, key: string, max: number): void {
    const r = this.rateLimit.hit(key, max, AUTH_WINDOW_MS);
    if (!r.allowed) {
      void reply.header('Retry-After', String(Math.ceil((r.resetAt - Date.now()) / 1000)));
      throw new HttpException({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);
    }
  }

  /**
   * Two outcomes, and the client must handle both.
   *   - No second factor enrolled → cookies are set and a session comes back, exactly
   *     as before.
   *   - A second factor enrolled → NO cookies, no session. The body carries
   *     `mfaRequired: true` and a challenge token to post back to `mfa/verify`.
   *
   * This is a shape change for the dashboard, and it is inert until somebody enrols:
   * `umi.user.mfa_method` is NULL for every row today, so the second branch is
   * unreachable until an enrolment writes it. Enrol only after the client can read
   * `mfaRequired`, or that account is locked out of the dashboard.
   */
  @Public()
  @Post('local/login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse | MfaChallengeResponse> {
    this.throttle(reply, `auth:login:${clientIp(req)}`, LOGIN_MAX_PER_WINDOW);
    const result = await this.auth.login(dto.username, dto.password);
    if (isMfaChallenge(result)) {
      // Deliberately no cookies. A half-authenticated caller carries the challenge in
      // the request body, so it can never ride along on an unrelated request the way
      // a cookie would.
      return {
        mfaRequired: true,
        method: result.method,
        challengeToken: result.challengeToken,
        expiresInSeconds: result.expiresInSeconds,
      };
    }
    this.setAuthCookies(reply, result, dto.remember ?? false);
    return { session: toSession(result, this.accessExpiresIn()) };
  }

  /** Second half of the two-step login. Issues the cookies the first half withheld. */
  @Public()
  @Post('local/mfa/verify')
  async verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    this.throttle(reply, `auth:mfa:${clientIp(req)}`, MFA_VERIFY_MAX_PER_WINDOW);
    const result = await this.auth.verifyMfa(dto.challengeToken, dto.code);
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
    merchants: result.merchants,
    provider: 'local',
    accessExpiresIn,
  };
}

function clientIp(req: FastifyRequest): string {
  // Fastify resolves req.ip from X-Forwarded-For using its configured trustProxy
  // hop count (set in main.ts). Trusting the raw leftmost XFF here instead would
  // let a caller spoof the header and rotate past the per-IP rate-limit buckets.
  return req.ip || 'unknown';
}
