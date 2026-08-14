import { commandFingerprint } from '../integrity/canonical-json';

const CODES = [
  'CUSTOMER_CONTACT_INVALID',
  'CUSTOMER_MERCHANT_SCOPE',
  'CUSTOMER_UNAVAILABLE',
  'VALUE_RECONCILIATION_REQUIRED',
  'LOYALTY_ACCOUNT_UNAVAILABLE',
  'LOYALTY_INSUFFICIENT_POINTS',
  'LOYALTY_POLICY_CHANGED',
  'REWARD_INELIGIBLE',
  'REWARD_AUTHORIZATION_EXPIRED',
  'STORED_VALUE_INSUFFICIENT_BALANCE',
  'STORED_VALUE_CURRENCY_MISMATCH',
  'STORED_VALUE_AUTHORIZATION_EXPIRED',
  'GIFT_CARD_NOT_FOUND',
  'GIFT_CARD_INACTIVE',
  'GIFT_CARD_CODE_INVALID',
  'APPROVAL_REUSED',
] as const;

export const customerValueConflictCode = (error: unknown): (typeof CODES)[number] | null => {
  const message = error instanceof Error ? error.message : String(error);
  return CODES.find((code) => message.includes(code)) ?? null;
};

export const customerValueFingerprint = (type: string, value: object): string =>
  commandFingerprint(type, value);
