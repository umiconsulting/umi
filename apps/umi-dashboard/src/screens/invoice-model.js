/**
 * Pure helpers for the console's Facturas tab (recipes module plan §7, §10 and
 * §11, Phase 5).
 *
 * No React and no JSX, so the rules run in a test without a browser
 * (invoice-model.spec.js). The screen decides the layout; this file decides the
 * words that belong to the data and the check that a commit is complete.
 *
 * THE XML IS THE TRUSTWORTHY PATH (plan D10). The supplier's CFDI file carries
 * the issuer, the folio, the date and the unit prices, so every number this tab
 * shows comes from the server's parse of that file. This file never guesses a
 * price and never invents a line.
 *
 * AN UNMATCHED LINE BLOCKS THE COMMIT (plan §10.3). That is the one rule this
 * file owns: a line the matcher could not place is cashed by hand first, and the
 * refusal names the line so the operator can point at it.
 *
 * A PRICE THAT MOVED CARRIES BOTH NUMBERS. A line whose cost differs from the
 * last price paid, or from the price the open order expected, prints the invoice
 * price AND the earlier price. One number is not evidence of a change.
 */

import { msg, t } from '@lingui/core/macro';
import { clampScale, formatScaled } from './inventory-model.js';

/** The largest integer the contract accepts for a scaled quantity. */
const MAX_SAFE = 9007199254740991n;

/**
 * How the matcher placed a line, in the order it tries (plan §10.3): the
 * supplier's own SKU, a remembered match, the line history, a fuzzy name, a
 * manual choice, or nothing.
 */
export const MATCH_METHOD_LABEL = {
  supplier_sku: msg`SKU del proveedor`,
  remembered: msg`Cotejo recordado`,
  history: msg`Historial de líneas`,
  fuzzy: msg`Nombre parecido`,
  manual: msg`Cotejo manual`,
  unmatched: msg`Sin casar`,
};

/** The label for one match method, or null for a method this build does not know. */
export function matchMethodLabel(matchMethod) {
  return MATCH_METHOD_LABEL[matchMethod] || null;
}

/** Where the invoice sits in its own life: uploaded, read, cashed, registered. */
export const INVOICE_STATUS_LABEL = {
  uploaded: msg`Recibida`,
  extracted: msg`Leída`,
  matched: msg`Casada`,
  committed: msg`Registrada`,
  rejected: msg`Rechazada`,
};

export function invoiceStatusLabel(status) {
  return INVOICE_STATUS_LABEL[status] || null;
}

/**
 * Money as the screen's own formatter renders it, or null when the server did not
 * send the number. A null cost is UNKNOWN, not zero: the caller shows a named
 * state. A real zero is a price the supplier charged and stays readable.
 */
export function moneyText(minorUnits, money) {
  if (minorUnits == null) return null;
  const value = Number(minorUnits);
  if (!Number.isFinite(value)) return null;
  return money(value);
}

/**
 * The sentence that shows a moved price with BOTH numbers: what this invoice
 * charges, what was paid before, and what the open order expected when an order
 * carries one. Null when the line did not move.
 *
 * `money` is the screen's formatter, bound to the invoice currency, so this file
 * stays free of locale and currency policy.
 */
export function priceChangeText(line, money) {
  if (!line || line.priceChanged !== true) return null;
  const current = moneyText(line.unitCostMinor, money);
  const previous = moneyText(line.previousUnitCostMinor, money);
  const order = moneyText(line.purchaseOrderUnitCostMinor, money);
  if (current === null) return null;
  let sentence = t`La factura cobra ${current}`;
  if (previous !== null) sentence += `. ${t`Antes pagaste ${previous}`}`;
  if (order !== null) sentence += `. ${t`El pedido esperaba ${order}`}`;
  return `${sentence}.`;
}

/**
 * The state of one invoice's lines: how many are cashed, how many are not, and
 * how many moved a price. `unmatchedLines` carries the lines themselves, because
 * a refusal must name the line an operator has to fix.
 */
export function invoiceLineTally(invoice) {
  const lines = (invoice && invoice.lines) || [];
  const unmatchedLines = [];
  let matched = 0;
  let priceChanged = 0;
  for (const line of lines) {
    if (!line) continue;
    if (line.matchedInventoryItemId) matched += 1;
    else unmatchedLines.push(line);
    if (line.priceChanged === true) priceChanged += 1;
  }
  return {
    total: lines.length,
    matched,
    unmatched: unmatchedLines.length,
    priceChanged,
    unmatchedLines,
  };
}

