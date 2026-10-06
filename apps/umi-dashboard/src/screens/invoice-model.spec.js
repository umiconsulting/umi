import { describe, expect, it } from 'vitest';
import '@/test/i18n.jsx';
import { i18n } from '@/test/i18n.jsx';
import {
  buildCommitLines,
  commitReady,
  invoiceLineTally,
  invoiceStatusLabel,
  lineQuantityText,
  matchMethodLabel,
  moneyText,
  orderLinesForItem,
  priceChangeText,
  receivedQuantity,
} from './invoice-model.js';

const money = (minorUnits) => `$${(Number(minorUnits) / 100).toFixed(2)}`;

function invoiceLine(overrides) {
  return {
    id: 'line-1',
    lineNumber: 1,
    rawDescription: 'LECHE ENTERA 1 L',
    quantity: { value: 12, scale: 0, unit: 'unit' },
    unitCostMinor: 2450,
    lineTotalMinor: 29400,
    matchedInventoryItemId: 'item-milk',
    matchedInventoryItemName: 'Leche entera',
    matchMethod: 'supplier_sku',
    matchConfidence: 100,
    supplierSku: 'LEC-1',
    priceChanged: false,
    previousUnitCostMinor: null,
    purchaseOrderUnitCostMinor: null,
    ...overrides,
  };
}

function orderLine(id, inventoryItemId) {
  return {
    id,
    lineNumber: 1,
    inventoryItemId,
    supplierSku: null,
    description: null,
    orderedQuantity: { value: 12, scale: 0, unit: 'unit' },
    receivedQuantity: 0,
    outstandingQuantity: 12,
    unitCostMinor: 2450,
    lineTotalMinor: 29400,
    receivedLineTotalMinor: 0,
  };
}

describe('el estado del cotejo de una linea', () => {
  it('nombra cada metodo del contrato', () => {
    expect(i18n._(matchMethodLabel('supplier_sku'))).toBe('SKU del proveedor');
    expect(i18n._(matchMethodLabel('remembered'))).toBe('Cotejo recordado');
    expect(i18n._(matchMethodLabel('history'))).toBe('Historial de líneas');
    expect(i18n._(matchMethodLabel('fuzzy'))).toBe('Nombre parecido');
    expect(i18n._(matchMethodLabel('manual'))).toBe('Cotejo manual');
    expect(i18n._(matchMethodLabel('unmatched'))).toBe('Sin casar');
  });

  it('no inventa una etiqueta para un metodo desconocido', () => {
    expect(matchMethodLabel('invented')).toBeNull();
  });

  it('nombra el estado de la factura', () => {
    expect(i18n._(invoiceStatusLabel('committed'))).toBe('Registrada');
    expect(invoiceStatusLabel('invented')).toBeNull();
  });
});

describe('el cambio de precio', () => {
  it('muestra los dos numeros cuando la factura cobra distinto', () => {
    const line = invoiceLine({
      priceChanged: true,
      unitCostMinor: 2700,
      previousUnitCostMinor: 2450,
    });

    const sentence = priceChangeText(line, money);

    expect(sentence).toContain('$27.00');
    expect(sentence).toContain('$24.50');
    expect(sentence).toBe('La factura cobra $27.00. Antes pagaste $24.50.');
  });

  it('suma el precio que esperaba el pedido cuando existe', () => {
    const line = invoiceLine({
      priceChanged: true,
      unitCostMinor: 2700,
      previousUnitCostMinor: 2450,
      purchaseOrderUnitCostMinor: 2600,
    });

    const sentence = priceChangeText(line, money);

    expect(sentence).toBe(
      'La factura cobra $27.00. Antes pagaste $24.50. El pedido esperaba $26.00.',
    );
  });

  it('no dice nada cuando el precio no cambio', () => {
    expect(priceChangeText(invoiceLine({}), money)).toBeNull();
    expect(priceChangeText(null, money)).toBeNull();
  });
});

describe('el dinero de un costo', () => {
  it('deja el costo ausente como un estado, nunca como cero', () => {
    expect(moneyText(null, money)).toBeNull();
    expect(moneyText(undefined, money)).toBeNull();
    expect(moneyText(Number.NaN, money)).toBeNull();
  });

  it('deja leer un cero real', () => {
    expect(moneyText(0, money)).toBe('$0.00');
  });

  it('lee el numero que manda el servidor', () => {
    expect(moneyText(2450, money)).toBe('$24.50');
  });
});

describe('la lista de lineas de una factura', () => {
  it('cuenta las casadas, las que no casaron y los cambios de precio', () => {
    const tally = invoiceLineTally({
      lines: [
        invoiceLine({}),
        invoiceLine({ id: 'line-2', matchedInventoryItemId: null, matchMethod: 'unmatched' }),
        invoiceLine({ id: 'line-3', priceChanged: true, previousUnitCostMinor: 2450 }),
      ],
    });

    expect(tally).toMatchObject({ total: 3, matched: 2, unmatched: 1, priceChanged: 1 });
    expect(tally.unmatchedLines.map((line) => line.id)).toEqual(['line-2']);
  });
});

