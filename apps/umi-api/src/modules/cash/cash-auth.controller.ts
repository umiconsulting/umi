import { Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { PubMerchant } from '../auth/current-user.decorator';
import type { PublicMerchant } from '../auth/public-merchant.guard';
import { CustomerSessionService } from './customer-session.service';

/** The cookie umi-cash writes at login and reads at refresh. */
const REFRESH_COOKIE = 'refreshToken';

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
  constructor(private readonly sessions: CustomerSessionService) {}

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
