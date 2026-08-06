import { z } from 'zod';
import { CorrelationId, CurrencyCode, IsoTimestamp, MerchantDate, Money, Uuid } from './platform';

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const PublicReference = z.string().min(1).max(80);
const CursorPage = z.object({ nextCursor: z.string().max(1024).nullable() }).strict();

export const CustomerStatus = z.enum([
  'active',
  'inactive',
  'archived',
  'merged',
  'restricted',
  'anonymized',
]);
export const CustomerContactType = z.enum(['email', 'phone', 'other_approved']);
export const CustomerContactVerification = z.enum([
  'unverified',
  'pending',
  'verified',
  'invalid',
  'suppressed',
  'provider_unavailable',
]);
export const CustomerContact = z
  .object({
    id: Uuid,
    type: CustomerContactType,
    displayValue: z.string().min(1).max(320),
    maskedValue: z.string().min(1).max(320),
    verification: CustomerContactVerification,
    primary: z.boolean(),
  })
  .strict();
export const CustomerPrivacyPreference = z
  .object({
    dataMinimized: z.boolean(),
    contactVisibility: z.enum(['limited', 'full']),
    version: z.number().int().positive(),
  })
  .strict();
export const ConsentType = z.enum([
  'receipt_delivery',
  'marketing_email',
  'marketing_sms',
  'loyalty_enrollment',
  'profiling_foundation',
  'terms_acceptance_foundation',
]);
export const ConsentStatus = z.enum(['not_requested', 'granted', 'denied', 'revoked', 'expired']);
export const ConsentEvidence = z
  .object({
    source: z.enum(['pos_operator', 'customer_self_service', 'migration']),
    policyVersion: z.string().min(1).max(80),
    reference: z.string().max(120).nullable(),
  })
  .strict();
export const CustomerConsent = z
  .object({
    id: Uuid,
    type: ConsentType,
    status: ConsentStatus,
    grantedAt: IsoTimestamp.nullable(),
    revokedAt: IsoTimestamp.nullable(),
    evidence: ConsentEvidence,
  })
  .strict();
export const CustomerProfile = z
  .object({
    id: Uuid,
    publicReference: PublicReference,
    displayName: z.string().min(1).max(160),
    status: CustomerStatus,
    preferredLanguage: z.enum(['en', 'es']).nullable(),
    version: z.number().int().positive(),
    contacts: z.array(CustomerContact).max(10),
    consents: z.array(CustomerConsent).max(20),
    privacy: CustomerPrivacyPreference,
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .strict();
export const Customer = CustomerProfile;
export const CustomerSearchRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    query: z.string().trim().max(120).default(''),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    recent: z.coerce.boolean().default(false),
  })
  .strict();
export const CustomerSearchResult = CursorPage.extend({
  customers: z.array(CustomerProfile).max(50),
  ambiguous: z.boolean(),
}).strict();
export const CustomerMatchCandidate = z
  .object({
    customer: CustomerProfile,
    reasons: z
      .array(z.enum(['same_email', 'same_phone', 'similar_name', 'same_verified_contact']))
      .max(8),
    scoreBasisPoints: z.number().int().min(0).max(10000),
  })
  .strict();
export const CustomerAttachment = z
  .object({
    saleId: Uuid,
    customerId: Uuid,
    attachedAt: IsoTimestamp,
    version: z.number().int().positive(),
  })
  .strict();
export const CustomerHistoryEntry = z
  .object({
    id: Uuid,
    type: z.enum([
      'sale',
      'receipt',
      'refund',
      'void',
      'points_earn',
      'reward',
      'wallet',
      'gift_card',
      'consent',
      'merge',
    ]),
    publicReference: PublicReference,
    locationId: Uuid.nullable(),
    businessDate: MerchantDate,
    total: Money.nullable(),
    points: z.number().int().nullable().default(null),
    relatedSaleId: Uuid.nullable().default(null),
    relatedExceptionId: Uuid.nullable().default(null),
    correlationReference: z.string().max(120).nullable().default(null),
    status: z.string().min(1).max(64),
    occurredAt: IsoTimestamp,
  })
  .strict();
