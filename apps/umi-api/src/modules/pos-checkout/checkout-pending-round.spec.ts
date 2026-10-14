import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PosCheckoutRepository } from './pos-checkout.repository';
import { appendOrderItems, writeOrder } from '../../shared/orders/order-writer';

vi.mock('../../shared/orders/order-writer', () => ({
  writeOrder: vi.fn(),
  appendOrderItems: vi.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const money = { minorUnits: 5000, currency: 'MXN' };
const cart = {
  id: id(1),
  merchantId: id(2),
  locationId: id(3),
  customerId: null,
  fulfillmentType: 'dine_in',
  businessDate: '2026-10-12',
  lines: [
    { id: id(4), productId: id(6), courseNumber: 1 },
    { id: id(5), productId: id(7), courseNumber: 2 },
  ],
};
const receipt = {
  grandTotal: money,
  lines: [
    { description: 'Coffee', quantity: 1, unitPrice: money, modifiers: [] },
    {
      description: 'Dessert',
      quantity: 1,
      unitPrice: money,
      note: 'No nuts',
      modifiers: ['Chocolate'],
    },
  ],
};

describe('checkout sends pending rounds', () => {
  beforeEach(() => vi.resetAllMocks());

  async function run(pendingIds: string[]) {
    const stop = new Error('STOP_AFTER_ORDER');
    const client = {
      query: vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql.includes('commit_customer_value_closeout')) throw stop;
        // The ticket counter answers the number the receipt then carries. A double that
        // returned nothing here would fail the commit with a TypeError instead of a checkout.
        if (sql.includes('merchant.receipt_counter')) {
          return { rows: [{ folio: '7' }], rowCount: 1 };
        }
        if (
          sql.includes('INSERT INTO merchant.receipt_snapshot') ||
          sql.includes('INSERT INTO merchant.pos_committed_sale')
        ) {
          return { rows: [{ id: id(30) }], rowCount: 1 };
        }
        if (sql.includes('SELECT id::text FROM merchant.pos_cart_line')) {
          return { rows: pendingIds.map((value) => ({ id: value })) };
        }
        // `syncCartOrderContext` reads the account context off the cart and REFUSES when the
        // row is not there, so a double that answers nothing fails the commit with
        // CART_CONTEXT_NOT_FOUND before it ever reaches the statements under test.
        if (sql.includes('FROM merchant.pos_cart WHERE merchant_id')) {
          return {
            rows: [
              {
                locationId: id(3),
                fulfillmentType: 'dine_in',
                context: { accountFolio: 'Cuenta 042' },
                reference: 'Cuenta 042',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const repository = new PosCheckoutRepository({} as never);
    await expect(
      repository.commit(
        client as never,
        cart as never,
        { totals: { grandTotal: money } } as never,
        [{ attempt: { id: id(20), amount: money, method: 'manual_terminal' } }] as never,
        { tenders: [] } as never,
        id(21),
        {} as never,
        receipt as never,
        null,
        id(22),
        { deviceId: id(23) } as never,
        id(24),
        id(25),
        'basis',
        null,
      ),
    ).rejects.toBe(stop);
    return client.query;
  }

  it('appends only the new dessert to the original order before recording payment', async () => {
    vi.mocked(writeOrder).mockResolvedValue({ orderId: id(10), lineIds: [id(11)], created: false });
    vi.mocked(appendOrderItems).mockResolvedValue({ lineIds: [id(12)] });
    const query = await run([id(5)]);
    expect(appendOrderItems).toHaveBeenCalledOnce();
    expect(vi.mocked(appendOrderItems).mock.calls[0][1]).toEqual({
      merchantId: id(2),
      orderId: id(10),
      lines: [
        {
          productId: id(7),
          name: 'Dessert',
          variantName: null,
          quantity: 1,
          courseNumber: 2,
          unitPriceCents: 5000,
          notes: 'No nuts',
          modifiers: [{ name: 'Chocolate', priceDeltaCents: 0 }],
        },
      ],
    });
    const updates = query.mock.calls.filter(([sql]) =>
      sql.includes('UPDATE merchant.pos_cart_line'),
    );
    expect(updates).toHaveLength(1);
    const inventoryIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('commit_sale_inventory'),
    );
    const mappingIndex = query.mock.calls.findIndex(([sql]) =>
      sql.includes('UPDATE merchant.pos_cart_line'),
    );
    expect(mappingIndex).toBeGreaterThan(inventoryIndex);
    expect(updates[0][1]).toEqual([id(2), id(5), id(12)]);
  });

  it('does not send an already sent round again', async () => {
    vi.mocked(writeOrder).mockResolvedValue({
      orderId: id(10),
      lineIds: [id(11), id(12)],
      created: false,
    });
    const query = await run([]);
    expect(appendOrderItems).not.toHaveBeenCalled();
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('UPDATE merchant.pos_cart_line')),
    ).toHaveLength(0);
  });

  it('maps a first checkout order without appending a duplicate kitchen round', async () => {
    vi.mocked(writeOrder).mockResolvedValue({
      orderId: id(10),
      lineIds: [id(11), id(12)],
      created: true,
    });
    const query = await run([id(4), id(5)]);
    expect(appendOrderItems).not.toHaveBeenCalled();
    const updates = query.mock.calls.filter(([sql]) =>
      sql.includes('UPDATE merchant.pos_cart_line'),
    );
    expect(updates.map((call) => call[1])).toEqual([
      [id(2), id(4), id(11)],
      [id(2), id(5), id(12)],
    ]);
  });
});
