import { z } from 'zod';

export const Uuid = z.string().uuid();
export const IsoTimestamp = z.string().datetime({ offset: true });
export const BusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
export const CorrelationId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
export const OpaqueCursor = z.string().min(1).max(512);
export const JsonPayload = z.record(z.unknown());

export const Money = z
  .object({
    minorUnits: z.number().int().safe(),
    currency: CurrencyCode,
  })
  .strict();
export type Money = z.infer<typeof Money>;

export const PageRequest = z
  .object({
    limit: z.number().int().min(1).max(100).default(25),
    cursor: OpaqueCursor.optional(),
  })
  .strict();
export type PageRequest = z.infer<typeof PageRequest>;

export const PageInfo = z
  .object({
    limit: z.number().int().min(1).max(100),
    hasMore: z.boolean(),
    nextCursor: OpaqueCursor.nullable(),
  })
  .strict();
export type PageInfo = z.infer<typeof PageInfo>;

export const Identity = z
  .object({
    id: Uuid,
    email: z.string().email(),
    displayName: z.string().min(1).max(160).nullable(),
  })
  .strict();
export type Identity = z.infer<typeof Identity>;

export const SessionApplication = z.enum(['dashboard', 'kds', 'pos']);
export type SessionApplication = z.infer<typeof SessionApplication>;

export const DeviceAuthContext = z
  .object({
    deviceId: Uuid.nullable(),
    application: SessionApplication,
  })
  .strict();
export type DeviceAuthContext = z.infer<typeof DeviceAuthContext>;

export const DurableSession = z
  .object({
    sessionId: Uuid,
    userId: Uuid,
    deviceId: Uuid.nullable(),
    application: SessionApplication,
    issuedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    lastSeenAt: IsoTimestamp.nullable(),
    revokedAt: IsoTimestamp.nullable(),
  })
  .strict();
export type DurableSession = z.infer<typeof DurableSession>;

export const Membership = z
  .object({
    membershipId: Uuid.nullable(),
    userId: Uuid,
    tenantId: Uuid,
    branchIds: z.array(Uuid).max(500),
    allBranches: z.boolean(),
    roles: z.array(z.string().min(1).max(100)).max(50),
    permissions: z.array(z.string().min(1).max(100)).max(500),
  })
  .strict();
export type Membership = z.infer<typeof Membership>;

export const StaffIdentity = z
  .object({
    staffId: Uuid,
    identity: Identity,
    tenantId: Uuid,
    branchId: Uuid.nullable(),
    position: z.string().max(160).nullable(),
    status: z.enum(['active', 'inactive']),
  })
  .strict();
export type StaffIdentity = z.infer<typeof StaffIdentity>;

export const AuthorizationDecision = z
  .object({
    allowed: z.boolean(),
    reason: z.enum([
      'granted',
      'explicit_deny',
      'missing_permission',
      'missing_entitlement',
      'tenant_scope',
      'branch_scope',
      'elevation_required',
    ]),
    permission: z.string().min(1).max(100),
    tenantId: Uuid,
    branchId: Uuid.nullable(),
  })
  .strict();
export type AuthorizationDecision = z.infer<typeof AuthorizationDecision>;

export const EffectiveEntitlement = z
  .object({
    featureKey: z.string().min(1).max(160),
    enabled: z.boolean(),
    limit: z.number().int().nonnegative().nullable(),
    subscriptionStatus: z.enum(['trialing', 'active', 'past_due', 'canceled']),
  })
  .strict();
export type EffectiveEntitlement = z.infer<typeof EffectiveEntitlement>;

export const ElevationRequirement = z
  .object({
    permission: z.string().min(1).max(100),
    method: z.enum(['manager_approval', 'operator_pin']),
    freshWithinSeconds: z.number().int().positive().max(900),
  })
  .strict();
export type ElevationRequirement = z.infer<typeof ElevationRequirement>;

export const BusinessFailureClass = z.enum([
  'validation',
  'authorization',
  'conflict',
  'transient',
  'permanent',
  'unknown_outcome',
]);
export type BusinessFailureClass = z.infer<typeof BusinessFailureClass>;

export const BusinessCommandResult = z
  .object({
    commandId: Uuid,
    status: z.enum(['succeeded', 'failed']),
    duplicate: z.boolean(),
    retryable: z.boolean(),
    result: JsonPayload.nullable(),
    failureCode: z.string().min(1).max(100).nullable(),
    failureClass: BusinessFailureClass.nullable(),
    correlationId: CorrelationId,
  })
  .strict();
export type BusinessCommandResult = z.infer<typeof BusinessCommandResult>;

export const AuditEventView = z
  .object({
    id: Uuid,
    tenantId: Uuid,
    branchId: Uuid.nullable(),
    eventType: z.string().min(1).max(160),
    entityType: z.string().min(1).max(160),
    entityId: Uuid.nullable(),
    outcome: z.enum(['success', 'denied', 'failure']),
    reasonCode: z.string().min(1).max(160).nullable(),
    data: JsonPayload,
    correlationId: CorrelationId,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditSearchRequest = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    before: IsoTimestamp.optional(),
    eventType: z.string().min(1).max(160).optional(),
    entityType: z.string().min(1).max(160).optional(),
    entityId: Uuid.optional(),
    correlationId: CorrelationId.optional(),
  })
  .strict();
