import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CashReadService } from './cash-read.service';

/**
 * The register's six screens, tested against a RECORDING.
 *
 * `register-flip.integration.ts` proves the twenty-three forwarded routes EXIST on
 * umi-api. A Next rewrite is a proxy, so existing proves nothing about what comes
 * back — and on 2026-10-06 that gap was measured with a live credential: ten of ten
 * comparable routes differed, on four of the six screens the cafés actually use.
 * The panel read `undefined` and drew zeros, or lost a reward tier, with no error
 * anywhere on either side.
 *
 * So this file compares umi-api's answers against `register-shapes.json` — the
 * shapes captured from production `cash.umiconsulting.co` with a real café
 * credential, by `scripts/umi-cash-shape-capture.mjs`. The fixture is a recording,
 * not a transcription: regenerating it is a command, not an act of memory.
 *
 * WHAT IT CHECKS: every key path umi-cash sends is still present. NOT the values
 * (the two sides are different databases), and NOT the types of leaves that are
 * legitimately null for some cafés — `promoMessage` is null for a café with no
 * promo, and a comparison that called that a failure would be turned off within a
 * week. What it does catch is the whole class of defect above: a key that stops
 * being sent.
 *
 * WHICH CAFÉ: elgranribera (a 7/9 ladder and a per-card override) is the fixture
 * below, because it exercises the superset — `upgrade` and `baseReward` carry an
 * object there and are null at kalalacafe, and the fixture is the union of both.
 */

const FIXTURE: Record<string, string[]> = JSON.parse(
  readFileSync(join(__dirname, 'register-shapes.json'), 'utf8'),
);

/** Mirrors the harness's `shape`: every decided path, arrays collapsed to one row. */
function shape(value: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    out.add(`${prefix}[]`);
    if (value.length > 0) shape(value[0], `${prefix}[].`, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const path = prefix + k;
      const type = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
      out.add(`${path}:${type}`);
      shape(v, `${path}.`, out);
    }
  }
  return out;
}

/** Paths the recording has and the answer does not. Type is deliberately ignored. */
function missing(expected: string[], actual: Set<string>): string[] {
  const paths = new Set([...actual].map((p) => p.slice(0, p.lastIndexOf(':'))));
  return expected.filter((p) => !paths.has(p.slice(0, p.lastIndexOf(':'))));
}

/**
 * A café with everything switched on: a 7/9 ladder, one per-card override, one
 * banked pre-ladder reward, one visit, one canje, one ledger row, one gift card.
 * Every array is NON-EMPTY on purpose — an empty array proves the array exists and
 * nothing about the row, which is where four of the ten measured differences lived.
 */
