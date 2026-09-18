import type { PointOperatingMode } from '@umi/contract';
import { pointIdempotencyKey } from '../tender/providers/mercado-pago-point.transport';

/**
 * THE VENDOR'S TERMINAL, STORE AND POINT-OF-SALE CALLS — plan section 4 phase 5 steps 3 and 4,
 * written against research note `01-orders-api-spec.md` sections 5 and 6 and nothing else.
 *
 * WHAT THIS FILE IS. Four conversations, one per vendor endpoint:
 *
 *   - `GET /terminals/v1/list`     — the terminals THIS merchant's account holds (step 3's list);
 *   - `PATCH /terminals/v1/setup`  — which side drives one of them (step 3's switch);
 *   - `POST /users/{id}/stores`    — the merchant's store, "required for reconciliation"
 *                                    (note 01 section 2.3, step 4);
 *   - `POST /v2/pos`               — the point of sale a terminal in `PDV` mode must have
 *                                    (note 01 section 6.3, step 4).
 *
 * NONE OF THEM IS A PAYMENT, and that is the first thing their error handling records. The
 * money-moving calls live in `tender/providers/mercado-pago-point.transport.ts` and keep its
 * doctrine: a socket problem is never a decline. Here a socket problem is never anything but
 * "the configuration could not be read or written", which is a fact about a screen, and a
 * socket we cannot read is not a terminal we do not own.
 *
 * EVERY CALL IS MADE WITH THE MERCHANT'S OWN TOKEN (plan D7), and that is why the token is an
 * ARGUMENT to each method rather than a field of this class. It is not stored, not cached, not
 * remembered between two calls, and it exists in this file only long enough to be put in one
 * `Authorization` header. `MercadoPagoPointTransport` resolves a token with a fallback to the
 * deployment's own account; this client has no such fallback, and the difference is the point
 * of it: a charge may legitimately run through the deployment's account, while a store, a
 * point of sale and a terminal mode belong to the account that will take the money. Writing
 * `PDV` onto somebody else's terminal with a deployment token is exactly the mistake note 08
 * section 1 describes, so the credential is resolved by the caller and handed in.
 *
 * THE TOKEN NEVER REACHES A MESSAGE. Every throw below passes through `redact`, which strips
 * the token of THAT call. It is not a formality: a vendor that echoes the request back in an
 * error body, or a `fetch` implementation that quotes the request it was handed, would
 * otherwise put a live bearer credential into whatever the caller logs.
 */

/**
 * The list's own enum, which is NOT the contract's. The vendor documents three values on
 * `GET /terminals/v1/list` — `PDV`, `STANDALONE` and `UNDEFINED`, the last being "The
 * configuration that the terminal has is not recognized" (note 01 section 5.3) — and only two
 * on the `setup` request. `UNDEFINED` is read-only and can never be written.
 */
export type VendorOperatingMode = 'PDV' | 'STANDALONE' | 'UNDEFINED';

/** One terminal as the vendor lists it: the account's facts, before we enrich them with ours. */
export interface VendorTerminal {
  /**
   * The exact `type + "__" + serial` string. It is carried VERBATIM into
   * `device_point_terminal.terminal_id` and never rebuilt (note 01 section 5.1, migration 72).
   */
  readonly terminalId: string;
  readonly operatingMode: VendorOperatingMode;
  /** The store this terminal is attached to in the merchant's account, or null. */
  readonly storeId: string | null;
  /** The point of sale this terminal is set to, or null. `pos_id` arrives numeric; kept as text. */
  readonly posId: string | null;
}

/**
 * The store's location, which the vendor requires and validates. `city_name` is a CLOSED
 * CATALOGUE with accents — the field observation of note 01 section 6.2 is that `Culiacan` is
 * refused and `Culiacan` with its accent accepted — so this is a value a caller must hold
 * already, never one this file can invent or normalize.
 */
export interface VendorStoreLocation {
  readonly streetName: string;
  readonly streetNumber: string;
  readonly cityName: string;
  readonly stateName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly reference: string | null;
}

