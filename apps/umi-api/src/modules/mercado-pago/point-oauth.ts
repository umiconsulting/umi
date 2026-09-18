import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * THE MERCADO PAGO POINT OAUTH CLIENT — plan §4 phase 5 step 1, written against research
 * note `08-serving-many-merchants.md` §2 and nothing else.
 *
 * WHY THIS EXISTS AT ALL. Plan D7: one production credential serves one account, and Umi's
 * clients are OTHER sellers, so Umi cannot charge them through its own account — the money
 * has to reach the seller's own books. The third-party model of note 08 §2 is therefore the
 * only model that fits, and it needs three things: a URL to send a seller to, a state value
 * that proves the callback belongs to a flow WE started, and the code-for-token exchange.
 * This file is those three things and nothing else — no table (see the state note below), no
 * Nest, no clock of its own, no logger.
 *
 * THE FOUR FACTS THAT SHAPE EVERY LINE (note 08 §2, quoted from the vendor's go-to-production
 * page):
 *
 * 1. The codes and secrets are CREDENTIALS. `client_secret` and `code` never reach a log, an
 *    error message, or a template string that could be one. The one place they legitimately
 *    appear is the request body of the exchange, which is why that body is a `URLSearchParams`
 *    built and sent in the same breath.
 * 2. The state is OURS, not the vendor's. The vendor returns it verbatim and asks no questions
 *    about it; its only job is to prove the callback is one we started for a known merchant
 *    and operator.
 * 3. The token lasts 180 days (`expires_in: 15552000`) and the vendor states the integration
 *    stops working without renewal. So the expiry is a real value we persist and compare
 *    against, never an advisory number (plan D8).
 * 4. The endpoint answers with the vendor's TWO error envelopes, the same pair the orders API
 *    uses (research note `01-orders-api-spec.md` §7.1): auth failures are flat
 *    (`{"code":"unauthorized"}`), everything else nests
 *    (`{"errors":[{"code":"invalid_grant"}]}`).
 */

export interface PointOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** The vendor's authorization host, overridable so a test can point at a stub. */
  readonly authorizeUrl: string;
  /** The vendor's token endpoint, overridable for the same reason. */
  readonly tokenUrl: string;
  /** The HMAC key the CSRF state is signed with (a config secret, never a vendor value). */
  readonly stateSecret: string;
}

/**
 * THE PART OF THE CONFIG A TOKEN CALL ACTUALLY USES.
 *
 * The exchange and the renewal share one endpoint and one client credential and differ only in
 * their grant. The authorize URL, the redirect URI and the state secret belong to the browser
 * flow around them, so a renewal — a background job with no browser and no CSRF state — is typed
 * to what it uses rather than being handed three values it would have to invent or leave blank.
 */
export type PointOAuthTokenEndpoint = Pick<
  PointOAuthConfig,
  'clientId' | 'clientSecret' | 'tokenUrl'
>;

/**
 * A NAMED FAILURE, in the shape the rest of the tender path already reads (`code`, `status`,
 * `retryable`). The same three questions the Point transport answers, because the caller is
 * the same kind of caller: a job that has to decide between "ask again" and "tell a person".
 */
export class PointOAuthError extends Error {
  /** The vendor's code, or a local one. */
  readonly code: string;
  /** The HTTP status, and 0 when there was no answer at all. */
  readonly status: number;
  /** True for 429, 5xx, timeouts, and dead sockets: asking again is coherent. */
  readonly retryable: boolean;

  constructor(init: {
    readonly message: string;
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
  }) {
    super(init.message);
    this.name = 'PointOAuthError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
  }
}

/**
 * The two failures the vendor never gets to name, in the same local-code style the transport
 * uses: a socket that did not answer, and an answer we cannot read as a token.
 */
const UNREACHABLE_CODE = 'MERCADO_PAGO_OAUTH_UNREACHABLE';
const MALFORMED_CODE = 'MERCADO_PAGO_OAUTH_MALFORMED';

/** The socket budget. A hung token endpoint must not hold a callback request open. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * How long a state is good for. Ten minutes is long enough for a seller to log in to Mercado
 * Pago and approve — a human step, not a machine one — and short enough that a state leaked
 * into a browser history or a referrer header is worthless by the time it is found.
 */
export const POINT_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** The one legal shape of the signed state, so a future shape is refused, not misread. */
const STATE_VERSION = 1;
const STATE_PURPOSE = 'mercado_pago_point_oauth';

