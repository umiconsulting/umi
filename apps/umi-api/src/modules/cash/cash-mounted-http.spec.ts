import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { JwtService } from '../../shared/auth/jwt.service';
import { CustomerTokenService } from '../../shared/auth/customer-token.service';
import { QrService } from '../../shared/auth/qr.service';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { ClassValidationPipe } from '../../shared/http/class-validation.pipe';
import { AuthRepository } from '../auth/auth.repository';
import { CashController } from './cash.controller';
import { CashMerchantController } from './cash-merchant.controller';
import { CashWriteController } from './cash-write.controller';
import { CashScanController } from './cash-scan.controller';
import { CashCustomerController } from './cash-customer.controller';
import { CashReadService } from './cash-read.service';
import { CashWriteService } from './cash-write.service';
import { CashRegisterService } from './cash-register.service';
import { CashRepository } from './cash.repository';
import { CashCardRepository } from './cash-card.repository';
import { CashWriteRepository } from './cash-write.repository';
import { CashRegisterRepository } from './cash-register.repository';
import { CashScanService } from './cash-scan.service';

/**
 * Mounted HTTP acceptance for the Cash R0 slice.
 *
 * The Nest module is real: the controllers, their guard stack, the global
 * `ClassValidationPipe` and the Fastify request pipeline all run. Only the data
 * layer and the auth substrate are synthetic. No database, no network and no
 * cookie from a real login.
 *
 * `supertest` is not a dependency of this app. `NestFastifyApplication.inject()`
 * drives the same mounted Fastify pipeline in-process.
 */

const MERCHANT_ID = '9f000000-0000-4000-8000-00000000a001';
const CUSTOMER_ID = '9f000000-0000-4000-8000-00000000c001';
const MERCHANT = { id: MERCHANT_ID, name: 'Kala', handle: 'kalala' };

type Profile = { role: string; permissions: string[] };
const matrix = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../..', 'config/umipos-pilot-role-grants.json'), 'utf8'),
) as { profiles: Profile[] };
const permissionsOf = (role: string): string[] =>
  matrix.profiles.find((profile) => profile.role === role)?.permissions ?? [];

const CUSTOMER_ROW = {
  id: CUSTOMER_ID,
  name: 'Ana',
  phone: '+5215550001111',
  email: 'ana@example.test',
  device: null,
  os: null,
  cardId: 'card-1',
  cardNumber: 'KAL-1',
  balanceCentavos: 12550,
  totalVisits: 13,
  visitsThisCycle: 3,
  pendingRewards: 1,
  lastVisit: new Date('2026-10-04T18:00:00.000Z'),
  createdAt: new Date('2026-01-05T18:00:00.000Z'),
  ltvCentavos: 48000,
};

const DETAIL = {
  id: CUSTOMER_ID,
  name: 'Ana',
  phone: '+5215550001111',
  email: 'ana@example.test',
  birthday: new Date('1990-04-12T00:00:00.000Z'),
  createdAt: new Date('2026-01-05T18:00:00.000Z'),
  cardId: 'card-1',
  cardNumber: 'KAL-1',
  cardCreatedAt: new Date('2026-01-06T18:00:00.000Z'),
};

const SETTINGS = {
  name: 'Kala',
  city: 'Mazatlán',
  primaryColor: '#123456',
  secondaryColor: '#abcdef',
  logoUrl: null,
  stripImageUrl: null,
  passStyle: 'stamps',
  promoMessage: null,
  promoStartsAt: null,
  promoEndsAt: null,
  promoDays: null,
  selfRegistration: true,
  topupEnabled: true,
  multiSealEnabled: false,
  birthdayRewardEnabled: false,
  birthdayRewardName: null,
  cardPrefix: 'KAL',
  handle: 'kalala',
  lifecycleCopy: {},
  programId: MERCHANT_ID,
};

const authRepo = {
  findMembershipAccess: vi.fn(async (userId: string, merchantId: string) => {
    const role = userId.replace(/^user-/, '');
    return {
      merchantId,
      handle: 'kalala',
      name: 'Kala',
      timezone: 'America/Mexico_City',
      membershipId: `member-${role}`,
      roles: [role],
      permissions: permissionsOf(role),
      locationId: null,
    };
  }),
  merchantIdForHandle: vi.fn(async (handle: string) => (handle === 'kalala' ? MERCHANT_ID : null)),
  merchantById: vi.fn(async (id: string) => (id === MERCHANT_ID ? MERCHANT : null)),
  merchantByHandle: vi.fn(async (handle: string) => (handle === 'kalala' ? MERCHANT : null)),
  productStatus: vi.fn(async () => 'active'),
};

