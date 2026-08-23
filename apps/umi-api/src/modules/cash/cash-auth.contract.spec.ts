import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fastifyCookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CashAuthController } from './cash-auth.controller';
import { CashAuthService } from './cash-auth.service';
import { CustomerSessionService } from './customer-session.service';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { AuthRepository } from '../auth/auth.repository';
import { PasswordService } from '../../shared/auth/password.service';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';

/**
 * THE WHOLE ROUND TRIP, OVER REAL HTTP.
 *
 * The other suites each see one seam. This one sees the JOIN between them, which
 * is where a port actually fails: the guard chain, the cookie surviving a round
 * trip, the DTO pipe, and — the reason this file exists — that LOGGING OUT ENDS
 * THE ABILITY TO REFRESH. That claim spans three routes and a cookie, so no
 * single-seam test can make it.
 *
 * The session STORE is a double; its SQL is proven against a real database in
 * `cash-login.integration.ts`. Everything else here is the real object: the real
 * controller, the real service, the real guard, real JWTs, real Fastify.
 *
 * A `.spec.ts` on purpose: no database, so it runs on every pull request.
 */

const MERCHANT = 'merchant-1';
const HANDLE = 'kalala';
const USER = 'user-1';

/** A test double of `runtime.session`: token hash → live or revoked. */
class SessionStore {
  private live = new Map<string, { userId: string; merchantId: string }>();
  private counter = 0;

  async createSession(subjectId: string, _role: string, merchantId: string) {
    const refreshToken = `refresh-${++this.counter}`;
    this.live.set(refreshToken, { userId: subjectId, merchantId });
    return { accessToken: `access-${this.counter}`, refreshToken };
  }

  async signAccessToken() {
    return `access-refreshed-${++this.counter}`;
  }

  async staffSessionByRefreshToken(merchantId: string, token: string) {
    const row = this.live.get(token);
    return row && row.merchantId === merchantId ? { userId: row.userId } : null;
  }

  async revokeByRefreshToken(merchantId: string, token: string) {
    const row = this.live.get(token);
    if (!row || row.merchantId !== merchantId) return false;
    this.live.delete(token);
    return true;
  }
}

describe('cash auth · login, refresh, logout as one flow', () => {
  let app: NestFastifyApplication;

  const authRepo = {
    merchantById: vi.fn(async () => null),
    merchantByHandle: vi.fn(async (h: string) =>
      h === HANDLE ? { id: MERCHANT, name: 'Kalala Café', handle: HANDLE } : null,
    ),
    findCredentialByEmail: vi.fn(async (email: string) =>
      email === 'ana@kalala.mx'
        ? {
            userId: USER,
            email,
            displayName: 'Ana',
            passwordSalt: 'salt',
            passwordHash: 'hash',
            passwordAlgorithm: 'scrypt-sha256-v1',
            mfaMethod: null,
          }
        : null,
    ),
    findMembershipAccess: vi.fn(async () => ({ roles: ['owner'] })),
    upgradeCredential: vi.fn(async () => undefined),
    // AB#115: refresh re-checks enrolment. Unenrolled here, so the flow still runs.
    mfaMethodByUserId: vi.fn(async () => null),
  };

  const passwords = {
    verify: (pw: string) => pw === 'correct',
    // The row this harness serves is already scrypt, so no upgrade is expected.
    // Both methods must exist regardless: a login must never 500 because the
    // credential-upgrade path was not wired.
    needsUpgrade: () => false,
    hash: () => ({ salt: 'new-salt', hash: 'new-hash' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashAuthController],
      providers: [
        CashAuthService,
        PublicMerchantGuard,
        RateLimitService,
        { provide: CustomerSessionService, useValue: new SessionStore() },
        { provide: AuthRepository, useValue: authRepo },
        { provide: PasswordService, useValue: passwords },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.register(fastifyCookie);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (path: string, payload?: unknown, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: path,
      payload: payload ?? {},
      headers: cookie ? { cookie } : {},
    });

  const login = (password = 'correct') =>
    post(`/api/${HANDLE}/auth/login`, { identifier: 'ana@kalala.mx', password });

  /** The `refreshToken=...` pair, as a browser would send it back. */
  const cookieFrom = (res: { cookies: { name: string; value: string }[] }) => {
    const c = res.cookies.find((x) => x.name === 'refreshToken');
    return c ? `refreshToken=${c.value}` : '';
  };

  it('logs in, and hands back a token plus an httpOnly cookie', async () => {
    const res = await login();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user).toMatchObject({ id: USER, role: 'ADMIN' });
    expect(body.refreshToken).toBeUndefined();

    const cookie = res.cookies.find((c) => c.name === 'refreshToken');
    expect(cookie?.httpOnly).toBe(true);
  });

  it('refreshes with that cookie', async () => {
    const res = await post(`/api/${HANDLE}/auth/refresh`, {}, cookieFrom(await login()));

    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
  });

  it('LOGGING OUT ENDS THE ABILITY TO REFRESH', async () => {
    // The claim the whole port rests on. Before this, `revokeByRefreshToken` set a
    // column nothing read, and logout was a cookie deletion dressed up as a
    // security control.
    const cookie = cookieFrom(await login());
    expect((await post(`/api/${HANDLE}/auth/refresh`, {}, cookie)).statusCode).toBe(200);

    const out = await post(`/api/${HANDLE}/auth/logout`, {}, cookie);
    expect(out.statusCode).toBe(200);

    // Same cookie, same signature, still unexpired — and refused, because the
    // session behind it is gone.
    const after = await post(`/api/${HANDLE}/auth/refresh`, {}, cookie);
    expect(after.statusCode).toBe(401);
  });

  it('refuses a wrong password without setting a cookie', async () => {
    const res = await login('wrong');

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Credenciales inválidas' });
    expect(res.cookies.find((c) => c.name === 'refreshToken')).toBeUndefined();
  });

  it('refuses a café that does not exist, before reading the password', async () => {
    const res = await post('/api/nosuchcafe/auth/login', {
      identifier: 'ana@kalala.mx',
      password: 'correct',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Merchant no encontrado' });
  });

  it('rejects a malformed body at the pipe', async () => {
    const res = await post(`/api/${HANDLE}/auth/login`, { identifier: 'ana@kalala.mx' });

    expect(res.statusCode).toBe(400);
  });

  it('refuses to refresh with no cookie at all', async () => {
    const res = await post(`/api/${HANDLE}/auth/refresh`);

    expect(res.statusCode).toBe(401);
  });
});
