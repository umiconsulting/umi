/**
 * Shared domain types for the conversational engine (ConversaFlow port, §3
 * Phase 3). Bound to the canonical `comms.*` columns confirmed in
 * `docs/migration/2026-06-25-phase3-conversaflow-binding-preflight.md` §2.
 *
 * Legacy → canonical renames carried here: `customer_id → person_id`,
 * `business_id → tenant_id`, `body → content`.
 */

/** A single line item in the conversation's draft cart (`comms.conversations.draft_cart`). */
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
 * The per-conversation state machine row, mapped to canonical column names.
 * `stateVersion` / `draftCartVersion` are the optimistic-lock (CAS) cursors the
 * turn loop and cart writes increment (preflight §2).
 */
export interface ConversationRecord {
  id: string;
  tenantId: string;
  personId: string;
  orderId: string | null;
  status: string;
  currentState: string;
  summary: string | null;
  draftCart: DraftCart | null;
  draftCartVersion: number;
  pendingClarification: Record<string, unknown> | null;
  stateVersion: number;
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
