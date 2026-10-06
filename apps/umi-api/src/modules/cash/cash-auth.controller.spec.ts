import { describe, expect, it, vi } from 'vitest';
import { CashAuthController } from './cash-auth.controller';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { CustomerSessionService } from './customer-session.service';
import type { PublicMerchant } from '../auth/public-merchant.guard';

const MERCHANT: PublicMerchant = {
  merchantId: '9f000000-0000-4000-8000-00000000d001',
  name: 'Kalala',
  handle: 'kalala',
};

function harness(revoke = vi.fn().mockResolvedValue(true)) {
  const sessions = { revokeByRefreshToken: revoke } as unknown as CustomerSessionService;
  const controller = new CashAuthController(
    sessions,
    { login: vi.fn(), refresh: vi.fn() } as never,
    new RateLimitService(),
    { get: () => undefined } as never,
  );
  const cleared: { name: string; path?: string }[] = [];
  const reply = {
    clearCookie: (name: string, opts?: { path?: string }) => {
      cleared.push({ name, path: opts?.path });
      return reply;
    },
  };
  const req = (cookies: Record<string, string>, merchantRef = 'kalala') =>
    ({ cookies, params: { merchantRef } }) as never;
  return { controller, revoke, reply: reply as never, cleared, req };
}

describe('cash logout', () => {
  it('revokes the presented refresh token', async () => {
    const h = harness();
    await h.controller.logout(MERCHANT, h.req({ refreshToken: 'tok-1' }), h.reply);
    expect(h.revoke).toHaveBeenCalledWith(MERCHANT.merchantId, 'tok-1');
  });

  it('clears the cookie on / and on the path the caller used', async () => {
    const h = harness();
    await h.controller.logout(MERCHANT, h.req({ refreshToken: 'tok-1' }, 'kalala'), h.reply);
    expect(h.cleared).toEqual([
      { name: 'refreshToken', path: '/' },
      { name: 'refreshToken', path: '/kalala' },
    ]);
  });

  it('clears the id path when the caller addressed the cafe by id', async () => {
    // The café answers to an id OR a handle. The browser stored the cookie under
    // the segment it navigated to, so resolving to the handle would leave a cookie
    // scoped to the id in place — and the browser would keep sending it.
    const h = harness();
    await h.controller.logout(MERCHANT, h.req({ refreshToken: 't' }, MERCHANT.merchantId), h.reply);
    expect(h.cleared[1]).toEqual({ name: 'refreshToken', path: `/${MERCHANT.merchantId}` });
  });

  it('succeeds with no cookie at all, and revokes nothing', async () => {
    // Logging out of a session you no longer hold is not an error, and answering
    // otherwise would tell an anonymous caller whether a token is live.
    const h = harness();
    await expect(h.controller.logout(MERCHANT, h.req({}), h.reply)).resolves.toEqual({
      success: true,
    });
    expect(h.revoke).not.toHaveBeenCalled();
    expect(h.cleared).toHaveLength(2);
  });

  it('still clears the cookie when the revoke throws', async () => {
    // Otherwise a database blip leaves the browser presenting a token whose session
    // the customer believes she ended.
    const h = harness(vi.fn().mockRejectedValue(new Error('pg down')));
    await expect(
      h.controller.logout(MERCHANT, h.req({ refreshToken: 't' }), h.reply),
    ).resolves.toEqual({ success: true });
    expect(h.cleared).toHaveLength(2);
  });
});
