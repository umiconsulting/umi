import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantAccess } from '../auth/auth.types';
import { PointTerminalClient, PointTerminalClientError } from './point-terminal.client';
import { PointTerminalService } from './point-terminal.service';
import type { PointTerminalBinding } from './point-terminal.repository';

/**
 * THE TERMINAL SURFACE, WITH NO NETWORK, NO DATABASE AND NO CLOCK OF ITS OWN.
 *
 * Two things are asserted here and they belong together. The CLIENT's cases check the bytes the
 * vendor receives — the query it is asked with, the body `PATCH /terminals/v1/setup` carries,
 * the header `POST /v2/pos` requires — because "we send this" is a claim about the wire and only
 * a recorded request proves it. The SERVICE's cases check the decisions that are ours: which
 * refusals carry which names, that the vendor's list is the authority for ownership, that a row
 * whose terminal left the account does not reach the screen, and that nothing is written when
 * the account refuses.
 *
 * THE FETCH IS STUBBED GLOBALLY rather than injected, on purpose: `PointTerminalService` builds
 * its client in its own constructor (the module has no factory to hang a seam on), so a stub on
 * `globalThis.fetch` is what proves the default wiring works — the client's `fetchImpl` default
 * reads the global at CALL time, and a client that had captured it at construction would fail
 * every case below.
 */

const BASE = 'https://api.mercadopago.test';
const MERCHANT = '11111111-1111-4111-8111-111111111111';
const OTHER_MERCHANT = '22222222-2222-4222-8222-222222222222';
const DEVICE = '33333333-3333-4333-8333-333333333333';
const OTHER_DEVICE = '66666666-6666-4666-8666-666666666666';
const LOCATION = '44444444-4444-4444-8444-444444444444';
/** The merchant's OWN token, with a shape that would be obvious if it ever reached a message. */
const TOKEN = 'APP_USR-2040479802223096-091712-abcdefabcdef-123456789';
const TERMINAL = 'NEWLAND_N950__N950NCB801293324';
const SECOND_TERMINAL = 'PAX_A910__SMARTPOS1234345545';
const STALE_TERMINAL = 'NEWLAND_N950__SBK0000001';
const STORE = '87482378';
const POS = '138301467';

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

interface Route {
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly body?: unknown;
}