/**
 * The commit check. A commit is complete only when the invoice carries at least
 * one line and EVERY line has an item. One unmatched line refuses the whole
 * commit, because a half-posted receipt is a stock count nobody can trust.
 */
export function commitReady(invoice) {
  const tally = invoiceLineTally(invoice);
  return { ready: tally.total > 0 && tally.unmatched === 0, tally };
}

/** The order lines that carry one inventory item. An order may name an item twice. */
export function orderLinesForItem(order, inventoryItemId) {
  if (!order || !inventoryItemId) return [];
  return (order.lines || []).filter((line) => line && line.inventoryItemId === inventoryItemId);
}

/** A scaled quantity as "12.5", for the received-quantity input's default. */
export function lineQuantityText(quantity) {
  if (!quantity) return '';
  return formatScaled(quantity.value, quantity.scale) || '';
}

/**
 * A received quantity from the text a person typed, at the invoice line's own
 * scale and unit. An empty text keeps the invoice's quantity, which is the whole
 * delivery. More decimals than the scale is refused rather than rounded, and a
 * zero or negative quantity is refused: receiving nothing is not a receipt.
 */
export function receivedQuantity(text, quantity) {
  if (text == null || String(text).trim() === '') {
    if (!quantity) return null;
    return {
      value: Number(quantity.value),
      scale: clampScale(quantity.scale),
      unit: quantity.unit,
    };
  }
  const scale = quantity ? clampScale(quantity.scale) : 0;
  const trimmed = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > scale) return null;
  const value = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (value <= 0n || value > MAX_SAFE) return null;
  return { value: Number(value), scale, unit: quantity ? quantity.unit : 'unit' };
}

/**
 * The commit request's own lines, built from what the invoice carries and what
 * the chosen order carries (plan §10.4). The invoice prices the line; the order
 * supplies the line it belongs to; the operator may correct the received
 * quantity, because a short delivery against a full invoice is a real event.
 *
 * `draftByLineId[lineId]` is `{ purchaseOrderLineId, receivedText }`.
 *
 * The answer is a NAMED STATE:
 *
 *   no_order         no order was chosen;
 *   unmatched        a line has no item, so the commit is refused;
 *   no_order_line    a cashed line has no line in that order;
 *   invalid_quantity a typed quantity is not positive at the line's scale;
 *   ready            `lines` is the request's line array.
 */
export function buildCommitLines(input) {
  const invoice = input && input.invoice;
  const order = input && input.order;
  const drafts = (input && input.draftByLineId) || {};
  const unmatchedLineIds = [];
  const missingOrderLineIds = [];
  const invalidQuantityLineIds = [];
  const lines = [];

  if (!order) {
    return {
      state: 'no_order',
      lines: [],
      unmatchedLineIds,
      missingOrderLineIds,
      invalidQuantityLineIds,
    };
  }

  for (const line of (invoice && invoice.lines) || []) {
    if (!line) continue;
    if (!line.matchedInventoryItemId) {
      unmatchedLineIds.push(line.id);
      continue;
    }
    const draft = drafts[line.id] || {};
    const candidates = orderLinesForItem(order, line.matchedInventoryItemId);
    const chosen = draft.purchaseOrderLineId
      ? candidates.find((candidate) => candidate.id === draft.purchaseOrderLineId) || null
      : candidates[0] || null;
    if (!chosen) {
      missingOrderLineIds.push(line.id);
      continue;
    }
    const received = receivedQuantity(draft.receivedText, line.quantity);
    if (!received) {
      invalidQuantityLineIds.push(line.id);
      continue;
    }
    lines.push({
      lineId: line.id,
      purchaseOrderLineId: chosen.id,
      receivedQuantity: received,
      unitCostMinor: line.unitCostMinor,
      lotCode: null,
    });
  }

  let state = 'ready';
  if (unmatchedLineIds.length > 0) state = 'unmatched';
  else if (missingOrderLineIds.length > 0) state = 'no_order_line';
  else if (invalidQuantityLineIds.length > 0) state = 'invalid_quantity';

  return {
    state,
    lines,
    unmatchedLineIds,
    missingOrderLineIds,
    invalidQuantityLineIds,
  };
}