export interface PointTerminalClientOptions {
  /** The Orders API origin: `/terminals/v1/*` and `/v2/pos` are absolute paths on it. */
  readonly baseUrl: string;
  /** Test seam. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Test seam. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * A NAMED FAILURE, in the shape the rest of the Point surface already reads (`code`, `status`,
 * `retryable`) plus one field the tender path can afford and this one cannot be without:
 * `configuration`, which says the fix is a human in the Mercado Pago panel rather than a
 * retry (plan D9 — `403 forbidden_checking_terminal_owner` and its siblings are setup
 * mistakes, not failed money).
 */
export class PointTerminalClientError extends Error {
  /** The vendor's code, or a local `MERCADO_PAGO_TERMINAL_*` one when there was no answer. */
  readonly code: string;
  /** The HTTP status, and 0 when there was no answer at all. */
  readonly status: number;
  /** True for 429, 5xx, timeouts and dead sockets: asking again is coherent. */
  readonly retryable: boolean;
  /** True for a 401/403: the account, the terminal or the credential is the problem. */
  readonly configuration: boolean;

  constructor(init: {
    readonly message: string;
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
    readonly configuration: boolean;
  }) {
    super(init.message);
    this.name = 'PointTerminalClientError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.configuration = init.configuration;
  }
}

/** The two failures the vendor never gets to name, in the transport's local-code style. */
const UNREACHABLE_CODE = 'MERCADO_PAGO_TERMINAL_UNREACHABLE';
const MALFORMED_CODE = 'MERCADO_PAGO_TERMINAL_MALFORMED';

/**
 * The list's page ceiling, and therefore OUR ceiling. The vendor documents `limit` as "greater
 * than or equal to 1 and less than or equal to 50. The default value is 50", and a field
 * observation confirms the server CLAMPS an out-of-range limit rather than refusing it (note
 * 01 section 5.1). `PointTerminalList` caps the array at 50 as well, so one page of fifty IS
 * the contract's whole set: asking for it explicitly is the difference between a defined page
 * and whatever a vendor default happens to be, and there is nothing to paginate towards.
 */
const TERMINAL_PAGE_LIMIT = 50;

/** The socket budget. A hung vendor must not hold a console request open. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** `POST /v2/pos` is documented as 201; 200 is accepted defensively, as the transport does. */
const CREATED = 201;
const OK = 200;

export class PointTerminalClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: PointTerminalClientOptions) {
    // The vendor's paths are absolute (`/terminals/v1/list`), so a trailing slash on the
    // origin would produce `//terminals/...` — a different URL to some proxies.
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * THE MERCHANT'S OWN TERMINALS — `GET /terminals/v1/list` (note 01 section 5.1).
   *
   * The `limit` is sent because a default is a promise somebody else keeps; the `offset` is
   * sent because an omitted offset and a zero offset are the same request and only one of them
   * says so. The query names no `store_id` and no `pos_id`: this screen shows every terminal of
   * the account, and a filter would hide the very terminal an operator is looking for.
   *
   * `data.terminals[]` is the whole answer; an entry without an `id` is not a terminal, so it
   * is dropped rather than carried as a row with a hole in it. The two id fields are read as
   * TEXT because the vendor's own two pages disagree about `pos_id`'s type (string in the
   * guide, integer in the reference — note 01 section 5.1), and a comparison that used `===`
   * against a number would silently mismatch half the time.
   */
  async listTerminals(token: string): Promise<VendorTerminal[]> {
    const answer = await this.send(
      `/terminals/v1/list?limit=${TERMINAL_PAGE_LIMIT}&offset=0`,
      { method: 'GET', headers: this.headers(token) },
      token,
    );
    if (answer.status !== OK) throw this.refusal(answer, token);

    const data = asRecord(asRecord(answer.body)?.data);
    const terminals = data === null ? null : asArray(data.terminals);
    if (terminals === null) {
      throw this.malformed(answer.status, 'the answer carried no data.terminals array', token);
    }

    const listed: VendorTerminal[] = [];
    for (const entry of terminals) {
      const record = asRecord(entry);
      const terminalId = record === null ? null : nonEmptyString(record.id);
      if (record === null || terminalId === null) continue;
      listed.push({
        terminalId,
        operatingMode: vendorMode(record.operating_mode),
        storeId: identifier(record.store_id),
        posId: identifier(record.pos_id),
      });
    }
    return listed;
  }