/** A `fetch` that answers canned routes and records everything it was asked to send. */
function stubFetch(routes: Route[]): { requests: RecordedRequest[]; install: () => void } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    requests.push({
      url,
      method,
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const route = routes.find((candidate) => {
      const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
      return candidate.method === method && path.split('?')[0] === candidate.path;
    });
    if (route === undefined) throw new Error(`no stub route for ${method} ${url}`);
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { requests, install: () => vi.stubGlobal('fetch', fetchImpl) };
}

/** The vendor's list answer, in the documented `{data:{terminals:[]}}` shape (note 01 section 5.1). */
function listAnswer(
  terminals: {
    id: string;
    operating_mode: string;
    store_id?: string | number | null;
    pos_id?: string | number | null;
  }[],
): Route {
  return {
    method: 'GET',
    path: '/terminals/v1/list',
    body: { data: { terminals }, paging: { total: terminals.length, limit: 50, offset: 0 } },
  };
}

const ACCESS: MerchantAccess = {
  merchantId: MERCHANT,
  handle: 'kalala',
  name: 'Kalala',
  timezone: 'America/Mazatlan',
  membershipId: '55555555-5555-4555-8555-555555555555',
  role: 'owner',
  roles: ['owner'],
  permissions: ['location.switch'],
  locationId: null,
};

function binding(overrides: Partial<PointTerminalBinding> = {}): PointTerminalBinding {
  return {
    deviceId: DEVICE,
    locationId: LOCATION,
    terminalId: TERMINAL,
    storeId: null,
    posId: null,
    operatingMode: 'PDV',
    ...overrides,
  };
}

/**
 * The service with stubs for the two repositories and a real client whose `fetch` is the
 * global stub above — so the HTTP layer under test is the real one.
 */
function makeService(options: {
  credential: { accessToken: string } | null;
  bindings?: PointTerminalBinding[];
  found?: PointTerminalBinding | null;
  storeId?: string | null;
  bound?: PointTerminalBinding;
  released?: PointTerminalBinding | null;
}) {
  const credentials = {
    readForMerchant: vi.fn().mockResolvedValue(
      options.credential === null
        ? null
        : {
            merchantId: MERCHANT,
            mpUserId: '3696430142',
            accessToken: options.credential.accessToken,
            refreshToken: null,
            expiresAt: null,
          },
    ),
  };
  const terminals = {
    list: vi.fn().mockResolvedValue(options.bindings ?? []),
    find: vi.fn().mockResolvedValue(options.found ?? null),
    merchantStoreId: vi.fn().mockResolvedValue(options.storeId ?? null),
    bind: vi.fn().mockResolvedValue(options.bound ?? binding()),
    unbind: vi.fn().mockResolvedValue(options.released ?? null),
  };
  const config = { get: vi.fn().mockReturnValue(BASE) };
  const service = new PointTerminalService(
    credentials as never,
    terminals as never,
    config as never,
  );
  return { service, credentials, terminals };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PointTerminalService.list', () => {
  it('projects over the vendor list, joins our binding, and drops a row the account no longer lists', async () => {
    const { requests, install } = stubFetch([
      listAnswer([
        { id: TERMINAL, operating_mode: 'PDV', store_id: STORE, pos_id: POS },
        { id: SECOND_TERMINAL, operating_mode: 'UNDEFINED' },
      ]),
    ]);
    install();
    const { service } = makeService({
      credential: { accessToken: TOKEN },
      // One row for a terminal the account still lists, and one for a terminal it does not.
      bindings: [
        binding({ storeId: 'stale-store', posId: 'stale-pos' }),
        binding({
          terminalId: STALE_TERMINAL,
          deviceId: OTHER_DEVICE,
          operatingMode: 'STANDALONE',
        }),
      ],
    });

    const answer = await service.list(ACCESS, MERCHANT);

    // The vendor's array is the projection: two entries in, two out, and the stale row is gone.
    expect(answer.terminals).toEqual([
      {
        terminalId: TERMINAL,
        operatingMode: 'PDV',
        deviceId: DEVICE,
        locationId: LOCATION,
        // The account's store and point of sale win over the ones our row remembers.
        storeId: STORE,
        posId: POS,
      },
      {
        terminalId: SECOND_TERMINAL,
        // UNDEFINED is "not recognized", and an unbound terminal is STANDALONE to the vendor.
        operatingMode: 'STANDALONE',
        deviceId: null,
        locationId: null,
        storeId: null,
        posId: null,
      },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${BASE}/terminals/v1/list?limit=50&offset=0`);
    expect(requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('refuses with MP_POINT_CREDENTIAL_ABSENT and asks the vendor nothing when the cafe is not connected', async () => {
    const { requests, install } = stubFetch([]);
    install();
    const { service, terminals } = makeService({ credential: null });

    const error = await service.list(ACCESS, MERCHANT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_CREDENTIAL_ABSENT',
    });
    expect(requests).toHaveLength(0);
    expect(terminals.list).not.toHaveBeenCalled();
  });

  it('refuses a path merchant id that is not the caller membership', async () => {
    const { requests, install } = stubFetch([]);
    install();
    const { service } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service.list(ACCESS, OTHER_MERCHANT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toEqual({
      code: 'MERCHANT_SCOPE_MISMATCH',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('PointTerminalService.bind', () => {
  it('refuses a terminal that is not in the account own list, before writing anything', async () => {
    const { requests, install } = stubFetch([
      listAnswer([{ id: SECOND_TERMINAL, operating_mode: 'STANDALONE' }]),
    ]);
    install();
    const { service, terminals } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service
      .bind(ACCESS, MERCHANT, TERMINAL, {
        deviceId: DEVICE,
        locationId: LOCATION,
        terminalId: TERMINAL,
        operatingMode: 'PDV',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_TERMINAL_UNKNOWN',
    });
    // The list was asked; nothing else was, and no row was written.
    expect(requests.map((request) => `${request.method} ${request.url.split('?')[0]}`)).toEqual([
      `GET ${BASE}/terminals/v1/list`,
    ]);
    expect(terminals.bind).not.toHaveBeenCalled();
  });

  it('creates the point of sale, sets PDV with the merchant token, and stores the mode the vendor confirmed', async () => {
    const { requests, install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'STANDALONE' }]),
      { method: 'POST', path: '/v2/pos', status: 201, body: { id: Number(POS) } },
      {
        method: 'PATCH',
        path: '/terminals/v1/setup',
        body: { terminals: [{ id: TERMINAL, operating_mode: 'PDV' }] },
      },
    ]);
    install();
    const stored = binding({ storeId: STORE, posId: POS, operatingMode: 'PDV' });
    const { service, terminals } = makeService({
      credential: { accessToken: TOKEN },
      // The terminal has no store of its own, but this cafe already has one.
      storeId: STORE,
      bound: stored,
    });

    const answer = await service.bind(ACCESS, MERCHANT, TERMINAL, {
      deviceId: DEVICE,
      locationId: LOCATION,
      terminalId: TERMINAL,
      operatingMode: 'PDV',
    });

    // The point of sale: the merchant's store, our own trivially-valid external id, and the key.
    const posRequest = requests.find((request) => request.url.endsWith('/v2/pos'));
    expect(posRequest?.method).toBe('POST');
    expect(JSON.parse(posRequest?.body ?? '{}')).toEqual({
      store_id: STORE,
      external_id: DEVICE.replace(/-/gu, ''),
    });
    expect(posRequest?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(posRequest?.headers['x-idempotency-key']).toMatch(/^[0-9a-f-]{36}$/u);

    // The mode switch: the reference's own body, with the merchant's token and nothing else.
    const setupRequest = requests.find((request) => request.url.endsWith('/terminals/v1/setup'));
    expect(setupRequest?.method).toBe('PATCH');
    expect(JSON.parse(setupRequest?.body ?? '{}')).toEqual({
      terminals: [{ id: TERMINAL, operating_mode: 'PDV' }],
    });
    expect(setupRequest?.headers.authorization).toBe(`Bearer ${TOKEN}`);

    // The row: written last, with the vendor's confirmed mode and the ids the account holds.
    expect(terminals.bind).toHaveBeenCalledTimes(1);
    expect(terminals.bind).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      locationId: LOCATION,
      deviceId: DEVICE,
      terminalId: TERMINAL,
      storeId: STORE,
      posId: POS,
      operatingMode: 'PDV',
    });
    expect(answer).toEqual({
      terminalId: TERMINAL,
      operatingMode: 'PDV',
      deviceId: DEVICE,
      locationId: LOCATION,
      storeId: STORE,
      posId: POS,
    });
  });

  it('refuses PDV with MP_POINT_STORE_REQUIRED when no store exists anywhere, and creates nothing', async () => {
    const { requests, install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'STANDALONE' }]),
    ]);
    install();
    const { service, terminals } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service
      .bind(ACCESS, MERCHANT, TERMINAL, {
        deviceId: DEVICE,
        locationId: LOCATION,
        terminalId: TERMINAL,
        operatingMode: 'PDV',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_STORE_REQUIRED',
      details: { terminalId: TERMINAL },
    });
    expect(requests.map((request) => request.method)).toEqual(['GET']);
    expect(terminals.bind).not.toHaveBeenCalled();
  });

  it('lets a STANDALONE switch through without a store, a point of sale or any creation', async () => {
    const { requests, install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'PDV', store_id: STORE, pos_id: POS }]),
      {
        method: 'PATCH',
        path: '/terminals/v1/setup',
        body: { terminals: [{ id: TERMINAL, operating_mode: 'STANDALONE' }] },
      },
    ]);
    install();
    const { service, terminals } = makeService({
      credential: { accessToken: TOKEN },
      bound: binding({ storeId: STORE, posId: POS, operatingMode: 'STANDALONE' }),
    });

    await service.bind(ACCESS, MERCHANT, TERMINAL, {
      deviceId: DEVICE,
      locationId: LOCATION,
      terminalId: TERMINAL,
      operatingMode: 'STANDALONE',
    });

    expect(requests.map((request) => `${request.method} ${request.url.split('?')[0]}`)).toEqual([
      `GET ${BASE}/terminals/v1/list`,
      `PATCH ${BASE}/terminals/v1/setup`,
    ]);
    expect(terminals.bind).toHaveBeenCalledWith(
      expect.objectContaining({ operatingMode: 'STANDALONE', posId: POS }),
    );
  });

  it('turns the vendor own store_pos_not_found refusal into the named MP_POINT_STORE_REQUIRED', async () => {
    const { install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'STANDALONE', store_id: STORE }]),
      { method: 'POST', path: '/v2/pos', status: 201, body: { id: POS } },
      {
        method: 'PATCH',
        path: '/terminals/v1/setup',
        status: 403,
        body: { errors: [{ code: 'store_pos_not_found' }] },
      },
    ]);
    install();
    const { service, terminals } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service
      .bind(ACCESS, MERCHANT, TERMINAL, {
        deviceId: DEVICE,
        locationId: LOCATION,
        terminalId: TERMINAL,
        operatingMode: 'PDV',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_STORE_REQUIRED',
      details: { vendorCode: 'store_pos_not_found' },
    });
    // The account refused the mode, so no row claims it.
    expect(terminals.bind).not.toHaveBeenCalled();
  });

  it('refuses a path and body that name two different terminals', async () => {
    const { requests, install } = stubFetch([]);
    install();
    const { service } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service
      .bind(ACCESS, MERCHANT, SECOND_TERMINAL, {
        deviceId: DEVICE,
        locationId: LOCATION,
        terminalId: TERMINAL,
        operatingMode: 'PDV',
      })
      .catch((caught: unknown) => caught);

    expect((error as ConflictException).getResponse()).toEqual({
      code: 'VALIDATION_FAILED',
      field: 'terminalId',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('PointTerminalService.unbind', () => {
  it('releases the binding and answers with the terminal as the account still reports it', async () => {
    const { requests, install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'PDV', store_id: STORE, pos_id: POS }]),
    ]);
    install();
    const { service, terminals } = makeService({
      credential: { accessToken: TOKEN },
      released: binding({ storeId: STORE, posId: POS, operatingMode: 'PDV' }),
    });

    const answer = await service.unbind(ACCESS, MERCHANT, TERMINAL);

    expect(answer).toEqual({
      terminalId: TERMINAL,
      operatingMode: 'PDV',
      deviceId: null,
      locationId: null,
      storeId: STORE,
      posId: POS,
    });
    expect(terminals.unbind).toHaveBeenCalledWith(MERCHANT, TERMINAL);
    // The account's mode is not switched by a register giving the terminal up.
    expect(requests.map((request) => request.method)).toEqual(['GET']);
  });

  it('is idempotent: a second release answers the same shape with the account ids alone', async () => {
    const { install } = stubFetch([
      listAnswer([{ id: TERMINAL, operating_mode: 'PDV', store_id: STORE, pos_id: POS }]),
    ]);
    install();
    const { service } = makeService({ credential: { accessToken: TOKEN }, released: null });

    const answer = await service.unbind(ACCESS, MERCHANT, TERMINAL);

    expect(answer).toEqual({
      terminalId: TERMINAL,
      operatingMode: 'PDV',
      deviceId: null,
      locationId: null,
      storeId: STORE,
      posId: POS,
    });
  });

  it('refuses MP_POINT_TERMINAL_UNKNOWN rather than agreeing with a terminal the account lacks', async () => {
    const { install } = stubFetch([listAnswer([])]);
    install();
    const { service, terminals } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service
      .unbind(ACCESS, MERCHANT, TERMINAL)
      .catch((caught: unknown) => caught);

    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_TERMINAL_UNKNOWN',
    });
    expect(terminals.unbind).not.toHaveBeenCalled();
  });
});

describe('PointTerminalClient', () => {
  it('never puts the merchant token into a message, even when the transport echoes it', async () => {
    const leaky = async (): Promise<Response> => {
      throw new Error(`connect ECONNREFUSED with Authorization: Bearer ${TOKEN}`);
    };
    const client = new PointTerminalClient({ baseUrl: BASE, fetchImpl: leaky });

    const error = await client.listTerminals(TOKEN).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PointTerminalClientError);
    expect((error as PointTerminalClientError).message).not.toContain(TOKEN);
    expect((error as PointTerminalClientError).message).toContain('[redacted]');
  });

  it('reports a dead socket as a retryable unreachable, never as a terminal the cafe lacks', async () => {
    const deadSocket = async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    };
    const client = new PointTerminalClient({ baseUrl: BASE, fetchImpl: deadSocket });

    const error = await client.listTerminals(TOKEN).catch((caught: unknown) => caught);

    expect((error as { code?: string }).code).toBe('MERCADO_PAGO_TERMINAL_UNREACHABLE');
    expect((error as { retryable?: boolean }).retryable).toBe(true);
    expect((error as { status?: number }).status).toBe(0);
  });

  it('answers a network failure through the service as a 503 with the contract code', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const { service } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service.list(ACCESS, MERCHANT).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'MP_POINT_TERMINAL_UNAVAILABLE',
      details: { vendorCode: 'MERCADO_PAGO_TERMINAL_UNREACHABLE', status: 0 },
    });
  });
});

describe('PointTerminalService.createStore', () => {
  const ADDRESS = {
    name: 'Kalala',
    streetName: 'Obregon',
    streetNumber: '1234',
    cityName: 'Culiacan',
    stateName: 'Sinaloa',
    latitude: 24.8091,
    longitude: -107.394,
    reference: 'Frente a la plaza',
  };

  it('creates the store under the MERCHANT’s own user id, with the address the operator typed', async () => {
    const { requests, install } = stubFetch([
      { method: 'POST', path: `/users/3696430142/stores`, status: 201, body: { id: STORE } },
    ]);
    install();
    const { service } = makeService({ credential: { accessToken: TOKEN } });

    const store = await service.createStore(ACCESS, MERCHANT, ADDRESS);

    const request = requests[0];
    // THE ACCOUNT THE STORE BELONGS TO IS THE CAFÉ'S, not this deployment's: the `user_id` in the
    // path comes from the OAuth answer, and the vendor's own refusal for a mismatch says the two
    // must agree.
    expect(request.url).toBe(`${BASE}/users/3696430142/stores`);
    expect(request.method).toBe('POST');
    expect(request.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(request.body ?? '{}')).toEqual({
      name: ADDRESS.name,
      // DERIVED FROM THE MERCHANT, so a retry proposes the same id and the vendor's uniqueness
      // rule makes the second attempt a refusal rather than a second store.
      external_id: `umi${MERCHANT.replace(/-/gu, '')}`,
      location: {
        street_name: 'Obregon',
        street_number: '1234',
        city_name: 'Culiacan',
        state_name: 'Sinaloa',
        latitude: 24.8091,
        longitude: -107.394,
        reference: 'Frente a la plaza',
      },
    });
    expect(store).toEqual({
      storeId: STORE,
      name: 'Kalala',
      externalId: `umi${MERCHANT.replace(/-/gu, '')}`,
    });
  });

  it('refuses — and asks the vendor nothing — when the café has not connected an account', async () => {
    const { requests, install } = stubFetch([]);
    install();
    const { service } = makeService({ credential: null });

    const error = await service.createStore(ACCESS, MERCHANT, ADDRESS).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_CREDENTIAL_ABSENT',
    });
    expect(requests).toHaveLength(0);
  });

  it('names a refused store with the STORE’s code, carrying the vendor’s own on it', async () => {
    // The city catalogue is closed and accented: `Culiacan` is the refusal the vendor documents,
    // and its answer lists the valid names. What matters here is that the code the console reads
    // names the STORE — a refusal reported as a terminal failure would send the operator to the
    // wrong screen, where there is no terminal involved at all.
    const { install } = stubFetch([
      {
        method: 'POST',
        path: `/users/3696430142/stores`,
        status: 400,
        body: { errors: [{ code: 'invalid_city', message: 'Culiacan' }] },
      },
    ]);
    install();
    const { service } = makeService({ credential: { accessToken: TOKEN } });

    const error = await service.createStore(ACCESS, MERCHANT, ADDRESS).catch((c: unknown) => c);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      code: 'MP_POINT_STORE_REFUSED',
      details: { vendorCode: 'invalid_city', status: 400 },
    });
  });
});
