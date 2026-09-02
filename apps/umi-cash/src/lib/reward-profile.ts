import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

/** The columns resolution needs — structurally satisfied by a prisma reward_configs row. */
export type RewardConfigRow = {
  id: string;
  visits_required: number;
  reward_name: string;
  reward_description: string | null;
};

export type RewardProfile = {
  visitsRequired: number;
  rewardName: string;
  rewardDescription: string | null;
  redemptionConfigId: string | null;
};

/**
 * Merge a card's reward override into the tenant default. Overrides are
 * reward-ONLY by decision (2026-09-01): the override supplies the reward's
 * identity (name/description, and the config a redemption records), while
 * visitsRequired always comes from the tenant's active default — a per-client
 * threshold would fork progress bars, pass rendering, and milestone copy.
 */
export function resolveRewardProfile(
  defaultConfig: RewardConfigRow | null,
  overrideConfig: RewardConfigRow | null,
): RewardProfile {
  const identity = overrideConfig ?? defaultConfig;
  return {
    visitsRequired: defaultConfig?.visits_required ?? DEFAULT_VISITS_REQUIRED,
    rewardName: identity?.reward_name ?? DEFAULT_REWARD_NAME,
    rewardDescription: identity?.reward_description ?? null,
    redemptionConfigId: identity?.id ?? null,
  };
}