const cards = {
  cardState: vi.fn().mockResolvedValue({
    card_number: 'KAL-1',
    total_visits: 13,
    visits_this_cycle: 3,
    pending_rewards: 1,
    balance_cents: 12550,
    visits_required: 10,
    pending_tier1: 0,
    reward_policy: 'standard',
    cycle_reward_available: false,
    base_reward_blocked_by_history: false,
    available_rewards: 0,
    reward_name: null,
    base_reward_name: null,
    base_visits_required: null,
    reward_expiry_days: null,
    next_reward_expires_at: null,
    legacy_pending_rewards: 0,
    visit_blocked_reason: null,
    merchant_timezone: 'America/Mexico_City',
  }),
  recentVisits: vi.fn().mockResolvedValue([]),
  recentLedger: vi.fn().mockResolvedValue([]),
};

const repo = {
  adminCustomers: vi.fn(
    async (
      _merchantId: string,
      opts: { search: string; includeContact: boolean },
    ): Promise<{ rows: unknown[]; total: number }> => {
      const term = String(opts.search ?? '')
        .trim()
        .toLowerCase();
      if (!term) return { rows: [CUSTOMER_ROW], total: 1 };
      const contactMatch =
        opts.includeContact === true &&
        (CUSTOMER_ROW.phone.toLowerCase().includes(term) ||
          CUSTOMER_ROW.email.toLowerCase().includes(term));
      const matches =
        CUSTOMER_ROW.name.toLowerCase().includes(term) ||
        CUSTOMER_ROW.cardNumber.toLowerCase().includes(term) ||
        contactMatch;
      return matches ? { rows: [CUSTOMER_ROW], total: 1 } : { rows: [], total: 0 };
    },
  ),
  adminCustomerDetail: vi.fn().mockResolvedValue(DETAIL),
  cardMoneyTotals: vi.fn().mockResolvedValue({ ltvCentavos: 0, topupCentavos: 0 }),
  rewardProfileRows: vi.fn().mockResolvedValue({
    defaultConfig: null,
    upgradeConfig: null,
    overrideConfig: null,
  }),
  cardRedemptions: vi.fn().mockResolvedValue({ total: 0, rows: [] }),
  stats: vi.fn().mockResolvedValue({
    visits: { n: 0 },
    topups: { n: 0, sum: 0 },
    pending: { sum: 0 },
  }),
  analytics: vi.fn().mockResolvedValue({
    recentVisits: [],
    topCards: [],
    recentUsers: [],
    balanceRow: [{ sum: 0 }],
    topupsRow: [{ sum: 0 }],
    rewardsRow: [{ n: 0 }],
    activeRow: [{ n: 0 }],
    totalsRow: [{ totalCustomers: 0, totalRevenueCentavos: 0, totalAllTimeVisits: 0 }],
    activeRewardConfigRow: [{ visitsRequired: 10, rewardCostCentavos: 0 }],
    highBalanceRow: [{ n: 0 }],
    birthdayRow: [{ n: 0 }],
    prevPeriodVisits: [{ n: 0 }],
    rewardsInRange: [{ n: 0 }],
    redemptionLog: [],
  }),
  giftCards: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  branding: vi.fn().mockResolvedValue(SETTINGS),
  updateProgram: vi.fn().mockResolvedValue(undefined),
  updateMerchantName: vi.fn().mockResolvedValue(undefined),
  adminExportRows: vi.fn().mockResolvedValue([]),
  rewardConfig: vi.fn().mockResolvedValue({
    active: [{ rewardDescription: 'Con crema', rewardCostCentavos: 4500 }],
    upgrade: [
      {
        visitsRequired: 9,
        rewardName: 'Latte rocas',
        rewardDescription: 'Con leche',
        rewardCostCentavos: 6000,
      },
    ],
    history: [],
  }),
  withRewardConfigLock: vi.fn(
    async (_merchantId: string, work: (client: object) => Promise<unknown>) => work({}),
  ),
  upsertRewardConfig: vi.fn().mockResolvedValue({ id: 'rc-2' }),
};

