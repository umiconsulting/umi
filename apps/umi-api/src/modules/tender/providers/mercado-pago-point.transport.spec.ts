import { describe, expect, it } from 'vitest';
import { UnconfiguredPointTransport, type PointOrderInput } from '../point-transport.port';
import { outcomeFromSnapshot } from '../tender-domain';
import type { ProviderRefundRequest } from '../tender-provider.port';
import { MercadoPagoPointProvider } from './mercado-pago-point.provider';
import {
  MercadoPagoPointError,
  MercadoPagoPointTransport,
  pointIdempotencyKey,
  sanitizeExternalReference,
  type MercadoPagoPointTransportOptions,
} from './mercado-pago-point.transport';

/**
 * THE LIVE TRANSPORT, PINNED TO THE NOTE — no network, no credentials, no terminal.
 *
 * Every assertion below is a fact from research note `01-orders-api-spec.md`: the three
 * required headers and the exact body shape (§1.1, §1.2), the two decimal places the
 * integration guide insists on (§1.4), the two error envelopes (§7.1), the codes that
 * need their own control-flow branch (§7.2), and `action_required` being terminal (§2.2).
 *
 * THE TWO INVARIANTS THIS FILE EXISTS FOR are not about field names. A transport problem
 * must never become a decline — the last describe drives a dead socket all the way through
 * `MercadoPagoPointProvider` and asserts `unknown` — and the idempotency key must be
 * derived from the command identity rather than invented, because a random key per retry
 * is what turns a network timeout into two orders on one terminal (plan D3).
 */

const ACCESS_TOKEN = 'test-token';
/** The exact `type__serial` string `GET /terminals/v1/list` returns (note 01 §1.2). */
const TERMINAL_ID = 'NEWLAND_N950__SBX0000001';
const BASE_URL = 'https://api.mercadopago.com';
const ORDER_ID = 'ORD00001111222233334444555566';
const PAYMENT_ID = 'PAY01J67CQQH5904WDBVZEM4JMEP3';
/** The vendor's refund id inside `transactions.refunds[]` (note 01 §4.2). */
const REFUND_ID = 'REF01J67CQQH5904WDBVZEM4JMEP3';
const COMMAND_IDENTITY = 'command-abc';
/** Whose account every call here acts for: the credential is resolved per merchant (plan D7). */
const MERCHANT_ID = 'merchant-1';
/** A fixed clock, so any sentence the transport builds is reproducible. */
const NOW = new Date('2026-09-17T18:00:00.000Z');

const ORDER_INPUT: PointOrderInput = {
  merchantId: MERCHANT_ID,
  externalReference: COMMAND_IDENTITY,
  amountMinorUnits: 500,
  currency: 'MXN',
  description: 'UmiPOS cart 42',
};

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  /** Header names arrive lower-cased, because `Headers` normalises them. */
  readonly headers: Record<string, string>;
  /** The raw body text, or null when the request carried no body at all. */
  readonly bodyText: string | null;
}

interface StubAnswer {
  readonly status: number;
  /** Serialised as the response body — unless `raw` is set, which wins. */
  readonly body?: unknown;
  /** A body that is not JSON: an HTML error page, an empty 500. */
  readonly raw?: string;
}

/**
 * A fetch that answers from a script and records exactly what it was asked. The signature
 * is `typeof fetch` rather than a hand-rolled shape, so the class's `fetchImpl` seam is
 * exercised with the type the production default has.
 */
const stubFetch = (reply: (request: CapturedRequest, call: number) => StubAnswer) => {
  const captured: CapturedRequest[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const bodyText = init !== undefined && typeof init.body === 'string' ? init.body : null;
    const request: CapturedRequest = { url, method: init?.method ?? 'GET', headers, bodyText };
    captured.push(request);
    const answer = reply(request, captured.length - 1);
    return new Response(answer.raw ?? JSON.stringify(answer.body ?? null), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, captured };
};

const transportWith = (
  overrides: Partial<MercadoPagoPointTransportOptions> = {},
): MercadoPagoPointTransport =>
  new MercadoPagoPointTransport({
    accessToken: ACCESS_TOKEN,
    terminalId: TERMINAL_ID,
    baseUrl: BASE_URL,
    now: () => NOW,
    ...overrides,
  });

/** `RequestInit.body` is typed loosely, so the recorded text is parsed at the assertion. */
const jsonOf = (request: CapturedRequest): Record<string, unknown> =>
  JSON.parse(request.bodyText ?? 'null') as Record<string, unknown>;

/**
 * The transport must THROW here — every refusal and every dead socket is an exception that
 * the provider turns into `unknown`. This returns the typed error so the branches under
 * test can be read off it.
 */
const refusalFrom = async (action: () => Promise<unknown>): Promise<MercadoPagoPointError> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof MercadoPagoPointError) return error;
    throw error;
  }
  throw new Error('the transport answered where the specification says it must throw.');
};

