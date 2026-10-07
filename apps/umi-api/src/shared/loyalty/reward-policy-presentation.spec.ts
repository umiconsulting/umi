import { describe, expect, it } from 'vitest';
import {
  cardPolicyFields,
  policyRewardCopy,
  rewardProfileWithSnapshot,
} from './reward-policy-presentation';

const profile = {
  visitsRequired: 9,
  rewardName: 'Upper renamed',
  rewardDescription: null,
  redemptionConfigId: null,
  baseTier: {
    visitsRequired: 7,
    rewardName: 'Base renamed',
    rewardDescription: null,
    configId: null,
  },
};
describe('single cycle presentation', () => {
  it('uses stored tier names and preserves the expiry instant', () => {
    const row = {
      reward_policy: 'single_cycle',
      visits_required: 9,
      reward_name: 'Upper original',
      base_visits_required: 7,
      base_reward_name: 'Base original',
      next_reward_expires_at: new Date('2026-11-06T18:00:00Z'),
      merchant_timezone: 'America/Mazatlan',
      legacy_pending_rewards: 2,
      cycle_reward_available: true,
      available_rewards: [
        { rewardName: 'Base original', quantity: 1, expiresAt: '2026-11-06T18:00:00.000Z' },
      ],
    };
    expect(rewardProfileWithSnapshot(profile, row).rewardName).toBe('Upper original');
    expect(cardPolicyFields(row)).toMatchObject({
      rewardPolicy: 'single_cycle',
      nextRewardExpiresAt: '2026-11-06T18:00:00.000Z',
      legacyPendingRewards: 2,
      merchantTimezone: 'America/Mazatlan',
    });
  });
  it('shows the upper reward and blocked visits at nine', () => {
    const copy = policyRewardCopy({
      rewardPolicy: 'single_cycle',
      visitsThisCycle: 9,
      visitsRequired: 9,
      rewardName: 'Upper',
      baseReward: { visitsRequired: 7, rewardName: 'Base' },
      nextRewardExpiresAt: '2026-11-06T18:00:00Z',
      merchantTimezone: 'America/Mazatlan',
      legacyPendingRewards: 0,
    });
    expect(copy?.body).toContain('Upper');
    expect(copy?.body).toContain('Canjea antes de otra visita');
    expect(copy?.body).not.toContain('Base');
    expect(copy?.body).toContain('11:00');
  });
});
