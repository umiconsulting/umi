import { describe, expect, it } from 'vitest';
import {
  cardPolicyFields,
  policyReadyFrontFields,
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
  it('shows both exclusive choices and retained visits at nine', () => {
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
    expect(copy?.body).toContain('Base');
    expect(copy?.body).toContain('7 visitas · quedan 2');
    expect(copy?.body).toContain('9 visitas · quedan 0');
    expect(copy?.body).not.toContain('reinicia');
    expect(copy?.body).toContain('11:00');
  });
});

it('keeps the enabled 7/9 thresholds before eligibility while it preserves custom names', () => {
  const custom = {
    ...profile,
    visitsRequired: 12,
    rewardName: 'Custom upper',
    baseTier: { ...profile.baseTier, visitsRequired: 8, rewardName: 'Custom base' },
  };
  expect(
    rewardProfileWithSnapshot(custom, {
      reward_policy: 'single_cycle',
      cycle_reward_available: false,
    }),
  ).toMatchObject({
    visitsRequired: 9,
    rewardName: 'Custom upper',
    baseTier: { visitsRequired: 7, rewardName: 'Custom base' },
  });
  expect(
    rewardProfileWithSnapshot(
      { ...custom, baseTier: null },
      { reward_policy: 'single_cycle', cycle_reward_available: false },
    ),
  ).toMatchObject({
    visitsRequired: 9,
    baseTier: { visitsRequired: 7, rewardName: 'Custom upper' },
  });
});

it('shows the base cost and retained visit at eight without a reset claim', () => {
  const copy = policyRewardCopy({
    rewardPolicy: 'single_cycle',
    visitsThisCycle: 8,
    visitsRequired: 9,
    rewardName: 'Upper',
    baseReward: { visitsRequired: 7, rewardName: 'Base' },
  });
  expect(copy?.body).toContain('7 visitas · quedan 1');
  expect(copy?.body).toContain('continuar');
  expect(copy?.body).not.toContain('reinicia');
});

it('shows both reward costs on the Apple front at nine', () => {
  expect(
    policyReadyFrontFields({
      rewardPolicy: 'single_cycle',
      cycleRewardAvailable: true,
      visitsThisCycle: 9,
      visitsRequired: 9,
      rewardName: 'Upper',
      baseReward: { visitsRequired: 7, rewardName: 'Base' },
    }),
  ).toEqual([
    { key: 'baseChoice', label: 'ELIGE · 7 VISITAS', value: 'Base · quedan 2' },
    { key: 'topChoice', label: 'O · 9 VISITAS', value: 'Upper · quedan 0' },
  ]);
});

it('does not offer a blocked base or continuation while historical rewards remain', () => {
  const state = {
    rewardPolicy: 'single_cycle',
    cycleRewardAvailable: true,
    visitsThisCycle: 8,
    visitsRequired: 9,
    rewardName: 'Upper',
    baseReward: { visitsRequired: 7, rewardName: 'Base', canRedeem: false },
    legacyPendingRewards: 1,
    visitBlockedReason: 'REDEMPTION_REQUIRED',
  };
  const copy = policyRewardCopy(state);
  expect(copy?.body).not.toContain('Base listo');
  expect(copy?.body).not.toContain('continuar');
  expect(copy?.body).toContain('saldo anterior');
  expect(policyReadyFrontFields(state)).toEqual([
    { key: 'historyFirst', label: 'SALDO ANTERIOR', value: 'Canjea antes de otra visita' },
  ]);
  expect(policyReadyFrontFields({ ...state, visitsThisCycle: 9 })).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'baseChoice' })]),
  );
});
