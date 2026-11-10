import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

// Authentication and database access belong to the private, loopback-only wrapper.
// This runner receives real HTTP responses and asserts persisted business facts.
export async function runPurchaseHttpAcceptance({
  fixture: f,
  request,
  snapshot,
  facts,
  artifact,
}) {
  const api = new URL(f.api);
  assert.equal(api.origin, 'http://127.0.0.1:4092');
  const merchant = f.merchants[0].id;
  const path = (suffix, m = merchant) => `/api/merchants/${m}/${suffix}`;
  const parameters = {
    locationId: f.locations[0].id,
    inventoryLocationId: f.inventoryLocations[0].id,
    issuedOn: '2026-11-03',
    currency: 'MXN',
    supplierId: null,
    note: 'Límite 界 🙂',
    lines: [
      {
        inventoryItemId: f.items[2].id,
        quantity: { value: 1234567, scale: 6, unit: 'liter' },
        unitCostMinor: 1250,
      },
    ],
  };
  const envelope = (p = parameters, operation = 'inventory.purchase.record') => ({
    operation,
    targetAggregateId: randomUUID(),
    targetVersion: null,
    commandId: randomUUID(),
    idempotencyKey: randomUUID(),
    parameters: p,
    locationId: p.locationId,
    approvalId: null,
  });
  const send = (actor, body) => request(actor, 'POST', path('administrative-commands'), body);
  const before = await snapshot();
  const accepted = envelope();
  const raw = JSON.stringify(accepted);
  assert.ok(Buffer.byteLength(raw) > raw.length, 'boundary must include multibyte UTF-8');
  const atLimit = raw + ' '.repeat(1024 * 1024 - Buffer.byteLength(raw));
  assert.equal(Buffer.byteLength(atLimit), 1048576);
  const exact = await send('owner', atLimit);
  assert.ok(exact.status >= 200 && exact.status < 300, JSON.stringify(exact));
  const after = await snapshot();
  const over = await send('owner', atLimit + ' ');
  assert.equal(over.status, 413);
  assert.deepEqual(await snapshot(), after);
  const replay = await send('owner', atLimit);
  assert.ok(replay.status >= 200 && replay.status < 300);
  assert.deepEqual(await snapshot(), after);
  const persisted = await facts(accepted, before, after);
  const refusals = [];
  for (const [label, patch] of [
    [
      'archived item',
      {
        lines: [
          ...parameters.lines,
          {
            inventoryItemId: f.items[3].id,
            quantity: { value: 1, scale: 0, unit: 'unit' },
            unitCostMinor: 1,
          },
        ],
      },
    ],
    [
      'foreign item',
      {
        lines: [
          ...parameters.lines,
          {
            inventoryItemId: f.items[4].id,
            quantity: { value: 1, scale: 0, unit: 'unit' },
            unitCostMinor: 1,
          },
        ],
      },
    ],
    ['archived supplier', { supplierId: f.suppliers[1].id }],
    ['foreign supplier', { supplierId: f.suppliers[2].id }],
    ['foreign destination', { inventoryLocationId: f.inventoryLocations[3].id }],
    ['wrong branch destination', { inventoryLocationId: f.inventoryLocations[2].id }],
  ]) {
    const body = envelope({ ...parameters, ...patch });
    const result = await send('owner', JSON.stringify(body));
    assert.ok(
      [400, 403, 404, 409, 422].includes(result.status),
      `${label}: ${JSON.stringify(result)}`,
    );
    assert.deepEqual(await snapshot(), after, `${label}: business facts must roll back`);
    refusals.push({
      label,
      status: result.status,
      code: result.body.code || result.body.error?.code,
    });
  }
  const permissions = [];
  for (const actor of ['capture', 'reader']) {
    for (const operation of ['inventory.purchase.record', 'inventory.invoice.receive_direct']) {
      const body = envelope(
        operation.endsWith('receive_direct')
          ? {
              locationId: parameters.locationId,
              inventoryLocationId: parameters.inventoryLocationId,
            }
          : parameters,
        operation,
      );
      const result = await send(actor, JSON.stringify(body));
      assert.equal(result.status, 403, `${actor} ${operation}`);
      permissions.push({
        actor,
        operation,
        status: result.status,
        code: result.body.code || result.body.error?.code,
      });
    }
  }
  assert.deepEqual(await snapshot(), after);
  const image = await artifact();
  const reads = [];
  for (const [actor, m, id, status] of [
    ['owner', merchant, image.id, 200],
    ['capture', merchant, image.id, 200],
    ['reader', merchant, image.id, 403],
    ['anonymous', merchant, image.id, 401],
    ['owner', f.merchants[1].id, image.id, 404],
    ['owner', merchant, accepted.targetAggregateId, 404],
  ]) {
    const result = await request(actor, 'GET', path(`supplier-invoices/${id}/artifact`, m));
    assert.equal(result.status, status, `${actor} artifact scope`);
    if (status === 200) {
      assert.equal(result.body.contentType, image.contentType);
      assert.equal(Buffer.from(result.body.dataBase64, 'base64').length, image.bytes);
    } else assert.equal(result.body.dataBase64, undefined);
    reads.push({
      actor,
      scope: m === merchant ? (id === image.id ? 'owned image' : 'no image') : 'other merchant',
      status,
    });
  }
  const list = await request('owner', 'GET', path('supplier-invoices?limit=100'));
  assert.equal(list.status, 200);
  assert.doesNotMatch(JSON.stringify(list.body), /dataBase64|artifactBase64|artifact_bytes/);
  assert.doesNotMatch(JSON.stringify(exact.body), /dataBase64|artifactBase64|artifact_bytes/);
  assert.deepEqual(await snapshot(), after, 'reads must not mutate business facts');
  return {
    utf8Boundary: {
      accepted: 1048576,
      refused: 1048577,
      acceptedStatus: exact.status,
      refusedStatus: over.status,
    },
    persisted,
    refusals,
    permissions,
    artifactReads: reads,
  };
}
