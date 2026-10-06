import type { StoredValueFingerprintInput } from '@umi/contract';
import { commandFingerprint } from '../integrity/canonical-json';

export type ContactType = 'email' | 'phone';
export type PointsFactType =
  | 'earn_pending'
  | 'earn_committed'
  | 'earn_cancelled'
  | 'earn_reversed'
  | 'reward_authorized'
  | 'reward_released'
  | 'points_redeemed'
  | 'points_reversed'
  | 'manual_increase'
  | 'manual_decrease';
export type StoredValueFactType =
  | 'issued'
  | 'loaded'
  | 'authorized'
  | 'authorization_released'
  | 'redeemed'
  | 'refunded'
  | 'reversed'
  | 'adjustment_increase'
  | 'adjustment_decrease';

const safe = (value: number, code: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(code);
  return value;
};

export const canonicalStoredValueFingerprint = (input: StoredValueFingerprintInput): string => {
  for (const amount of [input.cashMinorUnits, input.manualTerminalMinorUnits]) {
    safe(amount, 'STORED_VALUE_ALLOCATION_INVALID');
  }
  const allocations = input.allocations.map((allocation) => {
    safe(allocation.requestedAmountMinorUnits, 'STORED_VALUE_ALLOCATION_INVALID');
    safe(allocation.authorizedAmountMinorUnits, 'STORED_VALUE_ALLOCATION_INVALID');
    safe(allocation.committedAmountMinorUnits, 'STORED_VALUE_ALLOCATION_INVALID');
    safe(allocation.remainingAccountBalanceMinorUnits, 'STORED_VALUE_ALLOCATION_INVALID');
    safe(allocation.allocationOrder, 'STORED_VALUE_ALLOCATION_INVALID');
    if (
      allocation.requestedAmountMinorUnits === 0 ||
      allocation.authorizedAmountMinorUnits !== allocation.requestedAmountMinorUnits ||
      allocation.committedAmountMinorUnits > allocation.authorizedAmountMinorUnits
    ) {
      throw new RangeError('STORED_VALUE_ALLOCATION_INVALID');
    }
    return allocation;
  });
  if (
    new Set(allocations.map((allocation) => allocation.allocationId)).size !== allocations.length
  ) {
    throw new RangeError('STORED_VALUE_ALLOCATION_DUPLICATE');
  }
  if (
    new Set(allocations.map((allocation) => allocation.allocationOrder)).size !== allocations.length
  ) {
    throw new RangeError('STORED_VALUE_ALLOCATION_ORDER_DUPLICATE');
  }
  return commandFingerprint('umi.pos.customer-value.allocation.v1', {
    ...input,
    allocations: [...allocations].sort(
      (left, right) =>
        left.allocationOrder - right.allocationOrder ||
        left.allocationId.localeCompare(right.allocationId),
    ),
  });
};

export const normalizeCustomerContact = (type: ContactType, input: string) => {
  const displayValue = input.trim();
  if (displayValue.length === 0 || displayValue.length > 320) {
    throw new RangeError('CUSTOMER_CONTACT_INVALID');
  }
  if (type === 'email') {
    const normalizedValue = displayValue.toLocaleLowerCase('en-US');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) {
      throw new RangeError('CUSTOMER_CONTACT_INVALID');
    }
    return { displayValue, normalizedValue };
  }
  const prefix = displayValue.startsWith('+') ? '+' : '';
  const digits = displayValue.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new RangeError('CUSTOMER_CONTACT_INVALID');
  return { displayValue, normalizedValue: `${prefix}${digits}` };
};

export const calculateEarnedPoints = (
  eligibleMinorUnits: number,
  moneyUnitMinorUnits: number,
  pointsPerUnit: number,
  rounding: 'floor' | 'half_up',
): number => {
  safe(eligibleMinorUnits, 'LOYALTY_AMOUNT_INVALID');
  safe(moneyUnitMinorUnits, 'LOYALTY_POLICY_INVALID');
  safe(pointsPerUnit, 'LOYALTY_POLICY_INVALID');
  if (moneyUnitMinorUnits === 0 || pointsPerUnit === 0) return 0;
  const numerator = BigInt(eligibleMinorUnits) * BigInt(pointsPerUnit);
  const denominator = BigInt(moneyUnitMinorUnits);
  const value =
    rounding === 'half_up' ? (numerator + denominator / 2n) / denominator : numerator / denominator;
  const result = Number(value);
  return safe(result, 'LOYALTY_POINTS_OUT_OF_RANGE');
};

export interface PointsEarnPolicy {
  moneyUnitMinorUnits: number;
  pointsPerUnit: number;
  rounding: 'floor' | 'half_up';
  excludedProductIds: string[];
  excludedCategoryIds: string[];
  excludedTenderTypes: string[];
  includeTax: boolean;
  includeTip: boolean;
  discountInteraction: 'ignore' | 'subtract';
  rewardInteraction: 'ignore' | 'subtract';
  earnTiming: 'immediate' | 'pending';
}

