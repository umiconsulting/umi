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
            courseNumber: 2,
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
    // §8H step 4. The course travels to the kitchen line; the FIRED flag does not,
    // because it is derived from the ticket watermark in the read.
    const params = itemInsert?.[1] as unknown[];
    expect(params[12]).toBe(2);
    expect(String(itemInsert?.[0])).toContain('course_number');
    expect(String(itemInsert?.[0])).not.toContain('fired');
  });

  it('returns the existing projection on response retry', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'kitchen-1' }] });
    await expect(projectKitchenOrder({ query } as never, 'merchant-1', 'order-1')).resolves.toEqual(
      { kitchenOrderId: 'kitchen-1', created: false },
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('raises the board wake-up in the same transaction as the ticket', async () => {
    // §8H step 8. The notification is a QUERY on the caller's client rather than an in-process
    // emit, and that is the point: Postgres delivers NOTIFY at COMMIT, so a watcher cannot be
    // woken before this ticket exists, and a checkout that fails after projection wakes nobody.
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
            variantName: null,
            quantity: 1,
            courseNumber: 1,
            preparationNote: null,
            displayOrder: 0,
            targetSeconds: null,
            modifiers: [],
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
            targetSeconds: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'kitchen-1' }] })
      .mockResolvedValue({ rows: [] });

    await projectKitchenOrder({ query } as never, 'merchant-1', 'order-1');

    const notify = query.mock.calls.find(([sql]) =>
      String(sql).includes("pg_notify('umi_kitchen_board'"),
    );
    expect(notify).toBeDefined();
    // IDS ONLY. The board re-reads over RLS REST, so a wake-up cannot carry a stale name or a
    // quantity the database has already changed.
    expect(JSON.parse(String(notify?.[1]?.[0]))).toEqual({
      merchant_id: 'merchant-1',
      location_id: 'location-1',
      kitchen_order_id: 'kitchen-1',
    });
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
            courseNumber: 1,
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
