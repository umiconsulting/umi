import { describe, expect, it, vi } from 'vitest';
import { projectKitchenOrder } from './kitchen-projector';

describe('projectKitchenOrder', () => {
  it('creates one station-routed kitchen projection for preparation lines', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            orderId: 'order-1',
            merchantId: 'merchant-1',
            locationId: 'location-1',
            publicReference: 'R-100',
            source: 'pos',
            fulfillmentType: 'dine_in',
            businessDate: '2026-08-09',
            queuedAt: '2026-08-09T20:00:00.000Z',
            lineId: 'line-1',
            productId: 'product-1',
            categoryId: 'category-1',
            requiresPreparation: true,
            productName: 'Latte',
            variantName: 'Large',
            quantity: 1,
            preparationNote: 'Oat milk',
            displayOrder: 0,
            targetSeconds: 240,
            modifiers: ['Oat milk'],
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'route-1',
            stationId: 'station-1',
            productId: 'product-1',
            categoryId: null,
            priority: 1,
            targetSeconds: 180,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'kitchen-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await projectKitchenOrder({ query } as never, 'merchant-1', 'order-1');

    expect(result).toEqual({ kitchenOrderId: 'kitchen-1', created: true });
    const itemInsert = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO merchant.kitchen_order_item'),
    );
    expect(itemInsert?.[1]).toContain('station-1');
    expect(itemInsert?.[1]).not.toContain('Oat milk@');
  });

  it('returns the existing projection on response retry', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'kitchen-1' }] });
    await expect(projectKitchenOrder({ query } as never, 'merchant-1', 'order-1')).resolves.toEqual(
      { kitchenOrderId: 'kitchen-1', created: false },
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('does not create a kitchen order when no line needs preparation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            orderId: 'order-1',
            merchantId: 'merchant-1',
            locationId: 'location-1',
            publicReference: 'R-100',
            source: 'pos',
            fulfillmentType: 'dine_in',
            businessDate: '2026-08-09',
            queuedAt: '2026-08-09T20:00:00.000Z',
            lineId: 'line-1',
            productId: 'product-1',
            categoryId: 'retail',
            requiresPreparation: false,
            productName: 'Coffee beans',
            variantName: null,
            quantity: 1,
            preparationNote: null,
            displayOrder: 0,
            targetSeconds: null,
            modifiers: [],
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      projectKitchenOrder({ query } as never, 'merchant-1', 'order-1'),
    ).resolves.toBeNull();
  });
});
