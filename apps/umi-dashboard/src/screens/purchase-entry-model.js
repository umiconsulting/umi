import { msg } from '@lingui/core/macro';
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function decimal(text, scale, positive = false) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(text ?? '').trim());
  if (!match || (match[2] || '').length > scale) return null;
  const n =
    BigInt(match[1]) * 10n ** BigInt(scale) + BigInt((match[2] || '').padEnd(scale, '0') || '0');
  return n > MAX || (positive && n === 0n) ? null : n;
}
const optional = (value) => String(value ?? '').trim() || null;
export function buildPurchaseEntry({ draft, snapshot }) {
  const errors = [];
  const context = snapshot?.context;
  const lines = [];
  let total = 0n;
  if (
    !context ||
    !context.locationId ||
    !context.inventoryLocations?.some((d) => d.id === draft.inventoryLocationId)
  )
    errors.push(msg`Elige dónde entra el inventario.`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.issuedOn || '') ||
    !Number.isFinite(Date.parse(draft.issuedOn)) ||
    new Date(draft.issuedOn).toISOString().slice(0, 10) !== draft.issuedOn
  )
    errors.push(msg`Elige una fecha válida.`);
  if (
    draft.supplierId &&
    !snapshot?.suppliers?.some((s) => s.id === draft.supplierId && !s.isArchived && !s.archivedAt)
  )
    errors.push(msg`Elige un proveedor activo.`);
  if (!draft.lines?.length || draft.lines.length > 100)
    errors.push(msg`Agrega entre 1 y 100 filas.`);
  for (const row of draft.lines || []) {
    const item = snapshot?.items?.find(
      (i) => i.id === row.inventoryItemId && !i.isArchived && !i.archivedAt,
    );
    if (
      !item ||
      !Number.isInteger(item.quantityScale) ||
      item.quantityScale < 0 ||
      item.quantityScale > 6
    ) {
      errors.push(msg`Elige un artículo activo en cada fila.`);
      continue;
    }
    const quantity = decimal(row.quantityText, item.quantityScale, true),
      cost = decimal(row.costText, 2);
    if (quantity === null || cost === null) {
      errors.push(msg`Revisa la cantidad y el costo. Usa punto para los decimales.`);
      continue;
    }
    const divisor = 10n ** BigInt(item.quantityScale);
    const extended = (quantity * cost + divisor / 2n) / divisor;
    if (extended > MAX) {
      errors.push(msg`El importe es demasiado grande.`);
      continue;
    }
    total += extended;
    lines.push({
      inventoryItemId: item.id,
      quantity: { value: Number(quantity), scale: item.quantityScale, unit: item.baseUnit },
      unitCostMinor: Number(cost),
    });
  }
  if (total > MAX) errors.push(msg`El total es demasiado grande.`);
  const folio = optional(draft.folio),
    note = optional(draft.note);
  if ((folio?.length || 0) > 80 || (note?.length || 0) > 240)
    errors.push(msg`Acorta la referencia o la nota.`);
  const parameters = {
    locationId: context?.locationId,
    inventoryLocationId: draft.inventoryLocationId,
    issuedOn: draft.issuedOn,
    currency: context?.currency,
    supplierId: draft.supplierId || null,
    folio,
    note,
    lines,
    ...(draft.artifactBase64 ? { artifactBase64: draft.artifactBase64 } : {}),
  };
  return {
    parameters: errors.length ? null : parameters,
    errors,
    totalMinor: total <= MAX ? Number(total) : null,
  };
}