const writeRepo = {
  topupEnabled: vi.fn().mockResolvedValue(false),
  findCard: vi.fn().mockResolvedValue(null),
  getStaffMemberId: vi.fn().mockResolvedValue('staff-1'),
  getUserPersonId: vi.fn().mockResolvedValue(null),
  topupGuards: vi.fn(),
  creditWallet: vi.fn(),
  purchase: vi.fn(),
  insertGiftCard: vi.fn().mockResolvedValue({ id: 'g-1', code: 'AAAA-BBBB', amount_cents: 10000 }),
  findGiftCardByCode: vi.fn(),
  findPersonCard: vi.fn(),
  redeemGiftCard: vi.fn(),
};

const registerRepo = {
  merchantConfig: vi.fn().mockResolvedValue({
    name: 'Kala',
    loyaltyConfigured: true,
    cardPrefix: 'KAL',
    selfRegistration: true,
  }),
  normalizePhone: vi.fn().mockResolvedValue('+5215550001111'),
  findExisting: vi.fn().mockResolvedValue(null),
  resolveContact: vi.fn().mockResolvedValue('cust-new'),
  updatePerson: vi.fn().mockResolvedValue(undefined),
  createCard: vi.fn().mockResolvedValue({ cardId: 'card-new', cardNumber: 'KAL-1000000000' }),
};

const scan = {
  scan: vi.fn().mockResolvedValue({ ok: true }),
  preview: vi.fn().mockResolvedValue({ ok: true }),
  seals: vi.fn().mockResolvedValue({ ok: true }),
  revertRedemption: vi.fn().mockResolvedValue({ ok: true }),
};

const walletPass = {
  refreshCard: vi.fn().mockResolvedValue(undefined),
  refreshMerchant: vi.fn().mockResolvedValue(undefined),
  refreshMerchantWithCounts: vi.fn().mockResolvedValue(0),
  refreshMerchantGoogleObjects: vi.fn().mockResolvedValue(0),
};

const qr = { generateRandomToken: vi.fn().mockReturnValue('qr-token') };
const jwt = {
  verifyAccess: vi.fn(async (token: string) => ({
    sub: `user-${token.replace(/^token-/, '')}`,
    email: null,
    sessionId: 'session-1',
  })),
};
const customerTokens = { fromSharedAccessHeader: vi.fn(async () => null) };

let app: NestFastifyApplication;

async function request(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  role?: string,
  payload?: unknown,
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (role) headers.cookie = `umi_access=token-${role}`;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const response = await app.inject({
    method,
    url,
    headers,
    payload: payload as Record<string, unknown> | undefined,
  });
  return { status: response.statusCode, body: response.body, headers: response.headers };
}

function json<T = Record<string, unknown>>(body: string): T {
  return JSON.parse(body) as T;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      CashController,
      CashMerchantController,
      CashWriteController,
      CashScanController,
      CashCustomerController,
    ],
    providers: [
      CashReadService,
      CashWriteService,
      CashRegisterService,
      { provide: CashRepository, useValue: repo },
      { provide: CashCardRepository, useValue: cards },
      { provide: CashWriteRepository, useValue: writeRepo },
      { provide: CashRegisterRepository, useValue: registerRepo },
      { provide: CashScanService, useValue: scan },
      { provide: WalletPassAdapter, useValue: walletPass },
      { provide: QrService, useValue: qr },
      { provide: RateLimitService, useClass: RateLimitService },
      { provide: JwtService, useValue: jwt },
      { provide: CustomerTokenService, useValue: customerTokens },
      { provide: AuthRepository, useValue: authRepo },
    ],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  await app.register(fastifyCookie);
  app.useGlobalPipes(new ClassValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  repo.branding.mockResolvedValue(SETTINGS);
  repo.adminCustomerDetail.mockResolvedValue(DETAIL);
  writeRepo.topupEnabled.mockResolvedValue(false);
  registerRepo.findExisting.mockResolvedValue(null);
  registerRepo.createCard.mockResolvedValue({
    cardId: 'card-new',
    cardNumber: 'KAL-1000000000',
  });
});