export const CustomerHistoryPage = CursorPage.extend({
  entries: z.array(CustomerHistoryEntry).max(50),
  loyaltyAccount: z
    .lazy(() => LoyaltyAccount)
    .nullable()
    .default(null),
  pointsBalance: z
    .lazy(() => PointsBalance)
    .nullable()
    .default(null),
}).strict();
export const CustomerHistoryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    cursor: z.string().max(2048).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    category: z
      .enum([
        'all',
        'sale',
        'receipt',
        'exception',
        'loyalty',
        'reward',
        'wallet',
        'gift_card',
        'consent',
      ])
      .default('all'),
    eventLocationId: Uuid.optional(),
    businessDateFrom: MerchantDate.optional(),
    businessDateTo: MerchantDate.optional(),
  })
  .strict();
export const CustomerMergeCandidate = z
  .object({
    source: CustomerProfile,
    target: CustomerProfile,
    valueReconciliationRequired: z.boolean(),
  })
  .strict();

export const CustomerCommandContext = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: Uuid,
    expectedVersion: z.number().int().positive().nullable().default(null),
  })
  .strict();
export const CreateCustomerRequest = CustomerCommandContext.extend({
  displayName: z.string().trim().min(1).max(160),
  preferredLanguage: z.enum(['en', 'es']).nullable().default(null),
  contacts: z
    .array(
      z
        .object({
          type: z.enum(['email', 'phone']),
          value: z.string().trim().min(1).max(320),
          primary: z.boolean().default(false),
        })
        .strict(),
    )
    .max(3)
    .default([]),
  consents: z
    .array(
      z
        .object({
          type: ConsentType,
          status: z.enum(['granted', 'denied']),
          policyVersion: z.string().min(1).max(80),
        })
        .strict(),
    )
    .max(10)
    .default([]),
}).strict();
export const CustomerMergeRequest = CustomerCommandContext.extend({
  sourceCustomerId: Uuid,
  targetCustomerId: Uuid,
  approvalId: Uuid.nullable().default(null),
  approvalFingerprint: Fingerprint.nullable().default(null),
}).strict();
export const CustomerMergeResult = z
  .object({
    sourceCustomerId: Uuid,
    targetCustomerId: Uuid,
    status: z.enum(['merged', 'value_reconciliation_required']),
    recovered: z.boolean(),
    correlationId: CorrelationId,
  })
  .strict();

export const LoyaltyAccountStatus = z.enum([
  'active',
  'suspended',
  'closed',
  'merge_reconciliation_required',
  'restricted',
]);
export const LoyaltyAccount = z
  .object({
    id: Uuid,
    customerId: Uuid,
    programReference: PublicReference,
    status: LoyaltyAccountStatus,
    pointsScale: z.literal(0),
    ledgerSequence: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    enrolledAt: IsoTimestamp,
  })
  .strict();
export const LoyaltyPolicy = z
  .object({
    version: z.string().min(1).max(80),
    enabled: z.boolean(),
    enrollmentRequired: z.boolean(),
    pointsPerMoneyUnit: z.number().int().nonnegative(),
    moneyUnitMinorUnits: z.number().int().positive(),
    rounding: z.enum(['floor', 'half_up']),
    earnTiming: z.enum(['immediate', 'pending']),
    redemptionMinimum: z.number().int().nonnegative(),
    redemptionMaximum: z.number().int().nonnegative(),
    offlineEarn: z.boolean(),
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    fingerprint: Fingerprint,
  })
  .strict();
export const LoyaltyLedgerEntryType = z.enum([
  'points_earn_pending',
  'points_earn_committed',
  'points_earn_cancelled',
  'points_earn_reversed',
  'points_redeemed',
  'points_released',
  'points_reversed',
  'points_expired_foundation',
  'manual_points_adjustment',
]);
export const LoyaltyLedgerEntry = z
  .object({
    id: Uuid,
    accountId: Uuid,
    customerId: Uuid,
    sequence: z.number().int().positive(),
    type: LoyaltyLedgerEntryType,
    points: z.number().int().positive(),
    direction: z.enum(['credit', 'debit', 'hold', 'release']),
    saleId: Uuid.nullable(),
    refundId: Uuid.nullable(),
    rewardId: Uuid.nullable(),
    commandId: Uuid,
    businessDate: MerchantDate,
    occurredAt: IsoTimestamp,
  })
  .strict();
