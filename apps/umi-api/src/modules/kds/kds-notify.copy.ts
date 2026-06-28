import type { KitchenStatus } from './dto/kds-contract';

/**
 * Customer-facing WhatsApp copy for KDS status changes — ported BYTE-FOR-BYTE
 * from the legacy `kds.transition_ticket` / `partial_cancel_items` RPC bodies
 * (conversaflow migrations). These are TRANSACTIONAL notifications, not
 * conversational turns, so templated copy is correct here (the "no hardcoded
 * user messages" rule governs the ConversaFlow turn engine, not order
 * receipts) — same pattern as `cash/lifecycle-copy.ts`.
 */

/** Status-change message; null = no notification for that status. */
export function statusNotificationBody(status: KitchenStatus): string | null {
  switch (status) {
    case 'accepted':
      return 'Tu pedido fue aceptado y está en cola en cocina.';
    case 'preparing':
      return 'Tu pedido se está preparando.';
    case 'ready':
      return 'Tu pedido está listo para recoger.';
    case 'completed':
      return 'Tu pedido fue completado. ¡Gracias!';
    case 'cancelled':
      return 'Tu pedido fue cancelado.';
    default:
      // new / partial_cancelled → no standalone status notification
      return null;
  }
}

/** A `• 2× Latte` style line for an order item. */
function itemLine(item: { quantity?: number; name?: string }): string {
  const qty = item.quantity && item.quantity > 1 ? `${item.quantity}× ` : '';
  return `• ${qty}${item.name ?? 'Artículo'}`;
}

/**
 * Partial-cancellation message — mirrors the legacy
 * "Se modificó tu pedido: … ❌ Cancelado: … Tu pedido actualizado: …" body.
 */
export function partialCancelNotificationBody(
  cancelled: Array<{ quantity?: number; name?: string }>,
  remaining: Array<{ quantity?: number; name?: string }>,
): string {
  const cancelledLines = cancelled.map(itemLine).join('\n');
  const remainingLines = remaining.length
    ? remaining.map(itemLine).join('\n')
    : '• Sin artículos restantes';
  return (
    'Se modificó tu pedido:' +
    '\n\n❌ Cancelado:\n' +
    cancelledLines +
    '\n\nTu pedido actualizado:\n' +
    remainingLines
  );
}
