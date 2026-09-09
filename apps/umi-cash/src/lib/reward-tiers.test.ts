import { describe, it, expect } from 'vitest';
import type { RewardProfile } from './reward-profile';
import {
  appleFrontFields,
  bankedReward,
  isBaseReady,
  ladderSummary,
  momentVars,
  nextRewardCopy,
  nextTier,
  parseStripState,
  pendingRewardsCopy,
  profileFromWalletFields,
  progressLine,
  readPendingTier1,
  staffVisitMessage,
  stripState,
  visitMoment,
  walletRewardFields,
} from './reward-tiers';

const single: RewardProfile = {
  visitsRequired: 10, rewardName: 'Bebida gratis', rewardDescription: null, redemptionConfigId: 'cfg-top', baseTier: null,
};
// El Gran Ribera's ask: 7 visits = capuccino, 9 = bebida rocas/frappé/caliente.
const ladder: RewardProfile = {
  visitsRequired: 9, rewardName: 'Bebida rocas', rewardDescription: null, redemptionConfigId: 'cfg-rocas',
  baseTier: { visitsRequired: 7, rewardName: 'Capuccino', rewardDescription: null, configId: 'cfg-cap' },
};

describe('nextTier / isBaseReady', () => {
  it('single reward: always the top tier', () => {
    expect(nextTier(single, 4)).toEqual({ rewardName: 'Bebida gratis', visitsRequired: 10, remaining: 6, isBase: false });
    expect(isBaseReady(single, 7)).toBe(false);
  });
  it('ladder: lower tier until reached, then the top', () => {
    expect(nextTier(ladder, 5)).toEqual({ rewardName: 'Capuccino', visitsRequired: 7, remaining: 2, isBase: true });
    expect(nextTier(ladder, 7)).toEqual({ rewardName: 'Bebida rocas', visitsRequired: 9, remaining: 2, isBase: false });
    expect(isBaseReady(ladder, 6)).toBe(false);
    expect(isBaseReady(ladder, 7)).toBe(true);
    expect(isBaseReady(ladder, 8)).toBe(true);
  });
  it('never reports zero visits remaining — the next visit earns', () => {
    expect(nextTier(single, 10).remaining).toBe(1);
  });
});

describe('bankedReward (legacy pending_tier1 tag)', () => {
  it('hands over the top tier by default', () => {
    expect(bankedReward(ladder, 0)).toEqual({ rewardName: 'Bebida rocas', configId: 'cfg-rocas', isBase: false });
  });
  it('honors rewards banked under the old single threshold as the lower tier first', () => {
    expect(bankedReward(ladder, 1)).toEqual({ rewardName: 'Capuccino', configId: 'cfg-cap', isBase: true });
  });
  it('ignores the tag without a ladder', () => {
    expect(bankedReward(single, 3).rewardName).toBe('Bebida gratis');
  });
  it('reads the tag defensively', () => {
    expect(readPendingTier1(null)).toBe(0);
    expect(readPendingTier1({ pending_tier1: 2 })).toBe(2);
    expect(readPendingTier1({ pending_tier1: '1' })).toBe(1);
    expect(readPendingTier1({ pending_tier1: -4 })).toBe(0);
    expect(readPendingTier1({ pending_tier1: 'nope' })).toBe(0);
  });
});

