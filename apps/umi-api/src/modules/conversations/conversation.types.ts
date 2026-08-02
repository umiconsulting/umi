/**
 * Shared domain types for the conversational engine (ConversaFlow port, §3
 * Phase 3). Bound to the canonical `comms.*` columns confirmed in
 * `docs/migration/2026-06-25-phase3-conversaflow-binding-preflight.md` §2.
 *
 * Legacy → canonical renames carried here: `customer_id → person_id`,
 * `merchant_id → merchant_id`, `body → content`.
 */

/** A single line item in the conversation's draft cart (`runtime.conversation_cart.cart`). */
export interface DraftCartItem {
  product_id: string;
  product_name: string;
  variant_name: string | null;
  quantity: number;
  unit_price: number;
}

export interface DraftCart {
  items: DraftCartItem[];
  updated_at: string;
  customer_note?: string | null;
}

/**
 * The conversation, as the turn engine reads it: the durable thread
 * (`merchant.conversation`) plus its in-flight cart (`runtime.conversation_cart`).
 * The FSM is gone — there is no `currentState` / `stateVersion` / `pendingClarification`;
 * the dialog-state label is DERIVED from cart-presence, and the cart is last-write-wins.
 */
export interface ConversationRecord {
  id: string;
  merchantId: string;
  personId: string;
  status: string;
  summary: string | null;
  draftCart: DraftCart | null;
}

export interface PartialCancelledItemContext {
  id: string;
  name: string;
  quantity: number;
  variantName: string | null;
  isCancelled: boolean;
}

export interface PartialCancelledOrderContext {
  ticketID: string;
  sourceTransactionID: string;
  reason: string;
  cancelledItems: PartialCancelledItemContext[];
  remainingItems: PartialCancelledItemContext[];
}