function make() {
  const repo = {
    branding: vi.fn().mockResolvedValue({
      id: 't1',
      handle: 'elgranribera',
      name: 'El Gran Ribera',
      timezone: 'America/Mexico_City',
      status: 'active',
      city: 'Mazatlán',
      programId: 't1',
      cardPrefix: 'EGR',
      passStyle: 'stamps',
      selfRegistration: true,
      topupEnabled: true,
      birthdayRewardEnabled: true,
      birthdayRewardName: 'Rebanada de pastel',
      primaryColor: '#8b5e3c',
      secondaryColor: '#f4ece4',
      logoUrl: 'https://example.test/logo.png',
      stripImageUrl: null,
      promoMessage: null,
      promoStartsAt: null,
      promoEndsAt: null,
      promoDays: null,
      lifecycleCopy: { first_visit: 'Hola {name}' },
    }),
    stats: vi.fn().mockResolvedValue({
      visits: { n: 12 },
      topups: { n: 3, sum: 45000 },
      pending: { sum: 4 },
    }),
    rewardConfig: vi.fn().mockResolvedValue({
      active: [
        {
          id: 'rc-base',
          merchantId: 't1',
          programId: null,
          visitsRequired: 7,
          rewardName: 'Capuccino',
          rewardDescription: null,
          rewardCostCentavos: 4500,
          isActive: true,
          activatedAt: '2026-09-09T00:00:00.000Z',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      upgrade: [
        {
          id: 'rc-top',
          merchantId: 't1',
          programId: null,
          visitsRequired: 9,
          rewardName: 'Latte rocas',
          rewardDescription: null,
          rewardCostCentavos: 6000,
          isActive: true,
          activatedAt: '2026-09-09T00:00:00.000Z',
          createdAt: '2026-09-09T00:00:00.000Z',
        },
      ],
      history: [
        {
          id: 'rc-old',
          merchantId: 't1',
          programId: null,
          visitsRequired: 10,
          rewardName: 'Bebida gratis',
          rewardDescription: 'cualquiera',
          rewardCostCentavos: 5000,
          isActive: false,
          activatedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
    giftCards: vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'gc1',
          code: 'ABCD-EFGH',
          amountCentavos: 20000,
          senderName: 'Ana',
          recipientName: 'Beto',
          recipientEmail: 'beto@example.test',
          recipientPhone: null,
          message: 'felicidades',
          isRedeemed: false,
          redeemedAt: null,
          expiresAt: null,
          createdAt: '2026-09-30T18:00:00.000Z',
        },
      ],
      total: 1,
    }),
    analytics: vi.fn().mockResolvedValue({
      recentVisits: [{ scannedAt: new Date('2026-10-04T18:00:00.000Z') }],
      topCards: [
        {
          userId: 'c1',
          name: 'Ana',
          cardNumber: 'EGR-1',
          totalVisits: 12,
          balanceCentavos: 15000,
        },
      ],
      recentUsers: [{ createdAt: new Date('2026-09-30T18:00:00.000Z') }],
      balanceRow: [{ sum: 15000 }],
      topupsRow: [{ sum: 45000 }],
      rewardsRow: [{ n: 2 }],
      activeRow: [{ n: 9 }],
      totalsRow: [{ totalCustomers: 42, totalRevenueCentavos: 900000, totalAllTimeVisits: 500 }],
      activeRewardConfigRow: [{ visitsRequired: 7, rewardCostCentavos: 4500 }],
      highBalanceRow: [{ n: 2 }],
      birthdayRow: [{ n: 1 }],
      prevPeriodVisits: [{ n: 8 }],
      rewardsInRange: [{ n: 3 }],
      redemptionLog: [
        {
          id: 'r1',
          redeemedAt: new Date('2026-10-01T19:47:01.935Z'),
          name: 'Ana',
          customerId: 'c1',
          cardNumber: 'EGR-1',
          revertedAt: null,
        },
      ],
    }),
    adminCustomers: vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'c1',
          name: 'Ana',
          phone: '+5215512345678',
          email: null,
          device: 'iPhone',
          os: 'iOS 18',
          cardNumber: 'EGR-1',
          cardId: 'card-1',
          balanceCentavos: 15000,
          totalVisits: 12,
          visitsThisCycle: 3,
          pendingRewards: 1,
          lastVisit: new Date('2026-10-04T18:00:00.000Z'),
          createdAt: new Date('2026-01-05T18:00:00.000Z'),
          ltvCentavos: 48000,
        },
      ],
      total: 1,
    }),
    adminCustomerDetail: vi.fn().mockResolvedValue({
      id: 'c1',
      name: 'Ana',
      birthday: new Date('1994-03-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-05T18:00:00.000Z'),
      device: 'iPhone',
      os: 'iOS 18',
      cardId: 'card-1',
      cardNumber: 'EGR-1',
      cardCreatedAt: new Date('2026-01-05T18:00:00.000Z'),
      phone: '+5215512345678',
      email: null,
    }),
    cardMoneyTotals: vi.fn().mockResolvedValue({ ltvCentavos: 48000, topupCentavos: 60000 }),
    rewardProfileRows: vi.fn().mockResolvedValue({
      defaultConfig: {
        id: 'rc-base',
        visits_required: 7,
        reward_name: 'Capuccino',
        reward_description: null,
      },
      upgradeConfig: {
        id: 'rc-top',
        visits_required: 9,
        reward_name: 'Latte rocas',
        reward_description: null,
      },
      overrideConfig: null,
    }),
    cardRedemptions: vi.fn().mockResolvedValue({
      total: 7,
      rows: [
        {
          id: 'r1',
          redeemedAt: new Date('2026-10-01T19:47:01.935Z'),
          note: null,
          revertedAt: null,
        },
      ],
    }),
  };
  const cards = {
    cardState: vi.fn().mockResolvedValue({
      card_number: 'EGR-1',
      total_visits: 12,
      visits_this_cycle: 3,
      pending_rewards: 1,
      balance_cents: 15000,
      visits_required: 9,
      pending_tier1: 1,
    }),
    recentVisits: vi
      .fn()
      .mockResolvedValue([{ id: 'v1', occurred_at: new Date('2026-10-04T18:00:00.000Z') }]),
    recentLedger: vi.fn().mockResolvedValue([
      {
        id: 'l1',
        reason: 'topup',
        delta: 20000,
        note: 'carga',
        created_at: new Date('2026-09-30T18:00:00.000Z'),
      },
    ]),
  };
  return { svc: new CashReadService(repo as never, cards as never), repo, cards };
}

const MERCHANT = '9f000000-0000-4000-8000-00000000e001';
const CUSTOMER = '9f000000-0000-4000-8000-00000000e002';

/** Every route the recording covers, answered by the service the flip would expose. */
function answers() {
  const h = make();
  return {
    '/admin/stats': h.svc.getStats(MERCHANT, 'ADMIN'),
    '/admin/settings': h.svc.getSettings(MERCHANT),
    '/admin/reward-config': h.svc.getRewardConfig(MERCHANT),
    '/admin/gift-cards': h.svc.getGiftCards(MERCHANT, {}),
    '/admin/analytics?days=7': h.svc.getAnalytics(MERCHANT, { days: '7' }),
    '/admin/customers': h.svc.getCustomers(MERCHANT, {}),
    '/admin/customers/:id': h.svc.getCustomer(MERCHANT, CUSTOMER, 'ADMIN'),
  };
}

describe('the register screens still answer what umi-cash answered', () => {
  // One café's fixture, resolved once — each route's answer is compared against the
  // shape recorded for that route.
  const recorded = Object.keys(FIXTURE);

  for (const route of recorded) {
    it(`${route} sends every key the recording has`, async () => {
      const body = await (answers() as Record<string, Promise<unknown>>)[route];
      expect(missing(FIXTURE[route], shape(body))).toEqual([]);
    });
  }

  it('covers every route the register flips, so a new one cannot slip in untested', () => {
    // Kept in step with next.config.mjs REGISTER_ROUTES by hand, on purpose: this
    // list is the set the RECORDING covers, and adding a route here without a
    // capture would make the test pass by asserting nothing.
    expect(recorded.sort()).toEqual(
      [
        '/admin/analytics?days=7',
        '/admin/customers',
        '/admin/customers/:id',
        '/admin/gift-cards',
        '/admin/reward-config',
        '/admin/settings',
        '/admin/stats',
      ].sort(),
    );
  });
});
