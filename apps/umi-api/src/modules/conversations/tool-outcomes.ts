import type { ToolResult } from './turn.types';

/**
 * Tracks what the tool loop accomplished this turn, to derive the response type
 * + next conversation state. Verbatim port of `processors/tool-outcomes.ts`.
 */
export interface ToolOutcomeState {
  orderConfirmed: boolean;
  orderChangesConfirmed: boolean;
  orderCancelled: boolean;
  cartUpdated: boolean;
  searchPerformed: boolean;
  suggestedTemplate: string | null;
}

const ORDER_CONFIRMATION_TOOLS = new Set(['confirm_order', 'reorder_last_order']);
const SEARCH_TOOLS = new Set(['search_menu', 'search_products']);

export function createToolOutcomeState(): ToolOutcomeState {
  return {
    orderConfirmed: false,
    orderChangesConfirmed: false,
    orderCancelled: false,
    cartUpdated: false,
    searchPerformed: false,
    suggestedTemplate: null,
  };
}

export function applyToolOutcome(
  state: ToolOutcomeState,
  toolName: string,
  result: ToolResult,
): void {
  // Only a genuine success advances turn state. A clarification or error payload
  // (success===false, a needs_clarification prompt, or an error) must never flip
  // orderConfirmed / cartUpdated / searchPerformed — otherwise a failed
  // confirm_order would still move the conversation to a confirmed state.
  if (result?.success === false || result?.needs_clarification || result?.error) return;

  if (ORDER_CONFIRMATION_TOOLS.has(toolName)) state.orderConfirmed = true;
  if (toolName === 'confirm_order_changes') state.orderChangesConfirmed = true;
  if (toolName === 'cancel_order') state.orderCancelled = true;
  if (toolName === 'add_to_cart' || (toolName === 'edit_cart' && result?.cart_empty !== true)) {
    state.cartUpdated = true;
  }
  if (SEARCH_TOOLS.has(toolName)) state.searchPerformed = true;

  const suggestedTemplate = extractSuggestedTemplate(toolName, result);
  if (suggestedTemplate) state.suggestedTemplate = suggestedTemplate;
}

function extractSuggestedTemplate(toolName: string, result: ToolResult): string | null {
  if (toolName === 'add_to_cart' || toolName === 'edit_cart') {
    return (result?.summary_text as string) ?? (result?.customer_reply as string) ?? null;
  }
  if (
    ORDER_CONFIRMATION_TOOLS.has(toolName) ||
    toolName === 'confirm_order_changes' ||
    toolName === 'cancel_order'
  ) {
    return (result?.customer_reply as string) ?? (result?.message as string) ?? null;
  }
  return null;
}
