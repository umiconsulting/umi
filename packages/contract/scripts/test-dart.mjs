import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { InventoryAuthoringItemUpdateRequest } from '../dist/index.js';

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