describe('public Cash registration over the mounted HTTP pipeline', () => {
  it('answers 202 with no token, no customer id and no card number', async () => {
    const res = await request('POST', '/api/kalala/customers', undefined, {
      name: 'Ana',
      phone: '+525550001111',
      birthDate: '1990-04-12',
    });

    expect(res.status).toBe(202);
    expect(json(res.body)).toEqual({
      verificationRequired: true,
      message: 'Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en Kala.',
    });
    for (const leaked of [
      'accessToken',
      'refreshToken',
      'customerId',
      'cardId',
      'cardNumber',
      'alreadyRegistered',
    ]) {
      expect(res.body).not.toContain(leaked);
    }
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns the same body for a known phone and a new phone', async () => {
    const fresh = await request('POST', '/api/kalala/customers', undefined, {
      name: 'Ana',
      phone: '+525550001111',
      birthDate: '1990-04-12',
    });
    registerRepo.findExisting.mockResolvedValue({
      personId: 'cust-existing',
      displayName: 'Existing',
      hasCard: true,
      cardId: 'card-9',
      cardNumber: 'KAL-9999999999',
    });
    const known = await request('POST', '/api/kalala/customers', undefined, {
      name: 'Ana',
      phone: '+525550001111',
      birthDate: '1990-04-12',
    });
    expect(known.status).toBe(fresh.status);
    expect(known.body).toBe(fresh.body);
  });
});

describe('staff member registration over the mounted HTTP pipeline', () => {
  const body = { name: 'Ana', phone: '+525550001111', birthDate: '1990-04-12' };

  it('lets a cashier register a member and returns the card, not a session', async () => {
    const res = await request('POST', `/api/merchants/${MERCHANT_ID}/cash/customers`, 'cashier', body);

    expect(res.status).toBe(200);
    expect(json(res.body)).toEqual({
      alreadyRegistered: false,
      customerId: 'cust-new',
      cardId: 'card-new',
      cardNumber: 'KAL-1000000000',
      name: 'Ana',
      message: '¡Bienvenido a Kala!',
    });
    expect(res.body).not.toContain('accessToken');
    expect(res.body).not.toContain('refreshToken');
  });

  it('refuses a viewer without customer.create', async () => {
    const res = await request('POST', `/api/merchants/${MERCHANT_ID}/cash/customers`, 'viewer', body);
    expect(res.status).toBe(403);
    expect(json(res.body).error).toBe('insufficient_permission');
  });

  it('returns an existing card without creating a second one', async () => {
    registerRepo.findExisting.mockResolvedValue({
      personId: 'cust-existing',
      displayName: 'Existing',
      hasCard: true,
      cardId: 'card-9',
      cardNumber: 'KAL-9999999999',
    });
    const res = await request('POST', `/api/merchants/${MERCHANT_ID}/cash/customers`, 'owner', body);

    expect(res.status).toBe(200);
    expect(json(res.body)).toMatchObject({
      alreadyRegistered: true,
      cardId: 'card-9',
      cardNumber: 'KAL-9999999999',
    });
    expect(registerRepo.createCard).not.toHaveBeenCalled();
  });
});

