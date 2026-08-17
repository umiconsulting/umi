import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashReadService } from './cash-read.service';

function make() {
  const repo = {
    branding: vi.fn(),
    updateMerchantName: vi.fn().mockResolvedValue(undefined),
    updateProgram: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn(),
    analytics: vi.fn(),
    adminCustomers: vi.fn(),
    rewardConfig: vi.fn(),
    upsertRewardConfig: vi.fn(),
    giftCards: vi.fn(),
    adminCustomerDetail: vi.fn(),
    cardMoneyTotals: vi.fn().mockResolvedValue({ ltvCentavos: 0, topupCentavos: 0 }),
  };
  const cards = {
    cardState: vi.fn(),
    recentVisits: vi.fn().mockResolvedValue([]),
    recentLedger: vi.fn().mockResolvedValue([]),
  };
  return { svc: new CashReadService(repo as never, cards as never), repo, cards };
}

describe('CashReadService.getStats', () => {
  it('formats topups as MXN and counts visits/pending', async () => {
    const h = make();
    h.repo.stats.mockResolvedValue({
      visits: { n: 7 },
      topups: { n: 3, sum: 45000 },
      pending: { sum: 12 },
    });
    const r = await h.svc.getStats('t1');
    expect(r.visitsToday).toBe(7);
    expect(r.topupsTodayCount).toBe(3);
    expect(r.topupsTodayMXN).toContain('450');
    expect(r.pendingRewards).toBe(12);
  });
});

describe('CashReadService.getAnalytics', () => {
  it('builds a 30-day visit series and derives profitability', async () => {
    const h = make();
    h.repo.analytics.mockResolvedValue({
      recentVisits: [],
      topCards: [
        { userId: 'u1', name: 'Ana', cardNumber: 'K1', totalVisits: 9, balanceCentavos: 10000 },
      ],
      recentUsers: [],
      balanceRow: [{ sum: 200000 }],
      topupsRow: [{ sum: 30000 }],
      rewardsRow: [{ n: 4 }],
      activeRow: [{ n: 5 }],
      totalsRow: [{ totalCustomers: 10, totalRevenueCentavos: 1000000, totalAllTimeVisits: 100 }],
      activeRewardConfigRow: [{ visitsRequired: 10, rewardCostCentavos: 5000 }],
    });
    const r = await h.svc.getAnalytics('t1');
    expect(r.visitsByDay).toHaveLength(30);
    expect(r.topCustomers[0].name).toBe('Ana');
    expect(r.retentionRate).toBe(50); // 5/10
    expect(r.avgVisitsPerCustomer).toBe(10); // 100/10
    expect(r.profitability.visitsRequired).toBe(10);
    expect(r.profitability.rewardCostConfigured).toBe(true);
  });
});

