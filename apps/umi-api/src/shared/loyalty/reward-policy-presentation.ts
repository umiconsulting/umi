import type { RewardProfile } from './reward-profile';

export type RewardPolicyRow = {
  reward_policy?: string;
  reward_expiry_days?: number | null;
  next_reward_expires_at?: Date | string | null;
  legacy_pending_rewards?: number;
  cycle_reward_available?: boolean;
  visit_blocked_reason?: string | null;
  merchant_timezone?: string;
  available_rewards?: { rewardName: string; quantity: number; expiresAt: string }[];
  visits_required?: number;
  reward_name?: string | null;
  base_visits_required?: number | null;
  base_reward_name?: string | null;
};

export function cardPolicyFields(row: RewardPolicyRow) {
  const expiry = row.next_reward_expires_at;
  return {
    rewardPolicy:
      row.reward_policy === 'single_cycle' ? ('single_cycle' as const) : ('accumulate' as const),
    rewardExpiryDays: row.reward_expiry_days ?? null,
    nextRewardExpiresAt: expiry ? new Date(expiry).toISOString() : null,
    legacyPendingRewards: Number(row.legacy_pending_rewards ?? 0),
    cycleRewardAvailable: row.cycle_reward_available ?? false,
    visitBlockedReason:
      row.visit_blocked_reason === 'REDEMPTION_REQUIRED' ? ('REDEMPTION_REQUIRED' as const) : null,
    merchantTimezone: row.merchant_timezone || 'America/Mexico_City',
    availableRewards: row.available_rewards ?? [],
  };
}

/** Render the entitlement's original tier names while it is available. */
export function rewardProfileWithSnapshot(
  profile: RewardProfile,
  row: RewardPolicyRow,
): RewardProfile {
  if (row.reward_policy !== 'single_cycle' || !row.cycle_reward_available) return profile;
  return {
    ...profile,
    visitsRequired: row.visits_required ?? profile.visitsRequired,
    rewardName: row.reward_name ?? profile.rewardName,
    baseTier:
      row.base_reward_name && row.base_visits_required
        ? {
            visitsRequired: row.base_visits_required,
            rewardName: row.base_reward_name,
            rewardDescription: null,
            configId: profile.baseTier?.configId ?? null,
          }
        : profile.baseTier,
  };
}

export type PolicyPresentation = {
  availableRewards?: { rewardName: string; quantity: number; expiresAt: string }[];
  rewardPolicy?: string;
  nextRewardExpiresAt?: string | null;
  merchantTimezone?: string;
  legacyPendingRewards?: number;
  cycleRewardAvailable?: boolean;
  visitBlockedReason?: string | null;
  visitsThisCycle: number;
  visitsRequired: number;
  rewardName: string;
  baseReward?: { visitsRequired: number; rewardName: string } | null;
};

export function policyRewardCopy(
  data: PolicyPresentation,
): { header: string; body: string } | null {
  if (data.rewardPolicy !== 'single_cycle') return null;
  const lines: string[] = [];
  if (data.legacyPendingRewards)
    lines.push(
      `Saldo anterior: ${data.legacyPendingRewards} recompensas. Canjea antes de otra visita.`,
    );
  if (data.cycleRewardAvailable !== false && data.visitsThisCycle >= data.visitsRequired) {
    lines.push(`${data.rewardName} listo. Canjea antes de otra visita.`);
  } else if (
    data.cycleRewardAvailable !== false &&
    data.baseReward &&
    data.visitsThisCycle >= data.baseReward.visitsRequired
  ) {
    lines.push(
      `${data.baseReward.rewardName} listo. Puedes continuar hasta ${data.visitsRequired} visitas para ${data.rewardName}.`,
    );
  } else {
    const next =
      data.baseReward && data.visitsThisCycle < data.baseReward.visitsRequired
        ? data.baseReward
        : { visitsRequired: data.visitsRequired, rewardName: data.rewardName };
    lines.push(
      `${Math.max(0, next.visitsRequired - data.visitsThisCycle)} visitas para ${next.rewardName}.`,
    );
  }
  if (data.nextRewardExpiresAt)
    lines.push(
      `Vence: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: data.merchantTimezone || 'America/Mexico_City' }).format(new Date(data.nextRewardExpiresAt))} (${data.merchantTimezone || 'America/Mexico_City'}).`,
    );
  for (const item of data.availableRewards ?? []) {
    const expiry = new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: data.merchantTimezone || 'America/Mexico_City',
    }).format(new Date(item.expiresAt));
    lines.push(`${item.quantity} × ${item.rewardName}. Vence: ${expiry}.`);
  }
  lines.push('El canje reinicia el ciclo en cero.');
  return { header: 'RECOMPENSA DEL CICLO', body: lines.join(' ') };
}