  /**
   * WHICH SIDE DRIVES ONE TERMINAL — `PATCH /terminals/v1/setup` (note 01 section 5.2).
   *
   * The body is the reference's, exactly: `{"terminals":[{"id":..., "operating_mode":"PDV"}]}`.
   * No `X-Idempotency-Key`: this is the one write endpoint in the Point family whose reference
   * documents no such header, and inventing one would be sending a field the vendor does not
   * read while pretending it protects something.
   *
   * THE RESPONSE IS READ, NOT ASSUMED. The vendor echoes the terminal with the mode it now has,
   * so that echo — not the request — is what this method returns as the confirmed mode. When
   * the echo is not one of the two writable values (an older answer, an `UNDEFINED` body), the
   * requested mode is returned instead: a 200 is the vendor's acceptance of the request, and
   * the request named a mode.
   *
   * `403 store_pos_not_found` is the documented refusal of a terminal that "does not have a
   * store associated or, if there is a store, it does not have a point of sale created" (note
   * 01 section 5.3), and it is classified as a configuration problem: asking again with the
   * same body asks the same question.
   */
  async setOperatingMode(
    token: string,
    input: { readonly terminalId: string; readonly operatingMode: PointOperatingMode },
  ): Promise<PointOperatingMode> {
    const answer = await this.send(
      '/terminals/v1/setup',
      {
        method: 'PATCH',
        headers: this.headers(token, 'application/json'),
        body: JSON.stringify({
          terminals: [{ id: input.terminalId, operating_mode: input.operatingMode }],
        }),
      },
      token,
    );
    if (answer.status !== OK) throw this.refusal(answer, token);

    const echoed = firstTerminalMode(answer.body);
    return echoed ?? input.operatingMode;
  }

  /**
   * THE MERCHANT'S STORE — `POST /users/{user_id}/stores` (note 01 sections 6.1 and 6.2).
   *
   * THE `user_id` IN THE PATH IS THE MERCHANT'S OWN, and the caller passes the one the OAuth
   * answer carried (`mp_point_credential.mp_user_id`), never Umi's. The vendor's `403` for a
   * mismatch says so in its own words: "make sure that the user_id used is the same as your
   * account". A store created under the wrong account is money reconciled into the wrong books.
   *
   * THE LOCATION IS REQUIRED AND IS NOT DECORATION. The vendor states that incorrect location
   * data "can cause errors in tax calculations, directly impacting billing and fiscal
   * compliance of your company", and `city_name` is a closed catalogue with accents. So this
   * method takes a location it can state and refuses locally — before any request — when it is
   * missing, rather than posting a store with an invented city that the vendor would either
   * refuse or accept into a fiscal record that is wrong.
   *
   * THE CREATE STATUS IS BOTH. The reference says 200 "indicates that the request has been
   * successfully processed" while the guide and a live call show 201 (note 01 section 6.1), so
   * both are read and the created resource — not the status code — is what the caller receives.
   *
   * NO `X-Idempotency-Key`: the store reference does not document one. Recovery from a retry is
   * the store's own `external_id` and the vendor's `GET
   * /users/{id}/stores/search?external_id=` lookup, which is why the caller derives that value
   * from OURS rather than randomizing it.
   */
  async createStore(
    token: string,
    input: {
      readonly userId: string;
      readonly name: string;
      readonly externalId: string;
      readonly location: VendorStoreLocation | null;
    },
  ): Promise<{ readonly storeId: string }> {
    if (input.location === null) {
      throw new PointTerminalClientError({
        code: MALFORMED_CODE,
        status: 0,
        retryable: false,
        configuration: true,
        message:
          'A Mercado Pago store needs the address the vendor validates (street, city from its own catalogue, state, coordinates); refusing to create one without it.',
      });
    }

    const answer = await this.send(
      `/users/${encodeURIComponent(input.userId)}/stores`,
      {
        method: 'POST',
        headers: this.headers(token, 'application/json'),
        body: JSON.stringify({
          name: input.name,
          external_id: input.externalId,
          location: {
            street_name: input.location.streetName,
            street_number: input.location.streetNumber,
            city_name: input.location.cityName,
            state_name: input.location.stateName,
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            // The vendor types `reference` as a string; an absent landmark is sent as the empty
            // string rather than omitted, because the field is documented as part of the
            // location object and a missing key and a blank one read differently there.
            reference: input.location.reference ?? '',
          },
        }),
      },
      token,
    );
    if (answer.status !== CREATED && answer.status !== OK) throw this.refusal(answer, token);

    const storeId = identifier(asRecord(answer.body)?.id);
    if (storeId === null) throw this.malformed(answer.status, 'the new store has no id', token);
    return { storeId };
  }