describe('createOrder — the request the vendor documents (note 01 §1.1, §1.2)', () => {
  it('posts the documented headers and body, and maps the 201 answer', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 201,
      body: { id: ORDER_ID, status: 'created', status_detail: 'created' },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT);

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request.url).toBe('https://api.mercadopago.com/v1/orders');
    expect(request.method).toBe('POST');
    expect(request.headers['authorization']).toBe('Bearer test-token');
    expect(request.headers['content-type']).toBe('application/json');
    // THE KEY IS DERIVED, and from `externalReference` because that IS our command
    // identity: `PointOrderInput` carries no other one, and the provider copies
    // `request.commandIdentity` into this field (plan D3).
    expect(request.headers['x-idempotency-key']).toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'create_order'),
    );
    // `toEqual` is the assertion: exactly these fields. The amount is a STRING with two
    // decimals (§1.4), there is exactly one payment (§1.2), and nothing extra is sent.
    expect(jsonOf(request)).toEqual({
      type: 'point',
      external_reference: COMMAND_IDENTITY,
      description: 'UmiPOS cart 42',
      expiration_time: 'PT3H',
      transactions: { payments: [{ amount: '5.00' }] },
      config: { point: { terminal_id: TERMINAL_ID, print_on_terminal: 'seller_ticket' } },
    });
    expect(snapshot).toEqual({
      orderId: ORDER_ID,
      status: 'created',
      // The order's own `status_detail`, kept beside the status because `refunded` and
      // `partially_refunded` live in the DETAIL vocabulary and not in the status enum
      // (note 01 §2.2) — a snapshot that dropped it would read a refunded sale as a
      // status nobody has seen.
      statusDetail: 'created',
      paymentId: null,
      // No payment on a create answer, so the vendor never said what was paid; null, not 0.
      paidAmountMinorUnits: null,
      tipAmountMinorUnits: null,
      failureCode: 'created',
    });
  });

  it('strips a trailing slash from the origin and caps the description at 150 characters', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 201,
      body: { id: ORDER_ID, status: 'created' },
    }));

    await transportWith({ baseUrl: `${BASE_URL}/`, fetchImpl: impl }).createOrder({
      ...ORDER_INPUT,
      description: 'd'.repeat(200),
    });

    // The reference's paths are absolute, so a slash left on the origin would build
    // `//v1/orders`; the description ceiling is the vendor's own (§1.2).
    expect(captured[0].url).toBe('https://api.mercadopago.com/v1/orders');
    expect(jsonOf(captured[0]).description).toBe('d'.repeat(150));
  });

  it('reports the configured terminal id, and null when there is no transport at all', () => {
    // The attempt record stores this exact string so the database can hold the
    // one-open-order-per-terminal rule (plan D4), and it is never rebuilt from parts.
    expect(transportWith().terminalId).toBe(TERMINAL_ID);
    expect(
      new UnconfiguredPointTransport('missing MERCADO_PAGO_POINT_ACCESS_TOKEN').terminalId,
    ).toBeNull();
  });
});

describe('pointIdempotencyKey — derived, never random (plan D3, note 01 §7.4)', () => {
  it('is stable for one command identity and different for another', () => {
    // KNOWN GOOD, computed once OUTSIDE this implementation, with Python's stdlib:
    //   python3 -c "import uuid;
    //     print(uuid.uuid5(uuid.UUID('bda43420-1926-41fc-b677-cdb870423f38'),
    //                      'command-abc:create_order'))"
    // run on 2026-09-17. Hard-coded so that a change to the namespace, the encoding, the
    // truncation, or the version nibble cannot pass as a refactor.
    expect(pointIdempotencyKey(COMMAND_IDENTITY, 'create_order')).toBe(
      '94564fea-8e36-5182-9096-eb5bff3c8bac',
    );
    // The same command, asked twice, is the same key: that is what makes the vendor
    // answer a retry with the first order instead of creating a second one (§7.4).
    expect(pointIdempotencyKey(COMMAND_IDENTITY, 'create_order')).toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'create_order'),
    );
    expect(pointIdempotencyKey('command-xyz', 'create_order')).not.toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'create_order'),
    );
    expect(pointIdempotencyKey(COMMAND_IDENTITY, 'read_order')).not.toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'create_order'),
    );
    // RFC-4122 v5: version nibble 5, variant bits 10xx, canonical lowercase hex.
    expect(pointIdempotencyKey(COMMAND_IDENTITY, 'create_order')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });
});

