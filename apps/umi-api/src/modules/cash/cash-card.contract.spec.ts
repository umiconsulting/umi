import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashCardController } from './cash-card.controller';
import { CashCardService } from './cash-card.service';
import { CustomerAuthGuard } from '../auth/customer-auth.guard';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { AuthRepository } from '../auth/auth.repository';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';

/**
 * THE CUSTOMER CARD OVER REAL HTTP.
 *
 * What can break on these two routes is the guard CHAIN, and no service test can
 * see it: `cash-card.service.spec.ts` constructs the service directly, so it
 * proves the shape of the answer and says nothing about who is allowed to ask.
 * This file boots both guards through Fastify and asks over the wire.
 *
 * The `no-store` header is here for the same reason — it exists only on the
 * response, so only a response can prove it.
 *
 * A `.spec.ts` on purpose: no database, so it runs in the ordinary test gate on
 * every pull request.
 */

const MERCHANT = 'merchant-1';
const HANDLE = 'kalala';

describe('CashCardController · the customer card contract', () => {
  let app: NestFastifyApplication;

  const cards = {
    card: vi.fn(async () => ({ cardId: 'card-1', cardNumber: 'KAL-1' })),
    qr: vi.fn(async () => ({
      payload: 'jwt',
      dataUrl: 'data:image/png;base64,AA',
      expiresAt: 'x',
    })),
  };

  const authRepo = {
    merchantById: vi.fn(async () => null),
    merchantByHandle: vi.fn(async (h: string) =>
      h === HANDLE ? { id: MERCHANT, name: 'Kalala Café', handle: HANDLE } : null,
    ),
  };

  // `Bearer mine` belongs to this café; `Bearer theirs` is a perfectly valid
  // session at a DIFFERENT café — the case the guard exists to refuse.
  const customerToken = {
    fromHeader: vi.fn(async (header?: string) => {
      // `role` is not decoration: `CustomerAuthGuard` refuses anything that is not
      // a CUSTOMER, because the same key signs the barista's token too.
      if (header === 'Bearer mine')
        return { subjectId: 'cust-1', merchantId: MERCHANT, role: 'CUSTOMER' };
      if (header === 'Bearer theirs')
        return { subjectId: 'cust-9', merchantId: 'other-cafe', role: 'CUSTOMER' };
      return null;
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CashCardController],
      providers: [
        PublicMerchantGuard,
        CustomerAuthGuard,
        { provide: CashCardService, useValue: cards },
        { provide: AuthRepository, useValue: authRepo },
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const get = (path: string, authorization?: string) =>
    app.inject({
      method: 'GET',
      url: path,
      headers: authorization ? { authorization } : {},
    });

  it('card · 200 for the customer this café issued the session to', async () => {
    const res = await get(`/api/${HANDLE}/card`, 'Bearer mine');

    expect(res.statusCode).toBe(200);
    expect(cards.card).toHaveBeenCalledWith(MERCHANT, 'cust-1', 'Kalala Café');
  });

  it('card · 401 with no token', async () => {
    const res = await get(`/api/${HANDLE}/card`);

    expect(res.statusCode).toBe(401);
    expect(cards.card).not.toHaveBeenCalled();
  });

  it('card · 403 for a valid session at another café', async () => {
    const res = await get(`/api/${HANDLE}/card`, 'Bearer theirs');

    expect(res.statusCode).toBe(403);
    expect(cards.card).not.toHaveBeenCalled();
  });

  it('card · 404 for a café that does not exist, before any token is read', async () => {
    const res = await get('/api/nosuchcafe/card', 'Bearer mine');

    expect(res.statusCode).toBe(404);
    expect(customerToken.fromHeader).not.toHaveBeenCalled();
  });

  it('qr · 200 and never cached', async () => {
    const res = await get(`/api/${HANDLE}/card/qr`, 'Bearer mine');

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(cards.qr).toHaveBeenCalledWith(MERCHANT, 'cust-1');
  });

  it('qr · 403 for a valid session at another café', async () => {
    const res = await get(`/api/${HANDLE}/card/qr`, 'Bearer theirs');

    expect(res.statusCode).toBe(403);
    expect(cards.qr).not.toHaveBeenCalled();
  });
});
