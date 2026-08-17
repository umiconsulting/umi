import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CashScanService } from './cash-scan.service';

function make() {
  const qr = {
    verifyQRPayload: vi
      .fn()
      .mockResolvedValue({ cardId: 'card-uuid', qrToken: 'tok', isWalletScan: false }),
    generateRandomToken: vi.fn().mockReturnValue('rotated-token'),
  };
  const cards = {
    findCard: vi.fn(),
    getStaffMemberId: vi.fn().mockResolvedValue('staff-1'),
    getUserPersonId: vi.fn().mockResolvedValue(null),
    findPersonCard: vi.fn().mockResolvedValue(null),
  };
  const repo = {
    merchantConfig: vi.fn().mockResolvedValue({
      name: 'Kala',
      timezone: 'America/Mexico_City',
      lifecycleCopy: {},
      birthdayRewardName: 'Café gratis',
    }),
    activeRewardConfig: vi
      .fn()
      .mockResolvedValue({ id: 'rc1', visits_required: 10, reward_name: 'Café' }),
    recentVisitWithin: vi.fn().mockResolvedValue(false),
    visitedToday: vi.fn().mockResolvedValue(false),
    lastVisitToday: vi.fn().mockResolvedValue(null),
    recentRedemptionWithin: vi.fn().mockResolvedValue(false),
    activeBirthdayReward: vi.fn().mockResolvedValue(null),
    isAfterHours: vi.fn().mockResolvedValue(false),
    performScan: vi.fn().mockResolvedValue({
      total_visits: 6,
      visits_this_cycle: 4,
      pending_rewards: 0,
      balance_cents: 0,
      card_number: 'KAL-1',
    }),
  };
  const walletPass = { refreshCard: vi.fn().mockResolvedValue(undefined) };
  const email = { send: vi.fn().mockResolvedValue(null) };
  const svc = new CashScanService(
    qr as never,
    cards as never,
    repo as never,
    walletPass as never,
    email as never,
  );
  return { svc, qr, cards, repo, walletPass, email };
}

const CARD = {
  id: 'card-uuid',
  card_number: 'KAL-1',
  qr_token: 'tok',
  total_visits: 5,
  visits_this_cycle: 3,
  pending_rewards: 0,
  balance_cents: 0,
  person_id: 'p1',
  display_name: 'Ana',
  normalized_email: null,
};

describe('CashScanService.scan — visit cycle', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.cards.findCard.mockResolvedValue(CARD);
  });

  it('records a non-earning visit (cycle +1, no reward)', async () => {
    const r = await h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' });
    const arg = h.repo.performScan.mock.calls[0][0];
    expect(arg.doVisit).toBe(true);
    expect(arg.earnedReward).toBe(false);
    expect(arg.newVisitsThisCycle).toBe(4);
    expect(arg.momentMessage).toBeNull();
    expect(r.rewardEarned).toBe(false);
    expect(r.actions).toEqual(['VISIT']);
  });

  it('earns a reward at the threshold visit (>=) and renders reward_earned moment', async () => {
    h.cards.findCard.mockResolvedValue({ ...CARD, visits_this_cycle: 9 });
    h.repo.performScan.mockResolvedValue({
      total_visits: 6,
      visits_this_cycle: 0,
      pending_rewards: 1,
      balance_cents: 0,
      card_number: 'KAL-1',
    });
    const r = await h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' });
    const arg = h.repo.performScan.mock.calls[0][0];
    expect(arg.earnedReward).toBe(true);
    expect(arg.momentMessage).toContain('¡Ganaste Café!');
    expect(r.rewardEarned).toBe(true);
  });

  it('sorts actions into BIRTHDAY→REDEEM→VISIT regardless of input order', async () => {
    h.cards.findCard.mockResolvedValue({ ...CARD, pending_rewards: 2 });
    h.repo.activeBirthdayReward.mockResolvedValue({ id: 'b1' });
    await h.svc.scan('t1', 'u1', {
      qrPayload: 'jwt',
      actions: ['VISIT', 'BIRTHDAY_REDEEM', 'REDEEM'],
    });
    const arg = h.repo.performScan.mock.calls[0][0];
    expect(arg.doBirthday && arg.doRedeem && arg.doVisit).toBe(true);
  });
});