describe('pass copy', () => {
  it('single reward keeps the pre-ladder escalation verbatim', () => {
    expect(nextRewardCopy(single, 4)).toEqual({ header: 'PRÓXIMA RECOMPENSA', body: '6 visitas para Bebida gratis' });
    expect(nextRewardCopy(single, 8).body).toBe('¡Ya casi! Solo 2 visitas para Bebida gratis');
    expect(nextRewardCopy(single, 9).body).toBe('¡Última visita! Tu próxima compra desbloquea Bebida gratis 🎁');
    expect(pendingRewardsCopy(single, 0, 0)).toBeNull();
    expect(pendingRewardsCopy(single, 1, 0)).toEqual({ header: 'RECOMPENSA LISTA', body: '🎉 Tu Bebida gratis te espera — ¡canjéala en tienda!' });
    expect(pendingRewardsCopy(single, 2, 0)?.body).toBe('🎉 Tienes 2 Bebida gratis — ¡canjéalas en tienda!');
  });

  it('ladder names both tiers while the lower one is ahead', () => {
    expect(nextRewardCopy(ladder, 3).body).toBe('4 visitas para Capuccino · 6 para Bebida rocas');
    expect(nextRewardCopy(ladder, 5).body).toBe('¡Ya casi! 2 visitas para Capuccino · 4 para Bebida rocas');
    expect(nextRewardCopy(ladder, 6).body).toBe('Tu próxima visita desbloquea Capuccino 🎁 · 3 para Bebida rocas');
  });

  it('ladder turns into the choice once the lower tier is reached ("dos visitas más y bebida rocas")', () => {
    expect(nextRewardCopy(ladder, 7)).toEqual({
      header: 'ELIGE TU RECOMPENSA',
      body: '🎁 Capuccino listo para canjear · o 2 visitas más y Bebida rocas',
    });
    expect(nextRewardCopy(ladder, 8).body).toBe('🎁 Capuccino listo para canjear · ¡o 1 visita más y Bebida rocas!');
  });

  it('pending copy names the banked tier, legacy capuccinos first', () => {
    expect(pendingRewardsCopy(ladder, 1, 0)?.body).toContain('Tu Bebida rocas te espera');
    expect(pendingRewardsCopy(ladder, 1, 1)?.body).toContain('Tu Capuccino te espera');
    expect(pendingRewardsCopy(ladder, 2, 1)?.body).toBe('🎉 Tienes 2 recompensas: Capuccino y Bebida rocas — ¡canjéalas en tienda!');
  });

  it('progress line for the web card and scan screen', () => {
    expect(progressLine(single, 4)).toBe('6 visitas más para: Bebida gratis');
    expect(progressLine(single, 9)).toBe('1 visita más para: Bebida gratis');
    expect(progressLine(single, 10)).toBe('¡Listo para canjear: Bebida gratis!');
    expect(progressLine(ladder, 5)).toBe('2 visitas más para Capuccino · 4 para Bebida rocas');
    expect(progressLine(ladder, 7)).toBe('Capuccino listo · 2 visitas más para Bebida rocas');
  });

  it('staff confirmation fragment', () => {
    expect(staffVisitMessage(single, 4)).toBe('6 visitas para Bebida gratis.');
    expect(staffVisitMessage(ladder, 7)).toBe('¡Capuccino listo! 2 visitas más para Bebida rocas.');
    expect(staffVisitMessage(ladder, 8)).toBe('¡Capuccino listo! 1 visita más para Bebida rocas.');
  });

  it('apple front row: two columns for a single reward, three on a ladder', () => {
    expect(appleFrontFields(single, 4)).toEqual([
      { key: 'remaining', label: 'VISITAS FALTANTES', value: '6 visitas' },
      { key: 'rewards', label: 'RECOMPENSA', value: 'Bebida gratis' },
    ]);
    // The upper tier is on the front from the first stamp, labelled as a LEVEL — the
    // customer gets one drink or the other, never "2da recompensa".
    expect(appleFrontFields(ladder, 5)).toEqual([
      { key: 'remaining', label: 'VISITAS FALTANTES', value: '2 visitas' },
      { key: 'rewards', label: 'RECOMPENSA', value: 'Capuccino' },
      { key: 'upgrade', label: 'SEGUNDO NIVEL', value: 'Bebida rocas · 4 más' },
    ]);
    expect(appleFrontFields(ladder, 7)).toEqual([
      { key: 'baseReady', label: 'LISTO PARA CANJEAR', value: 'Capuccino' },
      { key: 'remaining', label: 'VISITAS FALTANTES', value: '2 visitas' },
      { key: 'upgrade', label: 'SEGUNDO NIVEL', value: 'Bebida rocas' },
    ]);
    expect(appleFrontFields(ladder, 8)[1].value).toBe('1 visita');
    // Never more than three columns — Apple shrinks the row with every extra one.
    for (const v of [0, 3, 6, 7, 8]) expect(appleFrontFields(ladder, v).length).toBeLessThanOrEqual(3);
  });

  it('ladder summary for the pass back / details', () => {
    expect(ladderSummary(single)).toBeNull();
    expect(ladderSummary(ladder)).toBe('7 visitas: Capuccino · 9 visitas: Bebida rocas');
  });
});

