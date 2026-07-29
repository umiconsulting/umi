import { describe, expect, it, vi } from 'vitest';
import { PosCheckoutRepository, type CheckoutCart } from './pos-checkout.repository';

const cart: CheckoutCart = {
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  branchId: '00000000-0000-4000-8000-000000000003',
  operatorSessionId: '00000000-0000-4000-8000-000000000004',
  version: 2,
  businessDate: '2026-07-29',
  tenantName: 'UmiPOS Local',
  branchName: 'Sucursal Local',
  operatorName: 'Ada',
  customerId: null,
  lines: [
    {
      id: '00000000-0000-4000-8000-000000000005',
      productId: '00000000-0000-4000-8000-000000000006',
      variantId: null,
      quantity: 1,
      note: null,
      modifiers: [],
    },
  ],
};

describe('PosCheckoutRepository', () => {
  it('sends the reservation line snapshot as valid JSON', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000007',
          status: 'reserved',
          expiresAt: '2026-07-29T17:10:00.000Z',
        },
      ],
    });
    const repository = new PosCheckoutRepository({} as never);
    const snapshot = [{ productName: 'Café', quantity: 1 }];

    await repository.reserve({ query } as never, cart, snapshot);

    const parameters = query.mock.calls[0][1] as unknown[];
    expect(typeof parameters[4]).toBe('string');
    expect(JSON.parse(parameters[4] as string)).toEqual(snapshot);
  });
});
