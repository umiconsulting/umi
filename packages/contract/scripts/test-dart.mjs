import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  InventoryAuthoringItemUpdateRequest,
  ProductionRecord,
  RecordInventoryPurchaseRequest,
} from '../dist/index.js';

const result = spawnSync(
  process.env.DART_BIN ?? 'dart',
  [fileURLToPath(new URL('../test/dart/optional_nullable_test.dart', import.meta.url))],
  { encoding: 'utf8' },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
const payloads = JSON.parse(result.stdout);
for (const [name, payload] of Object.entries(payloads)) {
  const parsed = InventoryAuthoringItemUpdateRequest.parse(payload);
  assert.equal(Object.hasOwn(parsed, 'initialUnitCostMinor'), name !== 'omitted');
  assert.equal(parsed.initialUnitCostMinor, payload.initialUnitCostMinor);
}
console.log(
  'Dart scalar and collection constructors and round trips passed; all four payloads passed the server contract.',
);

const preparation = spawnSync(
  process.env.DART_BIN ?? 'dart',
  [fileURLToPath(new URL('../test/dart/production_plan_test.dart', import.meta.url))],
  { encoding: 'utf8' },
);
if (preparation.error) throw preparation.error;
assert.equal(preparation.status, 0, preparation.stderr);
const productionPayloads = JSON.parse(preparation.stdout);
for (const [name, payload] of Object.entries(productionPayloads)) {
  const parsed = ProductionRecord.parse(payload);
  const present = !name.startsWith('legacy');
  assert.equal(Object.hasOwn(parsed, 'plannedQuantity'), present);
  assert.equal(Object.hasOwn(parsed, 'recipeFingerprint'), present);
  if (name.startsWith('null')) {
    assert.equal(parsed.plannedQuantity, null);
    assert.equal(parsed.recipeFingerprint, null);
  }
}
assert.deepEqual(productionPayloads.legacy, productionPayloads.legacyRoundTrip);
assert.deepEqual(productionPayloads.planned, productionPayloads.plannedRoundTrip);
assert.deepEqual(productionPayloads.null, productionPayloads.nullRoundTrip);
console.log('Dart production plan constructors and round trips passed the server contract.');

const purchase = spawnSync(
  process.env.DART_BIN ?? 'dart',
  [fileURLToPath(new URL('../test/dart/purchase_entry_test.dart', import.meta.url))],
  { encoding: 'utf8' },
);
if (purchase.error) throw purchase.error;
assert.equal(purchase.status, 0, purchase.stderr);
const purchasePayloads = JSON.parse(purchase.stdout);
assert.equal(Object.hasOwn(purchasePayloads.omitted, 'artifactBase64'), false);
assert.equal(Object.hasOwn(purchasePayloads.null, 'artifactBase64'), true);
assert.equal(purchasePayloads.null.artifactBase64, null);
assert.equal(purchasePayloads.photo.artifactBase64, 'iVBORw0KGgo=');
for (const payload of Object.values(purchasePayloads))
  RecordInventoryPurchaseRequest.parse(payload);
assert.deepEqual(purchasePayloads.omitted, purchasePayloads.omittedRoundTrip);
assert.deepEqual(purchasePayloads.null, purchasePayloads.nullRoundTrip);
console.log(
  'Dart purchase omission, explicit null, photo and round trips passed the server contract.',
);
