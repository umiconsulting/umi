import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { PubMerchant } from '../auth/current-user.decorator';
import type { PublicMerchant } from '../auth/public-merchant.guard';
import type { AppConfig } from '../../shared/config/config.schema';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { CustomerSessionService } from './customer-session.service';
import { CashAuthService, type CashLoginResult } from './cash-auth.service';
import { CashLoginDto } from './dto/cash-login.dto';

/** The cookie umi-cash writes at login and reads at refresh. */
const REFRESH_COOKIE = 'refreshToken';
/** Matches the 30d expiry `createSession` writes to `runtime.session`. */
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;
const WINDOW = 15 * 60 * 1000;
/** umi-cash's two buckets: per address, then per account. */
const PER_IP = 10;
const PER_ACCOUNT = 5;

/**
 * Cash session teardown.
 *
 * NO AUTHENTICATION, DELIBERATELY. Holding the refresh token IS the authorization
 * to end the session it names, and demanding a valid access token as well would
 * make logout fail exactly when it matters most — after the access token expired,
 * or when a customer is trying to get out of a session she thinks is compromised.
 * A token nobody holds revokes nothing, so there is nothing here to abuse.
 *
 * IT ANSWERS 200 EITHER WAY. A logout that reported "that token was not live"
 * would answer, for any string a caller cares to submit, whether it names a
 * session — and it would do so with no login at all. The reply says only that the
 * browser is now logged out, which is true in both cases.
 *
 * ONE DIVERGENCE FROM umi-cash, ON PURPOSE. umi-cash never resolved the café, so
 * it answered 200 for any slug at all. This route runs `PublicMerchantGuard` like
 * every other public cash route, so an unknown `:merchantRef` is a 404 and the
 * cookie is not cleared. Keeping the guard is what lets the revoke carry a
 * merchant predicate — without a resolved café there is nothing to scope it to,
 * and a token minted at one café could end a session at another.
 *
 * LOGIN AND REFRESH ARE NOT HERE YET. They wait on the legacy password hashes
 * (AB#109): umi-cash still accepts a bare `salt:hash` sha256 that this API cannot
 * verify, and porting login before those accounts are migrated locks their owners
 * out. Logout does not read a password, so it does not wait.
 */
@UseGuards(PublicMerchantGuard)
@Controller('api/:merchantRef/auth')
export class CashAuthController {
  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly auth: CashAuthService,
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Open a register session.
   *
   * TWO BUCKETS, NOT ONE. Per-IP alone stops nothing: an attacker with a pool of
   * addresses guesses one café owner's password all day and never trips it. The
   * account bucket is keyed per CAFÉ as well, because two cafés can employ the
   * same address and one café's failures must not lock the other's till.
   *
   * The account bucket counts every ATTEMPT, not only failures. Counting failures
   * alone lets an attacker reset the window with one known-good login.
   */
  @Post('login')
  @HttpCode(200)
  async login(
    @PubMerchant() t: PublicMerchant,
    @Body() dto: CashLoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Omit<CashLoginResult, 'refreshToken'>> {
    const ip = req.ip || 'unknown';
    this.guard(reply, `cash-login:${t.merchantId}:${ip}`, PER_IP);
    this.guard(
      reply,
      `cash-login-account:${t.merchantId}:${dto.identifier.trim().toLowerCase()}`,
      PER_ACCOUNT,
    );

    const { refreshToken, ...body } = await this.auth.login(t.merchantId, dto);
    // The refresh token leaves ONLY as an httpOnly cookie. The client keeps the
    // access token in localStorage, so a refresh token in the body would be
    // readable by any script on the page.
    reply.setCookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }) ?? true,
      sameSite: this.config.get('COOKIE_SAMESITE', { infer: true }) ?? 'lax',
      path: '/',
      maxAge: REFRESH_MAX_AGE,
    });
    return body;
  }

  /**
   * A new access token for a session that is still live.
   *
   * The refresh token is never re-issued here. The frozen client reads only
   * `accessToken` from the body, and rotating belongs with the family/replay
   * design the schema anticipates (`refresh_family_id`, `replaced_by_id`) — which
   * is a change to the dashboard as well, not a detail of this port.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @PubMerchant() t: PublicMerchant,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) _reply: FastifyReply,
  ): Promise<{ accessToken: string }> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException({ error: 'Credenciales inválidas' });
    return this.auth.refresh(t.merchantId, token);
  }

  private guard(reply: FastifyReply, key: string, max: number): void {
    const r = this.rateLimit.hit(key, max, WINDOW);
    if (!r.allowed) {
      void reply.header('Retry-After', String(Math.ceil((r.resetAt - Date.now()) / 1000)));
      throw new HttpException({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @PubMerchant() t: PublicMerchant,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      // Never throws outward. The cookie must be cleared even when the database
      // refuses the write, or the browser keeps presenting a token whose session
      // the customer believes she ended.
      await this.sessions.revokeByRefreshToken(t.merchantId, token).catch(() => false);
    }

    // BOTH PATHS, as umi-cash does. A cookie is identified by name AND path, so a
    // clear on `/` does not remove one scoped to `/{slug}` — the browser would keep
    // sending the old one.
    //
    // The path uses the RAW `:merchantRef` the caller sent, not the resolved handle.
    // The cookie was written under the segment the browser navigated to, and this
    // route accepts an id OR a handle for the same café, so resolving first would
    // clear `/{handle}` for a browser holding `/{id}`.
    const ref = (req.params as { merchantRef?: string })?.merchantRef;
    for (const path of ref ? ['/', `/${ref}`] : ['/']) {
      reply.clearCookie(REFRESH_COOKIE, { path });
    }
    return { success: true };
  }
}
