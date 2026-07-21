import { Injectable } from '@nestjs/common';
import { OrdersRepository } from '../orders.repository';
import type { ToolContext, ToolResult } from '../turn.types';

/**
 * Customer tools: get_recent_customer_orders. Ported from `tools.ts`; rebound
 * from the legacy `transactions` read to `tenant."order"` (OrdersRepository). Money
 * surfaced to the LLM in pesos (the `details` items snapshot unit).
 */
@Injectable()
export class CustomerTools {
  constructor(private readonly orders: OrdersRepository) {}

  async getRecentCustomerOrders(ctx: ToolContext, limit?: number): Promise<ToolResult> {
    const orders = await this.orders.recentOrders(ctx.tenantId, ctx.personId, limit ?? 3);
    if (!orders.length) {
      return {
        found: 0,
        orders: [],
        message: 'No encontré pedidos previos para este cliente.',
      };
    }
    const normalized = orders.map((order) => ({
      id: order.id,
      status: order.status,
      created_at: order.createdAt,
      total: order.total,
      items: order.items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        variant_name: item.variant_name,
        unit_price: item.unit_price,
      })),
      customer_note: order.customerNote,
      pickup_person: order.pickupPerson,
      personal_message: order.personalMessage,
    }));
    return {
      found: normalized.length,
      orders: normalized,
      message: `Encontré ${normalized.length} pedido(s) reciente(s) del cliente.`,
    };
  }
}
