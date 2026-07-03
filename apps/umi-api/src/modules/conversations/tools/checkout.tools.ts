import { Injectable } from '@nestjs/common';
import { OrdersRepository, type OrderItemSnapshot } from '../orders.repository';
import { ProductsRepository } from '../products.repository';
import { ConversationsRepository } from '../conversations.repository';
import { BusinessHoursService } from '../business-hours.service';
import { OrderLocationResolver } from '../order-location.resolver';
import type { DraftCart } from '../conversation.types';
import type { ToolContext, ToolResult } from '../turn.types';
import {
  displayVariantName,
  formatMoney,
  formatOrderCustomerReply,
  toNumber,
} from './product-search';
import { needsInputToolError, retryableToolError, terminalToolError } from './tool-errors';

/**
 * Checkout tools: confirm_order, reorder_last_order, cancel_order. Ported from
 * `tools.ts`; orders rebound from the legacy `transactions` table to
 * `ops.orders`+`ops.order_items` (OrdersRepository). Idempotent on
 * `conversaflow:turn:<turn_id>` (the bug fix — a retried turn never duplicates an
 * order). Partial-cancellation (`confirm_order_changes`, the partial cancel
 * branch) is KDS-owned → deferred to Phase 4 (inert here).
 */
@Injectable()
export class CheckoutTools {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly products: ProductsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly hours: BusinessHoursService,
    private readonly locations: OrderLocationResolver,
  ) {}

  private idempotencyKey(ctx: ToolContext): string {
    return `conversaflow:turn:${ctx.turnId ?? ctx.conversationId}`;
  }

  /**
   * The branch a WhatsApp order is written to — the write side of the
   * fulfillment-location policy (see OrderLocationResolver). Resolved by data:
   * a bound number / sole branch / prior customer choice writes directly; a
   * multi-branch tenant with no choice returns `{ ok: false, ask }` so the bot
   * asks "¿de qué sucursal?" before any write, leaving the in-flight order
   * intact. A tenant with no active branch degrades to a NULL location rather
   * than blocking the order.
   */
  private async resolveOrderLocation(
    ctx: ToolContext,
  ): Promise<
    { ok: true; locationId: string | null } | { ok: false; ask: ToolResult }
  > {
    const resolution = await this.locations.resolve({
      tenantId: ctx.tenantId,
      conversationId: ctx.conversationId,
      channelLocationId: ctx.locationId ?? null,
    });
    if (resolution.kind === 'resolved') {
      return { ok: true, locationId: resolution.locationId };
    }
    if (resolution.kind === 'none') {
      // Misconfigured tenant (no active branch) — never block ordering over it.
      return { ok: true, locationId: null };
    }
    const names = resolution.branches.map((b) => b.name).join(', ');
    return {
      ok: false,
      ask: needsInputToolError(
        'Falta elegir la sucursal para este pedido.',
        `Pregúntale al cliente de qué sucursal quiere ordenar (opciones: ${names}) y usa set_branch. No pierdas su pedido.`,
      ),
    };
  }

  /** Re-validate + re-price cart items against the live catalog (pesos). */
  private async validateItems(
    tenantId: string,
    items: DraftCart['items'],
  ): Promise<{ ok: true; items: OrderItemSnapshot[]; total: number } | { ok: false; error: ToolResult }> {
    if (!items.length) return { ok: false, error: terminalToolError('No hay productos en la orden.') };
    const productMap = await this.products.getByIds(tenantId, [
      ...new Set(items.map((it) => it.product_id)),
    ]);
    const validated: OrderItemSnapshot[] = [];
    for (const item of items) {
      const product = productMap.get(item.product_id);
      if (!product || product.available === false) {
        return {
          ok: false,
          error: retryableToolError(`El producto ${item.product_name} ya no está disponible.`, {
            tool: 'search_menu',
            input: { query: item.product_name },
          }),
        };
      }
      let unitPrice = toNumber(product.price);
      if (item.variant_name) {
        const variant = (product.variants ?? []).find((c) => c.name === item.variant_name);
        if (!variant) {
          return {
            ok: false,
            error: needsInputToolError(
              `La variante ${displayVariantName(item.variant_name)} de ${product.name} ya no está disponible.`,
            ),
          };
        }
        unitPrice = toNumber(variant.price);
      }
      validated.push({
        product_id: product.id,
        product_name: product.name,
        variant_name: item.variant_name,
        quantity: item.quantity,
        unit_price: unitPrice,
      });
    }
    const total = validated.reduce((s, it) => s + it.quantity * it.unit_price, 0);
    return { ok: true, items: validated, total };
  }

  private async assertOrderingOpen(ctx: ToolContext): Promise<ToolResult | null> {
    const orderingCheck = await this.hours.checkOrderingEnabled(ctx.tenantId);
    if (!orderingCheck.enabled) {
      return terminalToolError(
        orderingCheck.disabledMessage ?? 'Los pedidos por WhatsApp están temporalmente pausados.',
      );
    }
    const within = await this.hours.isWithinOrderHours(
      ctx.tenantId,
      ctx.locationId ?? null,
      new Date(),
      ctx.customerPhone,
    );
    if (!within) {
      return terminalToolError(await this.hours.getOrdersClosedMessage(ctx.tenantId, ctx.locationId ?? null));
    }
    return null;
  }

  async confirmOrder(
    ctx: ToolContext,
    input: { pickup_person?: string; personal_message?: string; customer_note?: string },
  ): Promise<ToolResult> {
    const conv = await this.conversations.loadById(ctx.conversationId);
    const cart = (conv?.draftCart as DraftCart | null) ?? null;
    const version = conv?.draftCartVersion ?? 0;
    if (!cart || cart.items.length === 0) {
      return retryableToolError(
        'No hay productos en el carrito.',
        undefined,
        'Agrega un producto antes de confirmar tu pedido.',
      );
    }

    const closed = await this.assertOrderingOpen(ctx);
    if (closed) return closed;

    const validation = await this.validateItems(ctx.tenantId, cart.items);
    if (!validation.ok) return validation.error;

    // Branch gate: for a multi-branch tenant with the feature on, this returns
    // an "ask the customer which branch" result unless a branch is already
    // chosen. Returning before createOrder leaves the draft cart intact (it is
    // cleared only after a successful write), so the order is not forgotten.
    const location = await this.resolveOrderLocation(ctx);
    if (!location.ok) return location.ask;

    const result = await this.orders.createOrder({
      tenantId: ctx.tenantId,
      personId: ctx.personId,
      locationId: location.locationId,
      items: validation.items,
      customerNote: input.customer_note ?? cart.customer_note ?? null,
      pickupPerson: input.pickup_person ?? null,
      personalMessage: input.personal_message ?? null,
      sourceTransactionId: this.idempotencyKey(ctx),
    });

    // Clear the draft cart (idempotent: a stale CAS just means another turn moved on).
    await this.conversations.updateDraftCartCas(ctx.conversationId, version, null);

    return {
      success: true,
      order_id: result.orderId,
      total: result.total,
      customer_reply: formatOrderCustomerReply(result.orderId, result.total, input.pickup_person),
      message: input.pickup_person
        ? `Orden creada exitosamente para ${input.pickup_person}. Total: ${formatMoney(result.total)}`
        : `Orden creada exitosamente. Total: ${formatMoney(result.total)}`,
    };
  }

  async reorderLastOrder(
    ctx: ToolContext,
    input: { customer_note?: string },
  ): Promise<ToolResult> {
    const closed = await this.assertOrderingOpen(ctx);
    if (closed) return closed;

    const recent = await this.orders.recentOrders(ctx.tenantId, ctx.personId, 5);
    const last = recent.find((o) => o.status !== 'cancelled' && o.items.length > 0);
    if (!last) {
      return terminalToolError('No encontré una orden previa reutilizable para repetir.');
    }

    // Re-validate + re-price the historical items against the LIVE catalog (same
    // path confirmOrder uses) so a reorder never recreates a discontinued variant
    // or a stale price.
    const revalidated = await this.validateItems(ctx.tenantId, last.items);
    if (!revalidated.ok) return revalidated.error;

    const location = await this.resolveOrderLocation(ctx);
    if (!location.ok) return location.ask;

    const result = await this.orders.createOrder({
      tenantId: ctx.tenantId,
      personId: ctx.personId,
      locationId: location.locationId,
      items: revalidated.items,
      customerNote: input.customer_note ?? last.customerNote ?? null,
      pickupPerson: last.pickupPerson ?? null,
      personalMessage: last.pickupPerson ? last.personalMessage ?? null : null,
      sourceTransactionId: this.idempotencyKey(ctx),
    });

    return {
      success: true,
      order_id: result.orderId,
      total: result.total,
      customer_reply: formatOrderCustomerReply(result.orderId, result.total, last.pickupPerson ?? undefined),
      message: `Orden repetida exitosamente. Total: ${formatMoney(result.total)}`,
    };
  }

  async cancelOrder(ctx: ToolContext, reason: string): Promise<ToolResult> {
    // A draft cart (an order still being ASSEMBLED, not yet placed in ops.orders)
    // is what "cancel" means while the customer is still building their order.
    // Clear it FIRST: cancel_order used to only touch confirmed ops.orders, so a
    // cancel left the in-progress cart intact and it reappeared on the next add.
    const conv = await this.conversations.loadById(ctx.conversationId);
    const draftCart = (conv?.draftCart as DraftCart | null) ?? null;
    if (draftCart && draftCart.items.length > 0) {
      // Idempotent clear at the read version (a stale CAS just means another turn
      // already moved the cart on).
      await this.conversations.updateDraftCartCas(
        ctx.conversationId,
        conv?.draftCartVersion ?? 0,
        null,
      );
      const trimmed = reason?.trim();
      const replyBody = trimmed
        ? `Listo, cancelé tu pedido.\nMotivo: ${trimmed}`
        : 'Listo, cancelé tu pedido.';
      return { success: true, cart_cleared: true, customer_reply: replyBody, message: replyBody };
    }

    // No draft cart → cancel the most recent confirmed order the kitchen hasn't started.
    const recent = await this.orders.recentOrders(ctx.tenantId, ctx.personId, 5);
    if (!recent.length) {
      return terminalToolError('No encontré ningún pedido activo para tu cuenta.');
    }
    // Cancellable while the kitchen hasn't started (kitchen_status new / unset).
    const cancellable = recent.find((o) => !o.kitchenStatus || o.kitchenStatus === 'new');
    if (!cancellable) {
      const statusMap: Record<string, string> = {
        accepted: 'ya está siendo preparado y no puede cancelarse',
        preparing: 'ya está siendo preparado y no puede cancelarse',
        ready: 'ya está listo para recoger',
        completed: 'ya fue entregado',
        cancelled: 'ya estaba cancelado',
      };
      const latest = recent[0].kitchenStatus ?? recent[0].status;
      const statusMsg = statusMap[latest] ?? `está en estado "${latest}"`;
      return terminalToolError(
        `Tu pedido ${statusMsg}. Si necesitas ayuda, comunícate directamente con el café.`,
      );
    }

    await this.orders.markCancelled(ctx.tenantId, cancellable.id, reason);
    const trimmedReason = reason?.trim();
    const replyBody = trimmedReason
      ? `Tu pedido fue cancelado exitosamente.\nMotivo: ${trimmedReason}`
      : 'Tu pedido fue cancelado exitosamente.';
    return { success: true, order_id: cancellable.id, customer_reply: replyBody, message: replyBody };
  }

  /** Phase 4 (KDS partial cancellation). Inert until KDS is ported. */
  confirmOrderChanges(): Promise<ToolResult> {
    return Promise.resolve(
      terminalToolError('No encontré cambios pendientes por confirmar en tu pedido.'),
    );
  }
}
