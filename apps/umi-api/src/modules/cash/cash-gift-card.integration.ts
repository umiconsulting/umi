import { createHash, randomUUID } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { ClassValidationPipe } from '../../shared/http/class-validation.pipe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { getRequestContext, runWithRequestContext } from '../../shared/database/request-context';
import { RequestContextMiddleware } from '../../shared/database/request-context.middleware';
import type { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { AuthGuard } from '../auth/auth.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { PublicMerchantGuard } from '../auth/public-merchant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CashCustomerController } from './cash-customer.controller';
import { CashRegisterService } from './cash-register.service';
import { CashWriteController } from './cash-write.controller';
import { CashWriteService } from './cash-write.service';
import { CashWriteRepository, GiftCardAlreadyRedeemedError } from './cash-write.repository';

/**
 * The Gift Card flow runs against a real Build v3 database.
 *
 * PREPARE proves that a column exists. It cannot prove that `reason='load'` passes
 * the CHECK, that the clear bearer code is absent, or that two redemptions serialize.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = randomUUID();
const CUSTOMER = randomUUID();
const CARD = randomUUID();
const USER = randomUUID();
const ROLE = randomUUID();
const STAFF = randomUUID();
const RUN = MERCHANT.slice(0, 8);

describe('cash Gift Card · one bearer value, one redemption', () => {
  let pg: PgService;
  let repo: CashWriteRepository;
  let service: CashWriteService;
  let app: NestFastifyApplication;
  const refreshCard = vi.fn(async () => undefined);

  const asMerchant = <T>(work: () => Promise<T>) =>
    runWithRequestContext(
      { merchantId: MERCHANT, userId: USER, requestId: 'gift-card-harness' },
      work,
    );

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new CashWriteRepository(pg);
    service = new CashWriteService(repo, { refreshCard } as unknown as WalletPassAdapter);

    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle)
       VALUES ($1::uuid, 'Gift Test', $2)`,
      [MERCHANT, `gifttest-${RUN}`],
    );
    await pg.query(`INSERT INTO umi.role (id, key, name) VALUES ($1::uuid, $2, 'Staff')`, [
      ROLE,
      `gift_harness_staff_${RUN}`,
    ]);
    await pg.query(`INSERT INTO umi."user" (id, full_name) VALUES ($1::uuid, 'Barista')`, [USER]);
    await pg.query(
      `INSERT INTO merchant.staff (id, merchant_id, user_id, role_id, name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'Barista')`,
      [STAFF, MERCHANT, USER, ROLE],
    );
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name)
       VALUES ($1::uuid, $2::uuid, 'Ana')`,
      [CUSTOMER, MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.loyalty_card (id, merchant_id, customer_id, card_number)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'GIFT-CARD-TEST')`,
      [CARD, MERCHANT, CUSTOMER],
    );
    await pg.query(
      `INSERT INTO merchant.contact
         (merchant_id, customer_id, channel_id, raw_value, normalized_value, is_primary)
       SELECT $1::uuid, $2::uuid, id, 'ana@gift.test', 'ana@gift.test', true
         FROM umi.channel_type WHERE key='email'`,
      [MERCHANT, CUSTOMER],
    );

    const auth = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<{ authUser?: unknown }>();
        req.authUser = { id: USER, email: null };
        const requestContext = getRequestContext();
        if (requestContext) requestContext.userId = USER;
        return true;
      },
    };
    const merchant = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<{ merchantAccess?: unknown }>();
        req.merchantAccess = { merchantId: MERCHANT, handle: null, name: 'Gift Test' };
        const requestContext = getRequestContext();
        if (requestContext) requestContext.merchantId = MERCHANT;
        return true;
      },
    };
    const publicMerchant = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest<{ publicMerchant?: unknown }>();
        req.publicMerchant = { merchantId: MERCHANT, handle: null, name: 'Gift Test' };
        const requestContext = getRequestContext();
        if (requestContext) requestContext.merchantId = MERCHANT;
        return true;
      },
    };
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [CashWriteController, CashCustomerController],
      providers: [
        { provide: CashWriteService, useValue: service },
        { provide: CashWriteRepository, useValue: repo },
        { provide: CashRegisterService, useValue: {} },
        { provide: RateLimitService, useValue: { hit: () => ({ allowed: true }) } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(auth)
      .overrideGuard(MerchantAccessGuard)
      .useValue(merchant)
      .overrideGuard(EntitlementGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(PublicMerchantGuard)
      .useValue(publicMerchant)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    const requestContext = new RequestContextMiddleware();
    app.use(requestContext.use.bind(requestContext));
    app.useGlobalPipes(new ClassValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    // This suite runs only on a disposable Build v3 database. Ledger rows are
    // append-only by contract, so cleanup must not weaken their production guard.
    await app?.close();
    await pg?.onModuleDestroy?.();
  });

  beforeEach(() => {
    refreshCard.mockClear();
  });

  const issue = () =>
    asMerchant(() =>
      service.issueGiftCard(MERCHANT, USER, {
        amountCentavos: 5_000,
        senderName: 'Luis',
        recipientEmail: 'ana@gift.test',
        recipientName: 'Ana',
      }),
    );

  it('issues, consults, and redeems against the real schema', async () => {
    const issueResponse = await app.inject({
      method: 'POST',
      url: `/api/gifttest-${RUN}/admin/gift-cards`,
      payload: {
        amountCentavos: 5_000,
        senderName: 'Luis',
        recipientEmail: 'ana@gift.test',
        recipientName: 'Ana',
      },
    });
    expect(issueResponse.statusCode).toBe(200);
    const issued = issueResponse.json();
    const code = issued.giftCard.code;
    expect(code).toMatch(/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);

    const stored = await pg.query<{
      hash: string;
      masked_code: string;
      amount_cents: string;
      reason: string;
    }>(
      `SELECT encode(g.code_hash, 'hex') AS hash, g.masked_code, g.amount_cents::text,
              l.reason
         FROM merchant.loyalty_gift_card g
         JOIN merchant.loyalty_gift_card_ledger l
           ON l.merchant_id=g.merchant_id AND l.gift_card_id=g.id
        WHERE g.merchant_id=$1::uuid`,
      [MERCHANT],
    );
    expect(stored.rows[0]).toEqual({
      hash: createHash('sha256').update(code).digest('hex'),
      masked_code: `••••-${code.slice(-4)}`,
      amount_cents: '5000',
      reason: 'load',
    });

    const consultResponse = await app.inject({
      method: 'GET',
      url: `/api/gifttest-${RUN}/gift/${code}`,
    });
    expect(consultResponse.statusCode).toBe(200);
    expect(consultResponse.json()).toEqual({
      code: `••••-${code.slice(-4)}`,
      isRedeemed: false,
      hasMessage: false,
      merchantName: 'Gift Test',
    });

    // The value ledgers accept writes only through the fact functions (90_rls revokes
    // api's AND worker's DML on them), and those functions assert a merchant context
    // even on the worker pool — so the seed sets the scope, as a request would.
    await pg.workerTx(async (client) => {
      await client.query(`SELECT set_config('app.current_merchant', $1, true)`, [MERCHANT]);
      await client.query(
        `SELECT merchant.append_gift_card_fact(g.merchant_id, g.id, jsonb_build_object(
           'delta', -1000, 'reason', 'adjustment', 'sourceType', 'test',
           'sourceId', g.id::text, 'idempotencyKey', 'gift-adjustment-' || g.id::text))
           FROM merchant.loyalty_gift_card g
          WHERE g.merchant_id=$1::uuid AND g.code_hash=extensions.digest($2, 'sha256')`,
        [MERCHANT, code],
      );
    });

    const redeemResponse = await app.inject({
      method: 'POST',
      url: `/api/gifttest-${RUN}/gift/${code}`,
      payload: { email: 'ana@gift.test' },
    });
    expect(redeemResponse.statusCode).toBe(200);
    expect(redeemResponse.json()).toEqual(
      expect.objectContaining({ success: true, amountMXN: '$40.00', newBalanceMXN: '$40.00' }),
    );
    expect(refreshCard).toHaveBeenCalledWith(CARD);

    const balances = await pg.query<{ gift: string; wallet: string }>(
      `SELECT
         (SELECT sum(delta)::text FROM merchant.loyalty_gift_card_ledger
           WHERE merchant_id=$1::uuid) AS gift,
         (SELECT sum(delta)::text FROM merchant.loyalty_stored_value_ledger
           WHERE merchant_id=$1::uuid AND card_id=$2::uuid) AS wallet`,
      [MERCHANT, CARD],
    );
    expect(balances.rows[0]).toEqual({ gift: '0', wallet: '4000' });
  });

  it('allows only one of two simultaneous redemptions', async () => {
    const issued = await issue();
    const gift = await repo.findGiftCardByCode(MERCHANT, issued.giftCard.code);
    expect(gift).toBeTruthy();

    const results = await Promise.allSettled([
      repo.redeemGiftCard({
        merchantId: MERCHANT,
        giftCardId: gift!.id,
        cardId: CARD,
        amountCents: Number(gift!.amount_cents),
        senderName: null,
      }),
      repo.redeemGiftCard({
        merchantId: MERCHANT,
        giftCardId: gift!.id,
        cardId: CARD,
        amountCents: Number(gift!.amount_cents),
        senderName: null,
      }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(GiftCardAlreadyRedeemedError) });

    const ledger = await pg.query<{ redeems: number }>(
      `SELECT count(*)::int AS redeems FROM merchant.loyalty_gift_card_ledger
        WHERE merchant_id=$1::uuid AND gift_card_id=$2::uuid AND reason='redeem'`,
      [MERCHANT, gift!.id],
    );
    expect(ledger.rows[0].redeems).toBe(1);
  });
});
