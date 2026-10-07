import { describe, expect, it } from 'vitest';
import type { RewardProfile } from './reward-profile';
import {
  appleFrontFields,
  bankedReward,
  cardRewardFields,
  isBaseReady,
  ladderSummary,
  nextRewardCopy,
  nextTier,
  parseStripState,
  pendingRewardsCopy,
  profileFromWalletFields,
  progressLine,
  staffVisitMessage,
  stripState,
  visitMoment,
} from './reward-tiers';

/**
 * THE LADDER'S RULES AND ITS WORDS, ported from umi-cash's own test file with the
 * same expectations. This is the copy a customer reads on a pass and a barista reads
 * on the till, so it is checked against the original strings rather than against
 * whatever this file happens to produce.
 */

const single: RewardProfile = {
  visitsRequired: 10,
  rewardName: 'Bebida gratis',
  rewardDescription: null,
  redemptionConfigId: 'cfg-top',
  baseTier: null,
};
// El Gran Ribera's ask: 7 visits = capuccino, 9 = bebida rocas/frappé/caliente.
const ladder: RewardProfile = {
  visitsRequired: 9,
  rewardName: 'Bebida rocas',
  rewardDescription: null,
  redemptionConfigId: 'cfg-rocas',
  baseTier: {
    visitsRequired: 7,
    rewardName: 'Capuccino',
    rewardDescription: null,
    configId: 'cfg-cap',
  },
};

describe('nextTier / isBaseReady', () => {
  it('single reward: always the top tier', () => {
    expect(nextTier(single, 4)).toEqual({
      rewardName: 'Bebida gratis',
      visitsRequired: 10,
      remaining: 6,
      isBase: false,
    });
    expect(isBaseReady(single, 7)).toBe(false);
  });

  it('ladder: lower tier until reached, then the top', () => {
    expect(nextTier(ladder, 5)).toEqual({
      rewardName: 'Capuccino',
      visitsRequired: 7,
      remaining: 2,
      isBase: true,
    });
    expect(nextTier(ladder, 7)).toEqual({
      rewardName: 'Bebida rocas',
      visitsRequired: 9,
      remaining: 2,
      isBase: false,
    });
    expect(isBaseReady(ladder, 6)).toBe(false);
    expect(isBaseReady(ladder, 7)).toBe(true);
    expect(isBaseReady(ladder, 8)).toBe(true);
  });

  it('never reports zero visits remaining — the next visit earns', () => {
    expect(nextTier(single, 10).remaining).toBe(1);
  });
});

describe('bankedReward (the pre-ladder pending_tier1 tag)', () => {
  it('hands over the top tier by default', () => {
    expect(bankedReward(ladder, 0).rewardName).toBe('Bebida rocas');
    expect(bankedReward(single, 3).rewardName).toBe('Bebida gratis');
  });

  it('honors rewards banked under the old single threshold as the lower tier first', () => {
    expect(bankedReward(ladder, 1)).toEqual({
      rewardName: 'Capuccino',
      configId: 'cfg-cap',
      isBase: true,
    });
  });

  it('ignores the tag without a ladder', () => {
    expect(bankedReward(single, 4).isBase).toBe(false);
  });
});

describe('pass copy', () => {
  it('single reward keeps the pre-ladder escalation verbatim', () => {
    expect(nextRewardCopy(single, 4)).toEqual({
      header: 'PRÓXIMA RECOMPENSA',
      body: '6 visitas para Bebida gratis',
    });
    expect(nextRewardCopy(single, 8).body).toBe('¡Ya casi! Solo 2 visitas para Bebida gratis');
    expect(nextRewardCopy(single, 9).body).toBe(
      '¡Última visita! Tu próxima compra desbloquea Bebida gratis 🎁',
    );
    expect(pendingRewardsCopy(single, 0, 0)).toBeNull();
    expect(pendingRewardsCopy(single, 1, 0)).toEqual({
      header: 'RECOMPENSA LISTA',
      body: '🎉 Tu Bebida gratis te espera — ¡canjéala en tienda!',
    });
    expect(pendingRewardsCopy(single, 2, 0)?.body).toBe(
      '🎉 Tienes 2 Bebida gratis — ¡canjéalas en tienda!',
    );
  });

  it('ladder names both tiers while the lower one is ahead', () => {
    expect(nextRewardCopy(ladder, 3).body).toBe('4 visitas para Capuccino · 6 para Bebida rocas');
    expect(nextRewardCopy(ladder, 5).body).toBe(
      '¡Ya casi! 2 visitas para Capuccino · 4 para Bebida rocas',
    );
    expect(nextRewardCopy(ladder, 6).body).toBe(
      'Tu próxima visita desbloquea Capuccino 🎁 · 3 para Bebida rocas',
    );
  });

  it('ladder turns into the choice once the lower tier is reached', () => {
    expect(nextRewardCopy(ladder, 7)).toEqual({
      header: 'ELIGE TU RECOMPENSA',
      body: '🎁 Capuccino listo para canjear · o 2 visitas más y Bebida rocas',
    });
    expect(nextRewardCopy(ladder, 8).body).toBe(
      '🎁 Capuccino listo para canjear · ¡o 1 visita más y Bebida rocas!',
    );
  });

  it('pending copy names the banked tier, legacy capuccinos first', () => {
    expect(pendingRewardsCopy(ladder, 1, 0)?.body).toContain('Tu Bebida rocas te espera');
    expect(pendingRewardsCopy(ladder, 1, 1)?.body).toContain('Tu Capuccino te espera');
    expect(pendingRewardsCopy(ladder, 2, 1)?.body).toBe(
      '🎉 Tienes 2 recompensas: Capuccino y Bebida rocas — ¡canjéalas en tienda!',
    );
  });

  it('progress line for the web card and the scan screen', () => {
    expect(progressLine(single, 4)).toBe('6 visitas más para: Bebida gratis');
    expect(progressLine(ladder, 5)).toBe('2 visitas más para Capuccino · 4 para Bebida rocas');
    expect(progressLine(ladder, 7)).toBe('Capuccino listo · 2 visitas más para Bebida rocas');
  });

  it('staff confirmation fragment', () => {
    expect(staffVisitMessage(single, 4)).toBe('6 visitas para Bebida gratis.');
    expect(staffVisitMessage(ladder, 7)).toBe('¡Capuccino listo! 2 visitas más para Bebida rocas.');
  });

  it('apple front row: two columns for a single reward, three on a ladder', () => {
    expect(appleFrontFields(single, 4)).toEqual([
      { key: 'remaining', label: 'VISITAS FALTANTES', value: '6 visitas' },
      { key: 'rewards', label: 'RECOMPENSA', value: 'Bebida gratis' },
    ]);
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
    // Never more than three columns — Apple shrinks the row with every extra one.
    for (const v of [0, 3, 6, 7, 8]) {
      expect(appleFrontFields(ladder, v).length).toBeLessThanOrEqual(3);
    }
  });

  it('ladder summary for the pass back / details', () => {
    expect(ladderSummary(single)).toBeNull();
    expect(ladderSummary(ladder)).toBe('7 visitas: Capuccino · 9 visitas: Bebida rocas');
  });
});

