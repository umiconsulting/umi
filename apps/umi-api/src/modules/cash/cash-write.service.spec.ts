import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { CashWriteService } from './cash-write.service';
import {
  GiftCardAlreadyRedeemedError,
  InsufficientBalanceError,
} from './cash-write.repository';

function make() {
  const repo = {
    findCard: vi.fn(),
    getStaffMemberId: vi.fn().mockResolvedValue('staff-1'),
    getUserPersonId: vi.fn().mockResolvedValue(null),
    topupGuards: vi.fn().mockResolvedValue({ staffSum: 0, cardSum: 0, cardCount: 0 }),
    creditWallet: vi.fn(),
    purchase: vi.fn(),
    insertGiftCard: vi.fn(),
    findGiftCardByCode: vi.fn(),
    findPersonCard: vi.fn(),
    redeemGiftCard: vi.fn(),
  };
  const walletPass = { refreshCard: vi.fn().mockResolvedValue(undefined) };
  const svc = new CashWriteService(repo as never, walletPass as never);
  return { svc, repo, walletPass };
}

const CARD = {
  id: 'card-1',
  card_number: 'KAL-001',
  balance_cents: 0,
  person_id: 'person-9',
  display_name: 'Ana',
};

describe('CashWriteService.topup', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findCard.mockResolvedValue(CARD);
    h.repo.creditWallet.mockResolvedValue(15000);
  });

  it('credits the wallet and refreshes the pass', async () => {
    const r = await h.svc.topup('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 15000 });
    expect(h.repo.creditWallet).toHaveBeenCalledOnce();
    expect(h.repo.creditWallet.mock.calls[0][0]).toMatchObject({ type: 'topup', deltaCents: 15000 });
    expect(h.walletPass.refreshCard).toHaveBeenCalledWith('card-1');
    expect(r.newBalanceCentavos).toBe(15000);
  });

  it('rejects amounts outside the bounds', async () => {
    await expect(h.svc.topup('t1', 'u1', { cardId: 'x', amountCentavos: 50 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.topup('t1', 'u1', { cardId: 'x', amountCentavos: 2_000_000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks topping up your own card', async () => {
    h.repo.getUserPersonId.mockResolvedValue('person-9'); // == card.person_id
    await expect(
      h.svc.topup('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 10000 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.repo.creditWallet).not.toHaveBeenCalled();
  });

  it('enforces the per-card daily count limit (429)', async () => {
    h.repo.topupGuards.mockResolvedValue({ staffSum: 0, cardSum: 0, cardCount: 3 });
    await expect(
      h.svc.topup('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 10000 }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('enforces the staff daily amount limit (429)', async () => {
    h.repo.topupGuards.mockResolvedValue({ staffSum: 495_000, cardSum: 0, cardCount: 0 });
    await expect(
      h.svc.topup('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 10_000 }),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe('CashWriteService.purchase', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.findCard.mockResolvedValue(CARD);
  });

  it('debits and returns the new balance', async () => {
    h.repo.purchase.mockResolvedValue(4000);
    const r = await h.svc.purchase('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 1000 });
    expect(h.repo.purchase.mock.calls[0][0]).toMatchObject({ deltaCents: -1000, type: 'purchase' });
    expect(r.newBalanceMXN).toContain('40');
  });

  it('maps insufficient balance to a 400 with the available amount', async () => {
    h.repo.purchase.mockRejectedValue(new InsufficientBalanceError(500));
    await expect(
      h.svc.purchase('t1', 'u1', { cardId: 'KAL-001', amountCentavos: 1000 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CashWriteService.issueGiftCard', () => {
  it('retries on a code collision then succeeds', async () => {
    const h = make();
    h.repo.insertGiftCard
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce({ id: 'g1', code: 'AAAA-BBBB', amount_cents: 20000 });
    const r = await h.svc.issueGiftCard('t1', 'u1', { amountCentavos: 20000, recipientEmail: 'a@b.co' });
    expect(h.repo.insertGiftCard).toHaveBeenCalledTimes(2);
    expect(r.giftCard.code).toBe('AAAA-BBBB');
  });
});

describe('CashWriteService.redeemGiftCard', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('404s an unknown code', async () => {
    h.repo.findGiftCardByCode.mockResolvedValue(null);
    await expect(h.svc.redeemGiftCard('t1', 'abc', { phone: '+52' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an already-redeemed card', async () => {
    h.repo.findGiftCardByCode.mockResolvedValue({ id: 'g1', amount_cents: 5000, redeemed_at: new Date(), expires_at: null });
    await expect(h.svc.redeemGiftCard('t1', 'abc', { phone: '+52' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('asks for registration when no card matches the contact', async () => {
    h.repo.findGiftCardByCode.mockResolvedValue({ id: 'g1', amount_cents: 5000, redeemed_at: null, expires_at: null, sender_name: 'X' });
    h.repo.findPersonCard.mockResolvedValue(null);
    await expect(h.svc.redeemGiftCard('t1', 'abc', { email: 'x@y.co' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('credits the recipient wallet when valid', async () => {
    h.repo.findGiftCardByCode.mockResolvedValue({ id: 'g1', amount_cents: 5000, redeemed_at: null, expires_at: null, sender_name: 'X' });
    h.repo.findPersonCard.mockResolvedValue({ personId: 'p1', displayName: 'Ana', cardId: 'card-1' });
    h.repo.redeemGiftCard.mockResolvedValue(5000);
    const r = await h.svc.redeemGiftCard('t1', 'abc', { phone: '+52' });
    expect(r.newBalanceMXN).toContain('50');
    expect(h.walletPass.refreshCard).toHaveBeenCalledWith('card-1');
  });

  it('maps a redeem race to already-redeemed', async () => {
    h.repo.findGiftCardByCode.mockResolvedValue({ id: 'g1', amount_cents: 5000, redeemed_at: null, expires_at: null, sender_name: 'X' });
    h.repo.findPersonCard.mockResolvedValue({ personId: 'p1', displayName: 'Ana', cardId: 'card-1' });
    h.repo.redeemGiftCard.mockRejectedValue(new GiftCardAlreadyRedeemedError());
    await expect(h.svc.redeemGiftCard('t1', 'abc', { phone: '+52' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
