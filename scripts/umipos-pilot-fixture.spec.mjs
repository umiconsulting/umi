import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const descriptor = JSON.parse(
  readFileSync(new URL('config/umipos-pilot-training-fixture.json', root)),
);
const source = [
  readFileSync(new URL('scripts/umi-pos-demo-seed.sh', root), 'utf8'),
  readFileSync(new URL('scripts/umi-pos-gate5a-live-fixture.sql', root), 'utf8'),
].join('\n');

test('la fixture exige un entorno desechable', () => {
  assert.equal(descriptor.classification, 'DEV_CERTIFICATION_ONLY');
  assert.equal(descriptor.activationGuard, 'PILOT_CERTIFICATION_CONFIRM=disposable');
  assert.match(
    readFileSync(new URL('scripts/umipos-pilot.sh', root), 'utf8'),
    /PILOT_CERTIFICATION_CONFIRM.*disposable/,
  );
});

test('la fixture cubre el negocio de entrenamiento', () => {
  for (const table of [
    'product_variant',
    'product_modifier',
    'inventory_item',
    'loyalty_reward',
    'loyalty_gift_card',
    'kitchen_route',
    'hardware_device',
    'pos_offline_policy',
  ])
    assert.match(source, new RegExp(`merchant\\.${table}`));
  for (const role of descriptor.roles)
    assert.match(source.toLowerCase(), new RegExp(role.toLowerCase()));
});