export const PointsBalance = z
  .object({
    accountId: Uuid,
    earned: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    authorized: z.number().int().nonnegative(),
    redeemed: z.number().int().nonnegative(),
    reversed: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    adjusted: z.number().int(),
    ledgerSequence: z.number().int().nonnegative(),
    projectionVersion: z.number().int().positive(),
    calculatedAt: IsoTimestamp,
  })
  .strict();
export const PointsEarnPreview = z
  .object({
    customerId: Uuid,
    accountId: Uuid,
    programReference: PublicReference,
    grossEligibleMinorUnits: z.number().int().nonnegative(),
    eligibleMinorUnits: z.number().int().nonnegative(),
    excludedMinorUnits: z.number().int().nonnegative(),
    expectedPoints: z.number().int().nonnegative(),
    status: z.enum(['none', 'pending', 'immediate']),
    policyVersion: z.string().min(1).max(80),
    fingerprint: Fingerprint,
    inputFingerprint: Fingerprint,
    previewVersion: z.number().int().positive(),
    checkoutVersion: z.number().int().positive(),
    customerAttachmentVersion: z.number().int().positive(),
    expiresAt: IsoTimestamp,
    explanationCodes: z.array(z.string().min(1).max(80)).max(20),
  })
  .strict();
export const PointsEarnCommit = z
  .object({
    ledgerEntry: LoyaltyLedgerEntry.nullable(),
    balance: PointsBalance.nullable(),
    policyVersion: z.string().min(1).max(80).nullable(),
  })
  .strict();

