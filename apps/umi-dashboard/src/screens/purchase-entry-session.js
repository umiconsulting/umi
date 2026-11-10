import { t } from '@lingui/core/macro';
import { validatePurchaseEnvelope } from './purchase-entry-photo.js';
const key = (id) => `umi-purchase-attempt:${id}`;
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
  const pending = { ...current, state: 'pending' };
  persist(pending, storage);
  let response;
  try {
    response = await send(pending.merchantId, structuredClone(pending.envelope));
  } catch (error) {
    const definitive =
      current.state === 'prepared' && [400, 403, 404, 413, 422].includes(error?.status);
    const next = definitive
      ? {
          version: 1,
          merchantId: pending.merchantId,
          locationId: pending.locationId,
          commandId: pending.commandId,
          state: 'rejected',
        }
      : { ...pending, state: 'ambiguous' };
    persist(next, storage);
    return { ...next, error };
  }
  const done = {
    version: 1,
    merchantId: pending.merchantId,
    locationId: pending.locationId,
    commandId: pending.commandId,
    state: 'succeeded',
    invoiceId: response?.supplierInvoice?.id || response?.result?.supplierInvoice?.id,
  };
  persist(done, storage);
  return done;
}