export type AuditSearchRequest = z.infer<typeof AuditSearchRequest>;

export const AuditSearchResponse = z
  .object({
    events: z.array(AuditEventView).max(100),
    page: PageInfo,
  })
  .strict();
export type AuditSearchResponse = z.infer<typeof AuditSearchResponse>;

export const FinancialEvent = z
  .object({
    id: Uuid,
    commandId: Uuid,
    tenantId: Uuid,
    branchId: Uuid.nullable(),
    aggregateType: z.string().min(1).max(160),
    aggregateId: Uuid,
    aggregateVersion: z.number().int().positive(),
    eventType: z.string().min(1).max(160),
    amount: Money,
    compensatesEventId: Uuid.nullable(),
    data: JsonPayload,
    correlationId: CorrelationId,
    occurredAt: IsoTimestamp,
  })
  .strict();
export type FinancialEvent = z.infer<typeof FinancialEvent>;

export const TenantContext = z
  .object({
    tenantId: Uuid,
  })
  .strict();
export type TenantContext = z.infer<typeof TenantContext>;

export const BranchContext = TenantContext.extend({
  branchId: Uuid,
}).strict();
export type BranchContext = z.infer<typeof BranchContext>;

export const OperatorContext = BranchContext.extend({
  operatorId: Uuid,
  operatorSessionId: Uuid,
  permissions: z.array(z.string().min(1).max(100)).max(200),
}).strict();
export type OperatorContext = z.infer<typeof OperatorContext>;

export const TenantSummaryModel = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(100).nullable(),
    locale: z.string().min(2).max(20),
    currency: CurrencyCode,
  })
  .strict();
export type TenantSummaryModel = z.infer<typeof TenantSummaryModel>;

export const BranchSummaryModel = z
  .object({
    id: Uuid,
    tenantId: Uuid,
    name: z.string().min(1).max(160),
    timezone: z.string().min(1).max(100).nullable(),
    status: z.enum(['active', 'closed']),
  })
  .strict();
export type BranchSummaryModel = z.infer<typeof BranchSummaryModel>;

export const OptimisticVersion = z
  .object({
    version: z.number().int().nonnegative(),
  })
  .strict();
export type OptimisticVersion = z.infer<typeof OptimisticVersion>;

