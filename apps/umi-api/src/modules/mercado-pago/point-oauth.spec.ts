import { describe, expect, it } from 'vitest';
import {
  POINT_OAUTH_STATE_TTL_MS,
  PointOAuthError,
  exchangePointAuthorizationCode,
  pointAuthorizationUrl,
  signPointOAuthState,
  verifyPointOAuthState,
  type PointOAuthConfig,
} from './point-oauth';

/**
 * THE OAUTH CLIENT, WITH NO NETWORK AND NO CLOCK OF ITS OWN.
 *
 * Every case here asserts a SHAPE that came from the vendor's own documentation (research note
 * `08-serving-many-merchants.md` §2): the authorization URL's parameter set, the form encoding of
 * the exchange, and the mapping of the answer. The `fetch` fake records what was actually sent —
 * method, URL, headers and body — because "we use URLSearchParams" is a claim about code and
 * `application/x-www-form-urlencoded` is a claim about the WIRE, and only the second one is what
 * the vendor sees.
 */

/** A redirect URI with a query string of its own, so the encoding has something to get wrong. */
const REDIRECT_URI = 'https://pos.umi.example/mercado-pago/callback?tenant=umi';

const CONFIG: PointOAuthConfig = {
  clientId: '1234567890',
  clientSecret: 'APP_USR-secret-value',
  redirectUri: REDIRECT_URI,
  authorizeUrl: 'https://auth.mercadopago.com/authorization',
  tokenUrl: 'https://api.mercadopago.com/oauth/token',
  stateSecret: 'umo-state-secret',
};

const NOW = new Date('2026-09-17T12:00:00.000Z');

/** The vendor's documented token lifetime: 15552000 seconds, 180 days (note 08 §2 step 5). */
const EXPIRES_IN = 15_552_000;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Read a header case-insensitively, which is how HTTP treats it and how `fetch` may store it. */
function header(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

function headersToRecord(headers: RequestInit['headers']): Record<string, string> {
  const record: Record<string, string> = {};
  if (headers === undefined) return record;
  // `Headers` accepts all three shapes of `HeadersInit` (an array of pairs, a record, another
  // `Headers`), so the test reads the request through the same type the platform does.
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/** A `fetch` that answers one canned JSON body and records everything it was asked to send. */
function stubFetch(status: number, body: unknown) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: headersToRecord(init?.headers),
      // The two body shapes `fetch` sends as-is: a string, and a `URLSearchParams`, which the
      // platform serializes to its form encoding. Anything else is recorded as absent rather
      // than stringified into "[object Object]", so a test never asserts on a lie.
      body: bodyText(init?.body),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, requests };
}

function bodyText(body: BodyInit | null | undefined): string | null {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return null;
}

/** The documented success answer (note 08 §2 step 5). */
const TOKEN_ANSWER = {
  access_token: 'APP_USR-00000000-000000-abcdef',
  refresh_token: 'TG-00000000-000000-refresh',
  user_id: 13_045_771,
  public_key: 'APP_USR-00000000-000000-public',
  expires_in: EXPIRES_IN,
};

describe('pointAuthorizationUrl', () => {
  it('carries exactly the documented parameters, with the redirect and state encoded', () => {
    const state = 'v1.cGF5bG9hZA.c2ln';
    const url = new URL(pointAuthorizationUrl(CONFIG, state));

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.mercadopago.com/authorization');
    expect([...url.searchParams.entries()]).toEqual([
      ['client_id', CONFIG.clientId],
      ['response_type', 'code'],
      ['platform_id', 'mp'],
      ['state', state],
      ['redirect_uri', REDIRECT_URI],
    ]);
    // The redirect URI is the configured one, not one a caller passed, and it is ENCODED:
    // string concatenation would leave the `?tenant=umi` looking like a parameter of ours.
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.search).toContain('redirect_uri=https%3A%2F%2Fpos.umi.example');
    expect(url.searchParams.get('tenant')).toBeNull();
  });
});

