import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CashCardService } from './cash-card.service';

function make() {
  const repo = {
    cardForCustomer: vi.fn().mockResolvedValue({
      id: 'card-1',
      qr_token: 'tok-abc',
      customer_name: 'Ana',
    }),
    cardState: vi.fn().mockResolvedValue({
      card_number: 'KAL-1',
      total_visits: 13,
      visits_this_cycle: 3,
      pending_rewards: 1,
      balance_cents: 12550,
      visits_required: 10,
    }),
    recentVisits: vi.fn().mockResolvedValue([
      { id: 'v1', occurred_at: new Date('2026-08-10T18:00:00.000Z') },
      { id: 'v2', occurred_at: new Date('2026-08-03T18:00:00.000Z') },
    ]),
    recentLedger: vi.fn().mockResolvedValue([
      {
        id: 'l1',
        reason: 'topup',
        delta: 10000,
        note: 'Recarga',
        created_at: new Date('2026-08-10T18:00:00.000Z'),
      },
    ]),
  };
  const scan = {
    activeRewardConfig: vi.fn().mockResolvedValue({
      id: 'rc1',
      visits_required: 10,
      reward_name: 'Café gratis',
      reward_description: 'Cualquier bebida del menú',
    }),
  };
  const qr = {
    signQRPayload: vi.fn().mockResolvedValue('signed.jwt.payload'),
  };
  const svc = new CashCardService(repo as never, scan as never, qr as never);
  return { svc, repo, scan, qr };
}

describe('CashCardService.card', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
  });

  it('reports the derived state, not a stored one', async () => {
    const r = await h.svc.card('m1', 'cust-1', 'Kalala Café');

    expect(r.cardId).toBe('card-1');
    expect(r.cardNumber).toBe('KAL-1');
    expect(r.customerName).toBe('Ana');
    expect(r.tenantName).toBe('Kalala Café');
    expect(r.totalVisits).toBe(13);
    expect(r.visitsThisCycle).toBe(3);
    expect(r.pendingRewards).toBe(1);
    expect(r.balanceCentavos).toBe(12550);
    expect(r.balanceMXN).toBe('$125.50');
  });

  it('reads the threshold that produced the cycle, not a hardcoded ten', async () => {
    h.scan.activeRewardConfig.mockResolvedValue({
      id: 'rc2',
      visits_required: 8,
      reward_name: 'Postre',
      reward_description: null,
    });

    const r = await h.svc.card('m1', 'cust-1', 'Kalala Café');

    expect(r.visitsRequired).toBe(8);
    expect(r.rewardName).toBe('Postre');
    expect(r.rewardDescription).toBeNull();
  });

  it('falls back to the default reward when the café configured none', async () => {
    h.scan.activeRewardConfig.mockResolvedValue(null);

    const r = await h.svc.card('m1', 'cust-1', 'Kalala Café');

    expect(r.visitsRequired).toBe(10);
    expect(r.rewardName).toBe('Recompensa de temporada');
    expect(r.rewardDescription).toBeNull();
  });

  it('caps the progress bar at 100 when the cycle overshoots', async () => {
    h.repo.cardState.mockResolvedValue({
      card_number: 'KAL-1',
      total_visits: 30,
      visits_this_cycle: 12,
      pending_rewards: 3,
      balance_cents: 0,
      visits_required: 10,
    });

    const r = await h.svc.card('m1', 'cust-1', 'Kalala Café');

    expect(r.progressPercent).toBe(100);
  });

  it('renders the history as ISO strings the page can parse', async () => {
    const r = await h.svc.card('m1', 'cust-1', 'Kalala Café');

    expect(r.recentVisits).toEqual([
      { id: 'v1', scannedAt: '2026-08-10T18:00:00.000Z' },
      { id: 'v2', scannedAt: '2026-08-03T18:00:00.000Z' },
    ]);
    expect(r.recentTransactions).toEqual([
      {
        id: 'l1',
        type: 'topup',
        amountCentavos: 10000,
        description: 'Recarga',
        createdAt: '2026-08-10T18:00:00.000Z',
      },
    ]);
  });

  it('404s when the customer holds no card at this café', async () => {
    h.repo.cardForCustomer.mockResolvedValue(null);

    await expect(h.svc.card('m1', 'cust-1', 'Kalala Café')).rejects.toThrow(NotFoundException);
  });
});

describe('CashCardService.qr', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
  });

  it('signs the card id together with the nonce the register will check', async () => {
    const r = await h.svc.qr('m1', 'cust-1');

    expect(h.qr.signQRPayload).toHaveBeenCalledWith('card-1', 'tok-abc');
    expect(r.payload).toBe('signed.jwt.payload');
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('tells the page when to come back for a fresh code', async () => {
    const before = Date.now();
    const r = await h.svc.qr('m1', 'cust-1');
    const expiresAt = Date.parse(r.expiresAt);

    // Five minutes, matching the expiry signed into the token itself.
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  });

  it('404s when the customer holds no card at this café', async () => {
    h.repo.cardForCustomer.mockResolvedValue(null);

    await expect(h.svc.qr('m1', 'cust-1')).rejects.toThrow(NotFoundException);
  });

  it('signs an empty nonce for a card that carries none, rather than inventing one', async () => {
    h.repo.cardForCustomer.mockResolvedValue({
      id: 'card-1',
      qr_token: null,
      customer_name: 'Ana',
    });

    await h.svc.qr('m1', 'cust-1');

    expect(h.qr.signQRPayload).toHaveBeenCalledWith('card-1', '');
  });
});
