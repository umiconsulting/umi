import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppleWebServiceController } from './apple-web-service.controller';
import { WalletPassService } from './wallet-pass.service';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';

/**
 * THE PASSKIT CONTRACT — Apple's status codes, driven over real HTTP.
 *
 * Apple speaks HTTP and nothing else. What can break here is a status code or a
 * header, and neither is visible from a service test: `wallet-pass.service.spec.ts`
 * constructs the service directly with a mocked repository, so it proves the
 * service's logic and says nothing about what the wire sees. This file boots the
 * controller through the Fastify adapter and asserts the wire.
 *
 * It is a `.spec.ts` on purpose. `vitest run` matches `.spec.` and `.test.`, so
 * this runs inside the ordinary `pnpm --filter @umi/api test` gate on every pull
 * request — no database, no build-v3, no Postgres service container.
 *
 * THE SERVICE IS MOCKED, deliberately. The seam under test is the CONTROLLER:
 * the routing, the status codes, the headers, and the auth branch. What the
 * service does behind it is covered by wallet-pass.service.spec.ts and
 * wallet-carry.integration.ts.
 *
 * ⚠️ THE ROUTE SHAPE IS FROZEN. Every issued pass carries
 * `https://cash.umiconsulting.co/api/{handle}/passes/apple` as its
 * `webServiceURL`, signed in at issue time, and the copy on a customer's phone
 * can never change. A path edit here is a 404 on a real customer's phone that no
 * other test would see, so the paths below are written out in full rather than
 * built from a constant.
 */

const HANDLE = 'kalala';
const PASS_TYPE = 'pass.co.umicash.loyalty';
const SERIAL = 'SERIAL-1';
const TOKEN = 'the-immutable-token';
const DEVICE = 'DEVICE-1';
const MERCHANT = 'merchant-1';

const AUTHED_PASS = {
  walletPassId: 'wp-1',
  cardId: 'card-1',
  merchantId: MERCHANT,
  serialNumber: SERIAL,
  webServiceToken: TOKEN,
  cardUpdatedAt: new Date('2026-08-12T10:00:00Z'),
};