export const RewardType = z.enum([
  'fixed_discount',
  'percentage_discount',
  'free_eligible_item',
  'points_to_value',
  'operational_benefit_foundation',
]);
export const Reward = z
  .object({
    id: Uuid,
    publicReference: PublicReference,
    displayName: z.string().min(1).max(160),
    type: RewardType,
    pointsCost: z.number().int().positive(),
    active: z.boolean(),
    validFrom: IsoTimestamp,
    validUntil: IsoTimestamp.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const RewardEligibility = z
  .object({
    reward: Reward,
    eligible: z.boolean(),
    state: z.enum([
      'eligible',
      'ineligible',
      'approval_required',
      'replacement_confirmation_required',
    ]),
    pointsCost: z.number().int().positive(),
    benefit: Money,
    remainingPoints: z.number().int().nonnegative(),
    approvalPermission: z.string().max(100).nullable(),
    affectedLineIds: z.array(Uuid).max(100),
    taxConsequenceMinorUnits: z.number().int(),
    authorizationExpiresAt: IsoTimestamp,
    explanationCodes: z.array(z.string().min(1).max(80)).max(20),
    fingerprint: Fingerprint,
    policyVersion: z.string().min(1).max(80),
  })
  .strict();
export const RewardAuthorizationStatus = z.enum([
  'pending',
  'authorized',
  'committed',
  'released',
  'expired',
  'conflict',
  'reversed',
]);
export const RewardAuthorization = z
  .object({
    id: Uuid,
    customerId: Uuid,
    accountId: Uuid,
    rewardId: Uuid,
    saleId: Uuid,
    checkoutVersion: z.number().int().positive(),
    points: z.number().int().positive(),
    benefit: Money,
    rewardVersion: z.number().int().positive(),
    policyVersion: z.string().min(1).max(80),
    fingerprint: Fingerprint,
    status: RewardAuthorizationStatus,
    createdAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
  })
  .strict();
export const RewardAuthorizationRequest = CustomerCommandContext.extend({
  saleId: Uuid,
  checkoutVersion: z.number().int().positive(),
  customerId: Uuid,
  rewardId: Uuid,
  previewFingerprint: Fingerprint,
}).strict();
export const ValueReleaseRequest = CustomerCommandContext.extend({
  authorizationId: Uuid,
  accountType: z.enum(['loyalty_reward', 'wallet', 'gift_card']),
  fingerprint: Fingerprint,
}).strict();
export const RewardRedemption = z
  .object({
    authorizationId: Uuid,
    ledgerEntryId: Uuid,
    points: z.number().int().positive(),
    benefit: Money,
    committedAt: IsoTimestamp,
  })
  .strict();
export const RewardRelease = z
  .object({ authorizationId: Uuid, status: z.literal('released'), releasedAt: IsoTimestamp })
  .strict();
export const RewardReversal = z
  .object({
    redemptionId: Uuid,
    refundId: Uuid,
    points: z.number().int().nonnegative(),
    reversedAt: IsoTimestamp,
  })
  .strict();

export const WalletStatus = z.enum([
  'active',
  'suspended',
  'closed',
  'restricted',
  'merge_reconciliation_required',
]);
export const WalletAccount = z
  .object({
    id: Uuid,
    customerId: Uuid,
    publicReference: PublicReference,
    currency: CurrencyCode,
    status: WalletStatus,
    ledgerSequence: z.number().int().nonnegative(),
    projectionVersion: z.number().int().positive(),
    version: z.number().int().positive(),
  })
  .strict();
export const WalletLedgerEntryType = z.enum([
  'issued',
  'loaded',
  'authorized',
  'authorization_released',
  'redeemed',
  'refunded',
  'reversed',
  'expired_foundation',
  'adjustment_increase',
  'adjustment_decrease',
]);
export const WalletLedgerEntry = z
  .object({
    id: Uuid,
    walletId: Uuid,
    customerId: Uuid,
    currency: CurrencyCode,
    sequence: z.number().int().positive(),
    type: WalletLedgerEntryType,
    amountMinorUnits: z.number().int().positive(),
    direction: z.enum(['credit', 'debit', 'hold', 'release']),
    saleId: Uuid.nullable(),
    refundId: Uuid.nullable(),
    authorizationId: Uuid.nullable(),
    commandId: Uuid,
    businessDate: MerchantDate,
    occurredAt: IsoTimestamp,
  })
  .strict();
export const WalletBalance = z
  .object({
    accountId: Uuid,
    currency: CurrencyCode,
    issued: z.number().int().nonnegative(),
    loaded: z.number().int().nonnegative(),
    available: z.number().int().nonnegative(),
    authorized: z.number().int().nonnegative(),
    redeemed: z.number().int().nonnegative(),
    refunded: z.number().int().nonnegative(),
    reversed: z.number().int().nonnegative(),
    adjusted: z.number().int(),
    ledgerSequence: z.number().int().nonnegative(),
    projectionVersion: z.number().int().positive(),
    calculatedAt: IsoTimestamp,
  })
  .strict();
export const StoredValueAuthorizationStatus = z.enum([
  'pending',
  'authorized',
  'committed',
  'released',
  'expired',
  'declined',
  'conflict',
  'reversed',
]);
export const StoredValueAccountType = z.enum(['wallet', 'gift_card']);
export const StoredValueAuthorization = z
  .object({
    id: Uuid,
    accountType: StoredValueAccountType,
    accountId: Uuid,
    customerId: Uuid.nullable(),
    currency: CurrencyCode,
    saleId: Uuid,
    checkoutVersion: z.number().int().positive(),
    amountMinorUnits: z.number().int().positive(),
    fingerprint: Fingerprint,
    status: StoredValueAuthorizationStatus,
    remainingBalanceMinorUnits: z.number().int().nonnegative(),
    createdAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export const StoredValueAuthorizationRequest = CustomerCommandContext.extend({
  accountType: StoredValueAccountType,
  accountId: Uuid,
  customerId: Uuid.nullable(),
  saleId: Uuid,
  checkoutVersion: z.number().int().positive(),
  amount: Money.refine((value) => value.minorUnits > 0),
  checkoutFingerprint: Fingerprint,
}).strict();
export const StoredValueCommit = z
  .object({
    authorization: StoredValueAuthorization,
    ledgerEntryId: Uuid,
    committedAt: IsoTimestamp,
  })
  .strict();
export const StoredValueRelease = z
  .object({ authorizationId: Uuid, status: z.literal('released'), releasedAt: IsoTimestamp })
  .strict();
export const StoredValueReversal = z
  .object({
    ledgerEntryId: Uuid,
    originalLedgerEntryId: Uuid,
    refundId: Uuid,
    amount: Money,
    reversedAt: IsoTimestamp,
  })
  .strict();

export const GiftCardStatus = z.enum([
  'created',
  'inactive',
  'active',
  'suspended',
  'depleted',
  'expired',
  'closed',
  'restricted',
]);
export const GiftCard = z
  .object({
    id: Uuid,
    publicReference: PublicReference,
    maskedCode: z.string().min(4).max(32),
    status: GiftCardStatus,
    currency: CurrencyCode,
    initialValue: Money,
    balance: WalletBalance,
    activatedAt: IsoTimestamp.nullable(),
    expiresAt: IsoTimestamp.nullable(),
    customerId: Uuid.nullable(),
    version: z.number().int().positive(),
  })
  .strict();
export const GiftCardLookupRequest = z
  .object({ locationId: Uuid, operatorSessionId: Uuid, code: z.string().min(12).max(128) })
  .strict();
export const GiftCardLookupResult = z
  .object({
    found: z.boolean(),
    retryAfterSeconds: z.number().int().nonnegative(),
    card: GiftCard.nullable(),
    reasonCode: z.enum(['available', 'unavailable', 'temporarily_locked']),
  })
  .strict();
export const GiftCardIssuanceRequest = CustomerCommandContext.extend({
  currency: CurrencyCode,
  initialValueMinorUnits: z.number().int().positive().max(10_000_000),
  source: z.enum(['sale', 'promotion', 'development']),
  saleId: Uuid.nullable().default(null),
  customerId: Uuid.nullable().default(null),
  approvalId: Uuid.nullable().default(null),
  approvalFingerprint: Fingerprint.nullable().default(null),
}).strict();
export const GiftCardIssuanceResult = z
  .object({
    card: GiftCard,
    deliveryToken: z.string().min(32).max(256),
    deliveryExpiresAt: IsoTimestamp,
    recovered: z.boolean(),
  })
  .strict();
export const GiftCardIssuancePreview = z
  .object({
    currency: CurrencyCode,
    valueMinorUnits: z.number().int().positive(),
    maximumValueMinorUnits: z.number().int().positive(),
    approvalPermission: z.string().max(100).nullable(),
    fingerprint: Fingerprint,
  })
  .strict();
export const GiftCardSecretRevealRequest = CustomerCommandContext.extend({
  deliveryToken: z.string().min(32).max(256),
}).strict();
export const GiftCardSecretRevealResult = z
  .object({
    maskedReference: PublicReference,
    code: z.string().min(12).max(128),
    expiresAt: IsoTimestamp,
  })
  .strict();
export const GiftCardActivation = CustomerCommandContext.extend({
  giftCardId: Uuid,
  initialValue: Money.refine((value) => value.minorUnits > 0),
  approvalId: Uuid.nullable(),
  approvalFingerprint: Fingerprint.nullable(),
}).strict();
export const GiftCardAuthorization = StoredValueAuthorization;
export const GiftCardRedemption = StoredValueCommit;
export const GiftCardReversal = StoredValueReversal;

export const CustomerValuePreviewRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    saleId: Uuid,
    checkoutVersion: z.number().int().positive(),
    customerId: Uuid.nullable(),
    checkoutFingerprint: Fingerprint,
  })
  .strict();
export const CustomerCheckoutSummary = z
  .object({
    customer: CustomerProfile.nullable(),
    loyaltyAccount: LoyaltyAccount.nullable(),
    points: PointsBalance.nullable(),
    wallet: WalletBalance.nullable(),
    giftCards: z.array(GiftCard).max(20),
  })
  .strict();
export const CustomerValuePreview = z
  .object({
    summary: CustomerCheckoutSummary,
    earn: PointsEarnPreview.nullable(),
    rewards: z.array(RewardEligibility).max(50),
    selectedReward: RewardAuthorization.nullable(),
    storedValueAuthorizations: z.array(StoredValueAuthorization).max(8),
    remainingBalance: Money,
    policyVersions: z.record(z.string().min(1).max(80)),
    fingerprint: Fingerprint,
  })
  .strict();
export const CustomerValueSelection = z
  .object({
    previewFingerprint: Fingerprint,
    rewardAuthorizationId: Uuid.nullable().default(null),
    storedValueAuthorizationIds: z.array(Uuid).max(8).default([]),
  })
  .strict();
export const CustomerValueCommitResult = z
  .object({
    customerId: Uuid.nullable(),
    earn: PointsEarnCommit.nullable(),
    reward: RewardRedemption.nullable(),
    storedValue: z.array(StoredValueCommit).max(8),
    recovered: z.boolean(),
  })
  .strict();
export const CustomerValueConflict = z
  .object({
    code: z.enum([
      'customer_invalid',
      'customer_changed',
      'loyalty_policy_changed',
      'loyalty_account_suspended',
      'reward_changed',
      'reward_expired',
      'reward_insufficient_points',
      'authorization_expired',
      'authorization_released',
      'stored_value_insufficient_balance',
      'stored_value_currency_mismatch',
      'gift_card_inactive',
      'value_reconciliation_required',
      'command_failed',
    ]),
    actionCode: z.string().min(1).max(100),
    requiredPermission: z.string().max(100).nullable(),
    correlationId: CorrelationId,
  })
  .strict();
export const CustomerValueRecoveryState = z.enum([
  'none',
  'pending',
  'committed',
  'released',
  'conflict',
  'support_required',
]);
export const CustomerValueRecoveryQuery = z
  .object({ locationId: Uuid, operatorSessionId: Uuid })
  .strict();
export const CustomerValueRecoveryResult = z
  .object({
    commandId: Uuid,
    state: CustomerValueRecoveryState,
    result: z.unknown().nullable(),
    conflict: CustomerValueConflict.nullable(),
    recoveredAt: IsoTimestamp,
  })
  .strict();
export const PointsAdjustmentReason = z.enum([
  'customer_service_correction',
  'migration_correction',
  'fraud_correction',
  'operational_correction',
  'expired_reward_correction',
  'authorized_other',
]);
export const PointsAdjustmentRequest = CustomerCommandContext.extend({
  customerId: Uuid,
  accountId: Uuid,
  direction: z.enum(['increase', 'decrease']),
  points: z.number().int().positive().max(1_000_000),
  reason: PointsAdjustmentReason,
  note: z.string().trim().max(240).nullable().default(null),
  approvalId: Uuid.nullable().default(null),
  approvalFingerprint: Fingerprint.nullable().default(null),
}).strict();
export const PointsAdjustmentPreview = z
  .object({
    accountId: Uuid,
    currentAvailable: z.number().int().nonnegative(),
    projectedAvailable: z.number().int().nonnegative(),
    approvalPermission: z.string().max(100).nullable(),
    fingerprint: Fingerprint,
  })
  .strict();
export const PointsAdjustmentResult = z
  .object({
    ledgerEntry: LoyaltyLedgerEntry,
    balance: PointsBalance,
    recovered: z.boolean(),
  })
  .strict();
export const AuthorizationExpiryRequest = z
  .object({ merchantId: Uuid, batchSize: z.number().int().min(1).max(500).default(100) })
  .strict();
export const AuthorizationExpiryResult = z
  .object({ expiredCount: z.number().int().nonnegative(), processedAt: IsoTimestamp })
  .strict();
export const SafeCustomerDiagnostic = z
  .object({
    merchantReference: PublicReference,
    locationReference: PublicReference,
    customerReference: PublicReference,
    loyaltySequence: z.number().int().nonnegative().nullable(),
    walletSequence: z.number().int().nonnegative().nullable(),
    unresolvedConflictCount: z.number().int().nonnegative(),
    contractVersion: z.string().min(1).max(80),
    policyVersions: z.record(z.string().min(1).max(80)),
    correlationIds: z.array(CorrelationId).max(20),
  })
  .strict();

export type CustomerProfile = z.infer<typeof CustomerProfile>;
export type CustomerSearchRequest = z.infer<typeof CustomerSearchRequest>;
export type CustomerSearchResult = z.infer<typeof CustomerSearchResult>;
export type CustomerHistoryPage = z.infer<typeof CustomerHistoryPage>;
export type CustomerHistoryQuery = z.infer<typeof CustomerHistoryQuery>;
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;
export type CustomerMergeRequest = z.infer<typeof CustomerMergeRequest>;
export type CustomerValuePreviewRequest = z.infer<typeof CustomerValuePreviewRequest>;
export type CustomerValuePreview = z.infer<typeof CustomerValuePreview>;
export type CustomerValueSelection = z.infer<typeof CustomerValueSelection>;
export type CustomerValueCommitResult = z.infer<typeof CustomerValueCommitResult>;
export type RewardAuthorization = z.infer<typeof RewardAuthorization>;
export type StoredValueAuthorization = z.infer<typeof StoredValueAuthorization>;
export type GiftCard = z.infer<typeof GiftCard>;
export type RewardAuthorizationRequest = z.infer<typeof RewardAuthorizationRequest>;
export type StoredValueAuthorizationRequest = z.infer<typeof StoredValueAuthorizationRequest>;
export type ValueReleaseRequest = z.infer<typeof ValueReleaseRequest>;
export type GiftCardLookupRequest = z.infer<typeof GiftCardLookupRequest>;
export type GiftCardLookupResult = z.infer<typeof GiftCardLookupResult>;
export type GiftCardIssuanceRequest = z.infer<typeof GiftCardIssuanceRequest>;
export type GiftCardIssuanceResult = z.infer<typeof GiftCardIssuanceResult>;
export type GiftCardIssuancePreview = z.infer<typeof GiftCardIssuancePreview>;
export type GiftCardSecretRevealRequest = z.infer<typeof GiftCardSecretRevealRequest>;
export type GiftCardSecretRevealResult = z.infer<typeof GiftCardSecretRevealResult>;
export type PointsAdjustmentRequest = z.infer<typeof PointsAdjustmentRequest>;
export type PointsAdjustmentPreview = z.infer<typeof PointsAdjustmentPreview>;
export type PointsAdjustmentResult = z.infer<typeof PointsAdjustmentResult>;
export type GiftCardActivation = z.infer<typeof GiftCardActivation>;
export type CustomerValueRecoveryQuery = z.infer<typeof CustomerValueRecoveryQuery>;
export type CustomerValueRecoveryResult = z.infer<typeof CustomerValueRecoveryResult>;

export const posCustomerValueModels = {
  CustomerStatus,
  CustomerContactType,
  CustomerContactVerification,
  CustomerContact,
  CustomerPrivacyPreference,
  ConsentType,
  ConsentStatus,
  ConsentEvidence,
  CustomerConsent,
  CustomerProfile,
  Customer,
  CustomerSearchRequest,
  CustomerSearchResult,
  CustomerMatchCandidate,
  CustomerAttachment,
  CustomerHistoryEntry,
  CustomerHistoryPage,
  CustomerHistoryQuery,
  CustomerMergeCandidate,
  CustomerCommandContext,
  CreateCustomerRequest,
  CustomerMergeRequest,
  CustomerMergeResult,
  LoyaltyAccountStatus,
  LoyaltyAccount,
  LoyaltyPolicy,
  LoyaltyLedgerEntryType,
  LoyaltyLedgerEntry,
  PointsBalance,
  PointsEarnPreview,
  PointsEarnCommit,
  RewardType,
  Reward,
  RewardEligibility,
  RewardAuthorizationStatus,
  RewardAuthorization,
  RewardAuthorizationRequest,
  ValueReleaseRequest,
  RewardRedemption,
  RewardRelease,
  RewardReversal,
  WalletStatus,
  WalletAccount,
  WalletLedgerEntryType,
  WalletLedgerEntry,
  WalletBalance,
  StoredValueAuthorizationStatus,
  StoredValueAccountType,
  StoredValueAuthorization,
  StoredValueAuthorizationRequest,
  StoredValueCommit,
  StoredValueRelease,
  StoredValueReversal,
  GiftCardStatus,
  GiftCard,
  GiftCardLookupRequest,
  GiftCardLookupResult,
  GiftCardIssuanceRequest,
  GiftCardIssuanceResult,
  GiftCardIssuancePreview,
  GiftCardSecretRevealRequest,
  GiftCardSecretRevealResult,
  GiftCardActivation,
  GiftCardAuthorization,
  GiftCardRedemption,
  GiftCardReversal,
  CustomerValuePreviewRequest,
  CustomerCheckoutSummary,
  CustomerValuePreview,
  CustomerValueSelection,
  CustomerValueCommitResult,
  CustomerValueConflict,
  CustomerValueRecoveryState,
  CustomerValueRecoveryQuery,
  CustomerValueRecoveryResult,
  PointsAdjustmentReason,
  PointsAdjustmentRequest,
  PointsAdjustmentPreview,
  PointsAdjustmentResult,
  AuthorizationExpiryRequest,
  AuthorizationExpiryResult,
  SafeCustomerDiagnostic,
};
