import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { DraftCartItem } from './conversation.types';

/**
 * `ops.orders` + `ops.order_items` writes/reads for the bot checkout. Replaces
 * the legacy `transactions` table. Worker pool (unauthenticated WhatsApp path).
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
   * Create a confirmed WhatsApp order: `ops.orders` (status='pending',
   * kitchen_status='new' → surfaces in v_kds_tickets) + `ops.order_items`, in one
   * transaction. Idempotent on `source_transaction_id`: a retried turn returns the
   * existing order (no duplicate items).
   */
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    // Compute each line's cents ONCE, then sum for the header total — so
    // ops.orders.total_cents always equals SUM(quantity * order_items.unit_price_cents)
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
        `INSERT INTO ops.orders
           (tenant_id, person_id, location_id, source, channel, status, kitchen_status,
            total_cents, details, pickup_person, notes, source_transaction_id, placed_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'whatsapp', 'whatsapp', 'pending', 'new',
                 $4, $5::jsonb, $6, $7, $8, now())
         ON CONFLICT (tenant_id, source_transaction_id) WHERE source_transaction_id IS NOT NULL
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
          `SELECT id::text, total_cents FROM ops.orders
            WHERE tenant_id = $1::uuid AND source_transaction_id = $2`,
          [params.tenantId, params.sourceTransactionId],
        );
        const row = existing.rows[0];
        return { orderId: row?.id ?? '', total: (row?.total_cents ?? totalCents) / 100, created: false };
      }

      const orderId = ins.rows[0].id;
      for (let i = 0; i < params.items.length; i++) {
        const it = params.items[i];
        await client.query(
          `INSERT INTO ops.order_items
             (tenant_id, order_id, product_id, display_order, name, variant_name,
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
      return { orderId, total: totalCents / 100, created: true };
    });
  }

  /** Recent orders for a person (newest first), with the PESOS items snapshot. */
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
      `SELECT id::text, status, kitchen_status, total_cents, details, created_at
         FROM ops.orders
        WHERE tenant_id = $1::uuid AND person_id = $2::uuid
        ORDER BY COALESCE(placed_at, created_at) DESC
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

  /** Cancel an order (status + kitchen_status → cancelled, reason recorded). */
  async markCancelled(tenantId: string, orderId: string, reason: string): Promise<boolean> {
    const res = await this.pg.query(
      `UPDATE ops.orders
          SET status = 'cancelled', kitchen_status = 'cancelled',
              cancellation_reason = $3, updated_at = now()
        WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, orderId, reason],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