describe('CashReadService.updateRewardConfig', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('rejects when required fields are missing', async () => {
    await expect(
      h.svc.updateRewardConfig('t1', { rewardName: 'Free coffee' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the merchant has no loyalty program', async () => {
    h.repo.branding.mockResolvedValue({ programId: null });
    await expect(
      h.svc.updateRewardConfig('t1', { visitsRequired: 10, rewardName: 'X' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deactivates + inserts a new config when valid', async () => {
    h.repo.branding.mockResolvedValue({ programId: 'prog1' });
    h.repo.upsertRewardConfig.mockResolvedValue({ id: 'rc2', isActive: true });
    const r = await h.svc.updateRewardConfig('t1', {
      visitsRequired: '8',
      rewardName: 'Free coffee',
    });
    expect(h.repo.upsertRewardConfig).toHaveBeenCalledWith('t1', 'prog1', {
      visitsRequired: 8,
      rewardName: 'Free coffee',
      rewardDescription: null,
      rewardCostCentavos: 0,
    });
    expect(r.ok).toBe(true);
  });
});

describe('CashReadService.updateSettings', () => {
  it('updates the merchant name and builds the column-keyed program patch', async () => {
    const h = make();
    await h.svc.updateSettings('t1', { name: 'New Cafe', primaryColor: '#000', cardPrefix: 'NC' });
    expect(h.repo.updateMerchantName).toHaveBeenCalledWith('t1', 'New Cafe');
    const arg = h.repo.updateProgram.mock.calls[0][1];
    expect(arg.card_prefix).toBe('NC');
    expect(arg.primary_color).toBe('#000');
  });

  it('skips the program update when only the name changes', async () => {
    const h = make();
    await h.svc.updateSettings('t1', { name: 'Only Name' });
    expect(h.repo.updateProgram).not.toHaveBeenCalled();
  });
});

/**
 * The staff view of one customer. Everything on this screen is either PII or
 * money, so the tests are about reading the right person's numbers — and about
 * what build-v3 no longer keeps.
 */
describe('CashReadService.getCustomer', () => {
  let h: ReturnType<typeof make>;

  const DETAIL = {
    id: 'cust-1',
    name: 'Ana',
    phone: '+5215512345678',
    email: 'ana@example.com',
    birthday: new Date('1990-04-12T00:00:00.000Z'),
    createdAt: new Date('2026-01-05T18:00:00.000Z'),
    cardId: 'card-1',
    cardNumber: 'KAL-1',
    cardCreatedAt: new Date('2026-01-06T18:00:00.000Z'),
  };

  beforeEach(() => {
    h = make();
    h.repo.adminCustomerDetail.mockResolvedValue(DETAIL);
    h.cards.cardState.mockResolvedValue({
      card_number: 'KAL-1',
      total_visits: 13,
      visits_this_cycle: 3,
      pending_rewards: 1,
      balance_cents: 12550,
      visits_required: 10,
    });
  });

  it('reports her identity, her card and her derived state', async () => {
    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.id).toBe('cust-1');
    expect(r.name).toBe('Ana');
    expect(r.phone).toBe('+5215512345678');
    expect(r.email).toBe('ana@example.com');
    expect(r.cardId).toBe('card-1');
    expect(r.cardNumber).toBe('KAL-1');
    expect(r.totalVisits).toBe(13);
    expect(r.visitsThisCycle).toBe(3);
    expect(r.visitsRequired).toBe(10);
    expect(r.pendingRewards).toBe(1);
    expect(r.balanceCentavos).toBe(12550);
    expect(r.balanceMXN).toBe('$125.50');
  });

  it('renders the birthday as a plain date, not a timestamp', async () => {
    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.birthDate).toBe('1990-04-12');
  });

  it('reports no birthday when she gave none', async () => {
    h.repo.adminCustomerDetail.mockResolvedValue({ ...DETAIL, birthday: null });

    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.birthDate).toBeNull();
  });

  it('sums what she spent and what she loaded, spend as a positive figure', async () => {
    // Spend is stored negative; the screen says "lifetime value", not "drawdown".
    h.repo.cardMoneyTotals.mockResolvedValue({ ltvCentavos: 48000, topupCentavos: 60000 });

    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.ltvCentavos).toBe(48000);
    expect(r.ltvMXN).toBe('$480.00');
    expect(r.totalTopupCentavos).toBe(60000);
    expect(r.totalTopupMXN).toBe('$600.00');
  });

  it('takes the last visit from the most recent one, and null when there are none', async () => {
    h.cards.recentVisits.mockResolvedValue([
      { id: 'v1', occurred_at: new Date('2026-08-10T18:00:00.000Z') },
      { id: 'v2', occurred_at: new Date('2026-08-03T18:00:00.000Z') },
    ]);

    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.lastVisit).toBe('2026-08-10T18:00:00.000Z');
    expect(r.recentVisits).toHaveLength(2);

    h.cards.recentVisits.mockResolvedValue([]);
    expect((await h.svc.getCustomer('t1', 'cust-1')).lastVisit).toBeNull();
  });

  it('falls back to the card date when the customer row carries none', async () => {
    h.repo.adminCustomerDetail.mockResolvedValue({ ...DETAIL, createdAt: null });

    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.createdAt).toBe('2026-01-06T18:00:00.000Z');
  });

  it('maps a ledger entry to the shape the screen already reads', async () => {
    h.cards.recentLedger.mockResolvedValue([
      {
        id: 'l1',
        reason: 'purchase',
        delta: -4500,
        note: 'Latte',
        created_at: new Date('2026-08-10T18:00:00.000Z'),
      },
    ]);

    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.recentTransactions).toEqual([
      {
        id: 'l1',
        type: 'purchase',
        amountCentavos: -4500,
        description: 'Latte',
        createdAt: '2026-08-10T18:00:00.000Z',
      },
    ]);
  });

  /**
   * umi-cash reads `device` and `os` off `people.metadata`, written from the
   * User-Agent at sign-up. build-v3 drops that column and umi-api's registration
   * already discards the header, so there is nothing left to report. Null is the
   * honest answer; inventing one would be worse.
   */
  it('reports no device or OS, because build-v3 keeps neither', async () => {
    const r = await h.svc.getCustomer('t1', 'cust-1');

    expect(r.device).toBeNull();
    expect(r.os).toBeNull();
  });

  it('404s a customer this café does not have', async () => {
    h.repo.adminCustomerDetail.mockResolvedValue(null);

    await expect(h.svc.getCustomer('t1', 'nope')).rejects.toThrow(NotFoundException);
    expect(h.cards.cardState).not.toHaveBeenCalled();
  });
});
