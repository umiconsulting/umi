import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { writeOrder, type NewOrder } from './order-writer';

/**
 * A client that records the SQL it was handed. The point of these tests is not that the
 * statements execute — an integration test proves that — but that the writer emits the
 * rows an order is INCOMPLETE without. `order_event` in particular: an order missing its
 * opening event is valid in every table and invisible to the kitchen, so the only thing
 * that can catch its absence is an assertion that it was written.
 */
function recordingClient(overrides: Record<string, unknown[]> = {}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      for (const [fragment, rows] of Object.entries(overrides)) {
        if (sql.includes(fragment)) return { rows, rowCount: rows.length };
      }
      if (sql.includes('INSERT INTO tenant.customer_order')) {
        return { rows: [{ id: 'order-1' }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO tenant.order_item\n')) {
        return { rows: [{ id: `line-${queries.length}` }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, queries, sqlFor: (f: string) => queries.filter((q) => q.sql.includes(f)) };
}

const baseOrder: NewOrder = {
  businessId: '00000000-0000-4000-8000-000000000001',
  source: 'pos',
  fulfillmentType: 'dine_in',
  lines: [{ name: 'Latte', quantity: 2, unitPriceCents: 5000 }],
};

describe('writeOrder', () => {
  it('writes the opening order_event — the row that makes an order visible to the kitchen', async () => {
    const { client, sqlFor } = recordingClient();
    await writeOrder(client, baseOrder);

    const events = sqlFor('INSERT INTO tenant.order_event');
    expect(events).toHaveLength(1);
    // tenant.order_ticket.last_event_sequence reads max(order_event.sequence) and the
    // KDS polls `WHERE sequence > $n`. Without this row the cursor never advances.
    expect(events[0].params).toEqual(['order-1']);
    expect(events[0].sql).toContain("'status_changed'");
    expect(events[0].sql).toContain("'placed'");
  });

  it('writes the order, its lines and the event in that order, on ONE client', async () => {
    const { client, queries } = recordingClient();
    await writeOrder(client, {
      ...baseOrder,
      lines: [
        { name: 'Latte', quantity: 1, unitPriceCents: 5000 },
        { name: 'Panini', quantity: 1, unitPriceCents: 9000 },
      ],
    });
    const shape = queries.map((q) =>
      q.sql.includes('customer_order')
        ? 'order'
        : q.sql.includes('order_item')
          ? 'line'
          : q.sql.includes('order_event')
            ? 'event'
            : 'other',
    );
    expect(shape).toEqual(['order', 'line', 'line', 'event']);
  });

  it('gives each line its display_order, so the ticket renders in cart order', async () => {
    const { client, sqlFor } = recordingClient();
    await writeOrder(client, {
      ...baseOrder,
      lines: [
        { name: 'A', quantity: 1, unitPriceCents: 1 },
        { name: 'B', quantity: 1, unitPriceCents: 2 },
        { name: 'C', quantity: 1, unitPriceCents: 3 },
      ],
    });
    const lines = sqlFor('INSERT INTO tenant.order_item\n');
    expect(lines.map((l) => l.params[l.params.length - 1])).toEqual([0, 1, 2]);
  });

  it('carries station_id onto the line, not the order', async () => {
    const { client, sqlFor } = recordingClient();
    await writeOrder(client, {
      ...baseOrder,
      lines: [{ name: 'Latte', quantity: 1, unitPriceCents: 5000, stationId: 'station-bar' }],
    });
    expect(sqlFor('INSERT INTO tenant.order_item\n')[0].params).toContain('station-bar');
    expect(sqlFor('INSERT INTO tenant.customer_order')[0].params).not.toContain('station-bar');
  });

  it('writes the per-modifier breakdown a receipt needs', async () => {
    const { client, sqlFor } = recordingClient();
    await writeOrder(client, {
      ...baseOrder,
      lines: [
        {
          name: 'Latte',
          quantity: 1,
          unitPriceCents: 5500,
          modifiers: [{ name: 'Oat milk', priceDeltaCents: 500 }],
        },
      ],
    });
    const mods = sqlFor('INSERT INTO tenant.order_item_modifier');
    expect(mods).toHaveLength(1);
    expect(mods[0].params).toContain('Oat milk');
    expect(mods[0].params).toContain(500);
  });

  it('refuses a comp that does not name its line', async () => {
    const { client } = recordingClient();
    await expect(
      writeOrder(client, {
        ...baseOrder,
        discounts: [{ kind: 'comp', code: 'C', label: 'Comp', amountCents: 100 }],
      }),
    ).rejects.toThrow(/comp must name the line/);
  });

  it('attaches a line-scoped discount to the right line', async () => {
    const { client, sqlFor } = recordingClient();
    const written = await writeOrder(client, {
      ...baseOrder,
      lines: [
        { name: 'A', quantity: 1, unitPriceCents: 1000 },
        { name: 'B', quantity: 1, unitPriceCents: 2000 },
      ],
      discounts: [
        { kind: 'comp', code: 'C', label: 'Comped B', amountCents: 2000, orderItemIndex: 1 },
      ],
    });
    expect(sqlFor('INSERT INTO tenant.order_discount')[0].params).toContain(written.lineIds[1]);
  });

  it('refuses an order with no lines', async () => {
    const { client } = recordingClient();
    await expect(writeOrder(client, { ...baseOrder, lines: [] })).rejects.toThrow(
      /at least one line/,
    );
  });

  it('on a duplicate external_ref returns the existing order and rewrites nothing', async () => {
    // The conflicting INSERT returns no row; the writer then looks the order up.
    const { client, sqlFor } = recordingClient({
      'INSERT INTO tenant.customer_order': [],
      'SELECT id::text FROM tenant.customer_order': [{ id: 'existing-1' }],
      'SELECT id::text FROM tenant.order_item': [{ id: 'line-a' }, { id: 'line-b' }],
    });
    const written = await writeOrder(client, { ...baseOrder, externalRef: 'zettle-99' });

    expect(written).toEqual({
      orderId: 'existing-1',
      lineIds: ['line-a', 'line-b'],
      created: false,
    });
    // Critically: no new lines and NO second opening event. Re-emitting the event would
    // make the KDS show the ticket twice.
    expect(sqlFor('INSERT INTO tenant.order_item\n')).toHaveLength(0);
    expect(sqlFor('INSERT INTO tenant.order_event')).toHaveLength(0);
  });
});