describe('contact projection over the mounted HTTP pipeline', () => {
  it('masks phone, email and birthday for a cashier on list, search, members and detail', async () => {
    const cases = [
      `/api/merchants/${MERCHANT_ID}/cash/customers`,
      `/api/merchants/${MERCHANT_ID}/cash/customers?search=Ana`,
      `/api/merchants/${MERCHANT_ID}/cash/members`,
      `/api/${MERCHANT_ID}/admin/customers`,
    ];
    for (const url of cases) {
      const res = await request('GET', url, 'cashier');
      expect(res.status, url).toBe(200);
      const row = json<{ customers: Array<Record<string, unknown>> }>(res.body).customers[0];
      expect(row.phone, url).toBeNull();
      expect(row.email, url).toBeNull();
      expect(row.contactRestricted, url).toBe(true);
      expect(row.name, url).toBe('Ana');
      expect(row.cardNumber, url).toBe('KAL-1');
    }

    const detail = await request(
      'GET',
      `/api/merchants/${MERCHANT_ID}/cash/customers/${CUSTOMER_ID}`,
      'cashier',
    );
    expect(detail.status).toBe(200);
    const detailBody = json<Record<string, unknown>>(detail.body);
    expect(detailBody.phone).toBeNull();
    expect(detailBody.email).toBeNull();
    expect(detailBody.birthDate).toBeNull();
    expect(detailBody.contactRestricted).toBe(true);

    const legacyDetail = await request(
      'GET',
      `/api/${MERCHANT_ID}/admin/customers/${CUSTOMER_ID}`,
      'cashier',
    );
    expect(legacyDetail.status).toBe(200);
    expect(json<Record<string, unknown>>(legacyDetail.body).phone).toBeNull();
  });

  it('returns contact fields to a manager who holds customer.contact.read', async () => {
    const list = await request('GET', `/api/merchants/${MERCHANT_ID}/cash/customers`, 'manager');
    expect(list.status).toBe(200);
    const row = json<{ customers: Array<Record<string, unknown>> }>(list.body).customers[0];
    expect(row.phone).toBe('+5215550001111');
    expect(row.email).toBe('ana@example.test');
    expect(row.contactRestricted).toBe(false);

    const detail = await request(
      'GET',
      `/api/merchants/${MERCHANT_ID}/cash/customers/${CUSTOMER_ID}`,
      'manager',
    );
    expect(json<Record<string, unknown>>(detail.body).birthDate).toBe('1990-04-12');
  });

  it('does not let a cashier search by phone or email on either route', async () => {
    for (const base of [
      `/api/merchants/${MERCHANT_ID}/cash/customers`,
      `/api/${MERCHANT_ID}/admin/customers`,
    ]) {
      const phone = await request('GET', `${base}?search=5550001111`, 'cashier');
      expect(phone.status, base).toBe(200);
      expect(json<{ total: number; customers: unknown[] }>(phone.body).total, base).toBe(0);
      expect(json<{ customers: unknown[] }>(phone.body).customers, base).toEqual([]);

      const email = await request(
        'GET',
        `${base}?search=${encodeURIComponent('ana@example.test')}`,
        'cashier',
      );
      expect(email.status, base).toBe(200);
      expect(json<{ total: number }>(email.body).total, base).toBe(0);
    }
  });

  it('lets a cashier search by name or card and keeps the contact fields masked', async () => {
    for (const term of ['Ana', 'KAL-1']) {
      const res = await request(
        'GET',
        `/api/merchants/${MERCHANT_ID}/cash/customers?search=${encodeURIComponent(term)}`,
        'cashier',
      );
      expect(res.status, term).toBe(200);
      const body = json<{ total: number; customers: Array<Record<string, unknown>> }>(res.body);
      expect(body.total, term).toBe(1);
      expect(body.customers[0].phone, term).toBeNull();
      expect(body.customers[0].email, term).toBeNull();
      expect(body.customers[0].contactRestricted, term).toBe(true);
    }
  });

  it('lets a manager search by phone or email and returns the contact fields', async () => {
    for (const term of ['5550001111', 'ana@example.test']) {
      const res = await request(
        'GET',
        `/api/merchants/${MERCHANT_ID}/cash/customers?search=${encodeURIComponent(term)}`,
        'manager',
      );
      expect(res.status, term).toBe(200);
      const body = json<{ total: number; customers: Array<Record<string, unknown>> }>(res.body);
      expect(body.total, term).toBe(1);
      expect(body.customers[0].phone, term).toBe('+5215550001111');
      expect(body.customers[0].email, term).toBe('ana@example.test');
      expect(body.customers[0].contactRestricted, term).toBe(false);
    }
  });

  it('keeps the viewer row aggregate-only and still lets the viewer read analytics', async () => {
    const list = await request('GET', `/api/merchants/${MERCHANT_ID}/cash/customers`, 'viewer');
    expect(list.status).toBe(200);
    const row = json<{ customers: Array<Record<string, unknown>> }>(list.body).customers[0];
    expect(row.phone).toBeNull();
    expect(row.email).toBeNull();
    expect(row.contactRestricted).toBe(true);

    const analytics = await request(
      'GET',
      `/api/merchants/${MERCHANT_ID}/cash/analytics`,
      'viewer',
    );
    expect(analytics.status).toBe(200);
  });
});

