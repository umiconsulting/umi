import { randomBytes } from 'node:crypto';

/**
 * The SQLSTATE-raised refusals this module turns into typed ones.
 *
 * Same discipline as `inventory-errors.ts`, and for the same reason: the stock
 * consequences of a receipt are decided inside the database (the ledger function
 * and its constraints), so the refusals arrive as `Error.message` strings carrying
 * an upper-case token. A module that let them arrive as a 500 would turn "you
 * cannot receive more than you ordered" into "something went wrong", which is the
 * failure mode the plan's §4 bar exists to prevent.
 *
 * The list is deliberately the LEDGER's codes, not a copy of the constraint names:
 * the API checks the quantities before it posts and refuses in its own words (with
 * the line named), so these are the backstop for a race or a writer that reached
 * the database some other way.
 */
const PROCUREMENT_LEDGER_CODES = [
  'INVENTORY_SOURCE_STATE_INSUFFICIENT',
  'INVENTORY_ENTRY_TYPE_INVALID',
  'INVENTORY_QUANTITY_INVALID',
  'INVENTORY_CONTEXT_REQUIRED',
  'INVENTORY_MERCHANT_SCOPE',
  'INVENTORY_LOCATION_SCOPE',
  'STOCK_ITEM_ARCHIVED',
  'NEGATIVE_STOCK_BLOCKED',
  'NEGATIVE_STOCK_APPROVAL_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
] as const;

export function procurementLedgerCode(
  error: unknown,
): (typeof PROCUREMENT_LEDGER_CODES)[number] | null {
  const message = error instanceof Error ? error.message : String(error);
  return PROCUREMENT_LEDGER_CODES.find((code) => message.includes(code)) ?? null;
}

/**
 * The order's public reference.
 *
 * Generated rather than typed, because `purchase_order.public_reference` is the
 * key a receipt and a support conversation quote, and two clerks naming their own
 * would collide. The shape is `PO-<date>-<8 hex>` — sortable by the day it was
 * raised, and readable aloud, which is what a reference is for. The suffix is
 * random rather than a per-merchant counter: a counter is a row that has to be
 * locked on every order, and the unique constraint already makes a collision
 * impossible to store.
 */
export function purchaseOrderReference(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `PO-${day}-${randomBytes(4).toString('hex')}`;
}

/**
 * The CONSTRAINT names, mapped to the refusal a client can act on.
 *
 * Reaching one of these means the API's own check did not run — a race, a writer
 * that reached the database some other way, or a future edit that moved the check.
 * The caller still deserves a sentence rather than a 500, and the constraint name
 * itself is exactly the kind of internal detail that must not leak.
 */
const CONSTRAINT_CODES: ReadonlyArray<readonly [string, string]> = [
  ['purchase_order_line_not_over_received', 'PURCHASE_ORDER_OVER_RECEIPT'],
  ['purchase_order_sent_shape', 'PURCHASE_ORDER_NOT_DRAFT'],
  ['purchase_order_cancelled_shape', 'PURCHASE_ORDER_CLOSED'],
  ['supplier_merchant_id_public_reference_key', 'SUPPLIER_REFERENCE_TAKEN'],
  ['purchase_order_merchant_id_public_reference_key', 'PURCHASE_ORDER_REFERENCE_TAKEN'],
  ['purchase_order_receipt_merchant_id_idempotency_key_key', 'IDEMPOTENCY_CONFLICT'],
];

export function procurementConstraintCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return CONSTRAINT_CODES.find(([constraint]) => message.includes(constraint))?.[1] ?? null;
}
