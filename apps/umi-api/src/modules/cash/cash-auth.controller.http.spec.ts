import { describe, expect, it, vi } from 'vitest';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { CashAuthController } from './cash-auth.controller';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import type { PublicMerchant } from '../auth/public-merchant.guard';

const MERCHANT: PublicMerchant = {
  merchantId: '9f000000-0000-4000-8000-00000000a001',
  name: 'Kalala',
  handle: 'kalala',
};

const LOGIN_RESULT = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  user: { id: 'u1', name: 'Ana', role: 'ADMIN' as const, email: 'ana@kalala.mx' },
};

function harness() {
  const auth = {
    login: vi.fn().mockResolvedValue(LOGIN_RESULT),
    refresh: vi.fn().mockResolvedValue({ accessToken: 'access-2' }),
  };
  const sessions = { revokeByRefreshToken: vi.fn().mockResolvedValue(true) };
  const config = { get: () => undefined };
  const controller = new CashAuthController(
    sessions as never,
    auth as never,
    new RateLimitService(),
    config as never,
  );
  const cookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const reply = {
    setCookie: (name: string, value: string, opts: Record<string, unknown>) => {
      cookies.push({ name, value, opts });
      return reply;
    },
    clearCookie: () => reply,
    header: () => reply,
  };
  const req = (over: Record<string, unknown> = {}) =>
    ({ cookies: {}, params: { merchantRef: 'kalala' }, ip: '10.0.0.1', ...over }) as never;
  return { controller, auth, reply: reply as never, cookies, req };
}

describe('cash login · the wire contract the frozen client reads', () => {
  const body = { identifier: 'ana@kalala.mx', password: 'pw' };

  it('returns the access token and the user, and NEVER the refresh token', async () => {
    // The client stores `accessToken` in localStorage. A refresh token in the body
    // would be readable by any script on the page — the reason it is a cookie.
    const h = harness();
    const out = await h.controller.login(MERCHANT, body, h.req(), h.reply);
    expect(out).toEqual({ accessToken: 'access-1', user: LOGIN_RESULT.user });
    expect(JSON.stringify(out)).not.toContain('refresh-1');
  });

  it('sets the refresh cookie httpOnly, for 30 days, at the root path', async () => {
    const h = harness();
    await h.controller.login(MERCHANT, body, h.req(), h.reply);
    expect(h.cookies).toHaveLength(1);
    const c = h.cookies[0];
    expect(c.name).toBe('refreshToken');
    expect(c.value).toBe('refresh-1');
    expect(c.opts.httpOnly).toBe(true);
    expect(c.opts.path).toBe('/');
    expect(c.opts.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it('limits attempts per IP, across DIFFERENT accounts', async () => {
    // Each attempt names a different address, so the per-account bucket never
    // trips and only the IP bucket can refuse — otherwise this test would pass
    // for the wrong reason, since 5 accounts is reached before 10 addresses.
    // The attack it stops is one host spraying one password across every account
    // at a café.
    const h = harness();
    const attempt = (i: number) =>
      h.controller.login(
        MERCHANT,
        { ...body, identifier: `staff${i}@kalala.mx` },
        h.req(),
        h.reply,
      );
    for (let i = 0; i < 10; i++) await attempt(i);
    await expect(attempt(99)).rejects.toThrow(HttpException);
  });

  it('limits attempts per ACCOUNT, across IPs', async () => {
    // A per-IP limit alone is no defence: a distributed attacker rotates addresses
    // and keeps guessing one café owner's password all day.
    const h = harness();
    h.auth.login.mockRejectedValue(new UnauthorizedException({ error: 'Credenciales inválidas' }));
    for (let i = 0; i < 5; i++) {
      await h.controller
        .login(MERCHANT, body, h.req({ ip: `10.0.0.${i}` }), h.reply)
        .catch(() => null);
    }
    await expect(
      h.controller.login(MERCHANT, body, h.req({ ip: '10.9.9.9' }), h.reply),
    ).rejects.toThrow(HttpException);
  });

  it('buckets the account limit per cafe, not globally', async () => {
    // Two cafés can employ the same address; one café's failures must not lock the
    // other's register.
    const h = harness();
    h.auth.login.mockRejectedValue(new UnauthorizedException({ error: 'Credenciales inválidas' }));
    for (let i = 0; i < 5; i++) {
      await h.controller.login(MERCHANT, body, h.req(), h.reply).catch(() => null);
    }
    const other = { ...MERCHANT, merchantId: '9f000000-0000-4000-8000-00000000a002' };
    h.auth.login.mockResolvedValue(LOGIN_RESULT);
    await expect(
      h.controller.login(other, body, h.req({ ip: '10.1.1.1' }), h.reply),
    ).resolves.toMatchObject({ accessToken: 'access-1' });
  });
});

describe('cash refresh · the wire contract', () => {
  it('returns only the new access token', async () => {
    const h = harness();
    const out = await h.controller.refresh(
      MERCHANT,
      h.req({ cookies: { refreshToken: 'r' } }),
      h.reply,
    );
    expect(out).toEqual({ accessToken: 'access-2' });
  });

  it('refuses with no cookie, without asking the service', async () => {
    const h = harness();
    await expect(h.controller.refresh(MERCHANT, h.req(), h.reply)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(h.auth.refresh).not.toHaveBeenCalled();
  });
});
