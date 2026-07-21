import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { DraftCartItem } from './conversation.types';

/**
 * `tenant."order"` + `tenant.order_item` writes/reads for the bot checkout
 * (build-v2; was `ops.orders`/`ops.order_items`). Worker pool (unauthenticated
 * WhatsApp path).
 *
 * De-overload: the order's former `kitchen_status` and cancellation columns MOVED
 * to the `tenant.order_event` lifecycle journal. Creating an order therefore also
 * appends a `kitchen`/`new` event (so the KDS projection surfaces the ticket), and
 * cancelling appends a `cancellation` event; per-line `kitchen_status` stays on
 * `order_item`. `person_id → customer_id`, `location_id → branch_id`, and the
 * free-form `channel`/`source` collapse onto `channel_id → umi.channel_type`.
 *
 * Money boundary: the tool layer is in PESOS; this is where it converts to
 * CENTAVOS (`total_cents`, `unit_price_cents`). The `details` jsonb keeps a
 * PESOS items snapshot (legacy shape) so recent/reorder reads reconstruct the
 * cart directly. Idempotency: `source_transaction_id` (UNIQUE per tenant) — a
 * retried turn returns the same order instead of creating a duplicate.
 */

export interface OrderItemSnapshot {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  /** PESOS (legacy snapshot unit). */
  unit_price: number;
}

export interface CreateOrderParams {
  tenantId: string;
  personId: string;
  locationId: string | null;
  items: OrderItemSnapshot[]; // unit_price in PESOS
  customerNote?: string | null;
  pickupPerson?: string | null;
  personalMessage?: string | null;
  /** Deterministic idempotency key, e.g. `conversaflow:turn:<turn_id>`. */
  sourceTransactionId: string;
}

export interface CreateOrderResult {
  orderId: string;
  /** PESOS. */
  total: number;
  created: boolean;
}

export interface OrderSummary {
  id: string;
  status: string;
  kitchenStatus: string | null;
  /** PESOS. */
  total: number;
  createdAt: string;
  items: OrderItemSnapshot[];
  customerNote: string | null;
  pickupPerson: string | null;
  personalMessage: string | null;
}

const round = (n: number) => Math.round(n);

