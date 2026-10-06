import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimitService, type RateLimitResult } from '../ratelimit/rate-limit.service';
import { MetricsService } from './metrics.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '../auth/jwt.service';
import { ACCESS_COOKIE, type AuthedRequest } from '../../modules/auth/auth.types';
import type { AppConfig } from '../config/config.schema';

const WINDOW_MS = 60_000;

/**
 * Ingress rate limit (§3.5). ONE bucket, keyed on the address:
 *
 *   - `http:ip:<ip>`. Anonymous callers keep the original ceiling,
 *     `RATE_LIMIT_IP_PER_MINUTE`. Once a principal is verified the same bucket is
 *     charged at `RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE`, because every client
 *     behind one address — a café's dashboard, its tills, a workstation running the
 *     UX sweep — shares it. It stays an anti-abuse bound: a single address is still
 *     throttled at that ceiling.
 *
 * This guard bounds the ADDRESS; `OperationalInterceptor` bounds the PRINCIPAL. Both
 * are registered globally, and a bucket must be charged in exactly one place: the
 * interceptor already owns `http:user:<id>` (240/min) — as well as `http:device:`,
 * `http:tenant:` and `http:branch:` — so this guard must NOT charge `http:user:<id>`
 * again. Charging it here would draw two units from a single counter per request and
 * halve the effective per-principal allowance to 120/min.
 *
 * This is a GLOBAL guard, so it runs before the controller-level `AuthGuard`:
 * `request.authUser` is not populated here and the request context carries no userId
 * yet (which is why `CsrfGuard`, also global, reads the cookie directly). The guard
 * therefore verifies the access credential itself — the `umi_access` cookie, or the
 * POS's `Authorization: Bearer` — with the shared JwtService. The signature check is
 * the point: no caller reaches the higher ceiling by inventing a cookie. Everything
 * that does not verify (absent, expired, not an access token, a till register token,
 * or a JWT_SECRET misconfiguration) is treated as anonymous, i.e. the STRICTER
 * ceiling. This path never hands out more budget than the anonymous one.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly limits: RateLimitService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest & AuthedRequest>();
    const reply = http.getResponse<FastifyReply>();

    const userId = await this.verifiedUserId(request);
    const addressScope = userId ? 'ip_authenticated' : 'ip';
    const address = this.limits.hit(
      `http:ip:${request.ip}`,
      userId
        ? this.config.get('RATE_LIMIT_IP_AUTHENTICATED_PER_MINUTE', { infer: true })
        : this.config.get('RATE_LIMIT_IP_PER_MINUTE', { infer: true }),
      WINDOW_MS,
    );
    this.writeHeaders(reply, address.remaining, address.resetAt);
    if (!address.allowed) this.reject(addressScope, address);
    return true;
  }

  /**
   * The verified principal's user id, or null.
   *
   * Cookie first, then bearer, exactly as `AuthGuard` orders them. The result is only
   * ever used as a bucket key — never as an identity a route acts on. The
   * interceptor's other scopes are deliberately not repeated here: tenant/branch come
   * from the request context that `MerchantAccessGuard` fills in after auth, and
   * `x-umi-device-id` is a client-supplied header, not something to bind an ingress
   * limit on. The interceptor still enforces those, post-auth, on every request.
   */
  private async verifiedUserId(request: FastifyRequest & AuthedRequest): Promise<string | null> {
    const authorization = request.headers?.authorization;
    const bearer =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : undefined;
    const token = request.cookies?.[ACCESS_COOKIE] ?? bearer;
    if (!token) return null;
    try {
      return (await this.jwt.verifyAccess(token)).sub;
    } catch {
      // An unverifiable credential is anonymous. A missing JWT_SECRET lands here too
      // and degrades to the stricter ceiling rather than to a bypass.
      return null;
    }
  }

  private writeHeaders(reply: FastifyReply, remaining: number, resetAt: number): void {
    void reply.header('x-ratelimit-remaining', String(remaining));
    void reply.header('x-ratelimit-reset', String(Math.ceil(resetAt / 1_000)));
  }

  private reject(scope: string, result: RateLimitResult): never {
    this.metrics.increment('http.rate_limit.rejected', { scope });
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Request rate limit exceeded.',
        retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)),
      },
      429,
    );
  }
}
