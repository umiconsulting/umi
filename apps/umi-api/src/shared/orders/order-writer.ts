import type { PoolClient } from 'pg';

/**
 * THE way an order is written. Every producer — the WhatsApp checkout today, the POS
 * checkout next, an aggregator later — goes through this function.
 *
 * WHY IT EXISTS. `ORDER_MODEL.md` §1 says an order is written as three rows together:
 * `customer_order`, its `order_item` lines, and the opening `order_event`. That last row
 * is the status spine: `merchant.order_ticket.last_event_sequence` is
 * `max(order_event.sequence)`, and the KDS polls the event stream with `WHERE sequence >
 * $n`. An order written WITHOUT its opening event is therefore invisible to the kitchen
 * and to customer status notifications — and invisible silently, because every row that
 * was written is valid on its own.
 *
 * While there was one writer that was a convention held in one function. A second writer
 * turned it into a requirement, and the requirement was immediately broken: the POS
 * checkout on the source location wrote `customer_order`, `order_item`, `payment`,
 * `receipt_snapshot` and `pos_committed_sale`, and no `order_event` — so a POS sale
 * never reached the KDS. The model predicted this exact failure:
 *
 *   "si insertas la orden y olvidas el `order_event` de apertura, la orden … es
 *    invisible en la cocina y en el dashboard. Silenciosamente."
 *
 * The fix is not a rule in a document. It is that there is one function and it cannot be
 * partially used.
 *
 * TRANSACTION SHAPE. This takes a `PoolClient`, not a pool, so it composes INTO the
 * caller's transaction rather than opening its own. The POS has to write the order in
 * the same transaction as the payment, the receipt and the loyalty stamp; if this
 * function owned the transaction, that would be impossible and the POS would go around
 * it — which is how the seam gets broken again.
 *
 * MONEY is centavos here, always. Peso conversion belongs at the tool/HTTP boundary.
 */

export type OrderSource = 'whatsapp' | 'pos' | 'web' | 'dashboard';

export interface NewOrderModifier {
  /** Catalog ref for analytics; NULL when the modifier is ad-hoc or has been deleted. */
  modifierId?: string | null;
  /** Snapshot: renaming a modifier tomorrow must not rewrite today's receipt. */
  name: string;
  quantity?: number;
  /** Centavos, signed — a modifier can subtract. */
  priceDeltaCents: number;
}

export interface NewOrderLine {
  productId?: string | null;
  /** Snapshot of the product name at the time of sale. */
  name: string;
  variantName?: string | null;
  quantity: number;
  /** Centavos. The line total per unit, modifiers already folded in. */
  unitPriceCents: number;
  /** Where this line is prepared. NULL until a café configures routing. */
  stationId?: string | null;
  notes?: string | null;
  /**
   * The receipt-level split of `unitPriceCents`. Optional: a café with no modifiers
   * never needs it, and the line price stays authoritative either way.
   */
  modifiers?: NewOrderModifier[];
}

export interface NewOrderDiscount {
  /** Line-scoped when set; order-scoped when omitted. A comp MUST be line-scoped. */
  orderItemIndex?: number;
  kind: 'discount' | 'comp' | 'promo';
  code: string;
  label: string;
  /** Centavos removed from the total, always positive. */
  amountCents: number;
  reason?: string | null;
  authorizedBy?: string | null;
}

export interface NewOrder {
  merchantId: string;
  source: OrderSource;
  fulfillmentType: string;
  locationId?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  /**
   * The ORIGIN system's id for this record — a Zettle payment, an aggregator order
   * number. NOT a retry key: retry identity lives in `merchant.business_command`. Unique
   * per merchant, so passing one makes the insert conflict-safe against a duplicate
   * delivery of the same source record.
   */
  externalRef?: string | null;
  notes?: string | null;
  pickupPerson?: string | null;
  lines: NewOrderLine[];
  discounts?: NewOrderDiscount[];
}

export interface WrittenOrder {
  orderId: string;
  /** Line ids in the order they were supplied, so a caller can attach its own facts. */
  lineIds: string[];
  /** False when `externalRef` matched an existing order and nothing was written. */
  created: boolean;
}

