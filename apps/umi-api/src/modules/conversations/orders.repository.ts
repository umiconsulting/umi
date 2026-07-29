import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { writeOrder } from '../../shared/orders/order-writer';

/**
 * `tenant.customer_order` + `tenant.order_item` + `tenant.order_event` reads/writes
 * for the bot checkout (build-v3; was `tenant."order"`, and `ops.orders` before that).
 *
 * What the build-v3 order model changed here (see ORDER_MODEL.md):
 *
 * - **The order is no longer overloaded.** `kitchen_status` is gone: the commercial and
 *   operational axes collapsed into ONE `status`
 *   (`placed·preparing·ready·completed·canceled` — note the single-l spelling; the old
 *   code wrote `'cancelled'`, which this CHECK rejects). `order_event` is the status
 *   spine, a thin `(order_id, status)` transition journal with a monotonic `sequence`
 *   for the polling KDS — not the former catch-all event log.
 * - **The total is DERIVED**, not stored: `tenant.order_total` sums the live lines, so
 *   it cannot drift and self-heals when a line is voided.
 * - **The `details` jsonb is gone.** It held a denormalized copy of the lines plus a
 *   duplicate of the customer note. Lines now come from `order_item` (the only copy),
 *   and the note / `pickup_person` are named columns.
 * - **`source_transaction_id` → `external_ref`**, still the bot's idempotency key: the
 *   partial unique index on `(business_id, external_ref)` is what makes a retried turn
 *   return the same order instead of creating a duplicate.
 *
 * Money boundary: the tool layer is in PESOS; this is where it converts to CENTAVOS
 * (`order_item.unit_price`, `order_total.total`) and back.
 *
 * Pool: the RLS-ENFORCED app pool, scoped by an explicit tenant id. The WhatsApp path is
 * unauthenticated, so there is no request context to inherit — `runWithTenant` takes the
 * business the turn already resolved. A forgotten `business_id` predicate then returns
 * zero rows instead of another café's order.
 */

export interface OrderItemSnapshot {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  /** PESOS (the tool-layer unit). */
  unit_price: number;
}

export interface CreateOrderParams {
  tenantId: string;
  personId: string;
  locationId: string | null;
  items: OrderItemSnapshot[]; // unit_price in PESOS
  customerNote?: string | null;
  pickupPerson?: string | null;
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
  /** PESOS — derived from the live lines, never a stored column. */
  total: number;
  createdAt: string;
  items: OrderItemSnapshot[];
  customerNote: string | null;
  pickupPerson: string | null;
}

/**
 * The status an order is still cancellable in — the kitchen has not started it.
 * This replaces the old `kitchen_status IS NULL || 'new'` test, which read a column
 * that no longer exists now that the two status axes are one.
 */
export const CANCELLABLE_STATUS = 'placed';

const toCents = (pesos: number) => Math.round(pesos * 100);

/**
 * An order's live lines, as the tool layer's PESOS snapshot. Voided lines are excluded
 * (they are waste history, not something to re-order), and so are lines with no
 * `product_id` — a reorder re-prices against the live catalog by that id, so such a
 * line cannot survive the round trip anyway.
 */
const ITEMS_JSON = `COALESCE(
  (SELECT jsonb_agg(jsonb_build_object(
            'product_id',   i.product_id::text,
            'product_name', i.name,
            'variant_name', i.variant_name,
            'quantity',     i.quantity,
            'unit_price',   i.unit_price / 100.0)
          ORDER BY i.display_order, i.created_at)
     FROM tenant.order_item i
    WHERE i.order_id = o.id
      AND i.voided_at IS NULL
      AND i.product_id IS NOT NULL),
  '[]'::jsonb) AS items`;

