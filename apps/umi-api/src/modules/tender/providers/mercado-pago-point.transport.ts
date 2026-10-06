import { createHash } from 'node:crypto';
import type {
  PointOrderInput,
  PointOrderSnapshot,
  PointRefundInput,
  PointRefundSnapshot,
  PointTransport,
} from '../point-transport.port';

/**
 * THE LIVE POINT TRANSPORT — plan §4 phase 1, written against research note
 * `01-orders-api-spec.md` and nothing else.
 *
 * It does two things: it asks the vendor for an order, and it asks what happened to one.
 * Every status it returns is the vendor's own string, VERBATIM, because the meaning of a
 * status belongs to `classifyTerminalStatus` in `tender-domain.ts` — the pure, property
 * tested mapping — and not to the HTTP layer.
 *
 * TWO FACTS SHAPE EVERY LINE BELOW.
 *
 * 1. A TRANSPORT PROBLEM IS NEVER A DECLINE. A non-2xx answer, a dead socket, and a
 *    socket that never answers all THROW; the provider turns a throw into `unknown`
 *    (`transportFailureOutcome`), because "we could not ask" says nothing about the
 *    customer's card. Reading a network failure as a refused card is the mistake this
 *    whole workstream exists to prevent (note 01 §7.1, and the tender-path ADR).
 * 2. THE IDEMPOTENCY KEY IS DERIVED, NOT RANDOM. The vendor binds the key to the request
 *    body for 24 hours and answers a repeat with the ORIGINAL resource (note 01 §7.4), so
 *    a retry of the same command must reuse the same key — plan D3, and the reason
 *    `pointIdempotencyKey` is a pure function of identity and operation.
 */

/** create-order's documented success status is 201; 200 is accepted defensively (note 01 §1). */
const ORDER_CREATED = 201;
const ORDER_OK = 200;

/** The refund's documented success status is 201; 200 is accepted defensively (note 01 §4.2). */
const REFUND_CREATED = 201;

/** The two status classes the note calls possible and retryable (note 01 §8). */
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;

/** The vendor's own ceilings, in characters (note 01 §1.2). */
const EXTERNAL_REFERENCE_MAX_CHARS = 64;
const DESCRIPTION_MAX_CHARS = 150;

/**
 * THE EXPIRATION WINDOW, chosen at the top of the documented range. The vendor allows
 * PT30S to PT3H and defaults to FIFTEEN MINUTES when the field is omitted; a café table
 * outlives fifteen minutes, so we send the ceiling explicitly (note 01 §1.3, plan §4
 * phase 1 step 4).
 */
const DEFAULT_EXPIRATION_TIME = 'PT3H';

/** The socket budget: a hung vendor call must not hold the till's request open either. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The vendor's documented `print_on_terminal` default, sent explicitly (note 01 §1.2). */
const SELLER_TICKET = 'seller_ticket';

/** The local codes, for the two failures the vendor never gets to name (note 01 §7.1). */
const UNREACHABLE_CODE = 'MERCADO_PAGO_UNREACHABLE';
const MALFORMED_CODE = 'MERCADO_PAGO_MALFORMED_RESPONSE';

/**
 * A partial refund with no payment id. This is OUR malformed request, not the vendor's
 * refusal: the vendor's own rule is that `transactions[].id` "is the identifier of the
 * payment transaction created in the request", and a partial refund that names no payment
 * cannot be expressed at all (note 01 §4.3). It is thrown locally rather than sent, so a
 * bug in our command layer never becomes a vendor-side error we then have to interpret.
 */
const REFUND_NEEDS_PAYMENT_CODE = 'MERCADO_PAGO_REFUND_NEEDS_PAYMENT';

/**
 * THE IDEMPOTENCY NAMESPACE, FIXED FOREVER.
 *
 * A v5 key is `uuidv5(namespace, name)`, and the namespace is the one part of the key
 * that is not the attempt's own identity. It is a constant and it never changes: a
 * different namespace silently mints a DIFFERENT key for an attempt the vendor already
 * knows, which is precisely the double charge the key exists to prevent (plan D3).
 */
const MP_KEY_NAMESPACE = 'bda43420-1926-41fc-b677-cdb870423f38';

