import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CartTools } from './cart.tools';
import { CheckoutTools } from './checkout.tools';
import type { ProductRecord } from './product-search';
import type { ToolContext } from '../turn.types';

const CTX: ToolContext = {
  tenantId: 't1',
  personId: 'p1',
  conversationId: 'c1',
  turnId: 'turn-9',
  locationId: null,
  customerPhone: '+5210000000000',
};

const latte: ProductRecord & { available: boolean } = {
  id: 'p-latte',
  name: 'Latte',
  price: 50,
  available: true,
  variants: [
    { name: 'CH, CALIENTE', price: 50 },
    { name: 'GDE, CALIENTE', price: 60 },
  ],
};

describe('CartTools.addToCart', () => {
  it('resolves the variant and writes the draft cart', async () => {
    const products = {
      searchByQuery: vi.fn().mockResolvedValue([latte]),
      categorySuggestions: vi.fn().mockResolvedValue([]),
    };
    const conversations = {
      loadById: vi.fn().mockResolvedValue({ draftCart: null, draftCartVersion: 0 }),
      updateDraftCartCas: vi.fn().mockResolvedValue(1),
    };
    const cart = new CartTools(products as never, conversations as never);

    const r = await cart.addToCart(CTX, { query: 'latte grande', quantity: 1 });
    expect(r.success).toBe(true);
    expect(r.total).toBe(60); // GDE variant, pesos
    expect(conversations.updateDraftCartCas).toHaveBeenCalledTimes(1);
    const writtenCart = conversations.updateDraftCartCas.mock.calls[0][2];
    expect(writtenCart.items[0]).toMatchObject({
      product_id: 'p-latte',
      variant_name: 'GDE, CALIENTE',
      quantity: 1,
      unit_price: 60,
    });
  });
});

describe('CheckoutTools.confirmOrder', () => {
  let orders: { createOrder: ReturnType<typeof vi.fn> };
  let products: { getByIds: ReturnType<typeof vi.fn> };
  let conversations: { loadById: ReturnType<typeof vi.fn>; updateDraftCartCas: ReturnType<typeof vi.fn> };
  let hours: { checkOrderingEnabled: ReturnType<typeof vi.fn>; isWithinOrderHours: ReturnType<typeof vi.fn>; getOrdersClosedMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    orders = { createOrder: vi.fn().mockResolvedValue({ orderId: 'o-1', total: 60, created: true }) };
    products = { getByIds: vi.fn().mockResolvedValue(new Map([['p-latte', latte]])) };
    conversations = {
      loadById: vi.fn().mockResolvedValue({
        draftCart: {
          items: [{ product_id: 'p-latte', product_name: 'Latte', variant_name: 'GDE, CALIENTE', quantity: 1, unit_price: 60 }],
          updated_at: new Date(0).toISOString(),
          customer_note: null,
        },
        draftCartVersion: 3,
      }),
      updateDraftCartCas: vi.fn().mockResolvedValue(4),
    };
    hours = {
      checkOrderingEnabled: vi.fn().mockResolvedValue({ enabled: true, disabledMessage: null }),
      isWithinOrderHours: vi.fn().mockResolvedValue(true),
      getOrdersClosedMessage: vi.fn().mockResolvedValue('cerrado'),
    };
  });

  it('creates an order with a deterministic per-turn idempotency key and clears the cart', async () => {
    const checkout = new CheckoutTools(
      orders as never,
      products as never,
      conversations as never,
      hours as never,
    );
    const r = await checkout.confirmOrder(CTX, {});
    expect(r.success).toBe(true);
    expect(r.order_id).toBe('o-1');
    expect(orders.createOrder).toHaveBeenCalledTimes(1);
    // The bug fix: idempotency key is the turn, not a fresh UUID.
    expect(orders.createOrder.mock.calls[0][0].sourceTransactionId).toBe('conversaflow:turn:turn-9');
    // Draft cart cleared at the version it was read at.
    expect(conversations.updateDraftCartCas).toHaveBeenCalledWith('c1', 3, null);
  });

  it('blocks confirmation when ordering is paused', async () => {
    hours.checkOrderingEnabled.mockResolvedValue({ enabled: false, disabledMessage: 'pausado' });
    const checkout = new CheckoutTools(orders as never, products as never, conversations as never, hours as never);
    const r = await checkout.confirmOrder(CTX, {});
    expect(r.success).toBe(false);
    expect(orders.createOrder).not.toHaveBeenCalled();
  });
});

describe('CheckoutTools.cancelOrder', () => {
  const draftCart = {
    items: [{ product_id: 'p-latte', product_name: 'Latte', variant_name: 'GDE, CALIENTE', quantity: 1, unit_price: 60 }],
    updated_at: new Date(0).toISOString(),
    customer_note: null,
  };

  it('clears an in-progress draft cart (not a confirmed order)', async () => {
    const orders = { recentOrders: vi.fn(), markCancelled: vi.fn() };
    const conversations = {
      loadById: vi.fn().mockResolvedValue({ draftCart, draftCartVersion: 7 }),
      updateDraftCartCas: vi.fn().mockResolvedValue(8),
    };
    const checkout = new CheckoutTools(orders as never, {} as never, conversations as never, {} as never);

    const r = await checkout.cancelOrder(CTX, 'ya no quiero');
    expect(r.success).toBe(true);
    // Draft cart emptied at the read version; ops.orders never consulted.
    expect(conversations.updateDraftCartCas).toHaveBeenCalledWith('c1', 7, null);
    expect(orders.recentOrders).not.toHaveBeenCalled();
    expect(orders.markCancelled).not.toHaveBeenCalled();
  });

  it('falls back to cancelling a confirmed, not-yet-started order when no draft cart', async () => {
    const orders = {
      recentOrders: vi.fn().mockResolvedValue([{ id: 'o-9', status: 'pending', kitchenStatus: 'new', items: [{}] }]),
      markCancelled: vi.fn().mockResolvedValue(undefined),
    };
    const conversations = {
      loadById: vi.fn().mockResolvedValue({ draftCart: null, draftCartVersion: 0 }),
      updateDraftCartCas: vi.fn(),
    };
    const checkout = new CheckoutTools(orders as never, {} as never, conversations as never, {} as never);

    const r = await checkout.cancelOrder(CTX, 'me arrepentí');
    expect(r.success).toBe(true);
    expect(r.order_id).toBe('o-9');
    expect(orders.markCancelled).toHaveBeenCalledWith('t1', 'o-9', 'me arrepentí');
    expect(conversations.updateDraftCartCas).not.toHaveBeenCalled();
  });
});