@Injectable()
export class OrdersRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Create a confirmed WhatsApp order: `tenant.customer_order` (status='placed') + its
   * `order_item` lines + the opening `order_event`, in one transaction.
   *
   * Idempotent on `external_ref`: a retried turn conflicts on the partial unique index,
   * inserts nothing, and returns the existing order. The old code needed a second
   * idempotency key on the event to survive a partial commit; it no longer does, because
   * the lines and the event are written only on the branch where the ORDER was created,
   * inside that same transaction.
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    // Each line's cents computed ONCE, then summed — so the number the customer is told
    // matches what tenant.order_total will derive from the rows just written.
    const itemCents = params.items.map((it) => toCents(it.unit_price));
    const totalCents = params.items.reduce((s, it, i) => s + it.quantity * itemCents[i], 0);

    return this.pg.runWithTenant(params.tenantId, null, async (client) => {
      // The order, its lines and its opening `order_event` are written by the shared
      // writer, not here. Forgetting that event makes an order invisible to the kitchen
      // silently, so it is not something a channel gets to remember for itself — the POS
      // is the second producer and this is now a seam rather than a convention.
      const written = await writeOrder(client, {
        businessId: params.tenantId,
        source: 'whatsapp',
        fulfillmentType: 'pickup',
        branchId: params.locationId,
        customerId: params.personId,
        externalRef: params.sourceTransactionId,
        notes: params.customerNote ?? null,
        pickupPerson: params.pickupPerson ?? null,
        lines: params.items.map((it, i) => ({
          productId: it.product_id,
          name: it.product_name,
          variantName: it.variant_name,
          quantity: it.quantity,
          unitPriceCents: itemCents[i],
        })),
      });

      if (!written.created) {
        // Idempotent hit: this turn already produced an order. Report ITS derived total
        // rather than the one just computed — the two differ if the order was amended
        // (a line voided) between the original turn and this retry.
        const existing = await client.query<{ total: string | number }>(
          `SELECT t.total FROM tenant.order_total t WHERE t.order_id = $1::uuid`,
          [written.orderId],
        );
        const row = existing.rows[0];
        return {
          orderId: written.orderId,
          total: (row ? Number(row.total) : totalCents) / 100,
          created: false,
        };
      }

      return { orderId: written.orderId, total: totalCents / 100, created: true };
    });
  }

  /** Recent orders for a customer (newest first), with their live lines in PESOS. */
  async recentOrders(tenantId: string, personId: string, limit: number): Promise<OrderSummary[]> {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 10));
    const { rows } = await this.pg.tquery<{
      id: string;
      status: string;
      total: string | number;
      notes: string | null;
      pickup_person: string | null;
      ordered_at: string;
      items: OrderItemSnapshot[] | null;
    }>(
      tenantId,
      `SELECT o.id::text,
              o.status,
              t.total,
              o.notes,
              o.pickup_person,
              COALESCE(o.placed_at, o.created_at) AS ordered_at,
              ${ITEMS_JSON}
         FROM tenant.customer_order o
         JOIN tenant.order_total t ON t.order_id = o.id
        WHERE o.business_id = $1::uuid AND o.customer_id = $2::uuid
        ORDER BY COALESCE(o.placed_at, o.created_at) DESC
        LIMIT $3`,
      [tenantId, personId, safeLimit],
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      total: Number(r.total ?? 0) / 100,
      // When the order was PLACED — what "your recent orders" means to a customer,
      // rather than when the row happened to be written.
      createdAt: r.ordered_at,
      items: Array.isArray(r.items) ? r.items : [],
      customerNote: r.notes,
      pickupPerson: r.pickup_person,
    }));
  }

  /**
   * Cancel an order: set `status='canceled'` + the reason, and append the matching
   * transition to the spine. One transaction.
   */
  async markCancelled(tenantId: string, orderId: string, reason: string): Promise<boolean> {
    return this.pg.runWithTenant(tenantId, null, async (client) => {
      const res = await client.query(
        `UPDATE tenant.customer_order
            SET status = 'canceled', cancel_reason = $3, updated_at = now()
          WHERE business_id = $1::uuid AND id = $2::uuid`,
        [tenantId, orderId, reason?.trim() || null],
      );
      if ((res.rowCount ?? 0) === 0) return false;

      await client.query(
        `INSERT INTO tenant.order_event (order_id, status) VALUES ($1::uuid, 'canceled')`,
        [orderId],
      );
      return true;
    });
  }
}