/**
 * `uuidv5(commandIdentity + ':' + operation, MP_KEY_NAMESPACE)` — plan D3, by hand.
 *
 * The repo has no `uuid` dependency, and this needs SHA-1 over `node:crypto` and nothing
 * else, so RFC-4122's name-based construction is written out: SHA-1 of the 16 namespace
 * bytes followed by the UTF-8 name, truncated to 128 bits, with the version nibble set
 * to 5 and the variant bits set to RFC-4122, rendered as canonical lowercase
 * 8-4-4-4-12 hex. A retry of the same command therefore produces the same key — on this
 * deploy and on the next one, because the namespace is a constant (note 01 §7.4).
 */
export function pointIdempotencyKey(commandIdentity: string, operation: string): string {
  return uuidV5(MP_KEY_NAMESPACE, `${commandIdentity}:${operation}`);
}

/**
 * The vendor's `external_reference` rule, applied without negotiation: "The maximum
 * allowed limit is 64 characters, and the allowed characters are: uppercase and lowercase
 * letters, numbers, and the symbols hyphen (-) and underscore (_)" (note 01 §1.2). The
 * value is OUR command identity, so anything stripped here is stripped from our own
 * vocabulary, not from a customer's data — a customer name must never reach this field.
 */
export function sanitizeExternalReference(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, EXTERNAL_REFERENCE_MAX_CHARS);
}

/**
 * A vendor refusal, stated as a value rather than as a sentence.
 *
 * `code` is the vendor's own string when the answer carried one and a local
 * `MERCADO_PAGO_*` string when it did not, because the two control-flow branches that
 * matter — "retry this" and "this deployment is misconfigured" — hang off the code and
 * both must survive the vendor changing its envelopes (note 01 §7.1).
 */
export class MercadoPagoPointError extends Error {
  /** The vendor's code string, or a local one. */
  readonly code: string;
  /** The HTTP status, and 0 when there was no answer at all. */
  readonly status: number;
  /** True for 429, 5xx, timeouts, and dead sockets: asking again is coherent. */
  readonly retryable: boolean;
  /** True for a credential or terminal-ownership problem: a retry loop would hide it. */
  readonly configuration: boolean;

  constructor(init: {
    readonly message: string;
    readonly code: string;
    readonly status: number;
    readonly retryable: boolean;
    readonly configuration: boolean;
  }) {
    super(init.message);
    this.name = 'MercadoPagoPointError';
    this.code = init.code;
    this.status = init.status;
    this.retryable = init.retryable;
    this.configuration = init.configuration;
  }
}

export interface MercadoPagoPointTransportOptions {
  /**
   * The DEPLOYMENT's own token — D7's "own account" mode, which phases 1 to 4 use. Optional
   * when a resolver is given, because a deployment that only serves other people's accounts
   * has no token of its own.
   */
  readonly accessToken?: string;
  /**
   * THE MERCHANT'S OWN TOKEN, resolved per call (plan D7). In the third-party model each café
   * authorizes Umi separately, so the token a request is made with depends on whose money the
   * order is for — and the transport is built once for the whole process, which is why the
   * token cannot simply be a constructor value any more.
   *
   * A null answer is not an error here: it means "this merchant has not authorized", and the
   * deployment token (when there is one) is the fallback. Neither being available is a
   * CONFIGURATION failure, never a payment failure — see `resolveToken`.
   */
  readonly accessTokenFor?: (merchantId: string) => Promise<string | null>;
  /**
   * The exact `type__serial` string the vendor's terminal list returned, for example
   * `NEWLAND_N950__SBX0000001`. It is sent as `config.point.terminal_id` and never
   * rebuilt from parts, because the vendor documents the join itself: "You must send it
   * according to the following format: `type of terminal + "__" + terminal serial`"
   * (note 01 §1.2).
   */
  readonly terminalId: string;
  readonly baseUrl: string;
  /** ISO-8601 duration, `PT30S` to `PT3H`. Defaults to `PT3H` (note 01 §1.3). */
  readonly expirationTime?: string;
  /** Test seam. Defaults to the global `fetch` (note 01 §1.1's three required headers). */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Test seam. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

/**
 * THE TRANSPORT ITSELF. `configured` is a literal `true` because a deployment without
 * credentials builds `UnconfiguredPointTransport` instead of this class
 * (`tender.module.ts`), so reaching a constructor call at all means the config was there.
 */
export class MercadoPagoPointTransport implements PointTransport {
  readonly configured = true;
  readonly unavailableReason: string | null = null;

  /**
   * The `type__serial` string from the vendor's terminal list, kept exactly as it
   * arrived. It is what the attempt record stores so the database can hold the
   * one-open-order-per-terminal rule (plan D4), and it is NEVER rebuilt from parts: the
   * vendor's format is `type of terminal + "__" + terminal serial` (note 01 §1.2), and a
   * rebuilt string is a string that can disagree with the device in the merchant's hand.
   */
  readonly terminalId: string;

