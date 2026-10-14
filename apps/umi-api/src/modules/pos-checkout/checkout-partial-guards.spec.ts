import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { TableMapRepository } from '../table-map/table-map.repository';

const merchant = '10000000-0000-4000-8000-000000000001';
const location = '20000000-0000-4000-8000-000000000001';
const cartId = '30000000-0000-4000-8000-000000000001';
const sourceId = '40000000-0000-4000-8000-000000000001';
const targetId = '50000000-0000-4000-8000-000000000001';

describe('cuenta con resultado de terminal incierto', () => {
  it.each(['addOrMerge', 'clear'] as const)(
    'bloquea %s antes de modificar carrito aunque aún no exista un payment_attempt',
    async (method) => {
      const query = vi.fn(async (sql: string) => {
        if (sql.includes('SELECT 1 FROM merchant.pos_cart c')) {
          expect(sql).toContain('merchant.pos_partial_payment');
          expect(sql).toContain("'outcome_unknown'");
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        return { rowCount: 1, rows: [{ id: cartId }] };
      });
      const client = { query } as unknown as PoolClient;
      const repo = new PosCartRepository({} as never);
      const action =
        method === 'clear'
          ? repo.clear(client, merchant, cartId, 1, 'operator')
          : repo.addOrMerge(
              client,
              merchant,
              cartId,
              1,
              'item',
              { operatorSessionId: 'operator' } as never,
              { modifiers: [] } as never,
            );
      await expect(action).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
      expect(
        query.mock.calls.some(
          ([sql]) =>
            String(sql).includes('INSERT INTO merchant.pos_cart_line') ||
            String(sql).includes('DELETE FROM merchant.pos_cart_line') ||
            String(sql).includes('UPDATE merchant.pos_cart SET status='),
        ),
      ).toBe(false);
    },
  );

  it('bloquea mover la mesa antes de tocar table_state', async () => {
    const repo = new TableMapRepository({} as never);
    vi.spyOn(repo, 'servingTables').mockResolvedValue(
      new Map([
        [sourceId, { id: sourceId, capacity: 4 } as never],
        [targetId, { id: targetId, capacity: 4 } as never],
      ]),
    );
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM merchant.table_state') && sql.includes('FOR UPDATE')) {
        if (params[2] === sourceId) {
          return {
            rowCount: 1,
            rows: [
              {
                table_id: sourceId,
                state: 'occupied',
                seated_at: new Date(),
                party_size: 2,
                group_id: null,
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM merchant.pos_cart c') && sql.includes('ORDER BY c.id FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: cartId, fired_order_id: null }] };
      }
      if (sql.includes('UNION ALL SELECT 1 FROM merchant.pos_partial_payment')) {
        expect(sql).toContain("'outcome_unknown'");
        return { rowCount: 1, rows: [{ '?column?': 1 }] };
      }
      return { rowCount: 0, rows: [] };
    });
    const client = { query } as unknown as PoolClient;
    await expect(
      repo.move(client, merchant, location, { fromTableId: sourceId, toTableId: targetId }),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO merchant.table_state')),
    ).toBe(false);
  });
});
