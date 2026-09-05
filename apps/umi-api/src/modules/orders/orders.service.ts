import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrdersRepository, type ListOrdersQuery, type Row } from './orders.repository';

/**
 * Commercial order lifecycle (build-v3, ORDER_MODEL §1). This is the dashboard's own
 * order surface — it reads `merchant.customer_order` directly (the commercial truth
 * every channel writes) and advances its STATUS. It is deliberately NOT the kitchen
 * projection: `kitchen_order` only carries lines routed to a prep station, so it hides
 * a POS coffee-only order or any order without a configured route.
 *
 * Money: the repository returns cents; this maps to pesos for the display contract.
 */

const ORDER_STATUS_FLOW: Record<string, string[]> = {
  placed: ['preparing', 'canceled'],
  preparing: ['ready', 'canceled'],
  ready: ['completed', 'canceled'],
  completed: [],
  canceled: [],
};

/** True when the target is a real transition out of `current`. */
export function isCommercialTransition(current: string, target: string): boolean {
  const allowed = ORDER_STATUS_FLOW[current];
  if (!allowed) return false;
  return allowed.includes(target);
}

const ALLOWED_SOURCES = new Set(['whatsapp', 'pos', 'web', 'dashboard']);

@Injectable()
export class OrdersService {
  constructor(private readonly repo: OrdersRepository) {}

  async listForDashboard(
    merchantId: string,
    filter: string | undefined,
    channel: string | undefined,
    locationId: string | null,
  ): Promise<{ orders: Row[] }> {
    const q: ListOrdersQuery = {
      filter: filter || 'all',
      channel: channel && ALLOWED_SOURCES.has(channel) ? channel : null,
      locationId: locationId || null,
      limit: 200,
    };
    const { rows } = await this.repo.listOrders(merchantId, q);
    return { orders: rows.map(toOrderRow) };
  }

  /** Advance a commercial order to `target` after validating the transition. */
  async transitionFromDashboard(
    merchantId: string,
    orderId: string,
    target: string,
  ): Promise<{ ok: true; orderId: string; status: string }> {
    const current = await this.repo.loadOrderStatus(merchantId, orderId);
    if (!current) throw new NotFoundException({ error: 'order_not_found' });
    if (!isCommercialTransition(current.status, target)) {
      throw new BadRequestException({
        error: 'invalid_order_transition',
        message: `No se puede pasar de ${current.status} a ${target}.`,
      });
    }
    const ok = await this.repo.setStatus(merchantId, orderId, target);
    if (!ok) throw new NotFoundException({ error: 'order_not_found' });
    return { ok: true, orderId, status: target };
  }
}

function toOrderRow(r: Row): Row {
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    order_id: r.id,
    public_reference: r.publicReference ?? r.id,
    source: r.source,
    status: r.status,
    fulfillment_type: r.fulfillmentType ?? null,
    customer_name: r.customerName ?? null,
    customer_phone: r.customerPhone ?? null,
    customer_note: r.notes ?? null,
    pickup_person: r.pickupPerson ?? null,
    total_cents: Number(r.totalCents ?? 0),
    total_amount: Number(r.totalCents ?? 0) / 100,
    placed_at: r.placedAt ?? null,
    created_at: r.placedAt ?? null,
    updated_at: r.updatedAt ?? null,
    location_id: r.locationId ?? null,
    items: items.map((i: Row) => ({
      item_id: i.id,
      name: i.name,
      variant_name: i.variantName ?? null,
      quantity: Number(i.quantity ?? 0),
      unit_price: Number(i.unitPriceCents ?? 0) / 100,
      notes: i.notes ?? null,
    })),
    items_count: items.length,
  };
}
