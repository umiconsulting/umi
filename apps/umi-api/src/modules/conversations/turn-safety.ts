/**
 * Turn safety gates + byte helpers. Verbatim port of `processors/turn-safety.ts`
 * (behavior-fidelity carry-over, preflight §7). `blockUnverifiedOrderConfirmation`
 * stops the model from claiming an order was confirmed when no tool verified it.
 */

export const HALLUCINATED_ORDER =
  /orden\s*#|(?:orden|pedido).*(?:confirmad|registrad|cread|list[ao])|\btu\b.{0,80}\best[aá]\s+confirmad/i;

export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

export function truncateBytes(value: unknown, maxBytes: number): unknown {
  const json = JSON.stringify(value ?? null);
  const bytes = new TextEncoder().encode(json);
  if (bytes.length <= maxBytes) return value;
  // Truncate by BYTES (not chars) and drop any trailing replacement char left by
  // a split multibyte sequence, so the excerpt never exceeds maxBytes.
  const excerpt = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, maxBytes))
    .replace(/�+$/, '');
  return { truncated: true, max_bytes: maxBytes, excerpt };
}

export function blockUnverifiedOrderConfirmation(params: {
  text: string;
  orderConfirmed: boolean;
}): string {
  if (params.orderConfirmed || !HALLUCINATED_ORDER.test(params.text)) {
    return params.text;
  }
  return 'Ocurrió un error con tu orden. Intenta después.';
}

export function deriveNextConversationState(params: {
  pendingClarification: Record<string, unknown> | null;
  orderConfirmed: boolean;
  orderCancelled: boolean;
  orderChangesConfirmed: boolean;
  cartUpdated: boolean;
  searchPerformed: boolean;
  fallbackState: string;
}): string {
  if (params.pendingClarification) return 'awaiting_clarification';
  if (params.orderConfirmed || params.orderCancelled || params.orderChangesConfirmed) {
    return 'initial';
  }
  if (params.cartUpdated) return 'awaiting_confirmation';
  if (params.searchPerformed) return 'menu';
  return params.fallbackState || 'initial';
}