describe('the Cash permission matrix over the mounted HTTP pipeline', () => {
  it('refuses and allows the measured actions for each role', async () => {
    const scanBody = { qrPayload: 'synthetic-qr' };
    const cases: ReadonlyArray<{
      role: string;
      method: 'GET' | 'POST';
      url: string;
      payload?: unknown;
      expected: number;
    }> = [
      {
        role: 'cashier',
        method: 'GET',
        url: `/api/merchants/${MERCHANT_ID}/cash/analytics`,
        expected: 403,
      },
      {
        role: 'cashier',
        method: 'GET',
        url: `/api/${MERCHANT_ID}/admin/export`,
        expected: 403,
      },
      {
        role: 'cashier',
        method: 'POST',
        url: `/api/${MERCHANT_ID}/admin/scan`,
        payload: scanBody,
        expected: 201,
      },
      {
        role: 'viewer',
        method: 'GET',
        url: `/api/merchants/${MERCHANT_ID}/cash/analytics`,
        expected: 200,
      },
      {
        role: 'viewer',
        method: 'POST',
        url: `/api/${MERCHANT_ID}/admin/scan`,
        payload: scanBody,
        expected: 403,
      },
      {
        role: 'viewer',
        method: 'GET',
        url: `/api/merchants/${MERCHANT_ID}/cash/gift-cards`,
        expected: 403,
      },
      {
        role: 'manager',
        method: 'GET',
        url: `/api/merchants/${MERCHANT_ID}/cash/analytics`,
        expected: 403,
      },
      {
        role: 'manager',
        method: 'GET',
        url: `/api/${MERCHANT_ID}/admin/export`,
        expected: 200,
      },
      {
        role: 'manager',
        method: 'POST',
        url: `/api/${MERCHANT_ID}/admin/gift-cards`,
        payload: { amountCentavos: 10000, recipientEmail: 'a@example.test' },
        expected: 200,
      },
      {
        role: 'supervisor',
        method: 'POST',
        url: `/api/${MERCHANT_ID}/admin/scan/seals`,
        payload: { cardId: CUSTOMER_ID, stamps: 1 },
        expected: 403,
      },
      {
        role: 'owner',
        method: 'GET',
        url: `/api/merchants/${MERCHANT_ID}/cash/analytics`,
        expected: 200,
      },
    ];

    for (const testCase of cases) {
      const res = await request(
        testCase.method,
        testCase.url,
        testCase.role,
        testCase.payload,
      );
      expect(res.status, `${testCase.role} ${testCase.method} ${testCase.url}`).toBe(
        testCase.expected,
      );
    }
  });
});

describe('Cash settings and top-up over the mounted HTTP pipeline', () => {
  it('persists Cash-only fields on the merchant-id settings route', async () => {
    const res = await request('PATCH', `/api/merchants/${MERCHANT_ID}/cash/settings`, 'owner', {
      passStyle: 'stamps',
      topupEnabled: false,
      selfRegistration: true,
      primaryColor: '#123456',
    });

    expect(res.status).toBe(200);
    expect(repo.updateProgram).toHaveBeenCalledWith(
      MERCHANT_ID,
      expect.objectContaining({
        pass_style: 'stamps',
        topup_enabled: false,
        self_registration: true,
        primary_color: '#123456',
      }),
    );
  });

  it('refuses the settings write without merchant.manage', async () => {
    const res = await request('PATCH', `/api/merchants/${MERCHANT_ID}/cash/settings`, 'cashier', {
      topupEnabled: true,
    });
    expect(res.status).toBe(403);
    expect(repo.updateProgram).not.toHaveBeenCalled();
  });

  it('returns 403 for a top-up when the café disabled stored value', async () => {
    writeRepo.topupEnabled.mockResolvedValue(false);
    const res = await request('POST', `/api/${MERCHANT_ID}/admin/topup`, 'owner', {
      cardId: 'card-1',
      amountCentavos: 10000,
    });
    expect(res.status).toBe(403);
    expect(json(res.body).error).toBe('Las recargas están desactivadas');
    expect(writeRepo.creditWallet).not.toHaveBeenCalled();
  });

  it('preserves omitted reward fields on a PATCH', async () => {
    const res = await request(
      'PATCH',
      `/api/merchants/${MERCHANT_ID}/cash/reward-config`,
      'owner',
      { visitsRequired: 7, rewardName: 'Capuccino', rewardCostCentavos: 5000 },
    );

    expect(res.status).toBe(200);
    expect(repo.upsertRewardConfig).toHaveBeenCalledWith(
      MERCHANT_ID,
      MERCHANT_ID,
      {
        visitsRequired: 7,
        rewardName: 'Capuccino',
        rewardDescription: 'Con crema',
        rewardCostCentavos: 5000,
        upgrade: {
          visitsRequired: 9,
          rewardName: 'Latte rocas',
          rewardDescription: 'Con leche',
          rewardCostCentavos: 6000,
        },
      },
      expect.anything(),
    );
  });
});
