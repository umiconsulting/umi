import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { CashRegisterService } from './cash-register.service';

function make() {
  const repo = {
    tenantConfig: vi
      .fn()
      .mockResolvedValue({
        name: 'Kala',
        loyaltyConfigured: true,
        cardPrefix: null,
        selfRegistration: true,
      }),
    normalizePhone: vi.fn().mockResolvedValue('+5219991234567'),
    findExisting: vi.fn().mockResolvedValue(null),
    resolveContact: vi.fn().mockResolvedValue('person-1'),
    updatePerson: vi.fn().mockResolvedValue(undefined),
    createCard: vi.fn().mockResolvedValue({ cardId: 'card-1', cardNumber: 'LYL-1234567890' }),
  };
  const session = {
    createSession: vi.fn().mockResolvedValue({ accessToken: 'acc', refreshToken: 'ref' }),
  };
  const qr = { generateRandomToken: vi.fn().mockReturnValue('qrtok') };
  const svc = new CashRegisterService(repo as never, session as never, qr as never);
  return { svc, repo, session, qr };
}

const INPUT = { name: 'Ana López', phone: '9991234567', birthDate: '1990-05-15' };

describe('CashRegisterService.register', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('creates person + account + card and returns a 201 session payload', async () => {
    const r = await h.svc.register('t1', 'Kala', INPUT, 'ua/1.0');
    expect(h.repo.resolveContact).toHaveBeenCalledWith('t1', '9991234567', 'Ana López');
    expect(r.userId).toBe('person-1');
    expect(r.cardId).toBe('card-1');
    expect(r.accessToken).toBe('acc');
    expect(r.message).toBe('¡Bienvenido a Kala!');
    // default prefix LYL + 10 digits
    const cardNumber = h.repo.createCard.mock.calls[0][0].cardNumber;
    expect(cardNumber).toMatch(/^LYL-\d{10}$/);
  });

  it('uses the tenant card prefix when configured', async () => {
    h.repo.tenantConfig.mockResolvedValue({
      name: 'Egret',
      loyaltyConfigured: true,
      cardPrefix: 'EGR',
      selfRegistration: true,
    });
    await h.svc.register('t1', 'Egret', INPUT, null);
    expect(h.repo.createCard.mock.calls[0][0].cardNumber).toMatch(/^EGR-\d{10}$/);
  });

  it('403 when self-registration is disabled', async () => {
    h.repo.tenantConfig.mockResolvedValue({
      name: 'X',
      loyaltyConfigured: true,
      cardPrefix: null,
      selfRegistration: false,
    });
    await expect(h.svc.register('t1', 'X', INPUT, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('500 when the tenant has no loyalty program', async () => {
    h.repo.tenantConfig.mockResolvedValue({
      name: 'X',
      loyaltyConfigured: false,
      cardPrefix: null,
      selfRegistration: true,
    });
    await expect(h.svc.register('t1', 'X', INPUT, null)).rejects.toBeInstanceOf(HttpException);
  });

  it('400 on an unparseable phone', async () => {
    h.repo.normalizePhone.mockResolvedValue(null);
    await expect(h.svc.register('t1', 'Kala', INPUT, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('409 + session when the phone already has a card', async () => {
    h.repo.findExisting.mockResolvedValue({
      personId: 'p9',
      displayName: 'Existing',
      hasCard: true,
    });
    await expect(h.svc.register('t1', 'Kala', INPUT, null)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.session.createSession).toHaveBeenCalledWith('p9', 'CUSTOMER', 't1');
    expect(h.repo.createCard).not.toHaveBeenCalled();
  });

  it('retries card creation on a card_number collision (23505)', async () => {
    h.repo.createCard
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce({ cardId: 'card-2', cardNumber: 'LYL-9999999999' });
    const r = await h.svc.register('t1', 'Kala', INPUT, null);
    expect(h.repo.createCard).toHaveBeenCalledTimes(2);
    expect(r.cardId).toBe('card-2');
  });
});
