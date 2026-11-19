import { describe, expect, it } from 'vitest';
import {
  buildCashSettingsPatch,
  cashSettingsForm,
  parsePromoDays,
  promoDaysToNumbers,
} from './cash-settings-model.js';

const merchant = {
  primaryColor: '#1A5632',
  secondaryColor: '#E8C9A3',
  promoMessage: 'Doble sello',
  promoStartsAt: '2026-11-01T00:00:00.000Z',
  promoEndsAt: '2026-11-30T23:59:59.000Z',
  promoDays: '1,2,3',
  birthdayRewardEnabled: true,
  birthdayRewardName: 'Pastel',
  selfRegistration: false,
  topupEnabled: true,
  multiSealEnabled: false,
  passStyle: 'grid',
};

describe('Cash settings model', () => {
  it('seeds the form from the Cash settings response and preserves grid pass style', () => {
    const form = cashSettingsForm(merchant);
    expect(form).toMatchObject({
      primaryColor: '#1A5632',
      secondaryColor: '#E8C9A3',
      promoMessage: 'Doble sello',
      promoStartsAt: '2026-11-01',
      promoEndsAt: '2026-11-30',
      promoDays: ['lun', 'mar', 'mie'],
      birthdayRewardEnabled: true,
      birthdayRewardName: 'Pastel',
      selfRegistration: false,
      topupEnabled: true,
      multiSealEnabled: false,
    });
    expect(form).not.toHaveProperty('passStyle');
  });

  it('builds the Cash-only PATCH and never includes passStyle', () => {
    const patch = buildCashSettingsPatch(cashSettingsForm(merchant));
    expect(patch).toEqual({
      primaryColor: '#1A5632',
      secondaryColor: '#E8C9A3',
      promoMessage: 'Doble sello',
      promoStartsAt: '2026-11-01T00:00:00.000Z',
      promoEndsAt: '2026-11-30T23:59:59.000Z',
      promoDays: '1,2,3',
      birthdayRewardEnabled: true,
      birthdayRewardName: 'Pastel',
      selfRegistration: false,
      topupEnabled: true,
      multiSealEnabled: false,
    });
    expect(patch).not.toHaveProperty('passStyle');
  });

  it('clears the promotion and day set with null when the form is empty', () => {
    const patch = buildCashSettingsPatch({
      ...cashSettingsForm({}),
      promoStartsAt: '',
      promoEndsAt: '',
      promoDays: [],
    });
    expect(patch.promoStartsAt).toBeNull();
    expect(patch.promoEndsAt).toBeNull();
    expect(patch.promoDays).toBeNull();
  });

  it('parses and serializes the API day codes', () => {
    expect(parsePromoDays('0,6')).toEqual(['dom', 'sab']);
    expect(promoDaysToNumbers(['dom', 'sab'])).toBe('0,6');
  });
});