/**
 * Write an order and everything that must exist with it, on the caller's client and
 * inside the caller's transaction.
 *
 * Idempotent on `externalRef` when one is supplied: a duplicate delivery of the same
 * source record returns the existing order and writes nothing. Without an `externalRef`
 * every call creates an order — retry safety is then the caller's `business_command`
 * record, which is where it belongs.
 */
export async function writeOrder(client: PoolClient, order: NewOrder): Promise<WrittenOrder> {
  if (order.lines.length === 0) {
    throw new Error('writeOrder: an order needs at least one line');
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO merchant.customer_order
       (merchant_id, customer_id, conversation_id, location_id, source, fulfillment_type,
        status, notes, pickup_person, external_ref, placed_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
             'placed', $7, $8, $9, now())
     ON CONFLICT (merchant_id, external_ref) WHERE external_ref IS NOT NULL
       DO NOTHING
     RETURNING id::text`,
    [
      order.merchantId,
      order.customerId ?? null,
      order.conversationId ?? null,
      order.locationId ?? null,
      order.source,
      order.fulfillmentType,
      order.notes ?? null,
      order.pickupPerson ?? null,
      order.externalRef ?? null,
    ],
  );

  if (inserted.rows.length === 0) {
    // A duplicate delivery of the same source record. Return the order that already
    // exists; do NOT re-write its lines, which may have been amended since.
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM merchant.customer_order
        WHERE merchant_id = $1::uuid AND external_ref = $2`,
      [order.merchantId, order.externalRef],
    );
    const orderId = existing.rows[0]?.id ?? '';
    const lines = orderId
      ? await client.query<{ id: string }>(
          `SELECT id::text FROM merchant.order_item
            WHERE order_id = $1::uuid ORDER BY display_order, created_at`,
          [orderId],
        )
      : { rows: [] as { id: string }[] };
    return { orderId, lineIds: lines.rows.map((r) => r.id), created: false };
  }

  const orderId = inserted.rows[0].id;
  const lineIds: string[] = [];

  for (let i = 0; i < order.lines.length; i++) {
    const line = order.lines[i];
    const row = await client.query<{ id: string }>(
      `INSERT INTO merchant.order_item
         (order_id, product_id, name, variant_name, quantity, unit_price,
          station_id, notes, display_order)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8, $9)
       RETURNING id::text`,
      [
        orderId,
        line.productId ?? null,
        line.name,
        line.variantName ?? null,
        line.quantity,
        line.unitPriceCents,
        line.stationId ?? null,
        line.notes ?? null,
        // Cart order IS ticket order — the KDS renders lines by display_order.
        i,
      ],
    );
    lineIds.push(row.rows[0].id);

    for (const modifier of line.modifiers ?? []) {
      await client.query(
        `INSERT INTO merchant.order_item_modifier
           (merchant_id, order_item_id, modifier_id, name, quantity, price_delta)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
        [
          order.merchantId,
          row.rows[0].id,
          modifier.modifierId ?? null,
          modifier.name,
          modifier.quantity ?? 1,
          modifier.priceDeltaCents,
        ],
      );
    }
  }

  for (const discount of order.discounts ?? []) {
    const lineId =
      discount.orderItemIndex === undefined ? null : (lineIds[discount.orderItemIndex] ?? null);
    if (discount.kind === 'comp' && lineId === null) {
      // The database refuses this too; failing here names the caller's mistake instead
      // of surfacing a constraint violation from three frames down.
      throw new Error('writeOrder: a comp must name the line it applies to');
    }
    await client.query(
      `INSERT INTO merchant.order_discount
         (merchant_id, order_id, order_item_id, kind, code, label, amount, reason, authorized_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid)`,
      [
        order.merchantId,
        orderId,
        lineId,
        discount.kind,
        discount.code,
        discount.label,
        discount.amountCents,
        discount.reason ?? null,
        discount.authorizedBy ?? null,
      ],
    );
  }

  // THE OPENING EVENT. Everything above is invisible to the kitchen without it. It is
  // written here, unconditionally, in the same transaction — not left to a caller to
  // remember.
  await client.query(
    `INSERT INTO merchant.order_event (order_id, kind, status)
     VALUES ($1::uuid, 'status_changed', 'placed')`,
    [orderId],
  );

  return { orderId, lineIds, created: true };
}