/**
 * THE URL A SELLER IS SENT TO — the vendor's documented shape, exactly (note 08 §2):
 *
 *   {authorizeUrl}?client_id=APP_ID&response_type=code&platform_id=mp&state=RANDOM_ID
 *                 &redirect_uri=https://our-redirect
 *
 * Built with `URL`/`URLSearchParams` rather than concatenated, and that is not tidiness: the
 * redirect URI is an `https` URL with its own `://` and possibly its own query string, so it
 * has characters that change meaning when a string is joined by hand. `URLSearchParams`
 * encodes it, and encodes it the way a browser will decode it.
 *
 * `redirect_uri` is the CONFIGURED value and never one a caller supplies: the vendor requires
 * the redirect to be declared in the application's advanced settings, and the exchange must
 * send the same value that was authorized, so letting a request choose it would let a caller
 * choose where a seller's authorization code lands.
 */
export function pointAuthorizationUrl(config: PointOAuthConfig, state: string): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', config.redirectUri);
  return url.toString();
}

/**
 * THE CSRF STATE — signed, self-describing, short-lived, and STATELESS.
 *
 * WHY NO TABLE. The tempting design is a row per flow: store the state, look it up on the
 * callback, delete it. It buys nothing here, and the vendor's own protocol is the reason. The
 * `code` the callback carries is SINGLE-USE: whoever redeems it first gets the token, and a
 * second redemption fails at the vendor. So a replayed state cannot obtain anything — the code
 * it points at is already spent. What is left is the real risk, a forged callback, and that is
 * closed by a signature rather than by a lookup. The TTL is then the only bound we need, and it
 * is a bound we can keep, because it lives in the value instead of in a cleanup job that may or
 * may not have run.
 *
 * WHAT IT CARRIES: the merchant, the operator, and when it was issued — nothing else. No email,
 * no name, no token, no amount. The state travels through a browser address bar, so everything
 * in it should be something we would not mind reading there.
 */
export function signPointOAuthState(
  input: { merchantId: string; userId: string; now?: Date },
  stateSecret: string,
): string {
  const issuedAt = (input.now ?? new Date()).getTime();
  const payload = base64UrlEncode(
    JSON.stringify({
      v: STATE_VERSION,
      purpose: STATE_PURPOSE,
      merchantId: input.merchantId,
      userId: input.userId,
      issuedAt,
    }),
  );
  return `v${STATE_VERSION}.${payload}.${stateSignature(payload, stateSecret)}`;
}

/**
 * VERIFY A CALLBACK'S STATE. Returns the merchant and the operator, or null.
 *
 * NULL FOR EVERY FAILURE, deliberately: a wrong signature, an unreadable shape, and an expired
 * state are one answer to the caller — "do not trust this" — and telling the three apart to
 * whoever sent it hands a prober a signal for free. Every gate runs BEFORE any part of the
 * payload is returned, so there is no path where a caller receives a half-read merchant id.
 *
 * The comparison is `timingSafeEqual` over the hex digest, with a length check first, because
 * `timingSafeEqual` throws on a length mismatch and a throw here would be a 500 on a forged
 * callback instead of the refusal it deserves. The same recipe the webhook signature uses
 * (`point-signature.ts`), for the same reason.
 */
export function verifyPointOAuthState(
  state: string,
  stateSecret: string,
  now?: Date,
): { merchantId: string; userId: string } | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts;
  if (version !== `v${STATE_VERSION}` || payload.length === 0 || signature.length === 0) {
    return null;
  }

  const expected = Buffer.from(stateSignature(payload, stateSecret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  const decoded = decodeStatePayload(payload);
  if (decoded === null) return null;

  // The TTL is checked AFTER the signature, so an attacker cannot make us do arithmetic — or
  // reach the JSON parse above — with a value they chose.
  const age = (now ?? new Date()).getTime() - decoded.issuedAt;
  if (age > POINT_OAUTH_STATE_TTL_MS) return null;
  // A state issued in the future is not one we issued. There is no legitimate clock skew to
  // tolerate here: both ends of this value are the same process.
  if (age < 0) return null;

  return { merchantId: decoded.merchantId, userId: decoded.userId };
}

export interface PointOAuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly mpUserId: string;
  readonly publicKey: string | null;
  readonly expiresAt: Date;
}

