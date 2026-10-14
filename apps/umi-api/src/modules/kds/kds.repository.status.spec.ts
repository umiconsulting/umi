import { describe, expect, it, vi } from 'vitest';
import { KdsRepository } from './kds.repository';

describe('POS kitchen status line identities', () => {
  it('returns the source item and state without exposing the full KDS board', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          kitchen_order_id: 'kitchen-order',
          source_order_id: 'source-order',
          public_reference: 'Cuenta 211',
          status: 'partially_ready',
          priority: 'normal',
          version: '3',
          station_ids: [],
          updated_at: '2026-10-14T18:00:00.000Z',
          items: [
            { sourceOrderItemId: 'source-item-1', status: 'ready' },
            { sourceOrderItemId: 'source-item-2', status: 'preparing' },
          ],
          ready_items: [{ id: 'kitchen-item-1', sound: null }],
        },
      ],
    });
    const repository = new KdsRepository({ query } as never);

    const result = await repository.posKitchenStatus('merchant', 'location', 'source-order');
    expect(result?.items).toEqual([
      { sourceOrderItemId: 'source-item-1', status: 'ready' },
      { sourceOrderItemId: 'source-item-2', status: 'preparing' },
    ]);
    expect(result?.readyItems).toEqual([{ id: 'kitchen-item-1', sound: null }]);
    expect(query.mock.calls[0][0]).toContain("'sourceOrderItemId',i.source_order_item_id::text");
    expect(query.mock.calls[0][1]).toEqual(['merchant', 'location', 'source-order']);
  });
});
