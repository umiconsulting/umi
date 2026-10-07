/**
 * The two-tier ladder's rules, and every string that names a tier. Ported from
 * umi-cash `src/lib/reward-tiers.ts` — the copy is customer-facing and lives on
 * several surfaces at once, so the words have to be the same words.
 *
 * With `profile.baseTier === null` every function collapses to the single-reward
 * behavior that predates the ladder.
 *
 * ONE DELIBERATE DIFFERENCE FROM THE SOURCE. umi-cash kept the banked-tier counter
 * in `cards.metadata.pending_tier1`; build-v3 carries it as the typed column
 * `merchant.loyalty_card.pending_tier1` (78_customer_pass_metadata.sql), so the
 * helpers here take the number rather than a metadata blob.
 */
import type { RewardProfile } from './reward-profile';
import type { LifecycleJourneyKey } from '../../modules/cash/lifecycle-copy';

const visitas = (n: number) => `${n} visita${n === 1 ? '' : 's'}`;

/** Lower tier reached and not yet cashed out — the customer may redeem it or keep stamping. */
export function isBaseReady(profile: RewardProfile, visitsThisCycle: number): boolean {
  return !!profile.baseTier && visitsThisCycle >= profile.baseTier.visitsRequired;
}

export type NextTier = {
  rewardName: string;
  visitsRequired: number;
  remaining: number;
  isBase: boolean;
};

/**
 * The reward-shaped fields every card payload carries — scan preview, scan
 * commit, and the customer's own profile. Ported from umi-cash
 * `scan-helpers.ts#cardRewardFields`.
 *
 * `visitsRequired` / `rewardName` are the CYCLE's (top-tier) values, so the
 * progress math on the client keeps working; the ladder extras are null on a
 * single-reward café, which is what every pre-ladder surface already handled.
 */
export function cardRewardFields(
  profile: RewardProfile,
  card: {
    visitsThisCycle: number;
    pendingTier1: number;
    rewardPolicy?: string;
    cycleRewardAvailable?: boolean;
    baseRewardBlockedByHistory?: boolean;
    availableRewards?: { rewardName: string }[];
  },
) {
  const canRedeem =
    isBaseReady(profile, card.visitsThisCycle) &&
    (card.rewardPolicy !== 'single_cycle' ||
      (card.cycleRewardAvailable === true &&
        !card.baseRewardBlockedByHistory &&
        card.visitsThisCycle <= profile.visitsRequired));
  return {
    visitsRequired: profile.visitsRequired,
    rewardName: profile.rewardName,
    rewardDescription: profile.rewardDescription,
    baseReward: profile.baseTier
      ? {
          visitsRequired: profile.baseTier.visitsRequired,
          rewardName: profile.baseTier.rewardName,
          ready: canRedeem,
          ...(card.rewardPolicy === 'single_cycle' ? { canRedeem } : {}),
        }
      : null,
    // Which reward a banked redemption would hand over right now.
    pendingRewardName:
      card.rewardPolicy === 'single_cycle'
        ? (card.availableRewards?.[0]?.rewardName ??
          (canRedeem ? profile.baseTier!.rewardName : profile.rewardName))
        : bankedReward(profile, card.pendingTier1).rewardName,
  };
}

/**
 * The tier the customer is heading toward: the lower one until it is reached, then
 * the top. `remaining` never drops below 1 — once the count meets a threshold the
 * next visit is the one that earns (a shrunken config can leave visits >= required).
 */
export function nextTier(profile: RewardProfile, visitsThisCycle: number): NextTier {
  const base = profile.baseTier;
  if (base && visitsThisCycle < base.visitsRequired) {
    return {
      rewardName: base.rewardName,
      visitsRequired: base.visitsRequired,
      remaining: base.visitsRequired - visitsThisCycle,
      isBase: true,
    };
  }
  return {
    rewardName: profile.rewardName,
    visitsRequired: profile.visitsRequired,
    remaining: Math.max(1, profile.visitsRequired - visitsThisCycle),
    isBase: false,
  };
}

export type BankedReward = { rewardName: string; configId: string | null; isBase: boolean };

/**
 * Which reward a banked (pending) redemption hands over. The cycle only ever banks
 * the top tier, but cards holding a pending reward when the ladder was switched on
 * earned it under the old single threshold — those are tagged (pending_tier1) and
 * are honored as the lower tier, first.
 */
