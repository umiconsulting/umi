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
