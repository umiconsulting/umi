import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

/** Filters shared by the dashboard order list. */
export interface ListOrdersQuery {
  filter: string;
  channel: string | null;
  locationId: string | null;
  limit: number;
}

const COMMERCIAL_ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];

/**
 * `merchant.customer_order` is the commercial truth (ORDER_MODEL §1): every order from
 * every channel — WhatsApp (`source='whatsapp'`), POS (`source='pos'`), web, dashboard.
 * The KDS `kitchen_order` is a PROJECTION that only carries lines routed to a prep
 * station, so reading it for the dashboard hides POS coffee-only orders and anything
 * without a configured route. The model is explicit: "The dashboard reads
 * `customer_order` directly." This repository is that read.
 *
 * Money stays in CENTAVOS here; the service converts to pesos for display. RLS is
 * enforced by the request merchant context via `withMerchant`.
 */
@Injectable()
export class OrdersRepository {
  constructor(private readonly pg: PgService) {}

  /** Merchant-scoped commercial order list (newest first), with channel, customer, total, lines. */
  async listOrders(merchantId: string, q: ListOrdersQuery): Promise<{ rows: Row[] }> {
    const params: unknown[] = [merchantId];

    const statusSql = buildStatusClause(q.filter, params);
    const channelSql = buildChannelClause(q.channel, params);
    const locSql = buildLocationClause(q.locationId, params);

    params.push(q.limit);
    const limitIdx = params.length;

    const { rows } = await this.pg.withMerchant((c) =>
      c.query<Row>(
        `SELECT
           o.id::text AS "id",
           COALESCE(o.external_ref, o.id::text) AS "publicReference",
           o.source,
           o.status,
           o.fulfillment_type AS "fulfillmentType",
           o.notes,
           o.pickup_person AS "pickupPerson",
           c.name AS "customerName",
           phone.normalized_value AS "customerPhone",
           ot.total AS "totalCents",
           o.placed_at AS "placedAt",
           o.updated_at AS "updatedAt",
           o.location_id::text AS "locationId",
           COALESCE(items.items, '[]'::jsonb) AS items
         FROM merchant.customer_order o
         LEFT JOIN merchant.customer c
           ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
         LEFT JOIN merchant.order_total ot ON ot.order_id = o.id
         LEFT JOIN LATERAL (
           SELECT ci.normalized_value
           FROM merchant.contact ci
           JOIN umi.channel_type ch ON ch.id = ci.channel_id
           WHERE ci.merchant_id = o.merchant_id AND ci.customer_id = o.customer_id
             AND ch.key IN ('phone','whatsapp') AND ci.normalized_value IS NOT NULL
           ORDER BY CASE WHEN ch.key = 'phone' THEN 0 ELSE 1 END, ci.created_at ASC
           LIMIT 1
         ) phone ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', i.id::text,
               'name', i.name,
               'variantName', i.variant_name,
               'quantity', i.quantity,
               'unitPriceCents', i.unit_price,
               'displayOrder', i.display_order,
               'notes', i.notes
             ) ORDER BY i.display_order, i.created_at
           ) AS items
           FROM merchant.order_item i
           WHERE i.order_id = o.id AND i.voided_at IS NULL
         ) items ON true
         WHERE o.merchant_id = $1::uuid
           ${statusSql}
           ${channelSql}
           ${locSql}
         ORDER BY COALESCE(o.placed_at, o.created_at) DESC
         LIMIT $${limitIdx}`,
        params,
      ),
    );
    return { rows };
  }

  /** Load one order's current status by id, scoped to the merchant (RLS + predicate). */
  async loadOrderStatus(
    merchantId: string,
    orderId: string,
  ): Promise<{ id: string; status: string; version: string } | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ id: string; status: string; version: string }>(
        `SELECT id::text, status, version::text
           FROM merchant.customer_order
          WHERE merchant_id = $1::uuid AND id = $2::uuid
          LIMIT 1`,
        [merchantId, orderId],
      ),
    );
    return rows[0] ?? null;
  }

  /** Set the commercial status and append the spine event, in one transaction. */
  async setStatus(merchantId: string, orderId: string, target: string): Promise<boolean> {
    return this.pg.withMerchant(async (c) => {
      const res = await c.query(
        `UPDATE merchant.customer_order
            SET status = $3, updated_at = now()
          WHERE merchant_id = $1::uuid AND id = $2::uuid`,
        [merchantId, orderId, target],
      );
      if ((res.rowCount ?? 0) === 0) return false;
      // The opening event is written by writeOrder; every transition here is the second
      // row onward. ORDER_MODEL §1: the spine is append-only and advance is authoritative
      // only when the status row and the event move together.
      await c.query(
        `INSERT INTO merchant.order_event (order_id, status)
         VALUES ($1::uuid, $2)`,
        [orderId, target],
      );
      return true;
    });
  }
}

function buildStatusClause(filter: string, params: unknown[]): string {
  if (filter === 'active') {
    params.push(COMMERCIAL_ACTIVE_STATUSES);
    return `AND o.status = ANY($${params.length}::text[])`;
  }
  if (filter === 'completed') {
    params.push('completed');
    return `AND o.status = $${params.length}`;
  }
  if (filter === 'cancelled') {
    params.push('canceled');
    return `AND o.status = $${params.length}`;
  }
  return '';
}

function buildChannelClause(channel: string | null, params: unknown[]): string {
  if (!channel) return '';
  params.push(channel);
  return `AND o.source = $${params.length}`;
}

function buildLocationClause(locationId: string | null, params: unknown[]): string {
  if (!locationId) return '';
  params.push(locationId);
  return `AND o.location_id = $${params.length}::uuid`;
}
