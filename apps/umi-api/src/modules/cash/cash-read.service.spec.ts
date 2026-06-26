import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CashReadService } from './cash-read.service';

function make() {
  const repo = {
    branding: vi.fn(),
    updateTenantName: vi.fn().mockResolvedValue(undefined),
    updateProgram: vi.fn().mockResolvedValue(undefined),
    stats: vi.fn(),
    analytics: vi.fn(),
    adminCustomers: vi.fn(),
    rewardConfig: vi.fn(),
    upsertRewardConfig: vi.fn(),
    giftCards: vi.fn(),
  };
  return { svc: new CashReadService(repo as never), repo };
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
      topCards: [{ userId: 'u1', name: 'Ana', cardNumber: 'K1', totalVisits: 9, balanceCentavos: 10000 }],
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

  it('rejects when the tenant has no loyalty program', async () => {
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
  it('updates the tenant name and merges branding patch', async () => {
    const h = make();
    await h.svc.updateSettings('t1', { name: 'New Cafe', primaryColor: '#000', cardPrefix: 'NC' });
    expect(h.repo.updateTenantName).toHaveBeenCalledWith('t1', 'New Cafe');
    const arg = h.repo.updateProgram.mock.calls[0][1];
    expect(arg.cardPrefix).toBe('NC');
    expect(arg.brandingPatch.primary_color).toBe('#000');
  });

  it('skips the program update when only the name changes', async () => {
    const h = make();
    await h.svc.updateSettings('t1', { name: 'Only Name' });
    expect(h.repo.updateProgram).not.toHaveBeenCalled();
  });
});
