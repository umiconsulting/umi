import { describe, expect, it, vi } from 'vitest';
import { CashCustomerController } from './cash-customer.controller';

describe('Cash customer registration response', () => {
  it('returns the existing session with 409 without passing it through the error filter', async () => {
    const session = {
      error: 'Este teléfono ya está registrado',
      accessToken: 'test-access',
      user: { id: 'customer', role: 'CUSTOMER' },
    };
    const controller = new CashCustomerController(
      { register: async () => ({ alreadyRegistered: true, ...session }) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const reply = { status: vi.fn() };
    expect(
      await controller.registerCustomer(
        { merchantId: 'merchant', name: 'Test' } as never,
        {} as never,
        undefined,
        reply as never,
      ),
    ).toEqual(session);
    expect(reply.status).toHaveBeenCalledWith(409);
  });

  it('keeps the new registration response and its default creation status', async () => {
    const session = { accessToken: 'test-access', cardId: 'card', user: { role: 'CUSTOMER' } };
    const controller = new CashCustomerController(
      { register: async () => session } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const reply = { status: vi.fn() };
    expect(
      await controller.registerCustomer(
        { merchantId: 'merchant', name: 'Test' } as never,
        {} as never,
        undefined,
        reply as never,
      ),
    ).toEqual(session);
    expect(reply.status).not.toHaveBeenCalled();
  });
});
