import { describe, it, expect } from 'vitest';
import { resolveRewardProfile } from './reward-profile';
import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

const tenantDefault = {
  id: 'cfg-default', visits_required: 10,
  reward_name: 'Bebida gratis', reward_description: 'Cualquier bebida del menú',
};
const override = {
  id: 'cfg-override', visits_required: 5, // deliberately different — must be ignored
  reward_name: 'Postre gratis', reward_description: null,
};

describe('resolveRewardProfile', () => {
  it('uses the tenant default when there is no override', () => {
    expect(resolveRewardProfile(tenantDefault, null)).toEqual({
      visitsRequired: 10,
      rewardName: 'Bebida gratis',
      rewardDescription: 'Cualquier bebida del menú',
      redemptionConfigId: 'cfg-default',
      baseTier: null,
    });
  });

  it('takes reward identity from the override but visits from the default', () => {
    const p = resolveRewardProfile(tenantDefault, override);
    expect(p.rewardName).toBe('Postre gratis');
    expect(p.rewardDescription).toBeNull();
    expect(p.redemptionConfigId).toBe('cfg-override');
    // Reward-only override (spec): thresholds never change per client.
    expect(p.visitsRequired).toBe(10);
  });

  it('falls back to constants when the tenant has no active config at all', () => {
    expect(resolveRewardProfile(null, null)).toEqual({
      visitsRequired: DEFAULT_VISITS_REQUIRED,
      rewardName: DEFAULT_REWARD_NAME,
      rewardDescription: null,
      redemptionConfigId: null,
      baseTier: null,
    });
  });

  it('still lets an override apply when the tenant default is missing', () => {
    const p = resolveRewardProfile(null, override);
    expect(p.rewardName).toBe('Postre gratis');
    expect(p.redemptionConfigId).toBe('cfg-override');
    expect(p.visitsRequired).toBe(DEFAULT_VISITS_REQUIRED);
  });

  describe('two-tier ladder (upgrade config)', () => {
    const egrDefault = { id: 'cfg-cap', visits_required: 7, reward_name: 'Capuccino', reward_description: null };
    const egrUpgrade = { id: 'cfg-rocas', visits_required: 9, reward_name: 'Bebida rocas', reward_description: 'Rocas, frappé o caliente' };

    it('runs the cycle to the upgrade tier and keeps the default as the early cash-out', () => {
      expect(resolveRewardProfile(egrDefault, null, egrUpgrade)).toEqual({
        visitsRequired: 9,
        rewardName: 'Bebida rocas',
        rewardDescription: 'Rocas, frappé o caliente',
        redemptionConfigId: 'cfg-rocas',
        baseTier: { visitsRequired: 7, rewardName: 'Capuccino', rewardDescription: null, configId: 'cfg-cap' },
      });
    });

    it('lets a per-client override replace the LOWER tier only', () => {
      const p = resolveRewardProfile(egrDefault, override, egrUpgrade);
      expect(p.rewardName).toBe('Bebida rocas');
      expect(p.redemptionConfigId).toBe('cfg-rocas');
      expect(p.baseTier).toEqual({ visitsRequired: 7, rewardName: 'Postre gratis', rewardDescription: null, configId: 'cfg-override' });
    });

    it('ignores an upgrade that does not sit above the default threshold', () => {
      const bad = { ...egrUpgrade, visits_required: 7 };
      expect(resolveRewardProfile(egrDefault, null, bad).baseTier).toBeNull();
      expect(resolveRewardProfile(egrDefault, null, bad).visitsRequired).toBe(7);
    });
  });
});