export const IdempotencyMetadata = z
  .object({
    commandId: Uuid,
    idempotencyKey: z.string().min(8).max(128),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type IdempotencyMetadata = z.infer<typeof IdempotencyMetadata>;

export const CompensationRequest = z
  .object({
    command: IdempotencyMetadata,
    originalEventId: Uuid,
    reasonCode: z.string().min(1).max(160),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
export type CompensationRequest = z.infer<typeof CompensationRequest>;

export const CorrelationMetadata = z
  .object({
    correlationId: CorrelationId,
    requestId: CorrelationId,
  })
  .strict();
export type CorrelationMetadata = z.infer<typeof CorrelationMetadata>;

export const AuditMetadata = z
  .object({
    actorType: z.enum(['operator', 'manager', 'device', 'service']),
    actorId: Uuid,
    occurredAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type AuditMetadata = z.infer<typeof AuditMetadata>;

export const OfflineCommandEnvelope = z
  .object({
    commandId: Uuid,
    deviceId: Uuid,
    tenantId: Uuid,
    branchId: Uuid,
    operatorSessionId: Uuid,
    sequence: z.number().int().positive(),
    issuedAt: IsoTimestamp,
    commandType: z.string().min(1).max(100),
    payload: JsonPayload,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    optimisticVersion: z.number().int().nonnegative().optional(),
  })
  .strict();
export type OfflineCommandEnvelope = z.infer<typeof OfflineCommandEnvelope>;

export const ReconciliationItem = z
  .object({
    commandId: Uuid,
    status: z.enum(['accepted', 'duplicate', 'rejected', 'conflict', 'pending']),
    resultRef: z.string().min(1).max(200).nullable(),
    errorCode: z.string().min(1).max(100).nullable(),
  })
  .strict();
export type ReconciliationItem = z.infer<typeof ReconciliationItem>;

export const ReconciliationResponse = z
  .object({
    batchId: Uuid,
    acceptedThroughSequence: z.number().int().nonnegative(),
    items: z.array(ReconciliationItem).max(500),
    nextCursor: OpaqueCursor.nullable(),
  })
  .strict();
export type ReconciliationResponse = z.infer<typeof ReconciliationResponse>;

export const ReceiptLineSnapshot = z
  .object({
    lineRef: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    quantity: z.number().int().positive(),
    unitPrice: Money,
    lineTotal: Money,
    variantName: z.string().min(1).max(160).nullable().optional(),
    modifiers: z.array(z.string().min(1).max(160)).max(100).optional(),
    tax: Money.optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();
export type ReceiptLineSnapshot = z.infer<typeof ReceiptLineSnapshot>;

export const ReceiptSnapshot = z
  .object({
    receiptRef: z.string().min(1).max(100),
    tenantId: Uuid,
    branchId: Uuid,
    issuedAt: IsoTimestamp,
    businessDate: BusinessDate,
    lines: z.array(ReceiptLineSnapshot).min(1).max(500),
    subtotal: Money,
    taxTotal: Money,
    grandTotal: Money,
    currency: CurrencyCode,
    version: z.number().int().positive(),
    tenantName: z.string().min(1).max(240).optional(),
    branchName: z.string().min(1).max(240).optional(),
    operatorName: z.string().min(1).max(240).optional(),
    payment: z
      .object({
        method: z.enum(['cash', 'external_terminal', 'card', 'stored_value', 'gift_card']),
        status: z.enum(['succeeded', 'captured']),
        reference: z.string().min(1).max(100),
        amount: Money,
      })
      .strict()
      .optional(),
    discountTotal: Money.optional(),
  })
  .strict();
export type ReceiptSnapshot = z.infer<typeof ReceiptSnapshot>;

export const PaymentAmbiguity = z
  .object({
    paymentRef: z.string().min(1).max(100),
    status: z.enum(['pending', 'confirmed', 'declined', 'unknown']),
    queryOnly: z.boolean(),
    canRetryAsNew: z.boolean(),
    queryAfter: IsoTimestamp.nullable(),
    correlationId: CorrelationId,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'unknown' && (!value.queryOnly || value.canRetryAsNew)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An unknown payment outcome must be query-only and cannot be retried as new.',
      });
    }
  });
export type PaymentAmbiguity = z.infer<typeof PaymentAmbiguity>;

export const API_ERROR_CODES = [
  'VALIDATION_FAILED',
  'AUTHENTICATION_REQUIRED',
  'PERMISSION_DENIED',
  'TENANT_NOT_FOUND',
  'BRANCH_NOT_FOUND',
  'BRANCH_REQUIRED',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'COMMAND_IN_PROGRESS',
  'OPTIMISTIC_VERSION_CONFLICT',
  'RATE_LIMITED',
  'DEVICE_REVOKED',
  'DEVICE_NOT_ALLOWED',
  'DEVICE_NOT_ENROLLED',
  'DEVICE_CREDENTIAL_INVALID',
  'DEVICE_ROTATION_REQUIRED',
  'ENROLLMENT_EXPIRED',
  'ENROLLMENT_REJECTED',
  'ENROLLMENT_ATTEMPTS_EXCEEDED',
  'TENANT_DISABLED',
  'BRANCH_DISABLED',
  'OPERATOR_SESSION_REQUIRED',
  'CART_VALIDATION_FAILED',
  'CART_NOT_FOUND',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_NOT_AVAILABLE',
  'MODIFIER_SELECTION_INVALID',
  'CHECKOUT_GATE_NOT_AVAILABLE',
  'CHECKOUT_CONFIRMATION_REQUIRED',
  'CHECKOUT_CART_CHANGED',
  'INVENTORY_UNAVAILABLE',
  'PAYMENT_DECLINED',
  'PAYMENT_UNKNOWN',
  'PAYMENT_TIMEOUT',
  'RECEIPT_CREATION_FAILED',
  'OPERATOR_LOCKED',
  'PIN_LOCKED',
  'SESSION_REVOKED',
  'ELEVATION_REQUIRED',
  'AUDIT_INTEGRITY_FAILURE',
  'PAYMENT_OUTCOME_UNKNOWN',
  'RESOURCE_NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export const ApiError = z
  .object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    correlationId: CorrelationId,
    fieldErrors: z.record(z.array(z.string().max(300)).max(20)).optional(),
  })
  .strict();
export type ApiError = z.infer<typeof ApiError>;

export const ApiErrorEnvelope = z
  .object({
    error: ApiError,
  })
  .strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

export const contractModels = {
  Money,
  PageRequest,
  PageInfo,
  Identity,
  SessionApplication,
  DeviceAuthContext,
  DurableSession,
  Membership,
  StaffIdentity,
  AuthorizationDecision,
  EffectiveEntitlement,
  ElevationRequirement,
  BusinessFailureClass,
  BusinessCommandResult,
  AuditEventView,
  AuditSearchRequest,
  AuditSearchResponse,
  FinancialEvent,
  CompensationRequest,
  TenantContext,
  BranchContext,
  OperatorContext,
  TenantSummaryModel,
  BranchSummaryModel,
  OptimisticVersion,
  IdempotencyMetadata,
  CorrelationMetadata,
  AuditMetadata,
  OfflineCommandEnvelope,
  ReconciliationItem,
  ReconciliationResponse,
  ReceiptLineSnapshot,
  ReceiptSnapshot,
  PaymentAmbiguity,
  ApiError,
  ApiErrorEnvelope,
} as const;
