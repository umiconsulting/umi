import test from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../dist/index.js';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const line = {
  inventoryItemId: id,
  quantity: { value: 1250, scale: 3, unit: 'kilogram' },
  unitCostMinor: 1250,
};
const input = {
  commandId: id,
  idempotencyKey: other,
  locationId: id,
  inventoryLocationId: id,
  issuedOn: '2026-11-03',
  currency: 'MXN',
  lines: [line],
};
test('manual purchase accepts no supplier or artifact', () => {
  assert.ok(contract.RecordInventoryPurchaseRequest, 'purchase schema exists');
  assert.equal(contract.RecordInventoryPurchaseRequest.safeParse(input).success, true);
  assert.equal(
    contract.RecordInventoryPurchaseRequest.safeParse({ ...input, supplierId: null }).success,
    true,
  );
});
test('manual purchase treats an explicit null photo as no artifact', () => {
  assert.equal(
    contract.RecordInventoryPurchaseRequest.safeParse({ ...input, artifactBase64: null }).success,
    true,
  );
});
test('purchase refuses more than 100 rows, invalid dates and unsafe amounts', () => {
  assert.ok(contract.RecordInventoryPurchaseRequest, 'purchase schema exists');
  for (const invalid of [
    {
      ...input,
      lines: Array.from({ length: 101 }, (_, i) => ({
        ...line,
        inventoryItemId: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      })),
    },
    { ...input, issuedOn: '2026-02-30' },
    { ...input, issuedOn: 'not-a-date' },
    { ...input, lines: [{ ...line, unitCostMinor: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...input, lines: [{ ...line, quantity: { ...line.quantity, value: 0 } }] },
  ])
    assert.equal(contract.RecordInventoryPurchaseRequest.safeParse(invalid).success, false);
});
test('purchase artifact enforces the final photo byte limit', () => {
  assert.ok(contract.RecordInventoryPurchaseRequest, 'purchase schema exists');
  const image = Buffer.alloc(700 * 1024, 1).toString('base64');
  assert.equal(
    contract.RecordInventoryPurchaseRequest.safeParse({ ...input, artifactBase64: image }).success,
    true,
  );
  assert.equal(
    contract.RecordInventoryPurchaseRequest.safeParse({
      ...input,
      artifactBase64: Buffer.alloc(700 * 1024 + 1).toString('base64'),
    }).success,
    false,
  );
});
test('direct receive accepts identity and destination, refuses client replacement lines', () => {
  assert.ok(contract.ReceiveSupplierInvoiceDirectRequest, 'direct receive schema exists');
  const dto = {
    commandId: id,
    idempotencyKey: other,
    supplierInvoiceId: id,
    locationId: id,
    inventoryLocationId: id,
  };
  assert.equal(contract.ReceiveSupplierInvoiceDirectRequest.safeParse(dto).success, true);
  assert.equal(
    contract.ReceiveSupplierInvoiceDirectRequest.safeParse({ ...dto, lines: [line] }).success,
    false,
  );
});

test('manual purchase preserves repeated items with separate prices', () => {
  const parsed = contract.RecordInventoryPurchaseRequest.parse({
    ...input,
    lines: [line, { ...line, unitCostMinor: 1251 }],
  });
  assert.deepEqual(
    parsed.lines.map((row) => row.unitCostMinor),
    [1250, 1251],
  );
});

test('ordinary orders still require a supplier', () => {
  assert.equal(
    contract.CreatePurchaseOrderRequest.safeParse({
      locationId: id,
      idempotencyKey: other,
      inventoryLocationId: id,
      currency: 'MXN',
      lines: [{ ...line, supplierSku: null, description: null, lineTotalMinor: 1563 }],
    }).success,
    false,
  );
});
