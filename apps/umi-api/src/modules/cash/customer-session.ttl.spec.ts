import { describe, expect, it } from 'vitest';
import { decodeJwt } from 'jose';
import { CustomerSessionService } from './customer-session.service';

/**
 * HOW LONG A TILL SESSION LIVES, pinned.
 *
 * The access token is a BEARER. No route re-checks it against `runtime.session`,
 * so once it is issued nothing can take it back — `POST /auth/logout` revokes
 * the REFRESH token and the access token keeps working until it expires. Its
 * lifetime is therefore the real revocation window for a barista who was fired,
 * or for a token copied off a till.
 *
 * umi-cash answers 15 minutes (`lib/auth.ts:40`) and says why: `/auth/refresh`
 * re-derives the role and the membership from the database, which makes the
 * refresh the revocation point. The port shipped 24 hours while claiming
 * "minutes" in a comment. This test is what stops that drifting again.
 */
describe('the register session is short-lived, because nothing can revoke it', () => {
  const svc = new CustomerSessionService(
    {
      get: (k: string) =>
        k === 'JWT_ACCESS_SECRET' ? 'a-test-secret-thirty-two-plus-chars' : undefined,
    } as never,
    { query: async () => ({ rows: [] }) } as never,
  );

  it('mints a 15-minute access token, matching the app it replaces', async () => {
    const token = await svc.signAccessToken('u1', 'ADMIN', 'm1');
    const { iat, exp } = decodeJwt(token);
    expect(exp! - iat!).toBe(15 * 60);
  });

  it('says who and where, so the guards can tell the two audiences apart', async () => {
    const claims = decodeJwt(await svc.signAccessToken('u1', 'STAFF', 'm1'));
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('STAFF');
    expect(claims.merchantId).toBe('m1');
  });
});