export function bankedReward(profile: RewardProfile, pendingTier1: number): BankedReward {
  if (profile.baseTier && pendingTier1 > 0) {
    return {
      rewardName: profile.baseTier.rewardName,
      configId: profile.baseTier.configId,
      isBase: true,
    };
  }
  return { rewardName: profile.rewardName, configId: profile.redemptionConfigId, isBase: false };
}

/** "7 visitas: Capuccino · 9 visitas: Bebida rocas" — null without a ladder. */
export function ladderSummary(profile: RewardProfile): string | null {
  const base = profile.baseTier;
  if (!base) return null;
  return `${base.visitsRequired} visitas: ${base.rewardName} · ${profile.visitsRequired} visitas: ${profile.rewardName}`;
}

export type PassLine = { header: string; body: string };

/** Banked-reward line for the pass; null when nothing is pending. */
export function pendingRewardsCopy(
  profile: RewardProfile,
  pendingRewards: number,
  pendingTier1: number,
): PassLine | null {
  if (pendingRewards <= 0) return null;
  const base = profile.baseTier;
  const legacy = base ? Math.min(pendingTier1, pendingRewards) : 0;
  if (base && legacy > 0 && pendingRewards > legacy) {
    return {
      header: 'RECOMPENSAS DISPONIBLES',
      body: `🎉 Tienes ${pendingRewards} recompensas: ${base.rewardName} y ${profile.rewardName} — ¡canjéalas en tienda!`,
    };
  }
  const name = bankedReward(profile, pendingTier1).rewardName;
  if (pendingRewards > 1) {
    return {
      header: 'RECOMPENSAS DISPONIBLES',
      body: `🎉 Tienes ${pendingRewards} ${name} — ¡canjéalas en tienda!`,
    };
  }
  return { header: 'RECOMPENSA LISTA', body: `🎉 Tu ${name} te espera — ¡canjéala en tienda!` };
}

/**
 * Progress line for the pass. Copy escalates as the customer nears a reward; on a
 * ladder it names both tiers, and once the lower tier is reached it turns into the
 * choice the client asked for: "capuccino listo · o 2 visitas más y bebida rocas".
 */
export function nextRewardCopy(profile: RewardProfile, visitsThisCycle: number): PassLine {
  const base = profile.baseTier;
  const toTop = Math.max(1, profile.visitsRequired - visitsThisCycle);
  if (!base) {
    let body: string;
    if (toTop === 1) body = `¡Última visita! Tu próxima compra desbloquea ${profile.rewardName} 🎁`;
    else if (toTop === 2) body = `¡Ya casi! Solo 2 visitas para ${profile.rewardName}`;
    else body = `${toTop} visitas para ${profile.rewardName}`;
    return { header: 'PRÓXIMA RECOMPENSA', body };
  }
  if (isBaseReady(profile, visitsThisCycle)) {
    return {
      header: 'ELIGE TU RECOMPENSA',
      body:
        toTop === 1
          ? `🎁 ${base.rewardName} listo para canjear · ¡o 1 visita más y ${profile.rewardName}!`
          : `🎁 ${base.rewardName} listo para canjear · o ${toTop} visitas más y ${profile.rewardName}`,
    };
  }
  const toBase = base.visitsRequired - visitsThisCycle;
  let body: string;
  if (toBase === 1)
    body = `Tu próxima visita desbloquea ${base.rewardName} 🎁 · ${toTop} para ${profile.rewardName}`;
  else if (toBase === 2)
    body = `¡Ya casi! 2 visitas para ${base.rewardName} · ${toTop} para ${profile.rewardName}`;
  else body = `${toBase} visitas para ${base.rewardName} · ${toTop} para ${profile.rewardName}`;
  return { header: 'PRÓXIMA RECOMPENSA', body };
}

/** One-line progress for the customer web card and the staff scan screen. */
export function progressLine(profile: RewardProfile, visitsThisCycle: number): string {
  const base = profile.baseTier;
  if (!base) {
    const remaining = profile.visitsRequired - visitsThisCycle;
    return remaining > 0
      ? `${visitas(remaining)} más para: ${profile.rewardName}`
      : `¡Listo para canjear: ${profile.rewardName}!`;
  }
  const toTop = Math.max(1, profile.visitsRequired - visitsThisCycle);
  if (isBaseReady(profile, visitsThisCycle)) {
    return `${base.rewardName} listo · ${visitas(toTop)} más para ${profile.rewardName}`;
  }
  const toBase = base.visitsRequired - visitsThisCycle;
  return `${visitas(toBase)} más para ${base.rewardName} · ${toTop} para ${profile.rewardName}`;
}