export interface PointsEarnInput {
  lines: Array<{ amountMinorUnits: number; productId: string; categoryId: string | null }>;
  discountMinorUnits: number;
  taxMinorUnits: number;
  tipMinorUnits: number;
  tenderTypes: string[];
  rewardBenefitMinorUnits: number;
  policy: PointsEarnPolicy;
}

export const calculatePointsEarn = (input: PointsEarnInput) => {
  if (input.lines.length > 500) throw new RangeError('LOYALTY_LINE_LIMIT_EXCEEDED');
  const explanationCodes: string[] = [];
  let grossEligibleMinorUnits = 0;
  let excludedMinorUnits = 0;
  for (const line of input.lines) {
    safe(line.amountMinorUnits, 'LOYALTY_AMOUNT_INVALID');
    const excluded =
      input.policy.excludedProductIds.includes(line.productId) ||
      (line.categoryId !== null && input.policy.excludedCategoryIds.includes(line.categoryId));
    if (excluded) {
      excludedMinorUnits += line.amountMinorUnits;
      explanationCodes.push(
        input.policy.excludedProductIds.includes(line.productId)
          ? 'excluded_product'
          : 'excluded_category',
      );
    } else {
      grossEligibleMinorUnits += line.amountMinorUnits;
    }
  }
  for (const value of [
    input.discountMinorUnits,
    input.taxMinorUnits,
    input.tipMinorUnits,
    input.rewardBenefitMinorUnits,
  ]) {
    safe(value, 'LOYALTY_AMOUNT_INVALID');
  }
  if (input.tenderTypes.some((type) => input.policy.excludedTenderTypes.includes(type))) {
    return {
      grossEligibleMinorUnits,
      excludedMinorUnits: excludedMinorUnits + grossEligibleMinorUnits,
      finalEligibleMinorUnits: 0,
      points: 0,
      status: input.policy.earnTiming,
      explanationCodes: [...new Set([...explanationCodes, 'excluded_tender'])],
    };
  }
  let finalEligibleMinorUnits = grossEligibleMinorUnits;
  if (input.policy.discountInteraction === 'subtract' && input.discountMinorUnits > 0) {
    finalEligibleMinorUnits -= input.discountMinorUnits;
    explanationCodes.push('discount_subtracted');
  }
  if (!input.policy.includeTax && input.taxMinorUnits > 0) {
    finalEligibleMinorUnits -= input.taxMinorUnits;
    explanationCodes.push('tax_excluded');
  } else if (input.policy.includeTax && input.taxMinorUnits > 0) {
    explanationCodes.push('tax_included');
  }
  if (input.policy.includeTip && input.tipMinorUnits > 0) {
    finalEligibleMinorUnits += input.tipMinorUnits;
    explanationCodes.push('tip_included');
  } else if (!input.policy.includeTip && input.tipMinorUnits > 0) {
    explanationCodes.push('tip_excluded');
  }
  if (input.policy.rewardInteraction === 'subtract' && input.rewardBenefitMinorUnits > 0) {
    finalEligibleMinorUnits -= input.rewardBenefitMinorUnits;
    explanationCodes.push('reward_subtracted');
  }
  finalEligibleMinorUnits = Math.max(0, finalEligibleMinorUnits);
  return {
    grossEligibleMinorUnits,
    excludedMinorUnits,
    finalEligibleMinorUnits,
    points: calculateEarnedPoints(
      finalEligibleMinorUnits,
      input.policy.moneyUnitMinorUnits,
      input.policy.pointsPerUnit,
      input.policy.rounding,
    ),
    status: input.policy.earnTiming,
    explanationCodes: [...new Set(explanationCodes)],
  };
};

export interface RewardEligibilityInput {
  accountActive: boolean;
  availablePoints: number;
  authorizedPoints: number;
  customerActive: boolean;
  rewardActive: boolean;
  pointsCost: number;
  existingDiscount: boolean;
  anotherReward: boolean;
  tenderTypes: string[];
  allowedTenderTypes: string[];
  combinableWithDiscount: boolean;
  combinableWithRewards: boolean;
  usageCount: number;
  usageLimit: number | null;
}

