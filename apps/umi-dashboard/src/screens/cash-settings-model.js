/**
 * Cash settings form and PATCH body.
 *
 * The panel edits only the Cash-owned fields the API declares. `passStyle` is
 * absent on purpose: this panel does not show that control, and an absent key
 * leaves an existing `grid` pass untouched. `city` is absent for the same class
 * of reason on the merchant route; the dashboard settings screen shows it
 * read-only.
 */
export const CASH_DOW = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

export const CASH_DOW_NUM = {
  dom: '0',
  lun: '1',
  mar: '2',
  mie: '3',
  jue: '4',
  vie: '5',
  sab: '6',
};

export function parsePromoDays(value) {
  const numbers = String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return CASH_DOW.filter((id) => numbers.includes(CASH_DOW_NUM[id]));
}

export function promoDaysToNumbers(days) {
  return (days || [])
    .map((id) => CASH_DOW_NUM[id])
    .filter(Boolean)
    .join(',');
}

const dateOnly = (value) => (value ? String(value).slice(0, 10) : '');

export function cashSettingsForm(merchant) {
  return {
    primaryColor: merchant?.primaryColor || '#B5605A',
    secondaryColor: merchant?.secondaryColor || '#E8C9A3',
    promoMessage: merchant?.promoMessage || '',
    promoStartsAt: dateOnly(merchant?.promoStartsAt),
    promoEndsAt: dateOnly(merchant?.promoEndsAt),
    promoDays: parsePromoDays(merchant?.promoDays),
    birthdayRewardEnabled: merchant?.birthdayRewardEnabled !== false,
    birthdayRewardName: merchant?.birthdayRewardName || '',
    selfRegistration: merchant?.selfRegistration !== false,
    topupEnabled: merchant?.topupEnabled !== false,
    multiSealEnabled: merchant?.multiSealEnabled !== false,
  };
}

export function buildCashSettingsPatch(form) {
  return {
    primaryColor: form.primaryColor || null,
    secondaryColor: form.secondaryColor || null,
    promoMessage: String(form.promoMessage || '').slice(0, 200),
    promoStartsAt: form.promoStartsAt ? `${form.promoStartsAt}T00:00:00.000Z` : null,
    promoEndsAt: form.promoEndsAt ? `${form.promoEndsAt}T23:59:59.000Z` : null,
    promoDays: form.promoDays?.length ? promoDaysToNumbers(form.promoDays) : null,
    birthdayRewardEnabled: Boolean(form.birthdayRewardEnabled),
    birthdayRewardName: String(form.birthdayRewardName || '').trim(),
    selfRegistration: Boolean(form.selfRegistration),
    topupEnabled: Boolean(form.topupEnabled),
    multiSealEnabled: Boolean(form.multiSealEnabled),
  };
}