/**
 * EXCHANGE THE CODE — `POST https://api.mercadopago.com/oauth/token` (note 08 §2 step 4).
 *
 * THE BODY IS `application/x-www-form-urlencoded`, with the vendor's six documented parameters
 * and no extras: `client_secret`, `client_id`, `grant_type=authorization_code`, `code`,
 * `redirect_uri`, `test_token=false`. The encoding is the vendor's, not a preference — the
 * endpoint's documented examples are form posts — and `test_token=false` says these are
 * production credentials, which is the whole point of an authorization a real seller gave.
 *
 * `redirect_uri` is sent again, and it must be the SAME value the authorization used, because
 * the vendor matches the two. It reads from config in both places for exactly that reason.
 *
 * THE BODY CARRIES TWO CREDENTIALS AND IS NEVER LOGGED. `client_secret` is Umi's application
 * secret and `code` is the seller's one-shot authorization; a copy of either in a log is a copy
 * we then have to rotate or revoke. This function therefore has no logger at all, and its error
 * messages name the vendor's code and the HTTP status — never the request that produced them.
 */
export async function exchangePointAuthorizationCode(
  config: PointOAuthConfig,
  code: string,
  options?: { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number },
): Promise<PointOAuthTokenSet> {
  const fetchImpl = options?.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const now = options?.now ?? (() => new Date());
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // `URLSearchParams` does the encoding — the redirect URI carries a query string of its own,
  // so the bytes are not a string we should be joining by hand — and `toString()` is what goes
  // on the wire, spelled out rather than left to `fetch`'s own serialization so that what the
  // vendor receives is the same value a test can read, log-free.
  const body = new URLSearchParams({
    client_secret: config.clientSecret,
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    test_token: 'false',
  }).toString();

  const answer = await sendExchange(fetchImpl, config, code, body, timeoutMs, now);

  if (answer.status < 200 || answer.status >= 300) {
    throw refusal(answer, config.clientSecret, code);
  }

  return tokenSetFrom(answer, config.clientSecret, code, now());
}

/**
 * RENEW AN AUTHORIZATION — the same endpoint with a different grant (plan D8, phase 5 step 2).
 *
 * WHY THIS EXISTS AT ALL. An OAuth token lasts 180 days and the vendor states that the
 * integration stops working without the renewal flow, so a café that authorized in March must not
 * discover in September, at the counter, that its card method has gone. The renewal is the same
 * `POST` the exchange makes, with `grant_type=refresh_token` and no `code`: the vendor documents
 * it as one endpoint with two grants, and sending the fields that belong to the other one — a
 * `redirect_uri` that plays no part here — would be two fields nobody could explain.
 *
 * IT ANSWERS WITH A WHOLE TOKEN SET, NOT JUST AN ACCESS TOKEN, because the vendor rotates the
 * refresh token too: whatever it returns is what has to be stored, and a caller that kept only
 * the access token would hold a credential that renews exactly once.
 *
 * The refresh token is treated as the credential it is: it never appears in a message, and it
 * goes through the same redaction the authorization code does.
 */
export async function refreshPointAuthorization(
  config: PointOAuthTokenEndpoint,
  refreshToken: string,
  options?: { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number },
): Promise<PointOAuthTokenSet> {
  const fetchImpl = options?.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const now = options?.now ?? (() => new Date());
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = new URLSearchParams({
    client_secret: config.clientSecret,
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    test_token: 'false',
  }).toString();

  const answer = await sendExchange(fetchImpl, config, refreshToken, body, timeoutMs, now);

  if (answer.status < 200 || answer.status >= 300) {
    throw refusal(answer, config.clientSecret, refreshToken);
  }

  return tokenSetFrom(answer, config.clientSecret, refreshToken, now());
}

/**
 * ONE REQUEST, ONE BUDGET — the same `AbortController` plus `setTimeout` pair the transport
 * uses, cleared in `finally` so a fast answer leaves no timer behind.
 *
 * The deadline is ALSO raced against the fetch. Aborting releases the socket, but a `fetch`
 * implementation that ignores the signal would leave this function waiting forever, and a
 * callback endpoint that never answers is worse than one that answers with a failure: the
 * seller watches a spinner and the browser eventually times out with nothing recorded. The race
 * makes the budget a property of this function rather than a property of `fetch`.
 */