describe('visitMoment', () => {
  const visit = (profile: RewardProfile, v: number, extra: Partial<{ earnedReward: boolean; isFirstVisitEver: boolean }> = {}) =>
    visitMoment(profile, { newVisitsThisCycle: v, earnedReward: false, isFirstVisitEver: false, ...extra });

  it('single reward keeps the pre-ladder ordering', () => {
    expect(visit(single, 10, { earnedReward: true })).toMatchObject({ journey: 'reward_earned', rewardName: 'Bebida gratis', visitsThisCycle: 10 });
    expect(visit(single, 1, { isFirstVisitEver: true }).journey).toBe('first_visit');
    expect(visit(single, 9).journey).toBe('milestone_one_left');
    expect(visit(single, 5).journey).toBe('milestone_halfway');
    expect(visit(single, 3)).toEqual({ journey: 'visit_recorded', rewardName: 'Bebida gratis', visitsRequired: 10, visitsThisCycle: 3 });
  });

  it('ladder adds the lower-tier milestones and points plain visits at the next tier', () => {
    expect(visit(ladder, 9, { earnedReward: true })).toMatchObject({ journey: 'reward_earned', rewardName: 'Bebida rocas', visitsThisCycle: 9 });
    expect(visit(ladder, 7)).toEqual({ journey: 'base_reward_ready', rewardName: 'Capuccino', visitsRequired: 7, visitsThisCycle: 7 });
    expect(visit(ladder, 6)).toMatchObject({ journey: 'milestone_one_left', rewardName: 'Capuccino' });
    expect(visit(ladder, 8)).toMatchObject({ journey: 'milestone_one_left', rewardName: 'Bebida rocas' });
    expect(visit(ladder, 4)).toMatchObject({ journey: 'milestone_halfway', rewardName: 'Bebida rocas', visitsRequired: 9 });
    expect(visit(ladder, 3)).toEqual({ journey: 'visit_recorded', rewardName: 'Capuccino', visitsRequired: 7, visitsThisCycle: 3 });
    expect(visit(ladder, 1, { isFirstVisitEver: true })).toMatchObject({ journey: 'first_visit', rewardName: 'Capuccino' });
  });

  it('exposes the ladder variables to templates', () => {
    const vars = momentVars(ladder, visit(ladder, 7), { name: 'Ana', tenant: 'El Gran Ribera' });
    expect(vars).toMatchObject({ rewardName: 'Capuccino', upgradeRewardName: 'Bebida rocas', baseRewardName: 'Capuccino', visitsToUpgrade: 2 });
  });
});

describe('strip state', () => {
  it('encodes the bonus boundary only on a ladder', () => {
    expect(stripState(single, 4)).toBe('4-10');
    expect(stripState(ladder, 8)).toBe('8-9-b7');
    expect(stripState(ladder, 12)).toBe('9-9-b7');
  });
  it('parses and validates what it encodes', () => {
    expect(parseStripState('4-10', 20)).toEqual({ filled: 4, required: 10, bonusFrom: null });
    expect(parseStripState('8-9-b7.png', 20)).toEqual({ filled: 8, required: 9, bonusFrom: 7 });
    expect(parseStripState('12-9-b7', 20)?.filled).toBe(9);
    expect(parseStripState('8-9-b9', 20)).toBeNull();
    expect(parseStripState('8-9-b0', 20)).toBeNull();
    expect(parseStripState('3-25', 20)).toBeNull();
    expect(parseStripState('nope', 20)).toBeNull();
  });
});

describe('wallet field round-trip', () => {
  it('flattens a profile for the pass builders and rebuilds it', () => {
    const fields = walletRewardFields(ladder, { pending_tier1: 1 });
    expect(fields).toEqual({
      visitsRequired: 9, rewardName: 'Bebida rocas',
      baseReward: { visitsRequired: 7, rewardName: 'Capuccino' }, pendingTier1: 1,
    });
    expect(profileFromWalletFields(fields).baseTier?.rewardName).toBe('Capuccino');
    expect(profileFromWalletFields(walletRewardFields(single, null)).baseTier).toBeNull();
    // A base at/above the cycle length is not a ladder.
    expect(profileFromWalletFields({ visitsRequired: 7, rewardName: 'X', baseReward: { visitsRequired: 7, rewardName: 'Y' } }).baseTier).toBeNull();
  });
});
