import { t } from '@lingui/core/macro';
import { validatePurchaseEnvelope } from './purchase-entry-photo.js';
const key = (id) => `umi-purchase-attempt:${id}`;
const definitiveBusinessRefusals = new Set([
  'INVENTORY_QUANTITY_NOT_EXACT',
  'INVENTORY_UNIT_CONVERSION_REQUIRED',
  'INVENTORY_PURCHASE_ITEM_LIMIT',
  'SUPPLIER_ARCHIVED',
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_INVOICE_REJECTED',
  'SUPPLIER_INVOICE_HAS_NO_LINES',
  'SUPPLIER_INVOICE_UNMATCHED_LINES',
  'SUPPLIER_INVOICE_ALREADY_COMMITTED',
  'INVENTORY_ITEM_ARCHIVED',
  'STOCK_ITEM_ARCHIVED',
  'INVENTORY_LOCATION_CHANGED',
  'INVENTORY_LOCATION_SCOPE',
  'PURCHASE_ORDER_LINE_TOTAL_MISMATCH',
  'VALIDATION_FAILED',
]);
const states = ['prepared', 'pending', 'ambiguous', 'succeeded', 'rejected'];
function invalid() {
  throw new Error(t`No se pudo recuperar la compra. Conserva esta pestaña y pide ayuda.`);
}
export function readPurchaseAttempt({ merchantId, storage }) {
  const raw = storage.getItem(key(merchantId));
  if (!raw) return null;
  let a;
  try {
    a = JSON.parse(raw);
  } catch {
    invalid();
  }
  if (
    a?.version !== 1 ||
    a.merchantId !== merchantId ||
    !a.locationId ||
    !states.includes(a.state) ||
    !a.commandId
  )
    invalid();
  if (!['succeeded', 'rejected'].includes(a.state)) {
    const e = a.envelope;
    if (
      !e ||
      !['inventory.purchase.record', 'inventory.invoice.receive_direct'].includes(e.operation) ||
      e.commandId !== a.commandId ||
      !e.idempotencyKey ||
      !e.targetAggregateId ||
      e.locationId !== a.locationId ||
      e.parameters?.locationId !== a.locationId ||
      !e.parameters.inventoryLocationId
    )
      invalid();
    validatePurchaseEnvelope(e);
  }
  return a;
}
function persist(a, storage) {
  storage.setItem(key(a.merchantId), JSON.stringify(a));
  return a;
}
function persistOutcome(next, storage) {
  const owner = readPurchaseAttempt({ merchantId: next.merchantId, storage });
  if (!owner || owner.commandId !== next.commandId) return next;
  if (['succeeded', 'rejected'].includes(owner.state)) return owner;
  // A refusal settles only the first send. A retry can still commit this purchase.
  if (
    next.state === 'ambiguous' ||
    (next.state === 'rejected' && (owner.retryStarted || owner.state === 'ambiguous'))
  )
    return persist({ ...owner, state: 'ambiguous' }, storage);
  return persist(next, storage);
}
export function preparePurchaseAttempt({
  merchantId,
  locationId,
  operation,
  targetId,
  parameters,
  summary = null,
  storage,
}) {
  if (readPurchaseAttempt({ merchantId, storage }))
    throw new Error(t`Resuelve la compra pendiente antes de registrar otra.`);
  const commandId = crypto.randomUUID();
  const envelope = {
    operation,
    targetAggregateId: targetId || crypto.randomUUID(),
    targetVersion: null,
    commandId,
    idempotencyKey: crypto.randomUUID(),
    parameters: structuredClone(parameters),
    locationId,
    approvalId: null,
  };
  validatePurchaseEnvelope(envelope);
  const a = {
    version: 1,
    merchantId,
    locationId,
    commandId,
    state: 'prepared',
    envelope,
    summary: structuredClone(summary),
  };
  persist(a, storage);
  readPurchaseAttempt({ merchantId, storage });
  return a;
}
export function clearPurchaseAttempt({ merchantId, storage }) {
  const a = readPurchaseAttempt({ merchantId, storage });
  if (a && !['prepared', 'succeeded', 'rejected'].includes(a.state))
    throw new Error(t`La compra aún no tiene un resultado. Reintenta la misma compra.`);
  storage.removeItem(key(merchantId));
}
export async function runPurchaseAttempt({ attempt, storage, send }) {
  const current = readPurchaseAttempt({ merchantId: attempt.merchantId, storage });
  if (
    !current ||
    current.commandId !== attempt.commandId ||
    ['succeeded', 'rejected'].includes(current.state) ||
    JSON.stringify(current.envelope) !== JSON.stringify(attempt.envelope)
  )
    throw new Error(t`Este intento ya terminó o cambió. Revisa la compra pendiente.`);
  const pending = {
    ...current,
    state: 'pending',
    retryStarted: current.retryStarted === true || current.state !== 'prepared',
  };
  persist(pending, storage);
  let response;
  try {
    response = await send(pending.merchantId, structuredClone(pending.envelope));
  } catch (error) {
    const definitive =
      current.state === 'prepared' &&
      ([400, 403, 404, 413, 422].includes(error?.status) ||
        (error?.status === 409 && definitiveBusinessRefusals.has(error?.code)));
    const next = definitive
      ? {
          version: 1,
          merchantId: pending.merchantId,
          locationId: pending.locationId,
          commandId: pending.commandId,
          state: 'rejected',
        }
      : { ...pending, state: 'ambiguous' };
    const settled = persistOutcome(next, storage);
    return settled === next ? { ...next, error } : settled;
  }
  const done = {
    version: 1,
    merchantId: pending.merchantId,
    locationId: pending.locationId,
    commandId: pending.commandId,
    state: 'succeeded',
    invoiceId: response?.supplierInvoice?.id || response?.result?.supplierInvoice?.id,
  };
  return persistOutcome(done, storage);
}
