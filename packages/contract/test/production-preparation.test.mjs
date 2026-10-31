import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DashboardAdministrativeCommandRequest,
  ProductionRecord,
  ProductionPreview,
} from '../dist/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const quantity = { value: 5, scale: 0, unit: 'unit' };
const command = {
  locationId: id,
  inventoryLocationId: id,
  operatorSessionId: id,
  commandId: id,
  idempotencyKey: id,
  expectedVersion: 1,
  policyFingerprint: 'a'.repeat(64),
  businessDate: '2026-10-30',
  outputItemId: id,
  quantity,
};

test('production keeps absent plan fields compatible and accepts an explicit exact plan', () => {
  const legacy = ProductionRecord.parse(command);
  assert.equal(Object.hasOwn(legacy, 'plannedQuantity'), false);
  assert.equal(Object.hasOwn(legacy, 'recipeFingerprint'), false);
  const nullable = ProductionRecord.parse({
    ...command,
    plannedQuantity: null,
    recipeFingerprint: null,
  });
  assert.equal(nullable.plannedQuantity, null);
  assert.equal(nullable.recipeFingerprint, null);
  const planned = ProductionRecord.parse({
    ...command,
    plannedQuantity: quantity,
    recipeFingerprint: 'b'.repeat(64),
  });
  assert.deepEqual(planned.plannedQuantity, quantity);
  assert.equal(planned.recipeFingerprint, 'b'.repeat(64));
});

test('production refuses malformed plans and fingerprints', () => {
  for (const plannedQuantity of [
    { ...quantity, value: 0 },
    { ...quantity, value: 1.5 },
    { ...quantity, scale: 7 },
    { ...quantity, unit: 'invalid' },
  ]) {
    assert.equal(ProductionRecord.safeParse({ ...command, plannedQuantity }).success, false);
  }
  assert.equal(
    ProductionRecord.safeParse({ ...command, recipeFingerprint: 'unreviewed' }).success,
    false,
  );
});

test('preview uses the administrative envelope and publishes exact ingredients', () => {
  assert.equal(
    DashboardAdministrativeCommandRequest.parse({
      operation: 'inventory.production.preview',
      locationId: id,
      targetAggregateId: id,
      targetVersion: null,
      commandId: id,
      idempotencyKey: id,
      approvalId: null,
      parameters: { inventoryLocationId: id, quantity },
    }).operation,
    'inventory.production.preview',
  );
  const preview = {
    outputItemId: id,
    inventoryLocationId: id,
    recipeId: id,
    recipeVersion: 2,
    plannedQuantity: quantity,
    recipeFingerprint: 'b'.repeat(64),
    consumed: [
      {
        inventoryItemId: id,
        publicReference: 'FLOUR',
        displayName: 'Flour',
        quantity: { value: 500, scale: 0, unit: 'gram' },
        unitCostMinor: null,
        lineCostMinor: null,
      },
    ],
  };
  assert.deepEqual(ProductionPreview.parse(preview), preview);
  assert.equal(ProductionPreview.safeParse({ ...preview, recipeFingerprint: '' }).success, false);
});
