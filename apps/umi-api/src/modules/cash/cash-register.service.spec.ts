import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { CashRegisterService } from './cash-register.service';

function make() {
  const repo = {
    merchantConfig: vi.fn().mockResolvedValue({
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
  const qr = { generateRandomToken: vi.fn().mockReturnValue('qrtok') };
  const svc = new CashRegisterService(repo as never, qr as never);
  return { svc, repo, qr };
}

const INPUT = { name: 'Ana López', phone: '9991234567', birthDate: '1990-05-15' };

describe('CashRegisterService.register', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('creates the customer + card and returns a proof-required answer with no session', async () => {
    const r = await h.svc.register('t1', 'Kala', INPUT, 'ua/1.0');
    expect(h.repo.resolveContact).toHaveBeenCalledWith('t1', '9991234567', 'Ana López');
    expect(h.repo.updatePerson).toHaveBeenCalledWith('person-1', INPUT.name, INPUT.birthDate);
    expect(r).toEqual({
      verificationRequired: true,
      message: 'Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en Kala.',
    });
    expect(r).not.toHaveProperty('accessToken');
    // default prefix LYL + 10 digits
    const cardNumber = h.repo.createCard.mock.calls[0][0].cardNumber;
    expect(cardNumber).toMatch(/^LYL-\d{10}$/);
  });

  it('uses the merchant card prefix when configured', async () => {
    h.repo.merchantConfig.mockResolvedValue({
      name: 'Egret',
      loyaltyConfigured: true,
      cardPrefix: 'EGR',
      selfRegistration: true,
    });
    await h.svc.register('t1', 'Egret', INPUT, null);
    expect(h.repo.createCard.mock.calls[0][0].cardNumber).toMatch(/^EGR-\d{10}$/);
  });

  it('403 when self-registration is disabled', async () => {
    h.repo.merchantConfig.mockResolvedValue({
      name: 'X',
      loyaltyConfigured: true,
      cardPrefix: null,
      selfRegistration: false,
    });
    await expect(h.svc.register('t1', 'X', INPUT, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('500 when the merchant has no loyalty program', async () => {
    h.repo.merchantConfig.mockResolvedValue({
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

  it('returns the existing customer a proof-required answer without a second card', async () => {
    h.repo.findExisting.mockResolvedValue({
      personId: 'p9',
      displayName: 'Existing',
      hasCard: true,
      cardId: 'card-9',
      cardNumber: 'LYL-9999999999',
    });
    await expect(h.svc.register('t1', 'Kala', INPUT, null)).resolves.toEqual({
      verificationRequired: true,
      message: 'Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en Kala.',
    });
    expect(h.repo.createCard).not.toHaveBeenCalled();
    expect(h.repo.updatePerson).not.toHaveBeenCalled();
  });

  it('retries card creation on a card_number collision (23505)', async () => {
    h.repo.createCard
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce({ cardId: 'card-2', cardNumber: 'LYL-9999999999' });
    await h.svc.register('t1', 'Kala', INPUT, null);
    expect(h.repo.createCard).toHaveBeenCalledTimes(2);
  });
});

describe('CashRegisterService.registerStaff', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('creates a member and returns the card, with no customer token', async () => {
    const r = await h.svc.registerStaff('t1', 'Kala', INPUT);
    expect(r).toEqual({
      alreadyRegistered: false,
      customerId: 'person-1',
      cardId: 'card-1',
      cardNumber: expect.stringMatching(/^LYL-\d{10}$/),
      name: 'Ana López',
      message: '¡Bienvenido a Kala!',
    });
    expect(r).not.toHaveProperty('accessToken');
    expect(r).not.toHaveProperty('refreshToken');
  });

  it('returns the existing card without creating a second one', async () => {
    h.repo.findExisting.mockResolvedValue({
      personId: 'p9',
      displayName: 'Existing',
      hasCard: true,
      cardId: 'card-9',
      cardNumber: 'LYL-9999999999',
    });
    const r = await h.svc.registerStaff('t1', 'Kala', INPUT);
    expect(r).toEqual({
      alreadyRegistered: true,
      customerId: 'p9',
      cardId: 'card-9',
      cardNumber: 'LYL-9999999999',
      name: 'Existing',
      message: 'Este teléfono ya está registrado',
    });
    expect(h.repo.createCard).not.toHaveBeenCalled();
    expect(h.repo.updatePerson).not.toHaveBeenCalled();
  });

  it('creates a card for an existing customer who has none, without rewriting the profile', async () => {
    h.repo.findExisting.mockResolvedValue({
      personId: 'p9',
      displayName: 'Existing',
      hasCard: false,
      cardId: null,
      cardNumber: null,
    });
    const r = await h.svc.registerStaff('t1', 'Kala', INPUT);
    expect(r.alreadyRegistered).toBe(true);
    expect(h.repo.createCard).toHaveBeenCalledTimes(1);
    expect(h.repo.updatePerson).not.toHaveBeenCalled();
  });

  it('allows the counter when public self-registration is off', async () => {
    h.repo.merchantConfig.mockResolvedValue({
      name: 'Kala',
      loyaltyConfigured: true,
      cardPrefix: null,
      selfRegistration: false,
    });
    await expect(h.svc.registerStaff('t1', 'Kala', INPUT)).resolves.toMatchObject({
      alreadyRegistered: false,
    });
  });
});