  /**
   * THE POINT OF SALE — `POST /v2/pos` (note 01 section 6.3, step 4).
   *
   * ONE POINT OF SALE PER TERMINAL IN `PDV` MODE, and the vendor enforces the rule with a 412
   * on a second one (note 01 section 5.3). The body carries exactly what is required and
   * nothing invented: `store_id` as a STRING ("Only digits are allowed... The maximum allowed
   * limit is 20 characters" — and a numeric `store_id` is refused with `store_id expected
   * string, but got number`, section 6.3's field observation) and our own `external_id`.
   *
   * THE EXTERNAL ID IS OURS AND IT IS RULE-SHAPED. "Must contain only alphanumeric characters
   * (letters and numbers). The maximum allowed limit is 40 characters" — which a canonical UUID
   * is NOT, because of its hyphens. The caller derives it from the register's own id, hyphens
   * removed, and that derivation is what makes the vendor's `409 pos_already_exists` a
   * recoverable state rather than a duplicate point of sale.
   *
   * THE IDEMPOTENCY KEY IS DERIVED, NOT RANDOM, and it reuses the tender transport's own
   * generator so there is ONE key recipe in this codebase rather than two. A retry after a
   * timeout therefore names the same key and cannot create a second point of sale; the vendor
   * binds the key to the request, which is exactly the property the store step lacks and
   * recovers from by external id instead.
   *
   * THE NAME IS NOT SENT. The vendor documents it as optional and fills it from `external_id`
   * when absent; a name we invented would be a string about the cafe that the cafe never wrote.
   */
  async createPointOfSale(
    token: string,
    input: {
      readonly storeId: string;
      readonly externalId: string;
      readonly idempotencyName: string;
    },
  ): Promise<{ readonly posId: string }> {
    const answer = await this.send(
      '/v2/pos',
      {
        method: 'POST',
        headers: {
          ...this.headers(token, 'application/json'),
          'X-Idempotency-Key': pointIdempotencyKey(input.idempotencyName, 'create_point_of_sale'),
        },
        body: JSON.stringify({ store_id: input.storeId, external_id: input.externalId }),
      },
      token,
    );
    if (answer.status !== CREATED && answer.status !== OK) throw this.refusal(answer, token);

    const posId = identifier(asRecord(answer.body)?.id);
    if (posId === null)
      throw this.malformed(answer.status, 'the new point of sale has no id', token);
    return { posId };
  }