/** Staff-facing fragment appended to the scan confirmation after a visit lands. */
export function staffVisitMessage(profile: RewardProfile, visitsThisCycle: number): string {
  const base = profile.baseTier;
  if (base && isBaseReady(profile, visitsThisCycle)) {
    const toTop = Math.max(1, profile.visitsRequired - visitsThisCycle);
    return `¡${base.rewardName} listo! ${visitas(toTop)} más para ${profile.rewardName}.`;
  }
  const next = nextTier(profile, visitsThisCycle);
  return `${visitas(next.remaining)} para ${next.rewardName}.`;
}

export type AppleFrontField = { key: string; label: string; value: string };

/**
 * Apple front row, in order. A store card has ONE row under the strip (secondary and
 * auxiliary fields share it), so this stays at three columns on a ladder — Apple
 * shrinks the text with every extra column. The upper tier is labelled "SEGUNDO
 * NIVEL", never "2da recompensa": the customer gets one drink or the other, not both.
 */
export function appleFrontFields(
  profile: RewardProfile,
  visitsThisCycle: number,
): AppleFrontField[] {
  const base = profile.baseTier;
  const next = nextTier(profile, visitsThisCycle);
  const remaining: AppleFrontField = {
    key: 'remaining',
    label: 'VISITAS FALTANTES',
    value: visitas(next.remaining),
  };
  if (!base) {
    return [remaining, { key: 'rewards', label: 'RECOMPENSA', value: profile.rewardName }];
  }
  if (isBaseReady(profile, visitsThisCycle)) {
    return [
      { key: 'baseReady', label: 'LISTO PARA CANJEAR', value: base.rewardName },
      remaining,
      { key: 'upgrade', label: 'SEGUNDO NIVEL', value: profile.rewardName },
    ];
  }
  const toTop = Math.max(1, profile.visitsRequired - visitsThisCycle);
  return [
    remaining,
    { key: 'rewards', label: 'RECOMPENSA', value: base.rewardName },
    { key: 'upgrade', label: 'SEGUNDO NIVEL', value: `${profile.rewardName} · ${toTop} más` },
  ];
}

export type VisitMoment = {
  journey: LifecycleJourneyKey;
  /** The tier this moment talks about — `{rewardName}` in the template. */
  rewardName: string;
  visitsRequired: number;
  visitsThisCycle: number;
};

/**
 * The single lifecycle moment a credited visit leaves on the card. Shared by the
 * scan and bulk-seal routes. Priority: reward_earned > base_reward_ready >
 * first_visit > milestone_one_left (top, then lower tier) > milestone_halfway >
 * visit_recorded. Without a ladder this is exactly the pre-ladder ordering.
 */
export function visitMoment(
  profile: RewardProfile,
  args: { newVisitsThisCycle: number; earnedReward: boolean; isFirstVisitEver: boolean },
): VisitMoment {
  const { newVisitsThisCycle: v, earnedReward, isFirstVisitEver } = args;
  const base = profile.baseTier;
  const required = profile.visitsRequired;
  const top = (journey: LifecycleJourneyKey): VisitMoment => ({
    journey,
    rewardName: profile.rewardName,
    visitsRequired: required,
    visitsThisCycle: v,
  });
  const toward = (journey: LifecycleJourneyKey): VisitMoment => {
    const n = nextTier(profile, v);
    return {
      journey,
      rewardName: n.rewardName,
      visitsRequired: n.visitsRequired,
      visitsThisCycle: v,
    };
  };

  if (earnedReward) return { ...top('reward_earned'), visitsThisCycle: required };
  if (base && v === base.visitsRequired) {
    return {
      journey: 'base_reward_ready',
      rewardName: base.rewardName,
      visitsRequired: base.visitsRequired,
      visitsThisCycle: v,
    };
  }
  if (isFirstVisitEver) return toward('first_visit');
  if (v === required - 1) return top('milestone_one_left');
  if (base && v === base.visitsRequired - 1) {
    return {
      journey: 'milestone_one_left',
      rewardName: base.rewardName,
      visitsRequired: base.visitsRequired,
      visitsThisCycle: v,
    };
  }
  if (required >= 4 && v === Math.floor(required / 2)) return top('milestone_halfway');
  return toward('visit_recorded');
}

