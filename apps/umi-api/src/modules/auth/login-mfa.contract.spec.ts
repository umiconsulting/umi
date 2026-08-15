import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { MfaChallengeResponse, SessionResponse, mfaChallenged } from '@umi/contract';

/**
 * THE TWO-STEP LOGIN, OVER REAL HTTP.
 *
 * `POST /api/auth/local/login` answers with one of two shapes, and the dashboard
 * must tell them apart. What can break is a field name, a status code, or a
 * `Set-Cookie` — and none of the three is visible from a service test.
 * `auth.service.spec.ts` calls the service directly, so it proves the branch and
 * says nothing about the wire.
 *
 * ⚠️ THIS FILE IS THE GUARD ON A LOCKOUT. Before the dashboard learned this
 * shape, it stored `payload.session` whatever came back. On a challenge that
 * stored `undefined` and returned the person to the login screen, so an enrolled
 * account could never sign in. `umi.user.mfa_method` is NULL for every row
 * today, which is the only reason nobody has hit it.
 *
 * A rename of `mfaRequired`, or one `Set-Cookie` on the challenge branch, breaks
 * a person's ability to log in and breaks NO other test. It breaks this one.
 *
 * The service is mocked on purpose. The seam under test is the CONTROLLER: the
 * body it writes, its status, and its cookies.
 */

// The field is `displayName`, and `SessionUser` requires it. An earlier version
// of this fixture said `name`, and the contract parse below caught it — which is
// the point of parsing the wire body rather than trusting the fixture.
const USER = {
  id: 'user-1',
  email: 'admin@umi.invalid',
  displayName: 'Admin',
};

const SESSION_RESULT = {
  user: USER,
  merchants: [],
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  csrfToken: 'csrf-token',
};

const CHALLENGE_RESULT = {
  mfaRequired: true as const,
  method: 'totp',
  challengeToken: 'challenge-token-abc',
  expiresInSeconds: 300,
};

describe('POST /api/auth/local/login · the two-outcome contract', () => {
  let app: NestFastifyApplication;

  const auth = {
    login: vi.fn(),
    verifyMfa: vi.fn(async () => SESSION_RESULT),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'JWT_ACCESS_TTL') return '30m';
              if (key === 'JWT_REFRESH_TTL') return '30d';
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            },
          },
        },
        // Never throttled here. The ceiling has its own tests; a shared counter
        // across these cases would make one test's result depend on the order.
        { provide: RateLimitService, useValue: { hit: () => ({ allowed: true, resetAt: 0 }) } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(import('@fastify/cookie'));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const login = (body: Record<string, unknown> = { username: 'a@b.c', password: 'pw' }) =>
    app.inject({ method: 'POST', url: '/api/auth/local/login', payload: body });

  describe('no second factor', () => {
    beforeEach(() => auth.login.mockResolvedValue(SESSION_RESULT));

    it('answers with a session', async () => {
      const res = await login();
      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).session.user.id).toBe(USER.id);
    });

    it('sets the auth cookies', async () => {
      const res = await login();
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('does NOT claim a challenge', async () => {
      expect(JSON.parse((await login()).body).mfaRequired).toBeUndefined();
    });
  });

  describe('a second factor is enrolled', () => {
    beforeEach(() => auth.login.mockResolvedValue(CHALLENGE_RESULT));

    it('answers with the four challenge fields, and the names the client reads', async () => {
      const res = await login();
      expect(res.statusCode).toBe(201);
      // Written out, not compared to the source constant. A field renamed in both
      // places at once must still fail here.
      expect(JSON.parse(res.body)).toEqual({
        mfaRequired: true,
        method: 'totp',
        challengeToken: 'challenge-token-abc',
        expiresInSeconds: 300,
      });
    });

    it('SETS NO COOKIE — a half-authenticated caller carries nothing that rides along', async () => {
      const res = await login();
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('carries NO session, so a client that reads only `session` gets nothing', async () => {
      // This is the lockout, stated as a test. The old dashboard stored this
      // `undefined` and navigated away.
      expect(JSON.parse((await login()).body).session).toBeUndefined();
    });

    it('sends `mfaRequired` as the literal true, not a truthy value', async () => {
      expect(JSON.parse((await login()).body).mfaRequired).toBe(true);
    });
  });

  describe('the contract package agrees with the wire', () => {
    it('parses the challenge body as MfaChallengeResponse', async () => {
      auth.login.mockResolvedValue(CHALLENGE_RESULT);
      const body = JSON.parse((await login()).body);
      expect(MfaChallengeResponse.safeParse(body).success).toBe(true);
      expect(mfaChallenged(body)).toBe(true);
    });

    it('parses the session body as SessionResponse', async () => {
      auth.login.mockResolvedValue(SESSION_RESULT);
      const body = JSON.parse((await login()).body);
      expect(SessionResponse.safeParse(body).success).toBe(true);
      expect(mfaChallenged(body)).toBe(false);
    });

    it('does NOT read a session body as a challenge', async () => {
      auth.login.mockResolvedValue(SESSION_RESULT);
      const body = JSON.parse((await login()).body);
      expect(MfaChallengeResponse.safeParse(body).success).toBe(false);
    });
  });

  describe('POST /api/auth/local/mfa/verify · the second half', () => {
    it('exchanges the challenge for the cookies the first half withheld', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/local/mfa/verify',
        payload: { challengeToken: 'challenge-token-abc', code: '123456' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.headers['set-cookie']).toBeDefined();
      expect(SessionResponse.safeParse(JSON.parse(res.body)).success).toBe(true);
    });

    it('passes the code through unchanged, so a leading zero survives', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/local/mfa/verify',
        payload: { challengeToken: 'tok', code: '012345' },
      });
      expect(auth.verifyMfa).toHaveBeenCalledWith('tok', '012345');
    });
  });
});
