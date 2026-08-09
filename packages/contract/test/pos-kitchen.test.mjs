import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KitchenCommandRequest,
  KitchenOrderProjection,
  PosKitchenStatusResult,
  routeCatalog,
} from '../dist/index.js';

const id = (last) => `00000000-0000-4000-8000-${last.padStart(12, '0')}`;

test('Gate 4A kitchen projection contains preparation-safe fields only', () => {
  const projection = KitchenOrderProjection.parse({
    id: id('1'),
    sourceOrderId: id('2'),
    publicReference: '1024',
    merchantId: id('3'),
    locationId: id('4'),
    stationId: id('5'),
    source: 'pos',
    status: 'partially_ready',
    priority: 'high',
    businessDate: '2026-08-09',
    queuedAt: '2026-08-09T12:00:00.000Z',
    preparationStartedAt: '2026-08-09T12:01:00.000Z',
    updatedAt: '2026-08-09T12:02:00.000Z',
    version: 3,
    lastEventSequence: 9,
    items: [
      {
        id: id('6'),
        status: 'ready',
        productName: 'Latte',
        variantName: 'Grande',
        modifiers: ['Leche de avena'],
        quantity: 1,
        preparationNote: null,
        displayOrder: 0,
        targetSeconds: 300,
        version: 2,
      },
    ],
  });
  assert.equal(projection.status, 'partially_ready');
  assert.equal(
    KitchenOrderProjection.safeParse({ ...projection, customerContact: 'private' }).success,
    false,
  );
  assert.equal(
    KitchenOrderProjection.safeParse({ ...projection, paymentDetails: {} }).success,
    false,
  );
});

test('Gate 4A commands bind identity, version, and scope-safe payload', () => {
  const command = KitchenCommandRequest.parse({
    action: 'command',
    commandId: id('10'),
    idempotencyKey: 'kitchen-command-10',
    correlationId: 'kitchen-correlation-10',
    expectedVersion: 4,
    kitchenOrderId: id('1'),
    commandType: 'mark_item_ready',
    itemIds: [id('6')],
    reasonCode: null,
    reasonNote: null,
    priority: null,
  });
  assert.equal(command.expectedVersion, 4);
  assert.equal(KitchenCommandRequest.safeParse({ ...command, expectedVersion: 0 }).success, false);
});

test('Gate 4A exposes a generated POS status route', () => {
  const route = routeCatalog['GET /api/v1/pos/merchants/:merchantId/kitchen/orders/:sourceOrderId'];
  assert.equal(route.permission, 'kitchen.read');
  assert.equal(route.idempotent, true);
  const status = PosKitchenStatusResult.parse({
    kitchenOrderId: id('1'),
    sourceOrderId: id('2'),
    publicReference: '1024',
    status: 'ready',
    priority: 'normal',
    version: 4,
    stationIds: [id('5')],
    updatedAt: '2026-08-09T12:02:00.000Z',
  });
  assert.equal(status.status, 'ready');
});
