import { describe, expect, it, vi } from 'vitest';
import { CashRegisterService } from './cash-register.service';
import { CashCustomerController } from './cash-customer.controller';

/**
 * Synthetic reproduction of the public-registration identity gap.
 *
 * `POST /api/:merchantRef/customers` is public. It used to answer an existing
 * phone with a CUSTOMER access token, so a caller who knew a phone owned the
 * customer's card session. It also answered 409 `alreadyRegistered`, which told
 * the caller that the phone belonged to a customer.
 *
 * These tests use no database, no provider and no real phone. They assert the
 * contract that replaces the gap: registration never mints a session and never
 * reveals whether the phone is already known.
 */

const INPUT = { name: 'Ana López', phone: '9991234567', birthDate: '1990-05-15' };
const VERIFICATION_MESSAGE =
  'Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en Kala.';

function harness(existing: { personId: string; displayName: string | null; hasCard: boolean } | null) {
  const repo = {
    merchantConfig: vi.fn().mockResolvedValue({
      name: 'Kala',
      loyaltyConfigured: true,
      cardPrefix: null,
      selfRegistration: true,
    }),
    normalizePhone: vi.fn().mockResolvedValue('+5219991234567'),
    findExisting: vi.fn().mockResolvedValue(existing),
    resolveContact: vi.fn().mockResolvedValue('person-1'),
    updatePerson: vi.fn().mockResolvedValue(undefined),
    createCard: vi.fn().mockResolvedValue({ cardId: 'card-1', cardNumber: 'LYL-1234567890' }),
  };
  const qr = { generateRandomToken: vi.fn().mockReturnValue('qrtok') };
  const svc = new CashRegisterService(repo as never, qr as never);
  return { svc, repo };
}

describe('public Cash registration identity boundary', () => {
  it('mints no session for an existing phone that already has a card', async () => {
    const h = harness({ personId: 'p9', displayName: 'Existing', hasCard: true });
    const result = await h.svc.register('t1', 'Kala', INPUT, null);

    expect(result).toEqual({ verificationRequired: true, message: VERIFICATION_MESSAGE });
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('user');
    expect(result).not.toHaveProperty('cardNumber');
    expect(h.repo.createCard).not.toHaveBeenCalled();
    expect(h.repo.updatePerson).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing customer profile when the phone has no card', async () => {
    const h = harness({ personId: 'p9', displayName: 'Existing', hasCard: false });
    const result = await h.svc.register('t1', 'Kala', INPUT, null);

    expect(result).toEqual({ verificationRequired: true, message: VERIFICATION_MESSAGE });
    expect(h.repo.updatePerson).not.toHaveBeenCalled();
    expect(h.repo.createCard).toHaveBeenCalledTimes(1);
  });

  it('mints no session for a new phone', async () => {
    const h = harness(null);
    const result = await h.svc.register('t1', 'Kala', INPUT, null);

    expect(result).toEqual({ verificationRequired: true, message: VERIFICATION_MESSAGE });
    expect(result).not.toHaveProperty('accessToken');
    expect(h.repo.createCard).toHaveBeenCalledTimes(1);
    expect(h.repo.updatePerson).toHaveBeenCalledWith('person-1', INPUT.name, INPUT.birthDate);
  });

  it('returns one indistinguishable body for a new and an existing phone', async () => {
    const fresh = await harness(null).svc.register('t1', 'Kala', INPUT, null);
    const known = await harness({ personId: 'p9', displayName: 'Existing', hasCard: true }).svc.register(
      't1',
      'Kala',
      INPUT,
      null,
    );
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(known).sort());
    expect(fresh).toEqual(known);
  });
});

describe('public Cash registration response', () => {
  it('answers 202 with the verification contract and no credential', async () => {
    const register = {
      register: vi.fn().mockResolvedValue({
        verificationRequired: true,
        message: VERIFICATION_MESSAGE,
      }),
    };
    const controller = new CashCustomerController(
      register as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const body = await controller.registerCustomer(
      { merchantId: 'merchant', name: 'Kala' } as never,
      { name: 'Ana', phone: '9991234567', birthDate: '1990-05-15' },
      undefined,
    );

    expect(body).toEqual({ verificationRequired: true, message: VERIFICATION_MESSAGE });
  });
});
