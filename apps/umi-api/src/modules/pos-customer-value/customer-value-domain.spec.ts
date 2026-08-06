import { describe, expect, it } from 'vitest';
import {
  applyPointsFacts,
  applyStoredValueFacts,
  calculatePointsEarn,
  calculateEarnedPoints,
  calculateRewardReversal,
  evaluateRewardEligibility,
  normalizeCustomerContact,
} from './customer-value-domain';

describe('Gate 3F customer and value domain', () => {
  it('normalizes supported contacts without changing display data', () => {
    expect(normalizeCustomerContact('email', '  Café@Example.COM ')).toEqual({
      displayValue: 'Café@Example.COM',
      normalizedValue: 'café@example.com',
    });
    expect(normalizeCustomerContact('phone', '+52 (669) 123-4567')).toEqual({
      displayValue: '+52 (669) 123-4567',
      normalizedValue: '+526691234567',
    });
  });

  it('rejects an invalid customer contact', () => {
    expect(() => normalizeCustomerContact('email', 'bad-address')).toThrow(
      'CUSTOMER_CONTACT_INVALID',
    );
    expect(() => normalizeCustomerContact('phone', '123')).toThrow('CUSTOMER_CONTACT_INVALID');
  });

  it('calculates points with integer arithmetic and explicit rounding', () => {
    expect(calculateEarnedPoints(12_345, 100, 1, 'floor')).toBe(123);
    expect(calculateEarnedPoints(12_350, 100, 1, 'half_up')).toBe(124);
  });

  it('rebuilds points from immutable ordered facts', () => {
    expect(
      applyPointsFacts([
        { sequence: 1, type: 'earn_pending', points: 50 },
        { sequence: 2, type: 'earn_committed', points: 100 },
        { sequence: 3, type: 'reward_authorized', points: 40 },
        { sequence: 4, type: 'reward_released', points: 40 },
        { sequence: 5, type: 'reward_authorized', points: 25 },
        { sequence: 6, type: 'points_redeemed', points: 25 },
      ]),
    ).toEqual({ pending: 50, available: 75, authorized: 0, redeemed: 25, ledgerSequence: 6 });
  });

  it('rebuilds stored value without overdraft', () => {
    expect(
      applyStoredValueFacts([
        { sequence: 1, type: 'issued', amountMinorUnits: 2_000 },
        { sequence: 2, type: 'authorized', amountMinorUnits: 600 },
        { sequence: 3, type: 'authorization_released', amountMinorUnits: 600 },
        { sequence: 4, type: 'authorized', amountMinorUnits: 750 },
        { sequence: 5, type: 'redeemed', amountMinorUnits: 750 },
      ]),
    ).toEqual({ available: 1_250, authorized: 0, redeemed: 750, ledgerSequence: 5 });
    expect(() =>
      applyStoredValueFacts([
        { sequence: 1, type: 'issued', amountMinorUnits: 100 },
        { sequence: 2, type: 'authorized', amountMinorUnits: 101 },
      ]),
    ).toThrow('STORED_VALUE_INSUFFICIENT_BALANCE');
  });

  it('limits proportional reward reversal to the original redemption', () => {
    expect(calculateRewardReversal(500, 2_500, 10_000, 0)).toBe(125);
    expect(calculateRewardReversal(500, 10_000, 10_000, 100)).toBe(400);
  });

  it('uses one integer-safe earn engine for line, tax, tip, discount, tender, and reward rules', () => {
    expect(
      calculatePointsEarn({
        lines: [
          { amountMinorUnits: 12_000, categoryId: 'coffee', productId: 'latte' },
          { amountMinorUnits: 3_000, categoryId: 'retail', productId: 'beans' },
        ],
        discountMinorUnits: 1_500,
        taxMinorUnits: 1_600,
        tipMinorUnits: 800,
        tenderTypes: ['cash'],
        rewardBenefitMinorUnits: 500,
        policy: {
          moneyUnitMinorUnits: 100,
          pointsPerUnit: 1,
          rounding: 'floor',
          excludedProductIds: ['beans'],
          excludedCategoryIds: [],
          excludedTenderTypes: ['gift_card'],
          includeTax: false,
          includeTip: true,
          discountInteraction: 'subtract',
          rewardInteraction: 'subtract',
          earnTiming: 'pending',
        },
      }),
    ).toEqual({
      grossEligibleMinorUnits: 12_000,
      excludedMinorUnits: 3_000,
      finalEligibleMinorUnits: 9_200,
      points: 92,
      status: 'pending',
      explanationCodes: [
        'excluded_product',
        'discount_subtracted',
        'tax_excluded',
        'tip_included',
        'reward_subtracted',
      ],
    });
  });

  it('denies an incompatible or usage-limited reward', () => {
    expect(
      evaluateRewardEligibility({
        accountActive: true,
        availablePoints: 500,
        authorizedPoints: 0,
        customerActive: true,
        rewardActive: true,
        pointsCost: 100,
        existingDiscount: true,
        anotherReward: false,
        tenderTypes: ['cash'],
        allowedTenderTypes: ['cash'],
        combinableWithDiscount: false,
        combinableWithRewards: false,
        usageCount: 0,
        usageLimit: 1,
      }),
    ).toEqual({ eligible: false, reasonCodes: ['blocked_by_existing_discount'] });
  });

  it('permits an explicit reward replacement to reuse the current points hold', () => {
    expect(
      evaluateRewardEligibility({
        accountActive: true,
        availablePoints: 20,
        authorizedPoints: 100,
        customerActive: true,
        rewardActive: true,
        pointsCost: 100,
        existingDiscount: false,
        anotherReward: true,
        tenderTypes: ['cash'],
        allowedTenderTypes: ['cash'],
        combinableWithDiscount: true,
        combinableWithRewards: false,
        usageCount: 0,
        usageLimit: 1,
      }),
    ).toEqual({ eligible: false, reasonCodes: ['blocked_by_another_reward'] });
  });
});
