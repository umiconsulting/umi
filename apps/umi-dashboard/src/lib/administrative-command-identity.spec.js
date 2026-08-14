import { describe, expect, it } from 'vitest';
import {
  administrativeRecoveryKey,
  readAdministrativeIdentity,
  removeAdministrativeIdentity,
  writeAdministrativeIdentity,
} from './administrative-command-identity.js';

describe('Dashboard administrative command identity', () => {
  it('excludes command parameters and manager secrets from its storage key', () => {
    const key = administrativeRecoveryKey('refund.approval', 'sale-1', {
      parameters: { managerPin: '1234' },
    });
    expect(key).not.toContain('1234');
    expect(key).toBe('refund.approval:sale-1:none:none');
  });

  it('restores one response-loss identity and removes it after a terminal result', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const identity = { commandId: 'command-1', idempotencyKey: 'key-1' };
    writeAdministrativeIdentity(storage, 'inventory.adjustment:item-1:none:none', identity);
    expect(readAdministrativeIdentity(storage, 'inventory.adjustment:item-1:none:none')).toEqual(
      identity,
    );
    removeAdministrativeIdentity(storage, 'inventory.adjustment:item-1:none:none');
    expect(readAdministrativeIdentity(storage, 'inventory.adjustment:item-1:none:none')).toBeNull();
  });
});