export const evaluateRewardEligibility = (input: RewardEligibilityInput) => {
  const reasonCodes: string[] = [];
  if (!input.customerActive) reasonCodes.push('customer_unavailable');
  if (!input.accountActive) reasonCodes.push('loyalty_account_suspended');
  if (!input.rewardActive) reasonCodes.push('reward_unavailable');
  const replacementBalance = input.anotherReward
    ? input.availablePoints + input.authorizedPoints
    : input.availablePoints;
  if (replacementBalance < input.pointsCost) {
    reasonCodes.push('insufficient_points');
  }
  if (input.existingDiscount && !input.combinableWithDiscount) {
    reasonCodes.push('blocked_by_existing_discount');
  }
  if (input.anotherReward && !input.combinableWithRewards) {
    reasonCodes.push('blocked_by_another_reward');
  }
  if (
    input.allowedTenderTypes.length > 0 &&
    input.tenderTypes.some((type) => !input.allowedTenderTypes.includes(type))
  ) {
    reasonCodes.push('blocked_by_tender');
  }
  if (input.usageLimit !== null && input.usageCount >= input.usageLimit) {
    reasonCodes.push('usage_limit_reached');
  }
  return { eligible: reasonCodes.length === 0, reasonCodes };
};

export const applyPointsFacts = (
  facts: Array<{ sequence: number; type: PointsFactType; points: number }>,
) => {
  const balance = { pending: 0, available: 0, authorized: 0, redeemed: 0, ledgerSequence: 0 };
  for (const fact of facts) {
    safe(fact.points, 'LOYALTY_POINTS_INVALID');
    if (fact.points === 0 || fact.sequence !== balance.ledgerSequence + 1) {
      throw new RangeError('LOYALTY_LEDGER_INVALID');
    }
    switch (fact.type) {
      case 'earn_pending':
        balance.pending += fact.points;
        break;
      case 'earn_cancelled':
        balance.pending -= fact.points;
        break;
      case 'earn_reversed':
        balance.available -= fact.points;
        break;
      case 'earn_committed':
      case 'points_reversed':
      case 'manual_increase':
        balance.available += fact.points;
        break;
      case 'reward_authorized':
        balance.available -= fact.points;
        balance.authorized += fact.points;
        break;
      case 'reward_released':
        balance.available += fact.points;
        balance.authorized -= fact.points;
        break;
      case 'points_redeemed':
        balance.authorized -= fact.points;
        balance.redeemed += fact.points;
        break;
      case 'manual_decrease':
        balance.available -= fact.points;
        break;
    }
    if (balance.pending < 0 || balance.available < 0 || balance.authorized < 0) {
      throw new RangeError('LOYALTY_INSUFFICIENT_POINTS');
    }
    balance.ledgerSequence = fact.sequence;
  }
  return balance;
};

export const applyStoredValueFacts = (
  facts: Array<{ sequence: number; type: StoredValueFactType; amountMinorUnits: number }>,
) => {
  const balance = { available: 0, authorized: 0, redeemed: 0, ledgerSequence: 0 };
  for (const fact of facts) {
    safe(fact.amountMinorUnits, 'STORED_VALUE_AMOUNT_INVALID');
    if (fact.amountMinorUnits === 0 || fact.sequence !== balance.ledgerSequence + 1) {
      throw new RangeError('STORED_VALUE_LEDGER_INVALID');
    }
    switch (fact.type) {
      case 'issued':
      case 'loaded':
      case 'refunded':
      case 'reversed':
      case 'adjustment_increase':
        balance.available += fact.amountMinorUnits;
        break;
      case 'authorized':
        balance.available -= fact.amountMinorUnits;
        balance.authorized += fact.amountMinorUnits;
        break;
      case 'authorization_released':
        balance.available += fact.amountMinorUnits;
        balance.authorized -= fact.amountMinorUnits;
        break;
      case 'redeemed':
        balance.authorized -= fact.amountMinorUnits;
        balance.redeemed += fact.amountMinorUnits;
        break;
      case 'adjustment_decrease':
        balance.available -= fact.amountMinorUnits;
        break;
    }
    if (balance.available < 0 || balance.authorized < 0) {
      throw new RangeError('STORED_VALUE_INSUFFICIENT_BALANCE');
    }
    balance.ledgerSequence = fact.sequence;
  }
  return balance;
};

export const calculateRewardReversal = (
  redeemedPoints: number,
  refundedMinorUnits: number,
  originalMinorUnits: number,
  alreadyReversedPoints: number,
): number => {
  safe(redeemedPoints, 'REWARD_REVERSAL_INVALID');
  safe(refundedMinorUnits, 'REWARD_REVERSAL_INVALID');
  safe(originalMinorUnits, 'REWARD_REVERSAL_INVALID');
  safe(alreadyReversedPoints, 'REWARD_REVERSAL_INVALID');
  if (originalMinorUnits === 0 || alreadyReversedPoints > redeemedPoints) {
    throw new RangeError('REWARD_REVERSAL_INVALID');
  }
  const proportional = Number(
    (BigInt(redeemedPoints) * BigInt(Math.min(refundedMinorUnits, originalMinorUnits))) /
      BigInt(originalMinorUnits),
  );
  return Math.min(proportional, redeemedPoints - alreadyReversedPoints);
};