describe('AppleWebServiceController · the PassKit HTTP contract', () => {
  let app: NestFastifyApplication;

  const wallet = {
    isConfigured: vi.fn(() => true),
    authenticate: vi.fn(async (_serial: string, token: string) =>
      token === TOKEN ? AUTHED_PASS : null,
    ),
    registerDevice: vi.fn(async () => true),
    unregisterDevice: vi.fn(async () => undefined),
    serialsUpdatedSince: vi.fn(async (_handle: string, _deviceId: string, _since: Date) => [
      SERIAL,
    ]),
    merchantByHandle: vi.fn(async (_handle: string): Promise<{ id: string } | null> => ({
      id: MERCHANT,
    })),
    issuePass: vi.fn(async () => ({ buffer: Buffer.from('PK-ISSUE'), handle: HANDLE })),
    renderPass: vi.fn(async () => ({
      buffer: Buffer.from('PK-RENDER'),
      lastModified: new Date('2026-08-12T10:00:00Z'),
    })),
  };

  const customerToken = {
    fromHeader: vi.fn(async (header?: string) =>
      header === 'Bearer good' ? { subjectId: 'cust-1', merchantId: MERCHANT } : null,
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppleWebServiceController],
      providers: [
        { provide: WalletPassService, useValue: wallet },
        { provide: CustomerTokenService, useValue: customerToken },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  // Several cases queue a one-shot with `mockResolvedValueOnce`. If a case does
  // not consume its own queue, the value leaks into whichever test runs next and
  // the file becomes order-dependent — green today, red on a reorder, for a
  // reason that looks like a code defect. Reset every mock between cases.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const registrationPath = `/api/${HANDLE}/passes/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}/${SERIAL}`;

  // ── register ─────────────────────────────────────────────────────────────
  it('register · 201 the first time', async () => {
    wallet.registerDevice.mockResolvedValueOnce(true);
    const res = await app.inject({
      method: 'POST',
      url: registrationPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
      payload: { pushToken: 'push-1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('register · 200 when the device is already registered', async () => {
    wallet.registerDevice.mockResolvedValueOnce(false);
    const res = await app.inject({
      method: 'POST',
      url: registrationPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
      payload: { pushToken: 'push-1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('register · 401 with the wrong token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: registrationPath,
      headers: { authorization: 'ApplePass not-the-token' },
      payload: { pushToken: 'push-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('register · 401 when the scheme is not ApplePass', async () => {
    const res = await app.inject({
      method: 'POST',
      url: registrationPath,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { pushToken: 'push-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('register · 400 without a pushToken', async () => {
    const res = await app.inject({
      method: 'POST',
      url: registrationPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── unregister ───────────────────────────────────────────────────────────
  it('unregister · 200, and the device is forgotten', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: registrationPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(wallet.unregisterDevice).toHaveBeenCalledWith(AUTHED_PASS.walletPassId, DEVICE);
  });

  it('unregister · 401 with the wrong token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: registrationPath,
      headers: { authorization: 'ApplePass nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── the change list ──────────────────────────────────────────────────────
  const listPath = `/api/${HANDLE}/passes/apple/v1/devices/${DEVICE}/registrations/${PASS_TYPE}`;

  it('change list · 200 with serials when something changed', async () => {
    const res = await app.inject({ method: 'GET', url: listPath });
    expect(res.statusCode).toBe(200);
    const body: { serialNumbers: string[]; lastUpdated: string } = res.json();
    expect(body.serialNumbers).toEqual([SERIAL]);
    // Apple replays lastUpdated on the NEXT poll, so it must be a unix SECOND
    // count it can hand back. `expect.any(String)` would pass on any string at
    // all, including one this route could never produce.
    expect(body.lastUpdated).toMatch(/^\d{10}$/);
  });

  it('change list · 204 when nothing changed — an empty 200 is an error to Apple', async () => {
    wallet.serialsUpdatedSince.mockResolvedValueOnce([]);
    const res = await app.inject({ method: 'GET', url: listPath });
    expect(res.statusCode).toBe(204);
  });

  it('change list · passesUpdatedSince is respected, in unix SECONDS', async () => {
    wallet.serialsUpdatedSince.mockClear();
    await app.inject({ method: 'GET', url: `${listPath}?passesUpdatedSince=1755000000` });
    const since = wallet.serialsUpdatedSince.mock.calls[0][2];
    // A LITERAL instant, not `new Date(1755000000 * 1000)`. Recomputing the
    // controller's own arithmetic here would agree with it however wrong it was.
    expect(since.toISOString()).toBe('2025-08-12T12:00:00.000Z');
  });

  it('change list · a junk passesUpdatedSince falls back to the epoch, not NaN', async () => {
    wallet.serialsUpdatedSince.mockClear();
    await app.inject({ method: 'GET', url: `${listPath}?passesUpdatedSince=banana` });
    const since = wallet.serialsUpdatedSince.mock.calls[0][2];
    expect(since.getTime()).toBe(0);
  });

  // ── download ─────────────────────────────────────────────────────────────
  const passPath = `/api/${HANDLE}/passes/apple/v1/passes/${PASS_TYPE}/${SERIAL}`;

  it('download · 200 with the pkpass content type and Last-Modified', async () => {
    const res = await app.inject({
      method: 'GET',
      url: passPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(res.headers['last-modified']).toBeDefined();
    // A cached .pkpass is a stale stamp count.
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('download · 401 with the wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: passPath,
      headers: { authorization: 'ApplePass nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('download · 500 when Apple Wallet is not configured', async () => {
    wallet.isConfigured.mockReturnValueOnce(false);
    const res = await app.inject({
      method: 'GET',
      url: passPath,
      headers: { authorization: `ApplePass ${TOKEN}` },
    });
    // ⚠️ 500 here and 503 on issue, for the SAME condition. The drift is real
    // and recorded in work item 26; this test pins today's behaviour so a fix
    // is a deliberate change rather than an accident.
    expect(res.statusCode).toBe(500);
  });

  // ── issue (the one route a person calls) ─────────────────────────────────
  const issuePath = `/api/${HANDLE}/passes/apple`;

  it('issue · 200 with the pkpass for a signed-in customer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: issuePath,
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.apple.pkpass');
    expect(res.headers['content-disposition']).toContain(`${HANDLE}.pkpass`);
  });

  it('issue · 401 without a customer session', async () => {
    const res = await app.inject({ method: 'GET', url: issuePath });
    expect(res.statusCode).toBe(401);
  });

  it('issue · 503 when Apple Wallet is not configured', async () => {
    wallet.isConfigured.mockReturnValueOnce(false);
    const res = await app.inject({
      method: 'GET',
      url: issuePath,
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(503);
  });

  it('issue · 404 for a handle that does not exist', async () => {
    wallet.merchantByHandle.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'GET',
      url: issuePath,
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('issue · 403 when the session belongs to a different cafe', async () => {
    // THE CROSS-CAFE PROTECTION. The handle is in the caller's control, so a
    // customer of café A must not download a pass from café B by editing a URL.
    wallet.merchantByHandle.mockResolvedValueOnce({ id: 'a-different-merchant' });
    const res = await app.inject({
      method: 'GET',
      url: issuePath,
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Apple's device log ───────────────────────────────────────────────────
  it('device log · 200 always — Apple must never receive an error for a log line', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/${HANDLE}/passes/apple/v1/log`,
      payload: { logs: ['pass rejected', 'retrying'] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('device log · 200 with an empty body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/${HANDLE}/passes/apple/v1/log`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });
});
