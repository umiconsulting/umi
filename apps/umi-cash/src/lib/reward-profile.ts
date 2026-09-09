import { DEFAULT_VISITS_REQUIRED, DEFAULT_REWARD_NAME } from './constants';

/** The columns resolution needs — structurally satisfied by a prisma reward_configs row. */
export type RewardConfigRow = {
  id: string;
  visits_required: number;
  reward_name: string;
  reward_description: string | null;
};

export type RewardTier = {
  visitsRequired: number;
  rewardName: string;
  rewardDescription: string | null;
  /** reward_configs row a redemption of this tier records. */
  configId: string | null;
};

export type RewardProfile = {
  /** Visits that complete the cycle and bank a reward (the TOP tier on a ladder). */
  visitsRequired: number;
  /** Reward earned when the cycle completes (the TOP tier on a ladder). */
  rewardName: string;
  rewardDescription: string | null;
  /** Config recorded when a banked reward is redeemed. */
  redemptionConfigId: string | null;
  /**
   * Two-tier ladder: the lower tier the customer may cash out early instead of
   * finishing the cycle (e.g. capuccino at 7 while the cycle runs to 9 for a
   * bebida en las rocas). null = the tenant runs a single reward and every
   * surface behaves exactly as before the ladder existed.
   */
  baseTier: RewardTier | null;
};

/**
 * Merge a card's reward override and the tenant's optional upgrade tier into the
 * tenant default.
 *
 * Overrides are reward-ONLY by decision (2026-09-01): the override supplies the
 * reward's identity (name/description, and the config a redemption records), while
 * visitsRequired always comes from the tenant's active default — a per-client
 * threshold would fork progress bars, pass rendering, and milestone copy. On a
 * ladder the override replaces the LOWER tier (the one a VIP cashes out at the
 * standard threshold); the upper tier stays tenant-wide.
 *
 * The upgrade tier only counts when it sits strictly above the default threshold —
 * a mis-set row (9 over 10) is ignored rather than producing a cycle that can never
 * offer the early cash-out.
 */
export function resolveRewardProfile(
  defaultConfig: RewardConfigRow | null,
  overrideConfig: RewardConfigRow | null,
  upgradeConfig: RewardConfigRow | null = null,
): RewardProfile {
  const identity = overrideConfig ?? defaultConfig;
  const base: RewardTier = {
    visitsRequired: defaultConfig?.visits_required ?? DEFAULT_VISITS_REQUIRED,
    rewardName: identity?.reward_name ?? DEFAULT_REWARD_NAME,
    rewardDescription: identity?.reward_description ?? null,
    configId: identity?.id ?? null,
  };

  if (upgradeConfig && upgradeConfig.visits_required > base.visitsRequired) {
    return {
      visitsRequired: upgradeConfig.visits_required,
      rewardName: upgradeConfig.reward_name,
      rewardDescription: upgradeConfig.reward_description,
      redemptionConfigId: upgradeConfig.id,
      baseTier: base,
    };
  }

  return {
    visitsRequired: base.visitsRequired,
    rewardName: base.rewardName,
    rewardDescription: base.rewardDescription,
    redemptionConfigId: base.configId,
    baseTier: null,
  };
}