  private readonly deploymentToken: string | null;
  private readonly accessTokenFor: ((merchantId: string) => Promise<string | null>) | null;
  private readonly baseUrl: string;
  private readonly expirationTime: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: MercadoPagoPointTransportOptions) {
    this.deploymentToken = options.accessToken ?? null;
    this.accessTokenFor = options.accessTokenFor ?? null;
    this.terminalId = options.terminalId;
    // The reference's paths are absolute (`/v1/orders`), so a trailing slash on the
    // origin would produce `//v1/orders` — a different URL to some proxies.
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.expirationTime = options.expirationTime ?? DEFAULT_EXPIRATION_TIME;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * CREATE THE ORDER — `POST /v1/orders` (note 01 §1).
   *
   * The body is the guide's required minimum plus the two fields we have opinions about:
   * exactly one payment (the vendor allows one for `type: point`, note 01 §1.2), the
   * amount always as a two-decimal string (§1.4 — the reference page and the integration
   * guide disagree about "or none", so we send the form both accept), the seller ticket
   * printed (§1.2's default, sent explicitly), and `expiration_time` at the ceiling
   * (§1.3).
   *
   * The idempotency key is derived from `input.externalReference`, NOT from a counter or
   * a clock: `PointOrderInput` carries no separate command identity, and this field IS it
   * — it is what the provider copied from `request.commandIdentity`
   * (`mercado-pago-point.provider.ts`). Deriving the key from the same value the vendor
   * receives as `external_reference` means one command identity is one key for the
   * vendor's whole 24-hour window (note 01 §7.4, plan D3).
   */
  async createOrder(input: PointOrderInput): Promise<PointOrderSnapshot> {
    const response = await this.send('/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.resolveToken(input.merchantId)}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': pointIdempotencyKey(input.externalReference, 'create_order'),
      },
      body: JSON.stringify({
        type: 'point',
        external_reference: sanitizeExternalReference(input.externalReference),
        description: input.description.slice(0, DESCRIPTION_MAX_CHARS),
        expiration_time: this.expirationTime,
        transactions: { payments: [{ amount: amountFor(input.amountMinorUnits) }] },
        config: {
          point: { terminal_id: this.terminalId, print_on_terminal: SELLER_TICKET },
        },
      }),
    });

    if (response.status !== ORDER_CREATED && response.status !== ORDER_OK) {
      throw this.refusal(response);
    }
    return snapshotFromOrder(response.body, {
      httpStatus: response.status,
      fallbackOrderId: null,
      paymentDetailFirst: false,
    });
  }

