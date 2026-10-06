import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KitchenCommandRequest,
  KitchenOrderProjection,
  PosKitchenCommandRequest,
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
    // §8H step 4. The ticket has fired through course 1, so the dessert below is HELD
    // and still on the same ticket: a projection the client parses must be able to tell
    // the two apart, and a held item must not have been filtered out of the read.
    firedThroughCourse: 1,
    items: [
      {
        id: id('6'),
        status: 'ready',
        productName: 'Latte',
        variantName: 'Grande',
        // §8.5. The badge a cook reads. Derived from the product's recipe when the
        // board is read, never stored on the ticket.
        allergens: [{ code: 'milk', label: 'Leche' }],
        modifiers: ['Leche de avena'],
        quantity: 1,
        preparationNote: null,
        displayOrder: 0,
        targetSeconds: 300,
        courseNumber: 1,
        fired: true,
        version: 2,
      },
      {
        id: id('7'),
        status: 'queued',
        productName: 'Flan',
        variantName: null,
        allergens: [],
        modifiers: [],
        quantity: 1,
        preparationNote: null,
        displayOrder: 1,
        targetSeconds: 120,
        courseNumber: 3,
        fired: false,
        version: 1,
      },
    ],
  });
  assert.equal(projection.status, 'partially_ready');
  assert.deepEqual(
    projection.items.map((item) => [item.courseNumber, item.fired]),
    [
      [1, true],
      [3, false],
    ],
  );
  // The flag is part of the model, not an optional extra: a server that stopped sending
  // it would fail here rather than leave the board drawing every held dish as fired.
  assert.equal(
    KitchenOrderProjection.safeParse({
      ...projection,
      items: [{ ...projection.items[0], fired: undefined }],
    }).success,
    false,
  );
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

test('the POS command route carries the command plus the board read context', () => {
  const route = routeCatalog['POST /api/v1/pos/merchants/:merchantId/kitchen/command'];
  assert.equal(route.permission, 'kitchen.prepare');
  assert.equal(route.idempotent, true);
  assert.deepEqual(route.errors, [
    'PERMISSION_DENIED',
    'RESOURCE_NOT_FOUND',
    'OPTIMISTIC_VERSION_CONFLICT',
  ]);

  const command = PosKitchenCommandRequest.parse({
    ...KitchenCommandRequest.parse({
      action: 'command',
      commandId: id('10'),
      idempotencyKey: 'kitchen-command-10',
      correlationId: 'kitchen-correlation-10',
      expectedVersion: 4,
      kitchenOrderId: id('1'),
      commandType: 'mark_item_ready',
      itemIds: [id('6')],
    }),
    locationId: id('4'),
    operatorSessionId: id('12'),
  });
  assert.equal(command.locationId, id('4'));
  assert.equal(command.operatorSessionId, id('12'));

  // The POS context is not optional, and the request stays strict: a field the
  // server does not read must be refused rather than silently ignored, because a
  // client that believes it sent its location would otherwise command as nobody.
  assert.equal(
    PosKitchenCommandRequest.safeParse({ ...command, locationId: undefined }).success,
    false,
  );
  assert.equal(
    PosKitchenCommandRequest.safeParse({ ...command, stationId: id('5') }).success,
    false,
  );
  assert.equal(
    PosKitchenCommandRequest.safeParse({ ...command, expectedVersion: 0 }).success,
    false,
  );
});
