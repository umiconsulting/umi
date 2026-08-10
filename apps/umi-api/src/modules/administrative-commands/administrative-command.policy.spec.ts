import { describe, expect, it } from 'vitest';
import {
  ADMINISTRATIVE_COMMAND_POLICIES,
  administrativeCommandPolicy,
} from './administrative-command.policy';

describe('administrative command policy', () => {
  it('allows only explicit Dashboard operations', () => {
    expect(administrativeCommandPolicy('inventory.adjustment')).toMatchObject({
      permission: 'inventory.adjust.increase',
      contexts: ['dashboard_administrative', 'pos_device'],
    });
    expect(administrativeCommandPolicy('sale.checkout')).toBeNull();
    expect(administrativeCommandPolicy('kitchen.prepare')).toBeNull();
  });

  it('declares risk and physical relay rules for each operation', () => {
    expect(ADMINISTRATIVE_COMMAND_POLICIES.length).toBeGreaterThan(10);
    for (const policy of ADMINISTRATIVE_COMMAND_POLICIES) {
      expect(policy.contexts).toContain('dashboard_administrative');
      expect(policy.permission).toMatch(/^[a-z][a-z0-9_.]+$/);
      expect(typeof policy.stepUp).toBe('boolean');
      expect(typeof policy.approval).toBe('boolean');
      expect(typeof policy.remotePhysicalExecution).toBe('boolean');
    }
  });
});