describe('CashScanService.scan — guards', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.cards.findCard.mockResolvedValue(CARD);
  });

  it('404 when a hand-typed identifier matches no card', async () => {
    h.qr.verifyQRPayload.mockResolvedValue(null);
    h.cards.findCard.mockResolvedValue(null);
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'KAL-404', action: 'VISIT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 when a verified code is stale', async () => {
    h.qr.verifyQRPayload.mockResolvedValue({
      cardId: 'card-uuid',
      qrToken: 'old',
      isWalletScan: false,
    });
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 when the card is not found', async () => {
    h.cards.findCard.mockResolvedValue(null);
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 when an in-app QR token no longer matches (already used)', async () => {
    h.cards.findCard.mockResolvedValue({ ...CARD, qr_token: 'rotated-away' });
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('403 when scanning your own card', async () => {
    h.cards.getUserPersonId.mockResolvedValue('p1');
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('429 on a second visit the same day', async () => {
    h.repo.visitedToday.mockResolvedValue(true);
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('429 on a wallet replay within 60s', async () => {
    h.qr.verifyQRPayload.mockResolvedValue({ cardId: 'KAL-1', qrToken: '', isWalletScan: true });
    h.repo.recentVisitWithin.mockResolvedValue(true);
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'VISIT' }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('400 redeem with no pending rewards', async () => {
    await expect(
      h.svc.scan('t1', 'u1', { qrPayload: 'jwt', action: 'REDEEM' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Preview reads a card and writes nothing. Staff tap it before they commit a
 * visit, so the register can show who the customer is and what the scan will do.
 */
describe('CashScanService.preview', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.cards.findCard.mockResolvedValue({ ...CARD, balance_cents: 12550 });
  });

  it('reads the card and does not write', async () => {
    const r = await h.svc.preview('t1', 'u1', { qrPayload: 'jwt' });

    expect(r.cardId).toBe('card-uuid');
    expect(r.cardNumber).toBe('KAL-1');
    expect(r.customer.name).toBe('Ana');
    expect(r.card.visitsThisCycle).toBe(3);
    expect(r.card.visitsRequired).toBe(10);
    expect(r.card.pendingRewards).toBe(0);
    expect(r.card.balanceCentavos).toBe(12550);
    expect(r.card.rewardName).toBe('Café');
    expect(r.card.visitLimitReached).toBe(false);
    expect(h.repo.performScan).not.toHaveBeenCalled();
    expect(h.walletPass.refreshCard).not.toHaveBeenCalled();
  });

  it('refuses a card that belongs to the staff member reading it', async () => {
    h.cards.getUserPersonId.mockResolvedValue('p1'); // same person as CARD

    await expect(h.svc.preview('t1', 'u1', { qrPayload: 'jwt' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('marks the daily limit and says when the card was last stamped', async () => {
    const at = new Date('2026-08-16T15:04:05.000Z');
    h.repo.lastVisitToday.mockResolvedValue(at);

    const r = await h.svc.preview('t1', 'u1', { qrPayload: 'jwt' });

    expect(r.card.visitLimitReached).toBe(true);
    expect(r.card.lastVisitAt).toBe('2026-08-16T15:04:05.000Z');
  });

  it('surfaces an active birthday reward with the merchant name for it', async () => {
    h.repo.activeBirthdayReward.mockResolvedValue({ id: 'br-1' });

    const r = await h.svc.preview('t1', 'u1', { qrPayload: 'jwt' });

    expect(r.birthdayReward).toEqual({ id: 'br-1', rewardName: 'Café gratis' });
  });

  it('reports no birthday reward when none is active', async () => {
    const r = await h.svc.preview('t1', 'u1', { qrPayload: 'jwt' });

    expect(r.birthdayReward).toBeNull();
  });

  it('reports an unknown card as not found, not as a bad code', async () => {
    h.cards.findCard.mockResolvedValue(null);

    await expect(h.svc.preview('t1', 'u1', { qrPayload: 'KAL-404' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * umi-cash shipped this bug and then fixed it with one shared resolver: a phone
 * number previewed fine and then failed on commit, because only the commit
 * demanded a signed payload. Both paths must accept the same input.
 */
describe('CashScanService — preview and commit resolve the same input', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.qr.verifyQRPayload.mockResolvedValue(null); // hand-typed, no signed payload
  });

  it('accepts a card number on both paths', async () => {
    h.cards.findCard.mockResolvedValue(CARD);

    const preview = await h.svc.preview('t1', 'u1', { qrPayload: 'KAL-1' });
    const commit = await h.svc.scan('t1', 'u1', { qrPayload: 'KAL-1', action: 'VISIT' });

    expect(preview.cardId).toBe('card-uuid');
    expect(commit.success).toBe(true);
  });

  it('accepts a phone number on both paths', async () => {
    h.cards.findCard.mockResolvedValueOnce(null).mockResolvedValue(CARD);
    h.cards.findPersonCard.mockResolvedValue({
      personId: 'p9',
      displayName: 'Ana',
      cardId: 'card-uuid',
    });

    const preview = await h.svc.preview('t1', 'u1', { qrPayload: '5512345678' });
    expect(preview.cardId).toBe('card-uuid');

    h.cards.findCard.mockResolvedValueOnce(null).mockResolvedValue(CARD);
    const commit = await h.svc.scan('t1', 'u1', { qrPayload: '5512345678', action: 'VISIT' });
    expect(commit.success).toBe(true);
  });

  it('does not enforce token freshness on hand-typed entry', async () => {
    h.cards.findCard.mockResolvedValue({ ...CARD, qr_token: 'something-else' });

    await expect(h.svc.preview('t1', 'u1', { qrPayload: 'KAL-1' })).resolves.toBeTruthy();
  });
});
