export const USER_ROLES = {
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const SCAN_ACTIONS = {
  VISIT: 'VISIT',
  REDEEM: 'REDEEM',
  BIRTHDAY_REDEEM: 'BIRTHDAY_REDEEM',
} as const;

export type ScanAction = (typeof SCAN_ACTIONS)[keyof typeof SCAN_ACTIONS];

export const TRANSACTION_TYPES = {
  TOPUP: 'TOPUP',
  PURCHASE: 'PURCHASE',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export const DEFAULT_VISITS_REQUIRED = 10;
export const DEFAULT_REWARD_NAME = 'Recompensa de temporada';
export const DEFAULT_CUSTOMER_NAME = 'Cliente';