  /**
   * READ THE ORDER BACK — `GET /v1/orders/{order_id}` (note 01 §2).
   *
   * A read carries the Authorization header and NOTHING else: the idempotency header
   * belongs to requests that change something (§1.1 is stated for the write endpoints),
   * and the order id in the path is already encoded so a stray character cannot reshape
   * the URL.
   *
   * The failure detail is read from the PAYMENT level first (§2.2: the card's own
   * `status_detail` — `insufficient_amount`, `bad_filled_card_data` — is the refusal
   * reason, while the order-level detail says only `failed`).
   */
  async readOrder(orderId: string, merchantId: string): Promise<PointOrderSnapshot> {
    const response = await this.send(`/v1/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await this.resolveToken(merchantId)}` },
    });

    if (response.status !== ORDER_OK) {
      throw this.refusal(response);
    }
    return snapshotFromOrder(response.body, {
      httpStatus: response.status,
      // The caller already holds the id, so a body that omits it still answers honestly.
      fallbackOrderId: orderId,
      paymentDetailFirst: true,
    });
  }

  /**
   * GIVE MONEY BACK — `POST /v1/orders/{order_id}/refund` (note 01 §4).
   *
   * THE BODY IS THE WHOLE DISTINCTION BETWEEN THE TWO REFUNDS. A total refund sends NO
   * body — the vendor's reference is explicit ("without sending a body in the request",
   * §4.2) — and a partial refund sends exactly the `transactions` array §4.3 documents,
   * with the amount as the same two-decimal string `createOrder` uses (§4.3's table:
   * "The field can contain two decimal places or none", and both pages accept the form
   * with them). Sending the partial shape for a total refund would be a different request
   * than the one the vendor documents, so the two are built as two shapes here rather than
   * one shape with a null inside it.
   *
   * The idempotency key reuses `pointIdempotencyKey` with the operation `refund_order`, so
   * a retry of one refund command reuses one key and produces one refund, while a SECOND
   * refund command derives a different key — the vendor's 24-hour binding is on the key,
   * and a random key would let a retry move money twice (plan D3, note 01 §7.4).
   *
   * The answer is NOT classified here: `status` comes back verbatim because the vendor's
   * reference enum (`processing`) and its guide's example (`processed`) disagree, and a
   * refund that has been requested is not money that has moved (note 01 §4.2).
   */
  async refundOrder(input: PointRefundInput): Promise<PointRefundSnapshot> {
    if (input.amountMinorUnits !== null && input.paymentId === null) {
      throw new MercadoPagoPointError({
        code: REFUND_NEEDS_PAYMENT_CODE,
        status: 0,
        retryable: false,
        configuration: false,
        message:
          'A partial refund needs the payment id it applies to; refusing to send a request we know is malformed.',
      });
    }

    const path = `/v1/orders/${encodeURIComponent(input.orderId)}/refund`;
    const headers = {
      Authorization: `Bearer ${await this.resolveToken(input.merchantId)}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': pointIdempotencyKey(input.commandIdentity, 'refund_order'),
    };
    const partialBody =
      input.amountMinorUnits === null
        ? null
        : JSON.stringify({
            transactions: [{ id: input.paymentId, amount: amountFor(input.amountMinorUnits) }],
          });

    // The body key is OMITTED, not set to undefined: a total refund is a request with no
    // body at all, and `{"body": undefined}` is a different thing to write and to read.
    const response = await this.send(
      path,
      partialBody === null
        ? { method: 'POST', headers }
        : { method: 'POST', headers, body: partialBody },
    );

    if (response.status !== REFUND_CREATED && response.status !== ORDER_OK) {
      throw this.refusal(response);
    }
    return snapshotFromRefund(response.body, response.status);
  }

  /**
   * READ ONE REFUND BACK (plan §12.4 item 3, §14.2 D34).
   *
   * The same `GET /v1/orders/{order_id}` the capture query uses, read for a different question:
   * which of the order's refunds is the one we asked for, and what does the vendor now say about
   * it. A refund the terminal accepted but has not finished sits in `processing` forever unless
   * someone asks again, and this is the asking — a READ, so it cannot move a second peso, rather
   * than a repeated POST that would depend on the vendor's 24-hour idempotency window.
   *
   * The entry is chosen by the refund id the first answer gave us. That is the only attribution
   * this file will make: an order can hold several partial refunds, so matching on amount would
   * be a guess about money, and a guess is the one thing a settlement must never be.
   */
  async readRefund(
    orderId: string,
    refundId: string,
    merchantId: string,
  ): Promise<PointRefundSnapshot | null> {
    const response = await this.send(`/v1/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${await this.resolveToken(merchantId)}` },
    });
    if (response.status !== ORDER_OK) {
      throw this.refusal(response);
    }
    return refundFromOrder(response.body, refundId, response.status);
  }

  /**
   * ONE REQUEST, ONE BUDGET.
   *
   * The `AbortController` plus `setTimeout` pair — cleared in `finally`, so a fast
   * answer leaves no timer behind and a slow one cannot outlive the request — is what
   * keeps a hung vendor from holding the till's HTTP request open. The body read happens
   * INSIDE the same try: a socket that sends headers and then stalls is the same problem
   * as a socket that never answers.
   *
   * Everything the socket can do that is not an HTTP answer lands on the one code the
   * provider already understands, `MERCADO_PAGO_UNREACHABLE` with `status: 0` — a
   * transport problem, never a decline (note 01 §7.1, plan §4 phase 1 step 3).
   */
  private async send(path: string, init: RequestInit): Promise<VendorAnswer> {
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
      throw new MercadoPagoPointError({
        code: UNREACHABLE_CODE,
        status: 0,
        retryable: true,
        configuration: false,
        message: this.unreachableMessage(
          describeThrow(error),
          controller.signal.aborted,
          startedAt,
        ),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A NON-2xx ANSWER, CLASSIFIED. Both documented envelopes are read here and
   * `classifyFailure` decides which of the two control-flow branches it belongs to
   * (note 01 §7.1, §7.2).
   */
  private refusal(answer: VendorAnswer): MercadoPagoPointError {
    const envelope = readErrorEnvelope(answer.body, answer.status);
    const { retryable, configuration } = classifyFailure(envelope.code, answer.status);
    const detail = envelope.message === null ? '' : `: ${envelope.message}`;
    return new MercadoPagoPointError({
      code: envelope.code,
      status: answer.status,
      retryable,
      configuration,
      message: this.redact(
        `Mercado Pago Point answered ${answer.status} ${envelope.code}${detail}.`,
      ),
    });
  }

  /**
   * THE TWO WAYS A SOCKET FAILS, and why the clock seam appears here.
   *
   * A vendor that never answers and a vendor we cannot reach read the same way to the
   * till — we do not know — but an operator debugging a missing charge needs to tell
   * them apart, and needs to line OUR request up with the vendor's own record. The
   * vendor's order carries `created_date` and `last_updated_date` as the ordering key
   * (note 01 §2.2), so the message carries when we asked, from the injected clock, and
   * which budget ran out.
   */
  private unreachableMessage(reason: string, aborted: boolean, startedAt: Date): string {
    const sentAt = startedAt.toISOString();
    const detail = aborted
      ? `did not answer within ${this.timeoutMs} ms`
      : `could not be reached: ${reason}`;
    return this.redact(`The Mercado Pago Point API ${detail} (request sent ${sentAt}).`);
  }

  /**
   * WHETHER THIS CAFÉ'S ACCOUNT CAN BE CHARGED (plan D7, D8). The per-merchant half of
   * `configured`: the register is the deployment's, the account is the merchant's, and a till
   * must not offer a card button to a café whose account is not connected.
   */
  async canChargeFor(merchantId: string): Promise<boolean> {
    if (this.deploymentToken) return true;
    if (!this.accessTokenFor) return false;
    return (await this.accessTokenFor(merchantId)) !== null;
  }

  /**
   * WHICH TOKEN THIS CALL IS MADE WITH (plan D7).
   *
   * The merchant's own credential first, because that is the account whose money moves; the
   * deployment's token second, because that is the "own account" mode phases 1 to 4 run in.
   * Neither being present is a CONFIGURATION error — the refusal below says so, and the flag is
   * what keeps it apart from a declined card — and it is never a payment answer: it says the café
   * has not connected its account, which the console's status route already tells the truth
   * about, and reading it as a decline would be the mistake this whole workstream exists to avoid.
   */
  private async resolveToken(merchantId: string): Promise<string> {
    if (this.accessTokenFor && merchantId) {
      const perMerchant = await this.accessTokenFor(merchantId);
      if (perMerchant) return perMerchant;
    }
    if (this.deploymentToken) return this.deploymentToken;
    throw new MercadoPagoPointError({
      code: 'MERCADO_PAGO_NO_CREDENTIAL',
      status: 0,
      retryable: false,
      configuration: true,
      message:
        'This merchant has not connected a Mercado Pago account and the deployment has no token of its own.',
    });
  }

  private redact(text: string): string {
    // THE TOKEN NEVER TRAVELS. The access token is the whole credential (note 01 §1.1), so
    // anything that leaves this class in a message passes here first: vendor text can quote
    // a request back at us, and a token that reaches a log is a token we have to rotate.
    // The deployment token when we have one, and — because a per-merchant token is resolved
    // per call and this object never sees it — anything shaped like a bearer credential. A
    // leaked vendor token in an error message is the one redaction that must not depend on
    // having been handed the secret at construction.
    const withoutBearer = text.replace(/(Bearer\s+)\S+/gu, '$1[redacted]');
    return this.deploymentToken === null || this.deploymentToken.length === 0
      ? withoutBearer
      : withoutBearer.split(this.deploymentToken).join('[redacted]');
  }
}

/**
 * Integer minor units to the vendor's amount string. The vendor's own two pages disagree
 * about whether decimals are optional, and the integration guide is blunt: the field
 * "must carry 2 decimal places, even when it is a whole number (for example, `"10.00"`)"
 * (note 01 §1.4). `toFixed` is the whole conversion: the till carries cents, the vendor
 * wants a decimal string, and rounding has already happened where the cart was totalled.
 */
const amountFor = (minorUnits: number): string => (minorUnits / 100).toFixed(2);

/**
 * `minorUnitsFromAmount` is `amountFor` read backwards: the vendor's decimal string to
 * integer minor units (note 01 §2.2 — `paid_amount`, `tip_amount` and a refund's `amount`
 * all arrive as strings like `"120"` or `"120.50"`). The split on the decimal point is
 * deliberate: `Number(text) * 100` is a float multiply, and `"24.50"` and `"0.29"` land a
 * cent away from the integer the till already holds. Anything absent or not a decimal
 * number is NULL, never 0, because "the vendor did not say" is a different fact from "zero".
 */
function minorUnitsFromAmount(value: unknown): number | null {
  const text =
    typeof value === 'number' && Number.isFinite(value) ? String(value) : readNonEmptyString(value);
  if (text === null) return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(text);
  if (match === null) return null;
  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] ?? '';
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' ? -minor : minor;
}

/** RFC-4122 v5 over SHA-1. The `sha1` call is the standard's own choice, not a weakness. */
function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/gu, ''), 'hex');
  const digest = createHash('sha1')
    .update(namespaceBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = [...digest.subarray(0, 16)];
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface VendorAnswer {
  readonly status: number;
  /** The parsed body, or null when it was not JSON — the envelope is read from it. */
  readonly body: unknown;
}

interface ErrorEnvelope {
  readonly code: string;
  readonly message: string | null;
}

/**
 * THE TWO ENVELOPES, IN THE ORDER THAT FINDS BOTH (note 01 §7.1).
 *
 * The vendor answers an authentication failure flat — `{"code":"unauthorized",...}` —
 * and everything else nested — `{"errors":[{"code":"...","message":"..."}]}`. A parser
 * that reads only `body.code` misses every 400, 403, 404, 409, 422, 425, and 428, which
 * is why `errors[0].code` is read first and the flat `code` is the fallback. The last
 * resort names the status, because "something refused us and we cannot say what" is
 * still more useful than an empty code — and a body that was never JSON at all (an HTML
 * error page, an empty 500) never reaches a parser that could invent detail from it.
 */
function readErrorEnvelope(body: unknown, status: number): ErrorEnvelope {
  const record = asRecord(body);
  if (record === null) return { code: localHttpCode(status), message: null };

  const nested = asRecord(firstOf(record.errors));
  if (nested !== null) {
    const nestedCode = readNonEmptyString(nested.code);
    if (nestedCode !== null) {
      return { code: nestedCode, message: readNonEmptyString(nested.message) };
    }
  }

  const flatCode = readNonEmptyString(record.code);
  if (flatCode !== null) return { code: flatCode, message: readNonEmptyString(record.message) };

  return { code: localHttpCode(status), message: null };
}

/**
 * WHICH CODE NEEDS WHICH BRANCH — the documented table, transcribed (note 01 §7.2, §1.7).
 *
 * The configuration set is checked FIRST, and that order is the invariant rather than a
 * style choice: a credential or ownership problem must never also be `retryable`, or a
 * till loops politely on a token that will never work. The note also warns that one code
 * can arrive with different statuses on different endpoints (§7.3), so a documented code
 * outranks the status it came with.
 */
function classifyFailure(
  code: string,
  status: number,
): { readonly retryable: boolean; readonly configuration: boolean } {
  if (CONFIGURATION_CODES.has(code)) return { retryable: false, configuration: true };
  if (NOT_RETRYABLE_CODES.has(code)) return { retryable: false, configuration: false };
  if (RETRYABLE_CODES.has(code)) return { retryable: true, configuration: false };
  // Uncatalogued: the status decides. A blind retry of a 4xx repeats a request the vendor
  // has already refused; 429 and 5xx are the two the note calls possible and retryable
  // (§8: the vendor publishes no Point rate limit at all, so a 429 must be expected).
  return {
    retryable: status === TOO_MANY_REQUESTS || status >= SERVER_ERROR,
    configuration: false,
  };
}

/**
 * A credential or ownership problem. These are the codes a merchant must SEE: the token
 * is wrong or expired (`unauthorized`, `user_not_authorized` — §7.2 "Refresh the token")
 * or the token and the terminal do not belong to the same account
 * (`forbidden_checking_terminal_owner`, §1.7 — "the single most likely production failure
 * for a multi-merchant product"), or the store and point-of-sale setup is incomplete
 * (§7.2). None of them is fixed by asking again.
 */
const CONFIGURATION_CODES = new Set([
  'unauthorized',
  'user_not_authorized',
  'forbidden_checking_terminal_owner',
  'store_pos_not_found',
  'store_not_found',
  'pos_already_exists',
]);

/**
 * Codes where a second identical request is pointless or wrong: our own malformed
 * payload comes back as a validation code (§1.7, and the `property_value` case is an
 * unknown terminal id), the idempotency key is spent (§1.1, §7.4), the terminal already
 * holds an order (§1.5), or the answer is a race or a refusal that a person resolves
 * (§7.2). Retrying any of these in a loop would hide the condition rather than clear it.
 */
const NOT_RETRYABLE_CODES = new Set([
  'empty_required_header',
  'required_properties',
  'minimum_properties',
  'unsupported_properties',
  'property_type',
  'property_value',
  'minimum_items',
  'maximum_items',
  'json_syntax_error',
  'invalid_path_param',
  'idempotency_key_already_used',
  'already_queued_order_for_terminal',
  'cannot_cancel_order',
  'order_already_canceled',
  'order_not_found',
  'insufficient_money_for_refund',
  'refund_period_exceeded',
  // The refund endpoint's own answers (note 01 §4.4). Each one is a statement about THIS
  // refund — the order has a tip, the amount is over the ceiling, the order was already
  // given back, the payment id or order id is not one the vendor knows — so a retry loop
  // repeats a request the vendor has already answered.
  'partial_refund_forbidden_with_tips',
  'refund_amount_exceeds',
  'unsupported_partially_refunds',
  'cannot_refund_order',
  'order_already_refunded',
  'transaction_not_found',
]);

/** The documented transient set: retry with backoff, reusing the same idempotency key. */
const RETRYABLE_CODES = new Set([
  '500',
  'idempotency_validation_failed',
  'internal_error',
  'internal_server_error',
  'refund_in_progress',
  'movement_operations_pending',
  'order_payment_not_yet_enabled_for_refund',
]);

/**
 * The order, read as the snapshot the seam promises. `status` is copied verbatim, never
 * mapped, and a 2xx body we cannot read is a THROW rather than a fabricated snapshot: an
 * order id this client invented would be a lie the attempt record would keep forever.
 * The vendor's own read window is 3 months (§2.1), which is why the record — not this
 * API — is the long-term truth.
 */
function snapshotFromOrder(
  body: unknown,
  options: {
    readonly httpStatus: number;
    /** The id the caller already holds, for a read whose body omits it. */
    readonly fallbackOrderId: string | null;
    /** Read the payment's own `status_detail` before the order's (note 01 §2.2). */
    readonly paymentDetailFirst: boolean;
  },
): PointOrderSnapshot {
  const order = asRecord(body);
  if (order === null) throw malformedAnswer(options.httpStatus);

  const orderId = readNonEmptyString(order.id) ?? options.fallbackOrderId;
  const status = readNonEmptyString(order.status);
  if (orderId === null || status === null) {
    throw malformedAnswer(options.httpStatus);
  }

  const payment = firstPaymentOf(order);
  return {
    orderId,
    status,
    // The ORDER's own detail, kept beside the status. `refunded` and `partially_refunded`
    // are in the vendor's detail vocabulary and not in its status enum (note 01 §2.2), so a
    // snapshot that drops this field makes a refunded order look like a status nobody has
    // seen — which `classifyTerminalStatus` then reads as an unknown.
    statusDetail: readNonEmptyString(order.status_detail),
    paymentId: payment === null ? null : readNonEmptyString(payment.id),
    // The terminal can add a tip, so `paid_amount` is the number that actually reached the
    // card and the ceiling a refund has to respect (plan §4 phase 4 step 3, note 01 §2.2).
    // Both are STRINGS in the vendor's schema; when the vendor says nothing the field is
    // null rather than 0, because "did not say" and "zero" are different facts.
    paidAmountMinorUnits: payment === null ? null : minorUnitsFromAmount(payment.paid_amount),
    tipAmountMinorUnits: payment === null ? null : minorUnitsFromAmount(payment.tip_amount),
    failureCode: failureCodeOf(order, payment, options.paymentDetailFirst),
  };
}

/**
 * The refund answer, read as the snapshot the seam promises (note 01 §4.2, §4.3).
 *
 * The FIRST entry of `transactions.refunds[]` is the refund this request created: a partial
 * refund answers with `status=processed` while balance remains and `status_detail=
 * partially_refunded` (§4.3), and a total refund answers with `status=refunded`,
 * `status_detail=refunded` and the same array (§4.2). The status travels VERBATIM — the
 * vendor's own reference calls the enum `processing` while its guide's example says
 * `processed`, so "requested" and "moved" are not ours to conflate here — and a 2xx body we
 * cannot read is a THROW rather than a snapshot with an invented status, for the same
 * reason `snapshotFromOrder` throws.
 */
function snapshotFromRefund(body: unknown, httpStatus: number): PointRefundSnapshot {
  const refund = asRecord(body);
  const status = refund === null ? null : readNonEmptyString(refund.status);
  if (refund === null || status === null) throw malformedAnswer(httpStatus, 'a refund');

  const transactions = asRecord(refund.transactions);
  const entry = transactions === null ? null : asRecord(firstOf(transactions.refunds));
  return {
    refundId: entry === null ? null : readNonEmptyString(entry.id),
    status,
    statusDetail: readNonEmptyString(refund.status_detail),
    amountMinorUnits: entry === null ? null : minorUnitsFromAmount(entry.amount),
  };
}

/**
 * ONE REFUND, OUT OF THE ORDER'S OWN ANSWER.
 *
 * The refunds array is the vendor's record of everything given back on this order (note 01 §4.2),
 * and an order can carry several: two partial refunds are legal and documented. So the entry is
 * found by the vendor's refund id — never by position, never by amount — because a settlement
 * attributed to the wrong refund is a lie about money, and the amount is the one field two
 * partial refunds can share.
 *
 * `null` IS AN ANSWER: the order was read and does not list this refund. It is the honest result
 * of asking, and the caller must not turn it into a failure — "the vendor is not holding a refund
 * of ours" and "we could not find out" are different facts about the café's money.
 *
 * The entry's own `status`. The order's top-level one says what the ORDER is (`processed`,
 * `refunded`, `partially_refunded`) while every entry carries the refund's own state, which is the
 * field the question is about. An entry that names no status is unreadable rather than unknown:
 * the same `malformedAnswer` the POST's own reader raises, so one rule covers both reads.
 */
function refundFromOrder(
  body: unknown,
  refundId: string,
  httpStatus: number,
): PointRefundSnapshot | null {
  const order = asRecord(body);
  const transactions = order === null ? null : asRecord(order.transactions);
  const entries = transactions === null ? null : transactions.refunds;
  if (!Array.isArray(entries)) return null;

  for (const raw of entries) {
    const entry = asRecord(raw);
    if (entry === null || readNonEmptyString(entry.id) !== refundId) continue;
    const status = readNonEmptyString(entry.status);
    if (status === null) throw malformedAnswer(httpStatus, 'a refund');
    return {
      refundId,
      status,
      statusDetail: readNonEmptyString(entry.status_detail),
      amountMinorUnits: minorUnitsFromAmount(entry.amount),
    };
  }
  return null;
}

/**
 * A 2xx body with no id or no status. It is a THROW, not a snapshot with invented fields:
 * an order or refund id we made up would be a lie the attempt record keeps forever, and an
 * empty status would reach a classifier as a status the vendor never sent. Classified
 * retryable because nothing about it says our request was wrong — a create or a refund
 * retries safely under the same idempotency key (note 01 §7.4, plan D3).
 */
const malformedAnswer = (httpStatus: number, what = 'an order'): MercadoPagoPointError =>
  new MercadoPagoPointError({
    code: MALFORMED_CODE,
    status: httpStatus,
    retryable: true,
    configuration: false,
    message: `Mercado Pago Point answered ${httpStatus} with ${what} we cannot read.`,
  });

/**
 * The failure detail, in the order the endpoint documents it. A create-order answer has
 * only the order-level `status_detail` (note 01 §1.5); a read prefers the payment's own,
 * because that is where the card's refusal reason lives (§2.2).
 */
function failureCodeOf(
  order: Record<string, unknown>,
  payment: Record<string, unknown> | null,
  paymentDetailFirst: boolean,
): string | null {
  const orderDetail = readNonEmptyString(order.status_detail);
  const paymentDetail = payment === null ? null : readNonEmptyString(payment.status_detail);
  return paymentDetailFirst ? (paymentDetail ?? orderDetail) : orderDetail;
}

/** The first payment of the one transaction a `point` order may carry (note 01 §1.2). */
function firstPaymentOf(order: Record<string, unknown>): Record<string, unknown> | null {
  const transactions = asRecord(order.transactions);
  return transactions === null ? null : asRecord(firstOf(transactions.payments));
}

const localHttpCode = (status: number): string => `MERCADO_PAGO_HTTP_${status}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const firstOf = (value: unknown): unknown =>
  Array.isArray(value) ? (value as unknown[])[0] : undefined;

const readNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** An empty or unparsable body is `null`, never a partially trusted object. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The underlying reason, kept short: the message becomes an operator's sentence. */
const describeThrow = (error: unknown): string =>
  error instanceof Error ? error.message : 'no response';