describe('the signed state', () => {
  it('round-trips the merchant and the operator', () => {
    const state = signPointOAuthState(
      { merchantId: '5f000000-0000-4000-8000-0000000000a1', userId: 'operator-a', now: NOW },
      CONFIG.stateSecret,
    );

    expect(verifyPointOAuthState(state, CONFIG.stateSecret, NOW)).toEqual({
      merchantId: '5f000000-0000-4000-8000-0000000000a1',
      userId: 'operator-a',
    });
    expect(POINT_OAUTH_STATE_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('refuses a flipped character, a different secret, and an expired state', () => {
    const state = signPointOAuthState(
      { merchantId: 'merchant-a', userId: 'operator-a', now: NOW },
      CONFIG.stateSecret,
    );

    const flipped = state.slice(0, -1) + (state.endsWith('a') ? 'b' : 'a');
    expect(verifyPointOAuthState(flipped, CONFIG.stateSecret, NOW)).toBeNull();

    // A payload edited in place, with the signature left alone: the HMAC is over the payload,
    // so this is the re-forge an attacker would attempt. The FIRST character is changed, which
    // cannot be a no-op whatever the JSON encoded to.
    const [, payload, signature] = state.split('.');
    const editedPayload = (payload.startsWith('A') ? 'B' : 'A') + payload.slice(1);
    const edited = `v1.${editedPayload}.${signature}`;
    expect(verifyPointOAuthState(edited, CONFIG.stateSecret, NOW)).toBeNull();

    expect(verifyPointOAuthState(state, 'a-different-secret', NOW)).toBeNull();
    expect(verifyPointOAuthState(state, CONFIG.stateSecret, new Date(NOW.getTime() + 1))).toEqual({
      merchantId: 'merchant-a',
      userId: 'operator-a',
    });
    expect(
      verifyPointOAuthState(
        state,
        CONFIG.stateSecret,
        new Date(NOW.getTime() + POINT_OAUTH_STATE_TTL_MS + 1),
      ),
    ).toBeNull();
  });
});

describe('exchangePointAuthorizationCode', () => {
  it('posts the documented parameters as x-www-form-urlencoded to the token URL', async () => {
    const { fetchImpl, requests } = stubFetch(200, TOKEN_ANSWER);

    await exchangePointAuthorizationCode(CONFIG, 'THE-ONE-SHOT-CODE', {
      fetchImpl,
      now: () => NOW,
    });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe(CONFIG.tokenUrl);
    expect(request.method).toBe('POST');
    expect(header(request.headers, 'content-type')).toBe('application/x-www-form-urlencoded');

    const sent = new URLSearchParams(request.body ?? '');
    expect([...sent.entries()]).toEqual([
      ['client_secret', CONFIG.clientSecret],
      ['client_id', CONFIG.clientId],
      ['grant_type', 'authorization_code'],
      ['code', 'THE-ONE-SHOT-CODE'],
      ['redirect_uri', REDIRECT_URI],
      ['test_token', 'false'],
    ]);
  });

  it('maps the answer, and dates the expiry from the injected clock', async () => {
    const { fetchImpl } = stubFetch(200, TOKEN_ANSWER);

    const tokens = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl,
      now: () => NOW,
    });

    expect(tokens).toEqual({
      accessToken: TOKEN_ANSWER.access_token,
      refreshToken: TOKEN_ANSWER.refresh_token,
      mpUserId: '13045771',
      publicKey: TOKEN_ANSWER.public_key,
      expiresAt: new Date(NOW.getTime() + EXPIRES_IN * 1000),
    });
    // 180 days, stated as a date, so a wrong unit (milliseconds for seconds) cannot pass.
    expect(tokens.expiresAt.toISOString()).toBe('2027-03-16T12:00:00.000Z');
  });

  it('leaves a missing refresh token and public key null rather than empty', async () => {
    const { fetchImpl } = stubFetch(200, {
      access_token: 'APP_USR-token',
      user_id: '13045771',
      expires_in: EXPIRES_IN,
    });

    const tokens = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl,
      now: () => NOW,
    });

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.publicKey).toBeNull();
  });

  it('refuses to invent a token set from a malformed answer', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['access_token missing', { user_id: '13045771', expires_in: EXPIRES_IN }],
      ['user_id missing', { access_token: 'APP_USR-token', expires_in: EXPIRES_IN }],
      [
        'expires_in not a number',
        { access_token: 'APP_USR-token', user_id: '13045771', expires_in: 'soon' },
      ],
      ['expires_in absent', { access_token: 'APP_USR-token', user_id: '13045771' }],
    ];

    for (const [label, body] of cases) {
      const { fetchImpl } = stubFetch(200, body);
      const error = await exchangePointAuthorizationCode(CONFIG, 'code', {
        fetchImpl,
        now: () => NOW,
      }).catch((caught: unknown) => caught);

      expect(error, label).toBeInstanceOf(PointOAuthError);
      expect((error as PointOAuthError).code, label).toBe('MERCADO_PAGO_OAUTH_MALFORMED');
      expect((error as PointOAuthError).retryable, label).toBe(false);
    }
  });

  it('reads the vendor code from either envelope, and retries only what is worth retrying', async () => {
    const flat = stubFetch(401, {
      code: 'unauthorized',
      message: 'authorization value not present',
    });
    const flatError = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl: flat.fetchImpl,
      now: () => NOW,
    }).catch((caught: unknown) => caught);
    expect((flatError as PointOAuthError).code).toBe('unauthorized');
    expect((flatError as PointOAuthError).status).toBe(401);
    expect((flatError as PointOAuthError).retryable).toBe(false);

    const nested = stubFetch(400, {
      errors: [{ code: 'invalid_grant', message: 'invalid grant' }],
    });
    const nestedError = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl: nested.fetchImpl,
      now: () => NOW,
    }).catch((caught: unknown) => caught);
    expect((nestedError as PointOAuthError).code).toBe('invalid_grant');
    expect((nestedError as PointOAuthError).status).toBe(400);
    expect((nestedError as PointOAuthError).retryable).toBe(false);

    const server = stubFetch(500, { errors: [{ code: 'internal_error' }] });
    const serverError = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl: server.fetchImpl,
      now: () => NOW,
    }).catch((caught: unknown) => caught);
    expect((serverError as PointOAuthError).code).toBe('internal_error');
    expect((serverError as PointOAuthError).status).toBe(500);
    expect((serverError as PointOAuthError).retryable).toBe(true);
  });

  it('never puts the secret or the code into what a caller can log', async () => {
    // A vendor that echoes our request back at us in its own error message. Whatever it sends,
    // the message the caller holds is ours, and it names neither credential.
    const { fetchImpl } = stubFetch(400, {
      errors: [
        {
          code: 'invalid_grant',
          message: `client_secret ${CONFIG.clientSecret} code THE-ONE-SHOT-CODE`,
        },
      ],
    });

    const error = await exchangePointAuthorizationCode(CONFIG, 'THE-ONE-SHOT-CODE', {
      fetchImpl,
      now: () => NOW,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PointOAuthError);
    expect((error as PointOAuthError).message).not.toContain(CONFIG.clientSecret);
    expect((error as PointOAuthError).message).not.toContain('THE-ONE-SHOT-CODE');
  });

  it('says UNREACHABLE, retryable and status 0, for a dead socket and for a silent vendor', async () => {
    const deadSocket = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const dead = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl: deadSocket,
      now: () => NOW,
    }).catch((caught: unknown) => caught);
    expect(dead).toBeInstanceOf(PointOAuthError);
    expect((dead as PointOAuthError).code).toBe('MERCADO_PAGO_OAUTH_UNREACHABLE');
    expect((dead as PointOAuthError).status).toBe(0);
    expect((dead as PointOAuthError).retryable).toBe(true);

    // A socket that accepts the request and never answers, and a `fetch` that ignores the
    // abort signal: the budget has to be the function's own, not the socket library's.
    const silent = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const timedOut = await exchangePointAuthorizationCode(CONFIG, 'code', {
      fetchImpl: silent,
      now: () => NOW,
      timeoutMs: 20,
    }).catch((caught: unknown) => caught);
    expect(timedOut).toBeInstanceOf(PointOAuthError);
    expect((timedOut as PointOAuthError).code).toBe('MERCADO_PAGO_OAUTH_UNREACHABLE');
    expect((timedOut as PointOAuthError).status).toBe(0);
    expect((timedOut as PointOAuthError).retryable).toBe(true);
  });
});
