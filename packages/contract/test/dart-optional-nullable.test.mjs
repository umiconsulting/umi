import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { InventoryAuthoringItemUpdateRequest } from '../dist/index.js';

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/initial-cost-dart-updates.json', import.meta.url), 'utf8'),
);

test('Dart update fixtures preserve omitted, null, zero, and positive initial costs in the server contract', () => {
  for (const [name, payload] of Object.entries(fixtures)) {
    const parsed = InventoryAuthoringItemUpdateRequest.parse(payload);
    assert.equal(Object.hasOwn(parsed, 'initialUnitCostMinor'), name !== 'omitted');
    assert.equal(parsed.initialUnitCostMinor, payload.initialUnitCostMinor);
  }
});