/**
 * Template variables for a visit moment — the ladder extras are always present so
 * café copy may use them.
 *
 * `tenant` is the name umi-cash's copy uses; `merchant` is kept alongside it so an
 * override saved under either spelling renders instead of showing a literal
 * placeholder on the customer's lock screen.
 */
export function momentVars(
  profile: RewardProfile,
  moment: VisitMoment,
  ctx: { name: string; tenant: string },
): Record<string, string | number> {
  return {
    name: ctx.name,
    tenant: ctx.tenant,
    merchant: ctx.tenant,
    rewardName: moment.rewardName,
    visitsThisCycle: moment.visitsThisCycle,
    visitsRequired: moment.visitsRequired,
    upgradeRewardName: profile.rewardName,
    baseRewardName: profile.baseTier?.rewardName ?? profile.rewardName,
    visitsToUpgrade: Math.max(1, profile.visitsRequired - moment.visitsThisCycle),
  };
}

/**
 * Content-addressed stamp-strip state: `{filled}-{required}` plus `-b{base}` on a
 * ladder, so slots from `base` on render as bonus stamps. Part of the Google
 * heroImage URL — a different state is a different URL, which is what defeats
 * Google's image cache.
 */
export function stripState(profile: RewardProfile, visitsThisCycle: number): string {
  const filled = Math.max(0, Math.min(visitsThisCycle, profile.visitsRequired));
  const state = `${filled}-${profile.visitsRequired}`;
  return profile.baseTier ? `${state}-b${profile.baseTier.visitsRequired}` : state;
}

export type StripState = { filled: number; required: number; bonusFrom: number | null };

/** Inverse of stripState for the public image route; null on anything malformed or out of range. */
export function parseStripState(state: string, maxRequired: number): StripState | null {
  const m = state.replace(/\.png$/i, '').match(/^(\d+)-(\d+)(?:-b(\d+))?$/);
  if (!m) return null;
  const required = parseInt(m[2], 10);
  if (!Number.isInteger(required) || required < 1 || required > maxRequired) return null;
  const filled = Math.max(0, Math.min(parseInt(m[1], 10), required));
  let bonusFrom: number | null = null;
  if (m[3] !== undefined) {
    bonusFrom = parseInt(m[3], 10);
    if (!Number.isInteger(bonusFrom) || bonusFrom < 1 || bonusFrom >= required) return null;
  }
  return { filled, required, bonusFrom };
}

export type WalletRewardFields = {
  visitsRequired: number;
  rewardName: string;
  baseReward: { visitsRequired: number; rewardName: string } | null;
  pendingTier1: number;
};

/** The reward-shaped inputs both pass builders take, from a profile + the card's banked-tier counter. */
export function walletRewardFields(
  profile: RewardProfile,
  pendingTier1: number,
): WalletRewardFields {
  return {
    visitsRequired: profile.visitsRequired,
    rewardName: profile.rewardName,
    baseReward: profile.baseTier
      ? { visitsRequired: profile.baseTier.visitsRequired, rewardName: profile.baseTier.rewardName }
      : null,
    pendingTier1: pendingTier1 > 0 ? pendingTier1 : 0,
  };
}

/**
 * Rebuild a RewardProfile from the flat wallet fields — the pass builders only
 * receive the flat shape, but the copy helpers above take a profile.
 */
export function profileFromWalletFields(fields: {
  visitsRequired: number;
  rewardName: string;
  baseReward?: { visitsRequired: number; rewardName: string } | null;
}): RewardProfile {
  const base = fields.baseReward;
  return {
    visitsRequired: fields.visitsRequired,
    rewardName: fields.rewardName,
    rewardDescription: null,
    redemptionConfigId: null,
    baseTier:
      base && base.visitsRequired < fields.visitsRequired
        ? {
            visitsRequired: base.visitsRequired,
            rewardName: base.rewardName,
            rewardDescription: null,
            configId: null,
          }
        : null,
  };
}