  /**
   * ONE REQUEST, ONE BUDGET — the `AbortController` plus `setTimeout` pair the transport and
   * the OAuth client both use, cleared in `finally` so a fast answer leaves no timer behind.
   *
   * Everything the socket can do that is not an HTTP answer lands on ONE code,
   * `MERCADO_PAGO_TERMINAL_UNREACHABLE` with `status: 0`, and never on a code that reads like a
   * terminal we do not own. The distinction matters on this screen: "we could not ask the
   * account" and "the account does not list that terminal" lead an operator to two different
   * places, and the second one is a refusal the service states only from the vendor's own list.
   */
  private async send(
    path: string,
    init: RequestInit,
    token: string,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const startedAt = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, body: parseJson(text) };
    } catch (error) {
      const detail = controller.signal.aborted
        ? `did not answer within ${this.timeoutMs} ms`
        : `could not be reached: ${describeThrow(error)}`;
      throw new PointTerminalClientError({
        code: UNREACHABLE_CODE,
        status: 0,
        retryable: true,
        configuration: false,
        message: redact(
          `The Mercado Pago Point API ${detail} (request sent ${startedAt.toISOString()}).`,
          token,
        ),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A NON-2xx ANSWER, CLASSIFIED, with both documented envelopes read in the order that finds
   * both: `errors[0].code` first, the flat `{"code":...}` second (note 01 section 7.1 and the
   * OAuth client's identical reader). A body that was never JSON answers `http_<status>` rather
   * than an invented code.
   *
   * `configuration` is 401 and 403 — the account, the credential and the terminal's ownership
   * are the things a vendor refuses here — while `retryable` stays exactly 429 and 5xx, the
   * transport's rule. A 412 is neither: it is the one-terminal rule, a conflict about the point
   * of sale's state, and the caller states it as one.
   */
  private refusal(
    answer: { readonly status: number; readonly body: unknown },
    token: string,
  ): PointTerminalClientError {
    const envelope = readErrorEnvelope(answer.body, answer.status);
    const detail = envelope.message === null ? '' : `: ${envelope.message}`;
    return new PointTerminalClientError({
      code: envelope.code,
      status: answer.status,
      retryable: answer.status === 429 || answer.status >= 500,
      configuration: answer.status === 401 || answer.status === 403,
      message: redact(
        `Mercado Pago Point answered ${answer.status} ${envelope.code}${detail}.`,
        token,
      ),
    });
  }

  /** An answer that parsed but is not the resource we asked for, named as such. */
  private malformed(status: number, why: string, token: string): PointTerminalClientError {
    return new PointTerminalClientError({
      code: MALFORMED_CODE,
      status,
      retryable: false,
      configuration: false,
      message: redact(`The Mercado Pago Point answer could not be read: ${why}.`, token),
    });
  }

  /**
   * The one header every call carries, and the only place the token is used. `Accept` is sent
   * because the vendor's two error envelopes are JSON and we want JSON back, not HTML.
   */
  private headers(token: string, contentType?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
    };
  }
}

/**
 * The token of one call, stripped from one message. An empty value is skipped, because
 * splitting on `''` would shred the whole string into `[redacted]` between every character.
 */
function redact(text: string, token: string): string {
  return token.length === 0 ? text : text.split(token).join('[redacted]');
}

/**
 * The list's `operating_mode` when it is one the vendor documents, and `UNDEFINED` for anything
 * else — including a value a future vendor adds. A mode we cannot name is carried as "not
 * recognized" rather than folded into one of the two real modes: `UNDEFINED` is read-only
 * precisely because guessing it would be a claim about the counter.
 */
function vendorMode(value: unknown): VendorOperatingMode {
  return value === 'PDV' || value === 'STANDALONE' ? value : 'UNDEFINED';
}

/**
 * The mode `PATCH /terminals/v1/setup` echoed back in `terminals[0].operating_mode`, when it is
 * one of the two writable values. Anything else is null, and the caller falls back to what it
 * asked for: `UNDEFINED` may not be written, so it cannot be the answer to a write.
 */
function firstTerminalMode(body: unknown): PointOperatingMode | null {
  const terminals = asArray(asRecord(body)?.terminals);
  const first = terminals === null ? null : asRecord(terminals[0]);
  const mode = first === null ? null : first.operating_mode;
  return mode === 'PDV' || mode === 'STANDALONE' ? mode : null;
}

/**
 * The two envelopes, in the order that finds both, plus the message when one is there. The
 * message is the vendor's own sentence and is passed through the caller's redaction like every
 * other string; it is never a token, but it is also never ours to trust verbatim.
 */
function readErrorEnvelope(
  body: unknown,
  status: number,
): { code: string; message: string | null } {
  const record = asRecord(body);
  if (record === null) return { code: `http_${status}`, message: null };

  const nested = asRecord(asArray(record.errors)?.[0]);
  const nestedCode = nested === null ? null : nonEmptyString(nested.code);
  if (nestedCode !== null) {
    return { code: nestedCode, message: nested === null ? null : nonEmptyString(nested.message) };
  }

  const flatCode = nonEmptyString(record.code);
  if (flatCode !== null) return { code: flatCode, message: nonEmptyString(record.message) };

  return { code: `http_${status}`, message: null };
}

/** `pos_id` and `store_id` arrive as a number or a string; both are carried as text. */
function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return nonEmptyString(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** A body that is not JSON is null, never a throw: the status is the answer that survives. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The cause, as a class name and message. A cause can name a host; it never holds a token. */
function describeThrow(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown transport failure';
}
