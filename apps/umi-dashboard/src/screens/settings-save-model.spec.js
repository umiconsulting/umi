import { describe, expect, it } from 'vitest';
import { buildSettingsSaves } from './settings-save-model.js';

const base = {
  biz: {
    name: 'Café Norte',
    city: 'Mérida',
    businessDayStart: '04:00',
    posDayClosePolicy: 'manual',
  },
  seg: {
    vipMinPesos: '1200',
    vipMinVisits: '8',
    regularMinVisits: '3',
    activeWindowDays: '45',
    lapsedDays: '180',
  },
  brand: { primary: '#1A5632', secondary: '#E8C9A3' },
  promo: { message: 'Doble sello', from: '2026-11-01', to: '2026-11-30' },
  promoDayNums: '1,2,3',
  selfReg: false,
  topupEnabled: true,
  multiSealEnabled: false,
  birthday: { on: true, rewardName: 'Pastel' },
  loyalty: {
    rewardName: 'Café gratis',
    visitsRequired: 10,
    rewardCost: 12.5,
    rewardDescription: 'Un café de la casa',
    upgrade: {
      visitsRequired: 20,
      rewardName: 'Comida gratis',
      rewardDescription: 'Un platillo',
      rewardCostCentavos: 25000,
    },
  },
  cashActive: true,
};

describe('settings save split', () => {
  it('keeps Cash-only fields out of the merchant DTO', () => {
    const { merchant } = buildSettingsSaves(base);
    for (const key of [
      'passStyle',
      'promoMessage',
      'promoStartsAt',
      'promoEndsAt',
      'promoDays',
      'selfRegistration',
      'birthdayRewardEnabled',
      'birthdayRewardName',
      'primaryColor',
      'secondaryColor',
    ]) {
      expect(merchant, key).not.toHaveProperty(key);
    }
    expect(merchant).toMatchObject({
      name: 'Café Norte',
      city: 'Mérida',
      businessDayStart: '04:00',
      posDayClosePolicy: 'manual',
    });
    expect(merchant.segmentThresholds).toEqual({
      vipMinSpendCents: 120000,
      vipMinVisits: 8,
      regularMinVisits: 3,
      activeWindowDays: 45,
      lapsedDays: 180,
    });
  });

  it('sends the Cash-only fields to the Cash writer', () => {
    const { cash } = buildSettingsSaves(base);
    expect(cash).toMatchObject({
      primaryColor: '#1A5632',
      secondaryColor: '#E8C9A3',
      passStyle: 'stamps',
      promoMessage: 'Doble sello',
      promoStartsAt: '2026-11-01T00:00:00.000Z',
      promoEndsAt: '2026-11-30T23:59:59.000Z',
      promoDays: '1,2,3',
      selfRegistration: false,
      topupEnabled: true,
      multiSealEnabled: false,
      birthdayRewardEnabled: true,
      birthdayRewardName: 'Pastel',
    });
  });

  it('omits the switches when the merchant record does not carry them', () => {
    const { cash } = buildSettingsSaves({
      ...base,
      topupEnabled: undefined,
      multiSealEnabled: undefined,
    });
    expect(cash).not.toHaveProperty('topupEnabled');
    expect(cash).not.toHaveProperty('multiSealEnabled');
  });

  it('echoes rewardDescription and the second tier instead of erasing them', () => {
    const { reward } = buildSettingsSaves(base);
    expect(reward).toEqual({
      rewardName: 'Café gratis',
      visitsRequired: 10,
      rewardCostCentavos: 1250,
      rewardDescription: 'Un café de la casa',
      upgrade: {
        visitsRequired: 20,
        rewardName: 'Comida gratis',
        rewardDescription: 'Un platillo',
        rewardCostCentavos: 25000,
      },
    });
  });

  it('sends no Cash or reward body when Cash is not active', () => {
    const { cash, reward } = buildSettingsSaves({ ...base, cashActive: false });
    expect(cash).toBeNull();
    expect(reward).toBeNull();
  });

  it('keeps a null second tier null, which means "single reward"', () => {
    const { reward } = buildSettingsSaves({
      ...base,
      loyalty: { ...base.loyalty, upgrade: null, rewardDescription: null },
    });
    expect(reward.upgrade).toBeNull();
    expect(reward.rewardDescription).toBeNull();
  });
});
