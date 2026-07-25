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
  'OPTIMISTIC_VERSION_CONFLICT',
  'RATE_LIMITED',
  'DEVICE_REVOKED',
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
