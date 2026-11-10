import { describe, it, expect } from 'vitest';
import { buildPurchaseEntry } from './purchase-entry-model.js';
const snapshot = {
  merchantId: 'm',
  context: { locationId: 'l', currency: 'MXN', inventoryLocations: [{ id: 'd' }] },
  items: [{ id: 'i', baseUnit: 'kilogram', quantityScale: 3, isArchived: false }],
  suppliers: [{ id: 's', isArchived: false }],
};
const draft = (quantity = '1.250', cost = '12.50') => ({
  issuedOn: '2026-11-03',
  inventoryLocationId: 'd',
  lines: [{ inventoryItemId: 'i', quantityText: quantity, costText: cost }],
});
describe('exact purchase entry', () => {
  it('keeps exact scale and half-up cents', () => {
    const r = buildPurchaseEntry({ draft: draft(), snapshot });
    expect(r.errors).toEqual([]);
    expect(r.parameters.lines[0]).toEqual({
      inventoryItemId: 'i',
      quantity: { value: 1250, scale: 3, unit: 'kilogram' },
      unitCostMinor: 1250,
    });
    expect(r.totalMinor).toBe(1563);
  });
  it.each([0, 3, 6])('keeps scale %i and zero cost', (scale) => {
    const r = buildPurchaseEntry({
      draft: draft('2', '0'),
      snapshot: { ...snapshot, items: [{ ...snapshot.items[0], quantityScale: scale }] },
    });
    expect(r.parameters.lines[0].quantity).toEqual({
      value: 2 * 10 ** scale,
      scale,
      unit: 'kilogram',
    });
    expect(r.totalMinor).toBe(0);
  });
  it.each(['1,2', '1e2', '0', '-1', '1.0001'])('rejects invalid quantity %s', (q) =>
    expect(buildPurchaseEntry({ draft: draft(q), snapshot }).errors.length).toBeGreaterThan(0),
  );
  it.each(['1,2', '1e2', '-1', '1.001'])('rejects invalid cost %s', (c) =>
    expect(buildPurchaseEntry({ draft: draft('1', c), snapshot }).errors.length).toBeGreaterThan(0),
  );
  it('rejects line and accumulated overflow', () => {
    expect(
      buildPurchaseEntry({ draft: draft('9007199254740', '20'), snapshot }).errors.length,
    ).toBeGreaterThan(0);
    const d = draft('1', '90071992547409.90');
    d.lines.push({ ...d.lines[0] });
    expect(buildPurchaseEntry({ draft: d, snapshot }).errors.length).toBeGreaterThan(0);
  });
  it('preserves repeated priced rows and blank optional fields', () => {
    const d = draft();
    d.lines.push({ ...d.lines[0], costText: '20' });
    const r = buildPurchaseEntry({ draft: d, snapshot });
    expect(r.parameters.lines.map((l) => l.unitCostMinor)).toEqual([1250, 2000]);
    expect(r.parameters).toMatchObject({ supplierId: null, folio: null, note: null });
    expect(r.totalMinor).toBe(4063);
  });
  it.each(['archived', 'foreign', 'destination', 'supplier', 'date', 'limit'])(
    'refuses invalid %s',
    (kind) => {
      let s = structuredClone(snapshot),
        d = draft();
      if (kind === 'archived') s.items[0].isArchived = true;
      if (kind === 'foreign') s.items = [];
      if (kind === 'destination') d.inventoryLocationId = 'x';
      if (kind === 'supplier') d.supplierId = 'x';
      if (kind === 'date') d.issuedOn = '2026-02-30';
      if (kind === 'limit') d.lines = Array(101).fill(d.lines[0]);
      expect(buildPurchaseEntry({ draft: d, snapshot: s }).errors.length).toBeGreaterThan(0);
    },
  );
});
