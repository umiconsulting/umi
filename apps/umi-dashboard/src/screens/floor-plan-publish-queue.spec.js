import { describe, expect, it } from 'vitest';
import {
  blockingTablesReleased,
  clearPublishQueue,
  floorPlanBlockers,
  publishQueueKey,
  readPublishQueue,
  writePublishQueue,
} from './floor-plan-publish-queue';

const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const tableId = '33333333-3333-4333-8333-333333333333';
const accountId = '44444444-4444-4444-8444-444444444444';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe('floor-plan publish queue', () => {
  it('reads the actionable tables from the nested API refusal', () => {
    const blockers = floorPlanBlockers({
      details: {
        error: {
          code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
          fieldErrors: {
            tableIds: [tableId],
            blockers: ['Brasil'],
            blockerAccounts: [`${tableId}|${accountId}|7|012`],
          },
        },
      },
    });
    expect(blockers).toEqual({
      tableIds: [tableId],
      labels: ['Brasil'],
      details: [{ tableId, label: 'Brasil', accountReference: '012' }],
      canCloseAccounts: true,
    });
  });

  it('does not offer to close a party that has no account', () => {
    const blockers = floorPlanBlockers({
      response: {
        fieldErrors: { tableIds: [tableId], blockers: ['Brasil'] },
      },
    });
    expect(blockers.canCloseAccounts).toBe(false);
    expect(blockers.details).toEqual([{ tableId, label: 'Brasil', accountReference: null }]);
  });

  it('persists one queue per merchant and location across a dashboard reload', () => {
    const local = storage();
    const queue = {
      schemaVersion: 1,
      merchantId,
      locationId,
      expectedVersion: 9,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      tableIds: [tableId],
      blockers: ['Brasil'],
      details: [{ tableId, label: 'Brasil', accountReference: '012' }],
      queuedAt: '2026-10-20T12:00:00.000Z',
    };
    writePublishQueue(local, queue);
    expect(readPublishQueue(local, merchantId, locationId)).toEqual(queue);
    expect(readPublishQueue(local, merchantId, '99999999-9999-4999-8999-999999999999')).toBeNull();
    clearPublishQueue(local, merchantId, locationId);
    expect(local.getItem(publishQueueKey(merchantId, locationId))).toBeNull();
  });

  it('waits for both the party and the open account to leave a table', () => {
    const room = (entry) => ({ byTable: new Map([[tableId, entry]]) });
    const clear = {
      tableId,
      state: 'dirty',
      seatedAt: null,
      partySize: null,
      groupId: null,
      openAccountId: null,
      openAccountTableId: null,
    };
    expect(blockingTablesReleased(room(clear), [tableId])).toBe(true);
    expect(blockingTablesReleased(room({ ...clear, state: 'open' }), [tableId])).toBe(true);
    expect(blockingTablesReleased({ byTable: new Map() }, [tableId])).toBe(true);
    expect(
      blockingTablesReleased(
        room({
          ...clear,
          state: 'seated',
          seatedAt: '2026-10-20T12:00:00.000Z',
          partySize: 2,
        }),
        [tableId],
      ),
    ).toBe(false);
    expect(blockingTablesReleased(room({ ...clear, openAccountId: accountId }), [tableId])).toBe(
      false,
    );
  });
});