describe("sanitizeExternalReference — the vendor's own alphabet (note 01 §1.2)", () => {
  it('strips everything outside the documented set and stops at 64 characters', () => {
    // 100 characters in, of which 76 are legal: 12 chunks of `cmd ref!` plus `cdef`.
    const chunk = 'cmd ref!';
    const noisy = `${chunk.repeat(12)}cdef`;
    expect(noisy).toHaveLength(100);

    const cleaned = sanitizeExternalReference(noisy);

    expect(cleaned).toHaveLength(64);
    expect(cleaned).toMatch(/^[A-Za-z0-9_-]{64}$/u);
    // Ten whole chunks survive, and the cap lands four characters into the eleventh: the
    // strip happens first, the cut second.
    expect(cleaned).toBe(`${'cmdref'.repeat(10)}cmdr`);
    // A value that already obeys the rule survives untouched: it is our identity, and a
    // mangled identity is a payment nobody can match to a sale.
    expect(sanitizeExternalReference('cmd_9f3a-1b')).toBe('cmd_9f3a-1b');
  });
});

describe('the two error envelopes, and the branches they feed (note 01 §7.1, §7.2)', () => {
  it('reads the nested envelope: 409 already_queued_order_for_terminal is not a retry', async () => {
    const { impl } = stubFetch(() => ({
      status: 409,
      body: {
        errors: [
          {
            code: 'already_queued_order_for_terminal',
            message: 'The terminal already has an order waiting.',
          },
        ],
      },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    expect(error.code).toBe('already_queued_order_for_terminal');
    expect(error.status).toBe(409);
    // The terminal is busy, not broken: the answer is to read the open order, never to
    // send a second one in a loop (§1.5).
    expect(error.retryable).toBe(false);
    expect(error.configuration).toBe(false);
  });

  it('reads the flat envelope: 401 unauthorized is a configuration error', async () => {
    const { impl } = stubFetch(() => ({
      status: 401,
      body: { code: 'unauthorized', message: 'user not found' },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    // An authentication failure is flat — `{"code": "..."}` — so a parser that only read
    // `errors[0].code` would lose it entirely (§7.1).
    expect(error.code).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(error.configuration).toBe(true);
    // The two flags are mutually exclusive: a token that will never work must not also
    // look retryable, or a till loops on a configuration the merchant has to fix.
    expect(error.retryable).toBe(false);
    expect(String(error.message)).not.toContain(ACCESS_TOKEN);
  });

  it('redacts the token even when the vendor quotes it back at us', async () => {
    const { impl } = stubFetch(() => ({
      status: 401,
      body: {
        code: 'unauthorized',
        message: `authorization value not present: Bearer ${ACCESS_TOKEN}`,
      },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    // The token is the whole credential (§1.1). A message that reaches a log, an attempt
    // row, or an operator screen must never carry it.
    expect(String(error.message)).not.toContain(ACCESS_TOKEN);
    expect(String(error.message)).toContain('unauthorized');
  });

  it('maps 403 forbidden_checking_terminal_owner to a setup error (note 01 §1.7)', async () => {
    const { impl } = stubFetch(() => ({
      status: 403,
      body: {
        errors: [
          {
            code: 'forbidden_checking_terminal_owner',
            message: 'The Point terminal does not belong to the user who submitted the request.',
          },
        ],
      },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    // The token and the terminal disagree. It is the most likely production failure for a
    // multi-merchant product, and it is never a failed payment.
    expect(error.code).toBe('forbidden_checking_terminal_owner');
    expect(error.configuration).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it('classifies a 500 as retryable and a 400 property_value as our own bug', async () => {
    const server = stubFetch(() => ({
      status: 500,
      body: { errors: [{ code: '500', message: 'Generic error.' }] },
    }));
    const bug = stubFetch(() => ({
      status: 400,
      body: { errors: [{ code: 'property_value', message: 'terminal_id is not valid.' }] },
    }));

    const serverError = await refusalFrom(() =>
      transportWith({ fetchImpl: server.impl }).createOrder(ORDER_INPUT),
    );
    expect(serverError.code).toBe('500');
    expect(serverError.retryable).toBe(true);
    expect(serverError.configuration).toBe(false);

    const ourBug = await refusalFrom(() =>
      transportWith({ fetchImpl: bug.impl }).createOrder(ORDER_INPUT),
    );
    // An unknown terminal id is a value WE sent wrong (§1.7): a blind retry would repeat
    // the same mistake, so the code is explicitly not retryable.
    expect(ourBug.code).toBe('property_value');
    expect(ourBug.retryable).toBe(false);
    expect(ourBug.configuration).toBe(false);
  });

  it('keeps the status when there is no envelope to read, and retries a 429 (note 01 §8)', async () => {
    const { impl } = stubFetch(() => ({ status: 429, raw: '<html>slow down</html>' }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    // Not JSON, so there is no code to trust; the status is the honest fallback. The note
    // publishes no Point rate limit at all, which is why a 429 must be expected and
    // retried under the same key.
    expect(error.code).toBe('MERCADO_PAGO_HTTP_429');
    expect(error.retryable).toBe(true);
    expect(error.configuration).toBe(false);
  });

  it('refuses to fabricate an order from a 2xx it cannot read', async () => {
    const { impl } = stubFetch(() => ({ status: 201, body: { id: null, status: null } }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).createOrder(ORDER_INPUT),
    );

    // An invented order id would be a lie the attempt record keeps forever, and an empty
    // status would reach the classifier as a status the vendor never sent.
    expect(error.code).toBe('MERCADO_PAGO_MALFORMED_RESPONSE');
    expect(error.status).toBe(201);
    expect(error.configuration).toBe(false);
  });
});

describe('readOrder — the snapshot, kept verbatim (note 01 §2)', () => {
  it('maps a processed order with its payment id, and nothing else about it', async () => {
    const processed = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'processed',
        transactions: {
          payments: [{ id: PAYMENT_ID, status: 'processed', status_detail: 'accredited' }],
        },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: processed.impl }).readOrder(
      ORDER_ID,
      MERCHANT_ID,
    );

    expect(processed.captured).toHaveLength(1);
    expect(processed.captured[0].url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}`);
    expect(processed.captured[0].method).toBe('GET');
    // A read changes nothing, so it carries no idempotency header — only the bearer.
    expect(processed.captured[0].headers['x-idempotency-key']).toBeUndefined();
    expect(processed.captured[0].headers['authorization']).toBe('Bearer test-token');
    // The payment's own detail wins over the order's (§2.2): that is where the card's
    // refusal reason lives.
    expect(snapshot).toEqual({
      orderId: ORDER_ID,
      status: 'processed',
      statusDetail: 'processed',
      paymentId: PAYMENT_ID,
      // This payment carries neither field, so both are the honest null (see the
      // paid_amount cases below for the tip that makes them matter).
      paidAmountMinorUnits: null,
      tipAmountMinorUnits: null,
      failureCode: 'accredited',
    });

    // The one shape that may become a capture: `processed` WITH a payment id (§8G step 3).
    const outcome = outcomeFromSnapshot(snapshot);
    expect(outcome.kind).toBe('succeeded');
    if (outcome.kind !== 'succeeded') throw new Error('processed with a payment id is a capture');
    expect(outcome.providerOrderId).toBe(ORDER_ID);
    expect(outcome.providerPaymentId).toBe(PAYMENT_ID);
  });

  it('reads paid_amount and tip_amount into minor units, because the tip raises the ceiling (plan §4 phase 4 step 3)', async () => {
    // The terminal can add a tip, so `paid_amount` (60.00) exceeds the 55.00 we asked for,
    // and it is what a refund must be measured against (note 01 §2.2).
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'processed',
        transactions: {
          payments: [
            {
              id: PAYMENT_ID,
              status: 'processed',
              status_detail: 'accredited',
              paid_amount: '60.00',
              tip_amount: '5.00',
            },
          ],
        },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).readOrder(ORDER_ID, MERCHANT_ID);

    // Both are STRINGS in the vendor's schema (§2.2), parsed the same way `amountFor` is
    // written in reverse — never through a float multiply.
    expect(snapshot.paidAmountMinorUnits).toBe(6000);
    expect(snapshot.tipAmountMinorUnits).toBe(500);
  });

  it('leaves paid_amount and tip_amount null when the vendor did not send them', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'processed',
        transactions: { payments: [{ id: PAYMENT_ID, status_detail: 'accredited' }] },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).readOrder(ORDER_ID, MERCHANT_ID);

    // "The vendor did not say" is not "zero": a reconciliation that read an absent field as
    // 0 would compute a ceiling that is wrong in the direction that blocks a real refund.
    expect(snapshot.paidAmountMinorUnits).toBeNull();
    expect(snapshot.tipAmountMinorUnits).toBeNull();
  });

  it('reads a refunded order as the capture it proves, not as a status nobody has seen', async () => {
    // Phase 4 step 2 of the Point plan. `refunded` is an ORDER status and
    // `partially_refunded` is an order DETAIL, and a snapshot that dropped the detail made
    // both land in the classifier's `default` branch — where a captured sale reads as
    // `unknown`, which is a question rather than the answer it is.
    const refunded = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'refunded',
        status_detail: 'refunded',
        transactions: {
          payments: [{ id: PAYMENT_ID, status: 'processed', status_detail: 'refunded' }],
        },
      },
    }));
    const partial = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'partially_refunded',
        transactions: {
          payments: [{ id: PAYMENT_ID, status: 'processed', status_detail: 'accredited' }],
        },
      },
    }));

    const refundedSnapshot = await transportWith({ fetchImpl: refunded.impl }).readOrder(
      ORDER_ID,
      MERCHANT_ID,
    );
    expect(refundedSnapshot.statusDetail).toBe('refunded');
    const refundedOutcome = outcomeFromSnapshot(refundedSnapshot);
    expect(refundedOutcome.kind).toBe('succeeded');
    if (refundedOutcome.kind !== 'succeeded') throw new Error('a refunded order was captured');
    expect(refundedOutcome.providerPaymentId).toBe(PAYMENT_ID);

    const partialSnapshot = await transportWith({ fetchImpl: partial.impl }).readOrder(
      ORDER_ID,
      MERCHANT_ID,
    );
    expect(partialSnapshot.statusDetail).toBe('partially_refunded');
    // The capture stands; the giving-back is its own attempt with its own amount.
    expect(outcomeFromSnapshot(partialSnapshot).kind).toBe('succeeded');
  });

  it('never reads action_required as a decline: it is terminal and it does not change', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'action_required',
        status_detail: 'action_required',
        transactions: { payments: [{ id: PAYMENT_ID, status_detail: 'check_on_terminal' }] },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).readOrder(ORDER_ID, MERCHANT_ID);

    expect(snapshot.status).toBe('action_required');
    const outcome = outcomeFromSnapshot(snapshot);
    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('action_required is neither a win nor a loss');
    expect(outcome.code).toBe('TERMINAL_ACTION_REQUIRED');
    // Still a question, and still worth asking again — never a settled state.
    expect(outcome.queryAfterSeconds).toBeGreaterThan(0);
  });

  it('throws the vendor code for a read the vendor refuses', async () => {
    const { impl } = stubFetch(() => ({
      status: 404,
      body: { errors: [{ code: 'order_not_found', message: 'Order not found.' }] },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).readOrder(ORDER_ID, MERCHANT_ID),
    );

    expect(error.code).toBe('order_not_found');
    expect(error.status).toBe(404);
    expect(error.retryable).toBe(false);
  });
});

describe('refundOrder — the two refund shapes, and never a guess (note 01 §4)', () => {
  const refundInput = (
    overrides: Partial<Parameters<MercadoPagoPointTransport['refundOrder']>[0]> = {},
  ) => ({
    orderId: ORDER_ID,
    merchantId: MERCHANT_ID,
    paymentId: PAYMENT_ID,
    amountMinorUnits: null,
    commandIdentity: COMMAND_IDENTITY,
    ...overrides,
  });

  it('sends a TOTAL refund with the documented headers and NO body', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 201,
      body: {
        id: ORDER_ID,
        status: 'refunded',
        status_detail: 'refunded',
        transactions: {
          refunds: [
            {
              id: REFUND_ID,
              transaction_id: PAYMENT_ID,
              reference_id: 'ref',
              amount: '5.00',
              status: 'refunded',
            },
          ],
        },
      },
    }));

    await transportWith({ fetchImpl: impl }).refundOrder(refundInput());

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}/refund`);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].headers['authorization']).toBe('Bearer test-token');
    expect(captured[0].headers['content-type']).toBe('application/json');
    // The SAME derivation as create-order with a different operation, so a retry of one
    // refund reuses one key and a second refund is a different key (plan D3, §7.4).
    expect(captured[0].headers['x-idempotency-key']).toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'refund_order'),
    );
    expect(captured[0].headers['x-idempotency-key']).not.toBe(
      pointIdempotencyKey(COMMAND_IDENTITY, 'create_order'),
    );
    // NO BODY AT ALL: "without sending a body in the request" (§4.2). The recorded text is
    // null because the request carried no body — the distinction the vendor documents.
    expect(captured[0].bodyText).toBeNull();
  });

  it('sends a PARTIAL refund with exactly the documented body and a two-decimal amount', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 201,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'partially_refunded',
        transactions: { refunds: [{ id: REFUND_ID, amount: '24.50', status: 'processed' }] },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).refundOrder(
      refundInput({ amountMinorUnits: 2450 }),
    );

    // The exact body §4.3 documents, with the amount as a string: 2450 minor units is
    // `"24.50"`, the same conversion `createOrder` uses, and nothing else is sent.
    expect(jsonOf(captured[0])).toEqual({
      transactions: [{ id: PAYMENT_ID, amount: '24.50' }],
    });
    expect(Object.keys(jsonOf(captured[0]))).toEqual(['transactions']);
    // The response maps the FIRST refund's id and amount, and keeps status/status_detail
    // verbatim — the snapshot invents no `refunded` boolean (§4.2, §4.3).
    expect(snapshot).toEqual({
      refundId: REFUND_ID,
      status: 'processed',
      statusDetail: 'partially_refunded',
      amountMinorUnits: 2450,
    });
  });

  it('refuses a partial refund with no payment id, and sends NOTHING', async () => {
    const { impl, captured } = stubFetch(() => ({ status: 201, body: {} }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).refundOrder(
        refundInput({ paymentId: null, amountMinorUnits: 2450 }),
      ),
    );

    // OUR bug, not the vendor's: the idempotency header would be spent on a request the
    // vendor can only refuse, so it is never sent (§4.3's `transactions[].id` rule).
    expect(error.code).toBe('MERCADO_PAGO_REFUND_NEEDS_PAYMENT');
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(false);
    expect(error.configuration).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it('reads 403 partial_refund_forbidden_with_tips from the nested envelope, and THROWS it', async () => {
    const { impl } = stubFetch(() => ({
      status: 403,
      body: {
        errors: [
          {
            code: 'partial_refund_forbidden_with_tips',
            message: 'Partial refunds are not allowed when the order has tips.',
          },
        ],
      },
    }));

    const error = await refusalFrom(() =>
      transportWith({ fetchImpl: impl }).refundOrder(refundInput({ amountMinorUnits: 2450 })),
    );

    expect(error).toBeInstanceOf(MercadoPagoPointError);
    expect(error.code).toBe('partial_refund_forbidden_with_tips');
    expect(error.status).toBe(403);
    // An answer about THIS refund: the order has a tip, so a partial refund is closed and
    // asking again changes nothing (§4.1, §4.4).
    expect(error.retryable).toBe(false);
    expect(error.configuration).toBe(false);
  });

  it('retries a 500 but not a 409 refund_period_exceeded (note 01 §4.4)', async () => {
    const server = stubFetch(() => ({
      status: 500,
      body: { errors: [{ code: '500', message: 'Generic error.' }] },
    }));
    const period = stubFetch(() => ({
      status: 409,
      body: {
        errors: [{ code: 'refund_period_exceeded', message: 'The 90-day window closed.' }],
      },
    }));

    const serverError = await refusalFrom(() =>
      transportWith({ fetchImpl: server.impl }).refundOrder(refundInput()),
    );
    expect(serverError.code).toBe('500');
    expect(serverError.retryable).toBe(true);
    expect(serverError.configuration).toBe(false);

    const periodError = await refusalFrom(() =>
      transportWith({ fetchImpl: period.impl }).refundOrder(refundInput()),
    );
    expect(periodError.code).toBe('refund_period_exceeded');
    expect(periodError.retryable).toBe(false);
    expect(periodError.configuration).toBe(false);
  });

  it('refuses to refund through the unconfigured transport, and says why', async () => {
    // The frozen interface: `UnconfiguredPointTransport.refundOrder` rejects with the same
    // `unavailableReason` its other two members use, so the provider's transport-throw
    // branch answers `unknown` rather than inventing a refund.
    await expect(
      new UnconfiguredPointTransport('missing MERCADO_PAGO_POINT_ACCESS_TOKEN').refundOrder(),
    ).rejects.toThrow('missing MERCADO_PAGO_POINT_ACCESS_TOKEN');
  });

  it('READS one refund back out of the order, by the vendor’s own id', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'partially_refunded',
        transactions: {
          refunds: [
            // TWO partial refunds on one order, which is documented and legal (§4.3). The one we
            // did NOT ask about comes FIRST, so an implementation that took the first entry — or
            // that matched on the amount — would answer with someone else's refund.
            { id: 'REF01OTHER00000000000000000000', amount: '5.00', status: 'refunded' },
            { id: REFUND_ID, transaction_id: PAYMENT_ID, amount: '5.00', status: 'refunded' },
          ],
        },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).readRefund(
      ORDER_ID,
      REFUND_ID,
      MERCHANT_ID,
    );

    // A READ, so nothing here can move money: GET, the Authorization header, and NO idempotency
    // key — that header belongs to the requests that change something (§1.1).
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`https://api.mercadopago.com/v1/orders/${ORDER_ID}`);
    expect(captured[0].method).toBe('GET');
    expect(captured[0].headers['authorization']).toBe('Bearer test-token');
    expect(captured[0].headers['x-idempotency-key']).toBeUndefined();
    expect(captured[0].bodyText).toBeNull();

    expect(snapshot?.refundId).toBe(REFUND_ID);
    // THE ENTRY'S OWN status and not the order's: the order says `processed`, the refund says
    // `refunded`, and the refund is what the question is about (§4.2 lists `status` per entry).
    expect(snapshot?.status).toBe('refunded');
    expect(snapshot?.amountMinorUnits).toBe(500);
  });

  it('answers null when the order does not list that refund — an answer, not a failure', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        transactions: { refunds: [{ id: 'REF01OTHER00000000000000000000', amount: '5.00' }] },
      },
    }));

    const snapshot = await transportWith({ fetchImpl: impl }).readRefund(
      ORDER_ID,
      REFUND_ID,
      MERCHANT_ID,
    );

    // "The vendor is not holding a refund of ours" is a fact about the café's money, and it is
    // not the same fact as "we could not find out" — which is why this is null and not a throw.
    expect(snapshot).toBeNull();
  });

  it('refuses to read a refund through the unconfigured transport, and says why', async () => {
    await expect(
      new UnconfiguredPointTransport('missing MERCADO_PAGO_POINT_ACCESS_TOKEN').readRefund(),
    ).rejects.toThrow('missing MERCADO_PAGO_POINT_ACCESS_TOKEN');
  });
});

describe('MercadoPagoPointProvider.refund — it maps, and it never guesses (plan §4 phase 4)', () => {
  const refundRequest = (
    overrides: Partial<ProviderRefundRequest> = {},
  ): ProviderRefundRequest => ({
    commandIdentity: COMMAND_IDENTITY,
    merchantId: MERCHANT_ID,
    providerOrderId: ORDER_ID,
    providerPaymentId: PAYMENT_ID,
    amountMinorUnits: null,
    correlationId: 'correlation-1',
    ...overrides,
  });

  it('turns a transport throw into unknown / PROVIDER_TRANSPORT_FAILURE, never a decline', async () => {
    const transport = transportWith({
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });

    const outcome = await new MercadoPagoPointProvider(transport).refund(refundRequest());

    // Our own network failure says nothing about the customer's money (note 01 §7.1).
    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('a transport throw is an unknown');
    expect(outcome.providerStatus).toBe('unreachable');
    expect(outcome.code).toBe('PROVIDER_TRANSPORT_FAILURE');
  });

  it('answers refunded only with a refund id, carrying the vendor amount', async () => {
    const { impl } = stubFetch(() => ({
      status: 201,
      body: {
        id: ORDER_ID,
        status: 'refunded',
        status_detail: 'refunded',
        transactions: { refunds: [{ id: REFUND_ID, amount: '5.00', status: 'refunded' }] },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(transportWith({ fetchImpl: impl })).refund(
      refundRequest(),
    );

    expect(outcome).toEqual({
      kind: 'refunded',
      providerStatus: 'refunded',
      providerRefundId: REFUND_ID,
      amountMinorUnits: 500,
    });
  });

  it('maps the vendor processing status to unknown, never to refunded', async () => {
    const { impl } = stubFetch(() => ({
      status: 201,
      body: {
        id: ORDER_ID,
        status: 'processing',
        status_detail: 'processing',
        transactions: { refunds: [{ id: REFUND_ID, amount: '24.50', status: 'processing' }] },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(transportWith({ fetchImpl: impl })).refund(
      refundRequest({ amountMinorUnits: 2450 }),
    );

    // The refund has been REQUESTED, not moved: the vendor's own reference calls this enum
    // value "successfully requested and is being processed" (§4.2), so it is a question.
    expect(outcome.kind).toBe('unknown');
    expect(outcome.providerStatus).toBe('processing');
    expect(outcome.kind).not.toBe('refunded');
    // AND THE VENDOR'S OWN ID COMES WITH THE QUESTION. It is the only way a later read can say
    // which entry of `transactions.refunds[]` is ours, and dropping it here is what used to make
    // a processing refund permanent (plan §14.2 D34).
    if (outcome.kind !== 'unknown') throw new Error('processing is a question');
    expect(outcome.providerRefundId).toBe(REFUND_ID);
  });

  it('refuses to call a settled status refunded when it carries no refund id', async () => {
    const { impl } = stubFetch(() => ({
      status: 201,
      body: { id: ORDER_ID, status: 'processed', status_detail: 'partially_refunded' },
    }));

    const outcome = await new MercadoPagoPointProvider(transportWith({ fetchImpl: impl })).refund(
      refundRequest({ amountMinorUnits: 2450 }),
    );

    // `processed` with no `transactions.refunds[]` is a word, not proof: the same rule that
    // makes a capture need its payment id (plan §8G step 3).
    expect(outcome.kind).toBe('unknown');
    expect(outcome.providerStatus).toBe('processed');
  });

  it('answers unknown without an order id, instead of throwing or calling the transport', async () => {
    const transport = transportWith({
      fetchImpl: () => {
        throw new Error('the transport must not be asked without an order id');
      },
    });

    const outcome = await new MercadoPagoPointProvider(transport).refund(
      refundRequest({ providerOrderId: null }),
    );

    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('an unknown order id is an unknown');
    expect(outcome.code).toBe('TERMINAL_ORDER_UNKNOWN');
    expect(outcome.providerStatus).toBe('no_order_on_terminal');
  });

  it('REFUSES to look up a refund it cannot name, rather than matching on an amount', async () => {
    const transport = transportWith({
      fetchImpl: () => {
        throw new Error('the transport must not be asked without a refund id');
      },
    });

    const outcome = await new MercadoPagoPointProvider(transport).refundQuery(
      // An `unknown` refund from before this pass carries no id, and an order can hold several
      // partial refunds — so "the entry of the right size" is a guess about money, and this
      // answers the question rather than guessing at it.
      refundRequest({ providerRefundId: null }),
    );

    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('an unattributable refund is an unknown');
    expect(outcome.code).toBe('TERMINAL_REFUND_UNATTRIBUTED');
    expect(outcome.providerRefundId).toBeNull();
  });

  it('CLOSES a processing refund once the order says the money moved', async () => {
    const { impl, captured } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        transactions: { refunds: [{ id: REFUND_ID, amount: '24.50', status: 'refunded' }] },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(
      transportWith({ fetchImpl: impl }),
    ).refundQuery(refundRequest({ providerRefundId: REFUND_ID }));

    // The question was ASKED BY READING, which is the whole safety argument: a repeated POST
    // would lean on the vendor's 24-hour idempotency window to avoid moving money twice.
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('GET');
    expect(outcome.kind).toBe('refunded');
    if (outcome.kind !== 'refunded') throw new Error('a refunded entry is a refund');
    expect(outcome.providerRefundId).toBe(REFUND_ID);
    expect(outcome.amountMinorUnits).toBe(2450);
  });

  it('keeps asking about a refund the vendor still has not finished', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        transactions: { refunds: [{ id: REFUND_ID, amount: '24.50', status: 'processing' }] },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(
      transportWith({ fetchImpl: impl }),
    ).refundQuery(refundRequest({ providerRefundId: REFUND_ID }));

    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('processing is not money that moved');
    // THE ID SURVIVES THE QUESTION, so the next notification asks again instead of the refund
    // staying unknown for good (plan §14.2 D34).
    expect(outcome.providerRefundId).toBe(REFUND_ID);
    expect(outcome.providerStatus).toBe('processing');
  });

  it('reports a refund the order does not list as unattributed, never as settled', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        transactions: { refunds: [{ id: 'REF01OTHER00000000000000000000', amount: '24.50' }] },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(
      transportWith({ fetchImpl: impl }),
    ).refundQuery(refundRequest({ providerRefundId: REFUND_ID }));

    expect(outcome.kind).toBe('unknown');
    if (outcome.kind !== 'unknown') throw new Error('an absent refund is not a settlement');
    expect(outcome.providerStatus).toBe('refund_absent');
    expect(outcome.code).toBe('TERMINAL_REFUND_UNATTRIBUTED');
  });
});

describe('the provider carries paid_amount and tip_amount onto the answer (plan §4 phase 4 step 3)', () => {
  it('a query whose order carries a tip returns the amounts in minor units', async () => {
    const { impl } = stubFetch(() => ({
      status: 200,
      body: {
        id: ORDER_ID,
        status: 'processed',
        status_detail: 'processed',
        transactions: {
          payments: [
            {
              id: PAYMENT_ID,
              status: 'processed',
              status_detail: 'accredited',
              paid_amount: '60.00',
              tip_amount: '5.00',
            },
          ],
        },
      },
    }));

    const outcome = await new MercadoPagoPointProvider(transportWith({ fetchImpl: impl })).query({
      commandIdentity: COMMAND_IDENTITY,
      merchantId: MERCHANT_ID,
      providerOrderId: ORDER_ID,
      providerPaymentId: PAYMENT_ID,
      amountMinorUnits: 5500,
      currency: 'MXN',
      correlationId: 'correlation-1',
    });

    expect(outcome.kind).toBe('succeeded');
    if (outcome.kind === 'declined') throw new Error('a processed order is a capture');
    // 60.00 in, 6000 out: the customer paid a tip, and this is the ceiling a refund has to
    // be measured against (§2.2).
    expect(outcome.paidAmountMinorUnits).toBe(6000);
    expect(outcome.tipAmountMinorUnits).toBe(500);
  });
});

describe('a transport problem is never a decline (note 01 §7.1)', () => {
  it('surfaces a rejected fetch as unreachable, and the provider as unknown', async () => {
    const transport = transportWith({
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
    });

    const error = await refusalFrom(() => transport.createOrder(ORDER_INPUT));

    expect(error.code).toBe('MERCADO_PAGO_UNREACHABLE');
    // No HTTP answer at all, so no status: 0 is the honest value (§7.1).
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
    expect(error.configuration).toBe(false);

    // The reason it matters, asserted end to end: the customer may already have paid, and
    // the provider must answer `unknown` rather than inventing a refusal.
    const outcome = await new MercadoPagoPointProvider(transport).capture({
      commandIdentity: COMMAND_IDENTITY,
      merchantId: MERCHANT_ID,
      amountMinorUnits: 500,
      currency: 'MXN',
      cartId: 'cart-42',
      locationId: 'location-1',
      tenderId: 'tender-1',
      correlationId: 'correlation-1',
    });
    expect(outcome.kind).toBe('unknown');
    expect(outcome.providerStatus).toBe('unreachable');
  });

  it('gives up at the timeout instead of holding the till request open', async () => {
    // A fetch that honours the abort signal the way the real one does — the timer, not
    // the socket, is what ends this call.
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    const error = await refusalFrom(() =>
      transportWith({ timeoutMs: 5, fetchImpl: hangingFetch }).createOrder(ORDER_INPUT),
    );

    // A timeout is the same failure as a dead socket: not a decline, and safe to retry
    // under the same idempotency key.
    expect(error.code).toBe('MERCADO_PAGO_UNREACHABLE');
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
    // The sentence says which budget ran out, and when we asked — the clock an operator
    // needs to line our request up with the vendor's own `created_date` (§2.2).
    expect(String(error.message)).toContain('within 5 ms');
    expect(String(error.message)).toContain(NOW.toISOString());
  });
});