describe('the card payload every screen shares', () => {
  it('carries the cycle values plus the ladder', () => {
    expect(cardRewardFields(ladder, { visitsThisCycle: 7, pendingTier1: 1 })).toEqual({
      visitsRequired: 9,
      rewardName: 'Bebida rocas',
      rewardDescription: null,
      baseReward: { visitsRequired: 7, rewardName: 'Capuccino', ready: true },
      pendingRewardName: 'Capuccino',
    });
    expect(cardRewardFields(single, { visitsThisCycle: 3, pendingTier1: 0 })).toEqual({
      visitsRequired: 10,
      rewardName: 'Bebida gratis',
      rewardDescription: null,
      baseReward: null,
      pendingRewardName: 'Bebida gratis',
    });
  });
});

describe('the stamp-strip state', () => {
  it('encodes the ladder, so a bonus slot is a different URL', () => {
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

describe('the wallet field round-trip', () => {
  it('flattens a profile for the pass builders and rebuilds it', () => {
    const fields = profileFromWalletFields({
      visitsRequired: 9,
      rewardName: 'Bebida rocas',
      baseReward: { visitsRequired: 7, rewardName: 'Capuccino' },
    });
    expect(fields.baseTier?.rewardName).toBe('Capuccino');
    // A "base tier" that is not BELOW the cycle is not a ladder; ignoring it is what
    // keeps a mis-set upgrade row from inventing a choice that cannot be offered.
    expect(
      profileFromWalletFields({
        visitsRequired: 7,
        rewardName: 'X',
        baseReward: { visitsRequired: 7, rewardName: 'Y' },
      }).baseTier,
    ).toBeNull();
  });
});

describe('visitMoment', () => {
  it('single reward keeps the pre-ladder ordering', () => {
    expect(
      visitMoment(single, { newVisitsThisCycle: 10, earnedReward: true, isFirstVisitEver: false }),
    ).toMatchObject({ journey: 'reward_earned', rewardName: 'Bebida gratis' });
    expect(
      visitMoment(single, { newVisitsThisCycle: 1, earnedReward: false, isFirstVisitEver: true })
        .journey,
    ).toBe('first_visit');
    expect(
      visitMoment(single, { newVisitsThisCycle: 9, earnedReward: false, isFirstVisitEver: false })
        .journey,
    ).toBe('milestone_one_left');
  });

  it('on a ladder, reaching the lower tier is its own moment', () => {
    // 7 of 9 is not the end of the cycle — it is the choice the client asked for.
    expect(
      visitMoment(ladder, { newVisitsThisCycle: 7, earnedReward: false, isFirstVisitEver: false }),
    ).toMatchObject({ journey: 'base_reward_ready', rewardName: 'Capuccino' });
  });
});

it('disables the base reward after a single cycle reaches its upper tier', () => {
  const profile: RewardProfile = {
    visitsRequired: 9,
    rewardName: 'Upper',
    rewardDescription: null,
    redemptionConfigId: null,
    baseTier: { visitsRequired: 7, rewardName: 'Base', rewardDescription: null, configId: null },
  };
  expect(
    cardRewardFields(profile, {
      visitsThisCycle: 9,
      pendingTier1: 0,
      rewardPolicy: 'single_cycle',
      cycleRewardAvailable: true,
    }).baseReward,
  ).toMatchObject({ ready: false, canRedeem: false });
  expect(
    cardRewardFields(profile, {
      visitsThisCycle: 8,
      pendingTier1: 0,
      rewardPolicy: 'single_cycle',
      cycleRewardAvailable: true,
    }).baseReward,
  ).toMatchObject({ ready: true, canRedeem: true });
});