@Injectable()
export class OrdersRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Create a confirmed WhatsApp order: `tenant."order"` (status='pending') +
   * `tenant.order_item` + a `tenant.order_event` (`kitchen`/`new` → surfaces in the
   * KDS projection), in one transaction. Idempotent on `source_transaction_id`: a
   * retried turn returns the existing order (no duplicate items or events).
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    // Compute each line's cents ONCE, then sum for the header total — so
    // "order".total_cents always equals SUM(quantity * order_item.unit_price_cents)
    // (deriving the header from rounded pesos could drift by a centavo).
    const itemCents = params.items.map((it) => round(it.unit_price * 100));
    const totalCents = params.items.reduce((s, it, i) => s + it.quantity * itemCents[i], 0);
    const details = {
      items: params.items, // PESOS snapshot
      ...(params.customerNote ? { customer_note: params.customerNote } : {}),
      ...(params.pickupPerson ? { pickup_person: params.pickupPerson } : {}),
      ...(params.personalMessage ? { personal_message: params.personalMessage } : {}),
    };

    return this.pg.workerTx(async (client) => {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO tenant."order"
           (business_id, customer_id, branch_id, channel_id, order_type, status,
            total_cents, details, pickup_person, notes, source_transaction_id, placed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid,
                 (SELECT id FROM tenant.channel WHERE key = 'whatsapp'),
                 'whatsapp', 'pending',
                 $4, $5::jsonb, $6, $7, $8, now())
         ON CONFLICT (business_id, source_transaction_id) WHERE source_transaction_id IS NOT NULL
           DO NOTHING
         RETURNING id::text`,
        [
          params.tenantId,
          params.personId,
          params.locationId,
          totalCents,
          JSON.stringify(details),
          params.pickupPerson ?? null,
          params.customerNote ?? null,
          params.sourceTransactionId,
        ],
      );

      if (!ins.rows.length) {
        // Idempotent hit: the order already exists for this turn.
        const existing = await client.query<{ id: string; total_cents: number }>(
          `SELECT id::text, total_cents FROM tenant."order"
            WHERE business_id = $1::uuid AND source_transaction_id = $2`,
          [params.tenantId, params.sourceTransactionId],
        );
        const row = existing.rows[0];
        return { orderId: row?.id ?? '', total: (row?.total_cents ?? totalCents) / 100, created: false };
      }

      const orderId = ins.rows[0].id;
      for (let i = 0; i < params.items.length; i++) {
        const it = params.items[i];
        await client.query(
          `INSERT INTO tenant.order_item
             (business_id, order_id, product_id, display_order, name, variant_name,
              quantity, unit_price_cents, kitchen_status)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, 'new')`,
          [
            params.tenantId,
            orderId,
            it.product_id,
            i,
            it.product_name,
            it.variant_name,
            it.quantity,
            itemCents[i],
          ],
        );
      }

      // Open the kitchen lifecycle in the journal (the former ops.orders.kitchen_status
      // = 'new'). idempotency_key makes a partial-commit replay a no-op.
      await client.query(
        `INSERT INTO tenant.order_event
           (business_id, order_id, event_kind, new_status, kitchen_status, source, idempotency_key)
         VALUES ($1::uuid, $2::uuid, 'kitchen', 'pending', 'new', 'conversaflow', $3)
         ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO NOTHING`,
        [params.tenantId, orderId, `${params.sourceTransactionId}:new`],
      );

      return { orderId, total: totalCents / 100, created: true };
    });
  }

  /** Recent orders for a customer (newest first), with the PESOS items snapshot. */
  async recentOrders(tenantId: string, personId: string, limit: number): Promise<OrderSummary[]> {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
    const { rows } = await this.pg.query<{
      id: string;
      status: string;
      kitchen_status: string | null;
      total_cents: number;
      details: Record<string, unknown> | null;
      created_at: string;
    }>(
      `SELECT o.id::text, o.status, o.total_cents, o.details, o.created_at,
              (SELECT oe.kitchen_status
                 FROM tenant.order_event oe
                WHERE oe.business_id = o.business_id AND oe.order_id = o.id
                  AND oe.kitchen_status IS NOT NULL
                ORDER BY oe.occurred_at DESC
                LIMIT 1) AS kitchen_status
         FROM tenant."order" o
        WHERE o.business_id = $1::uuid AND o.customer_id = $2::uuid
        ORDER BY COALESCE(o.placed_at, o.created_at) DESC
        LIMIT $3`,
      [tenantId, personId, safeLimit],
    );
    return rows.map((r) => {
      const details = (r.details ?? {}) as Record<string, unknown>;
      const rawItems = Array.isArray(details.items) ? (details.items as unknown[]) : [];
      const items: OrderItemSnapshot[] = rawItems
        .map((raw) => {
          const it = raw as Record<string, unknown>;
          if (!it?.product_id || !it?.product_name) return null;
          return {
            product_id: String(it.product_id),
            product_name: String(it.product_name),
            variant_name: it.variant_name ? String(it.variant_name) : null,
            quantity: Math.max(1, Number(it.quantity) || 1),
            unit_price: Number(it.unit_price) || 0,
          };
        })
        .filter((it): it is OrderItemSnapshot => it !== null);
      return {
        id: r.id,
        status: r.status,
        kitchenStatus: r.kitchen_status,
        total: (r.total_cents ?? 0) / 100,
        createdAt: r.created_at,
        items,
        customerNote: (details.customer_note as string) ?? null,
        pickupPerson: (details.pickup_person as string) ?? null,
        personalMessage: (details.personal_message as string) ?? null,
      };
    });
  }

  /**
   * Cancel an order: flip `tenant."order".status` and append a `cancellation`
   * event (`kitchen_status='cancelled'` + reason) to the journal. One transaction.
   */
  async markCancelled(tenantId: string, orderId: string, reason: string): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const res = await client.query(
        `UPDATE tenant."order"
            SET status = 'cancelled', updated_at = now()
          WHERE business_id = $1::uuid AND id = $2::uuid`,
        [tenantId, orderId],
      );
      if ((res.rowCount ?? 0) === 0) return false;

      await client.query(
        `INSERT INTO tenant.order_event
           (business_id, order_id, event_kind, new_status, kitchen_status, reason, source)
         VALUES ($1::uuid, $2::uuid, 'cancellation', 'cancelled', 'cancelled', $3, 'conversaflow')`,
        [tenantId, orderId, reason],
      );
      return true;
    });
  }
}