describe('el registro de la entrada', () => {
  it('esta listo cuando cada linea tiene articulo', () => {
    const check = commitReady({
      lines: [invoiceLine({}), invoiceLine({ id: 'line-2', matchedInventoryItemId: 'item-salt' })],
    });

    expect(check.ready).toBe(true);
    expect(check.tally.unmatched).toBe(0);
  });

  it('no esta listo cuando una linea quedo sin casar', () => {
    const check = commitReady({
      lines: [invoiceLine({}), invoiceLine({ id: 'line-2', matchedInventoryItemId: null })],
    });

    expect(check.ready).toBe(false);
    expect(check.tally.unmatchedLines.map((line) => line.id)).toEqual(['line-2']);
  });

  it('no esta listo cuando la factura no trae lineas', () => {
    expect(commitReady({ lines: [] }).ready).toBe(false);
    expect(commitReady(null).ready).toBe(false);
  });

  it('arma la peticion con la linea del pedido y el precio de la factura', () => {
    const built = buildCommitLines({
      invoice: { lines: [invoiceLine({})] },
      order: { id: 'order-1', lines: [orderLine('po-line-1', 'item-milk')] },
      draftByLineId: {},
    });

    expect(built.state).toBe('ready');
    expect(built.lines).toEqual([
      {
        lineId: 'line-1',
        purchaseOrderLineId: 'po-line-1',
        receivedQuantity: { value: 12, scale: 0, unit: 'unit' },
        unitCostMinor: 2450,
        lotCode: null,
      },
    ]);
  });

  it('refusa el registro cuando la factura no esta casada', () => {
    const built = buildCommitLines({
      invoice: { lines: [invoiceLine({ matchedInventoryItemId: null })] },
      order: { id: 'order-1', lines: [orderLine('po-line-1', 'item-milk')] },
    });

    expect(built.state).toBe('unmatched');
    expect(built.unmatchedLineIds).toEqual(['line-1']);
    expect(built.lines).toEqual([]);
  });

  it('refusa el registro cuando el pedido no tiene esa linea', () => {
    const built = buildCommitLines({
      invoice: { lines: [invoiceLine({})] },
      order: { id: 'order-1', lines: [] },
    });

    expect(built.state).toBe('no_order_line');
    expect(built.missingOrderLineIds).toEqual(['line-1']);
  });

  it('pide un pedido antes de poder registrar', () => {
    expect(buildCommitLines({ invoice: { lines: [invoiceLine({})] }, order: null }).state).toBe(
      'no_order',
    );
  });

  it('acepta una cantidad recibida distinta de la facturada', () => {
    const built = buildCommitLines({
      invoice: { lines: [invoiceLine({})] },
      order: { id: 'order-1', lines: [orderLine('po-line-1', 'item-milk')] },
      draftByLineId: { 'line-1': { receivedText: '10' } },
    });

    expect(built.state).toBe('ready');
    expect(built.lines[0].receivedQuantity).toEqual({ value: 10, scale: 0, unit: 'unit' });
  });

  it('refusa una cantidad con mas decimales que la escala de la linea', () => {
    const built = buildCommitLines({
      invoice: { lines: [invoiceLine({})] },
      order: { id: 'order-1', lines: [orderLine('po-line-1', 'item-milk')] },
      draftByLineId: { 'line-1': { receivedText: '10.5' } },
    });

    expect(built.state).toBe('invalid_quantity');
    expect(built.invalidQuantityLineIds).toEqual(['line-1']);
  });

  it('encuentra las lineas de un articulo y deja leer su cantidad', () => {
    const order = {
      lines: [orderLine('po-line-1', 'item-milk'), orderLine('po-line-2', 'item-salt')],
    };

    expect(orderLinesForItem(order, 'item-salt').map((line) => line.id)).toEqual(['po-line-2']);
    expect(orderLinesForItem(order, 'item-other')).toEqual([]);
    expect(lineQuantityText({ value: 1250, scale: 3 })).toBe('1.25');
  });

  it('lee la cantidad recibida en la escala de la linea', () => {
    expect(receivedQuantity('1.25', { value: 1, scale: 2, unit: 'kilogram' })).toEqual({
      value: 125,
      scale: 2,
      unit: 'kilogram',
    });
    expect(receivedQuantity('', { value: 2, scale: 0, unit: 'unit' })).toEqual({
      value: 2,
      scale: 0,
      unit: 'unit',
    });
    expect(receivedQuantity('0', { value: 1, scale: 0, unit: 'unit' })).toBeNull();
    expect(receivedQuantity('mucho', { value: 1, scale: 0, unit: 'unit' })).toBeNull();
  });
});