async function sendExchange(
  fetchImpl: typeof fetch,
  config: PointOAuthTokenEndpoint,
  /**
   * THE SECOND SECRET ON THE WIRE, whichever it is: the authorization `code` on the first
   * exchange, the `refresh_token` on a renewal. It is named for what it does rather than for one
   * of its two values, because its only job here is redaction — a `fetch` implementation is free
   * to quote the request back at us, and both secrets are credentials.
   */
  secret: string,
  body: string,
  timeoutMs: number,
  now: () => Date,
): Promise<VendorAnswer> {
  const startedAt = now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new PointOAuthError({
          code: UNREACHABLE_CODE,
          status: 0,
          retryable: true,
          message: `The Mercado Pago OAuth token endpoint did not answer within ${timeoutMs} ms (request sent ${startedAt.toISOString()}).`,
        }),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      (async (): Promise<VendorAnswer> => {
        try {
          const response = await fetchImpl(config.tokenUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            body,
            signal: controller.signal,
          });
          const text = await response.text();
          return { status: response.status, body: safeJson(text) };
        } catch (error) {
          // A dead socket, a refused connection, an aborted read: one answer to the caller, and
          // never a token set. The cause is kept; the credentials are not, because the cause
          // passes through the same redaction every other message does — a `fetch` implementation
          // is free to quote the request it was handed back at us.
          throw new PointOAuthError({
            code: UNREACHABLE_CODE,
            status: 0,
            retryable: true,
            message: redact(
              `The Mercado Pago OAuth token endpoint could not be reached: ${describeThrow(error)}.`,
              config.clientSecret,
              secret,
            ),
          });
        }
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

interface VendorAnswer {
  readonly status: number;
  /** The parsed body, or null when it was not JSON — the envelope is read from it. */
  readonly body: unknown;
}

/**
 * A NON-2xx ANSWER, CLASSIFIED. `errors[0].code` first, then the flat `code` — the ORDER of
 * research note 01 §7.1, and the token endpoint is the same API answering the same two ways: a
 * 401 `{"code":"unauthorized"}` and a 400 `{"errors":[{"code":"invalid_grant"}]}`.
 *
 * `retryable` is 429 and 5xx only. A 400 `invalid_grant` is the vendor saying the code is wrong,
 * spent, or already exchanged — asking again with the same code asks the same question, so the
 * caller has to send the seller back through authorization instead. Getting that backwards is
 * just as bad in the other direction: a retry loop on `invalid_grant` burns a seller's patience
 * while a retry on a 503 is exactly right.
 */
function refusal(answer: VendorAnswer, clientSecret: string, code: string): PointOAuthError {
  const envelope = readErrorEnvelope(answer.body, answer.status);
  return new PointOAuthError({
    code: envelope.code,
    status: answer.status,
    retryable: answer.status === 429 || answer.status >= 500,
    message: redact(
      `Mercado Pago OAuth answered ${answer.status} ${envelope.code}.`,
      clientSecret,
      code,
    ),
  });
}

/**
 * THE ANSWER, MAPPED — and the three ways it can fail to be one.
 *
 * `access_token`, `refresh_token`, `user_id`, `public_key`, `expires_in` are the documented
 * fields (note 08 §2 step 5). A missing token, a missing account id, or an `expires_in` that is
 * not a number of seconds throws `MERCADO_PAGO_OAUTH_MALFORMED` rather than producing a token
 * set with a hole in it: a token with no owner cannot be attributed to a merchant, and a token
 * with no expiry is one the renewal job of D8 can never schedule — it would sit in the database
 * looking valid until the day it stopped working at the counter. The vendor's own value is
 * 15552000 seconds, 180 days.
 *
 * `refresh_token` and `public_key` are the two optional fields and they stay NULL when absent,
 * never an empty string: "the vendor did not send one" and "the vendor sent an empty one" are
 * different facts, and a later `if (refreshToken)` must not have to guess which it is holding.
 */
function tokenSetFrom(
  answer: VendorAnswer,
  clientSecret: string,
  code: string,
  now: Date,
): PointOAuthTokenSet {
  const record = asRecord(answer.body);
  const accessToken = record === null ? null : nonEmptyString(record.access_token);
  const mpUserId = record === null ? null : identifier(record.user_id);
  const expiresInSeconds = record === null ? null : seconds(record.expires_in);

  const missing: string[] = [];
  if (accessToken === null) missing.push('access_token');
  if (mpUserId === null) missing.push('user_id');
  if (expiresInSeconds === null) missing.push('expires_in');
  if (accessToken === null || mpUserId === null || expiresInSeconds === null) {
    throw new PointOAuthError({
      code: MALFORMED_CODE,
      status: answer.status,
      retryable: false,
      message: redact(
        `The Mercado Pago OAuth answer carried no usable ${missing.join(', ')}.`,
        clientSecret,
        code,
      ),
    });
  }

  return {
    accessToken,
    refreshToken: nonEmptyString(record?.refresh_token),
    mpUserId,
    publicKey: nonEmptyString(record?.public_key),
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000),
  };
}

interface StatePayload {
  readonly merchantId: string;
  readonly userId: string;
  readonly issuedAt: number;
}

/** Read a signed payload back. Null on anything that is not exactly the shape we wrote. */
function decodeStatePayload(payload: string): StatePayload | null {
  const parsed = safeJson(Buffer.from(payload, 'base64url').toString('utf8'));
  const record = asRecord(parsed);
  if (record === null) return null;
  if (record.v !== STATE_VERSION || record.purpose !== STATE_PURPOSE) return null;

  const merchantId = nonEmptyString(record.merchantId);
  const userId = nonEmptyString(record.userId);
  const issuedAt = record.issuedAt;
  if (merchantId === null || userId === null) return null;
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return null;
  return { merchantId, userId, issuedAt };
}

/** HMAC-SHA256, lowercase hex, over the encoded payload — the same key the state secret is. */
function stateSignature(payload: string, stateSecret: string): string {
  return createHmac('sha256', stateSecret).update(payload).digest('hex');
}

/** Base64url without padding, which is what the state's middle segment is expected to be. */
function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

/**
 * THE TWO ENVELOPES, IN THE ORDER THAT FINDS BOTH (research note 01 §7.1).
 *
 * Nested first, flat second: the auth-style `{"code":"unauthorized"}` is the fallback, and a
 * parser that read only `body.code` would lose every validation failure from this endpoint. The
 * last resort names the status, because "something refused us and we cannot say what" beats an
 * empty code — and a body that was never JSON (an HTML error page, an empty 502) never reaches a
 * parser that could invent detail from it.
 */
function readErrorEnvelope(body: unknown, status: number): { code: string } {
  const record = asRecord(body);
  if (record === null) return { code: `http_${status}` };

  const nested = asRecord(firstOf(record.errors));
  const nestedCode = nested === null ? null : nonEmptyString(nested.code);
  if (nestedCode !== null) return { code: nestedCode };

  const flatCode = nonEmptyString(record.code);
  if (flatCode !== null) return { code: flatCode };

  /**
   * THE OAUTH ENDPOINT'S OWN ENVELOPE, AND IT IS NOT THE ORDERS API'S. RFC 6749 puts the reason
   * in a top-level `error` string — `invalid_grant`, `invalid_client` — and the vendor's token
   * endpoint follows it, so a reader that only knew `code` would answer `http_400` for every
   * refusal and lose the one word that says what to do: `invalid_grant` means the café must
   * authorize again, `invalid_client` means OUR application secret is wrong, and a renewal that
   * reported both as "400" would send whoever reads it to the wrong place. It is read LAST, so
   * neither of the two documented shapes above changes meaning.
   */
  const flatError = nonEmptyString(record.error);
  if (flatError !== null) return { code: flatError };

  return { code: `http_${status}` };
}

/**
 * THE SECRETS NEVER LEAVE. A vendor that echoes the request back at us — some do, in an error
 * message — would otherwise put Umi's application secret or the seller's one-shot code into
 * whatever the caller logs. Both are stripped here, and an empty value is skipped because
 * splitting on `''` would shred the whole string.
 */
function redact(text: string, clientSecret: string, code: string): string {
  let result = text;
  for (const secret of [clientSecret, code]) {
    if (secret.length > 0) result = result.split(secret).join('[redacted]');
  }
  return result;
}

/** `user_id` arrives as a number from the vendor and is carried as a string everywhere else. */
function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return nonEmptyString(value);
}

/** `expires_in` is documented as a number of seconds; the string form is accepted too. */
function seconds(value: unknown): number | null {
  const text =
    typeof value === 'number' && Number.isFinite(value) ? String(value) : nonEmptyString(value);
  if (text === null || !/^\d+(?:\.\d+)?$/u.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstOf(value: unknown): unknown {
  return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
}

/** A body that is not JSON is null, never a throw: the status is the answer that survives. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The cause, as a class name and message. A cause can name a host; it never holds a secret. */
function describeThrow(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport failure';
}
