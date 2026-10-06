import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS,
  PointCredentialRenewalService,
} from './point-credential-renewal.service';

/**
 * THE RENEWAL SWEEP, WITH NOTHING BUT A FAKE VENDOR.
 *
 * The two questions this file answers are the two D8 turns on: a token inside the margin is
 * RENEWED and the new pair is stored, and everything that goes wrong is RECORDED rather than
 * thrown — because the record is what the owner sees, and an exception would only reach a log
 * nobody reads.
 */

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN_URL = 'https://api.mercadopago.com/oauth/token';

function config(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    MERCADO_PAGO_POINT_CLIENT_ID: 'client-id',
    MERCADO_PAGO_POINT_CLIENT_SECRET: 'client-secret',
    MERCADO_PAGO_POINT_OAUTH_TOKEN_URL: TOKEN_URL,
    ...overrides,
  };
  return { get: vi.fn((key: string) => values[key]) };
}

function repository(due: unknown[]) {
  return {
    dueForRenewal: vi.fn().mockResolvedValue(due),
    recordRefreshed: vi.fn().mockResolvedValue(undefined),
    recordRefreshFailure: vi.fn().mockResolvedValue(undefined),
  };
}

const credential = (merchantId: string, refreshToken: string | null = 'TG-REFRESH-OPAQUE') => ({
  merchantId,
  mpUserId: '3696430142',
  accessToken: 'APP_USR-OLD',
  refreshToken,
  expiresAt: new Date('2026-09-20T12:00:00.000Z'),
});

/** The vendor's answer to a refresh: a WHOLE token set, because it rotates the refresh token too. */
function stubVendor(status: number, body: unknown): { calls: { body: string }[] } {
  const calls: { body: string }[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
    calls.push({ body: String(init?.body ?? '') });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PointCredentialRenewalService.renewDue', () => {
  it('renews a credential inside the margin and stores the ROTATED pair', async () => {
    const vendor = stubVendor(200, {
      access_token: 'APP_USR-NEW',
      refresh_token: 'TG-REFRESH-NEW',
      user_id: 3696430142,
      expires_in: 15_552_000,
    });
    const credentials = repository([credential(MERCHANT)]);
    const service = new PointCredentialRenewalService(credentials as never, config() as never);

    const result = await service.renewDue();

    // The grant is the difference between this call and the exchange — nothing else changed.
    expect(vendor.calls).toHaveLength(1);
    expect(vendor.calls[0].body).toContain('grant_type=refresh_token');
    expect(vendor.calls[0].body).toContain('refresh_token=TG-REFRESH-OPAQUE');
    expect(credentials.recordRefreshed).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      mpUserId: '3696430142',
      accessToken: 'APP_USR-NEW',
      // THE ROTATED REFRESH TOKEN IS THE POINT: storing only the access token would leave a
      // credential that renews exactly once.
      refreshToken: 'TG-REFRESH-NEW',
      expiresAt: expect.any(Date),
    });
    expect(credentials.recordRefreshFailure).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 1, renewed: 1, failed: 0 });
  });

  it('records a refusal AND KEEPS GOING, so one café cannot stop the sweep', async () => {
    stubVendor(400, { error: 'invalid_grant', error_description: 'expired' });
    const credentials = repository([credential(MERCHANT), credential(OTHER)]);
    const service = new PointCredentialRenewalService(credentials as never, config() as never);

    const result = await service.renewDue();

    expect(credentials.recordRefreshFailure).toHaveBeenCalledTimes(2);
    // The reason is the vendor's CODE, never its message: `refresh_failed_at` has no message
    // column, and a vendor string kept beside a credential is a string nobody audits.
    expect(credentials.recordRefreshFailure).toHaveBeenCalledWith(
      MERCHANT,
      'invalid_grant (status 400)',
    );
    expect(credentials.recordRefreshed).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 2, renewed: 0, failed: 2 });
  });

  it('records a failure for a credential with no refresh token instead of hiding it', async () => {
    const vendor = stubVendor(200, {});
    const credentials = repository([credential(MERCHANT, null)]);
    const service = new PointCredentialRenewalService(credentials as never, config() as never);

    const result = await service.renewDue();

    // Nothing to renew WITH, and the honest outcome is the owner's alert — the fix is a person
    // authorizing again, which the console asks for precisely because this counter is up.
    expect(vendor.calls).toHaveLength(0);
    expect(credentials.recordRefreshFailure).toHaveBeenCalledWith(
      MERCHANT,
      expect.stringContaining('no refresh token is stored'),
    );
    expect(result).toEqual({ checked: 1, renewed: 0, failed: 1 });
  });

  it('does nothing at all when the deployment has no application identity', async () => {
    const vendor = stubVendor(200, {});
    const credentials = repository([credential(MERCHANT)]);
    const service = new PointCredentialRenewalService(
      credentials as never,
      config({ MERCADO_PAGO_POINT_CLIENT_SECRET: undefined }) as never,
    );

    const result = await service.renewDue();

    // A background sweep that threw here would fill the dead-letter sink every night for a
    // deployment that simply does not offer third-party accounts.
    expect(vendor.calls).toHaveLength(0);
    expect(credentials.dueForRenewal).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, renewed: 0, failed: 0 });
  });

  it('asks for exactly the margin and batch it was given', async () => {
    const credentials = repository([]);
    const service = new PointCredentialRenewalService(credentials as never, config() as never);

    await service.renewDue(3, 7);

    expect(credentials.dueForRenewal).toHaveBeenCalledWith(3, 7);
    // …and the default is D8's own number, stated once.
    expect(POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS).toBe(14);
  });
});
