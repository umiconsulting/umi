import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OfflineCommand, OfflineCommandGroupPayload } = require('../dist/index.cjs');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

test('the replay command accepts the null optional fields the Dart journal emits', () => {
  const command = {
    commandId: id(1),
    provisionalId: null,
    deviceId: id(2),
    deviceCredentialVersion: 1,
    deviceSequence: 1,
    merchantId: id(3),
    locationId: id(4),
    operatorSessionId: id(5),
    commandType: 'operational.ack',
    idempotencyKey: id(6),
    fingerprint: 'a'.repeat(64),
    contractVersion: '2.43.0',
    schemaVersion: 1,
    createdAt: '2026-10-19T02:00:00.000Z',
    originDeviceId: null,
    originOperatorSessionId: null,
    hubReceivedAt: null,
    hubOwned: null,
    payload: {},
  };

  assert.equal(OfflineCommand.safeParse(command).success, true);
});

test('the command group accepts null optional origin fields', () => {
  assert.equal(
    OfflineCommandGroupPayload.safeParse({
      groupId: id(10),
      aggregateKeys: [`account:${id(11)}`],
      effects: [
        {
          type: 'open_table_account',
          provisionalCartId: id(11),
          tableId: id(12),
          partySize: 2,
          expectedVersion: null,
        },
      ],
      originDeviceId: null,
      originOperatorSessionId: null,
      hubReceivedAt: null,
    }).success,
    true,
  );
});

test('an unspecified party size is null, not a missing required field', () => {
  assert.equal(
    OfflineCommandGroupPayload.safeParse({
      groupId: id(20),
      aggregateKeys: [`account:${id(21)}`],
      effects: [
        {
          type: 'open_table_account',
          provisionalCartId: id(21),
          tableId: id(22),
          partySize: null,
          expectedVersion: null,
        },
      ],
      originDeviceId: null,
      originOperatorSessionId: null,
      hubReceivedAt: null,
    }).success,
    true,
  );
});
