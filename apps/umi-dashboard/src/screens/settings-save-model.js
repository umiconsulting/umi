/**
 * Which endpoint receives which Settings field.
 *
 * The Settings screen edits two records: the merchant record and the Cash
 * program. Their DTOs do not overlap. The promotion, the birthday reward and the
 * brand colours are Cash columns; `name`, `businessDayStart`, `posDayClosePolicy`
 * and the segment cutoffs are merchant columns. Sending a Cash field to the
 * merchant PATCH is a silent discard — the route accepts the body, the DTO strips
 * the key, and the screen still says "saved".
 *
 * `city` is deliberately absent: the merchant DTO does not accept it, and the
 * screen shows it read-only. `passStyle` is also absent because this screen does
 * not edit it; leaving the key out preserves an existing `grid` café instead of
 * resetting it to `stamps`.
 *
 * This function is the one place that split is decided. It is pure so a unit
 * test can assert the merchant body carries no Cash-only key, and that the
 * reward body echoes `rewardDescription` and `upgrade`: the Cash service treats
 * an absent key as "clear it".
 */
export function buildSettingsSaves({
  biz,
  seg,
  brand,
  promo,
  promoDayNums,
  selfReg,
  topupEnabled,
  multiSealEnabled,
  birthday,
  loyalty,
  cashActive,
}) {
  const merchant = {
    name: biz.name,
    businessDayStart: biz.businessDayStart,
    posDayClosePolicy: biz.posDayClosePolicy,
  };

  if (seg) {
    merchant.segmentThresholds = {
      vipMinSpendCents: Math.max(0, Math.round(Number(seg.vipMinPesos || 0) * 100)),
      vipMinVisits: Math.max(1, Math.round(Number(seg.vipMinVisits || 1))),
      regularMinVisits: Math.max(1, Math.round(Number(seg.regularMinVisits || 1))),
      activeWindowDays: Math.max(1, Math.round(Number(seg.activeWindowDays || 1))),
      lapsedDays: Math.max(1, Math.round(Number(seg.lapsedDays || 1))),
    };
  }

  const cash = cashActive
    ? {
        primaryColor: brand.primary,
        secondaryColor: brand.secondary,
        promoMessage: promo.message,
        promoStartsAt: promo.from ? promo.from + 'T00:00:00.000Z' : null,
        promoEndsAt: promo.to ? promo.to + 'T23:59:59.000Z' : null,
        promoDays: promoDayNums || null,
        selfRegistration: selfReg,
        ...(typeof topupEnabled === 'boolean' ? { topupEnabled } : {}),
        ...(typeof multiSealEnabled === 'boolean' ? { multiSealEnabled } : {}),
        birthdayRewardEnabled: birthday.on,
        birthdayRewardName: birthday.rewardName,
      }
    : null;

  const reward =
    cashActive && loyalty
      ? {
          rewardName: loyalty.rewardName,
          visitsRequired: loyalty.visitsRequired,
          rewardCostCentavos: Math.round((loyalty.rewardCost || 0) * 100),
          rewardDescription: loyalty.rewardDescription ?? null,
          upgrade: loyalty.upgrade ?? null,
        }
      : null;

  return { merchant, cash, reward };
}
