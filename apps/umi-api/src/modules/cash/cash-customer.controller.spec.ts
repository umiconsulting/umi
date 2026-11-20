import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { CashCustomerController } from './cash-customer.controller';

const PAYLOAD = {
  verificationRequired: true,
  message: 'Solicitud recibida. Verifica tu teléfono para usar tu tarjeta en Test.',
};

describe('Cash customer registration response', () => {
  it('answers 202 with the proof-required body and no credential', async () => {
    const register = { register: vi.fn().mockResolvedValue(PAYLOAD) };
    const controller = new CashCustomerController(
      register as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const body = await controller.registerCustomer(
      { merchantId: 'merchant', name: 'Test' } as never,
      { name: 'Ana', phone: '9991234567', birthDate: '1990-05-15' },
      undefined,
    );

    expect(body).toEqual(PAYLOAD);
    expect(body).not.toHaveProperty('accessToken');
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, CashCustomerController.prototype.registerCustomer),
    ).toBe(202);
  });

  it('forwards the merchant, body and user agent to the service once', async () => {
    const register = { register: vi.fn().mockResolvedValue(PAYLOAD) };
    const controller = new CashCustomerController(
      register as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const dto = { name: 'Ana', phone: '9991234567', birthDate: '1990-05-15' };

    await controller.registerCustomer(
      { merchantId: 'merchant', name: 'Test' } as never,
      dto,
      'ua/1.0',
    );

    expect(register.register).toHaveBeenCalledWith('merchant', 'Test', dto, 'ua/1.0');
  });
});
