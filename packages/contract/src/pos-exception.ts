import { z } from 'zod';
import { CorrelationId, IsoTimestamp, MerchantDate, Money, Uuid } from './platform';

const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const NonNegativeMoney = Money.refine(
  (value) => value.minorUnits >= 0,
  'Amount must not be negative.',
);
const PositiveMoney = Money.refine((value) => value.minorUnits > 0, 'Amount must be positive.');
const SafeNote = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^<>]*$/)
  .nullable();

export const SaleExceptionType = z.enum([
  'void',
  'full_refund',
  'partial_refund',
  'payment_correction_required',
  'support_required',
]);
export const SaleExceptionStatus = z.enum([
  'draft',
  'eligibility_checking',
  'preview_ready',
  'approval_required',
  'ready_for_commit',
  'committing',
  'committed',
  'rejected',
  'outcome_unknown',
  'reconciliation_required',
  'recovered',
]);
export const RefundScope = z.enum(['full_remaining', 'selected_lines']);
export const RefundReason = z.enum([
  'customer_changed_mind',
  'product_defect',
  'incorrect_item',
  'incorrect_quantity',
  'duplicate_charge',
  'service_not_delivered',
  'quality_issue',
  'order_preparation_error',
  'pricing_error',
  'payment_correction',
  'other_approved_reason',
]);
export const VoidReason = z.enum([
  'operator_error',
  'duplicate_sale',
  'incorrect_tender',
  'sale_entered_by_mistake',
  'system_recovery',
  'other_approved_reason',
]);
export const ExceptionReason = z.union([RefundReason, VoidReason]);
export const RestockDecision = z.enum([
  'restock',
  'do_not_restock',
  'inspection_required',
  'not_applicable',
  'unknown_until_inventory_review',
]);
export const PaymentReversalStatus = z.enum([
  'not_started',
  'operator_processing_externally',
  'awaiting_operator_confirmation',
  'confirmed_success',
  'operator_reported_failure',
  'outcome_unknown',
  'cancelled_before_confirmation',
]);
export const PaymentReversalOutcome = z.enum([
  'confirmed_success',
  'operator_reported_failure',
  'outcome_unknown',
]);

export const RefundableQuantity = z
  .object({
    original: z.number().int().positive().max(100_000),
    previouslyRefunded: z.number().int().min(0).max(100_000),
    remaining: z.number().int().min(0).max(100_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.original - value.previouslyRefunded !== value.remaining) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The refundable quantity is invalid.',
      });
    }
  });

export const RefundableAmount = z
  .object({
    original: NonNegativeMoney,
    previouslyCompensated: NonNegativeMoney,
    remaining: NonNegativeMoney,
  })
  .strict()
  .superRefine((value, context) => {
    const currencies = [
      value.original.currency,
      value.previouslyCompensated.currency,
      value.remaining.currency,
    ];
    if (
      new Set(currencies).size !== 1 ||
      value.original.minorUnits - value.previouslyCompensated.minorUnits !==
        value.remaining.minorUnits
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The refundable amount is invalid.',
      });
    }
  });

export const RefundableLine = z
  .object({
    saleLineId: Uuid,
    productPublicReference: z.string().trim().min(1).max(80),
    displayName: z.string().trim().min(1).max(160),
    quantity: RefundableQuantity,
    merchandise: RefundableAmount,
    tax: RefundableAmount,
    discount: RefundableAmount,
    isService: z.boolean(),
    restockOptions: z.array(RestockDecision).min(1).max(5),
  })
  .strict();

export const RefundableSale = z
  .object({
    saleId: Uuid,
    receiptId: Uuid,
    receiptReference: z.string().min(1).max(80),
    businessDate: MerchantDate,
    committedAt: IsoTimestamp,
    version: z.number().int().positive(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/),
    originalTotal: NonNegativeMoney,
    previouslyRefunded: NonNegativeMoney,
    remainingRefundable: NonNegativeMoney,
  })
  .strict();

export const VoidEligibility = z
  .object({
    allowed: z.boolean(),
    reasonRequired: z.boolean(),
    approvalRequired: z.boolean(),
    blockCodes: z.array(z.string().min(1).max(80)).max(16),
    expiresAt: IsoTimestamp.nullable(),
  })
  .strict();

export const RefundEligibility = z
  .object({
    allowed: z.boolean(),
    fullRefundAllowed: z.boolean(),
    partialRefundAllowed: z.boolean(),
    cashRefundAllowed: z.boolean(),
    manualTerminalRefundAllowed: z.boolean(),
    approvalRequired: z.boolean(),
    approvalThreshold: NonNegativeMoney,
    lines: z.array(RefundableLine).max(500),
    refundableTax: RefundableAmount,
    refundableDiscount: RefundableAmount,
    refundableTip: RefundableAmount,
    blockCodes: z.array(z.string().min(1).max(80)).max(16),
    supportCodes: z.array(z.string().min(1).max(80)).max(16),
  })
  .strict();

export const SaleExceptionEligibilityQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();

export const SaleExceptionEligibility = z
  .object({
    sale: RefundableSale,
    allowedTypes: z.array(SaleExceptionType).max(5),
    refund: RefundEligibility,
    voidEligibility: VoidEligibility,
    allocationPolicy: z.enum(['proportional', 'terminal_first', 'cash_first']),
    tipPolicy: z.enum([
      'non_refundable',
      'full_refund_only',
      'proportional',
      'manager_selectable',
      'support_required',
    ]),
    onlineRequired: z.literal(true),
    correlationReference: CorrelationId,
  })
  .strict();

export const RefundLineRequest = z
  .object({
    saleLineId: Uuid,
    quantity: z.number().int().positive().max(100_000),
    restockDecision: RestockDecision,
  })
  .strict();

export const RefundPreviewRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    exceptionType: z.enum(['void', 'full_refund', 'partial_refund']),
    reason: ExceptionReason,
    note: SafeNote,
    lines: z.array(RefundLineRequest).max(500),
    expectedSaleVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.lines.map((line) => line.saleLineId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A sale line can be selected once.',
      });
    }
    if (value.exceptionType === 'partial_refund' && value.lines.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select one or more sale lines.' });
    }
  });

export const RefundLinePreview = z
  .object({
    saleLineId: Uuid,
    quantity: z.number().int().positive(),
    merchandise: NonNegativeMoney,
    tax: NonNegativeMoney,
    discount: NonNegativeMoney,
    tip: NonNegativeMoney,
    total: NonNegativeMoney,
    restockDecision: RestockDecision,
  })
  .strict();

export const RefundAllocation = z
  .object({
    merchandise: NonNegativeMoney,
    tax: NonNegativeMoney,
    discount: NonNegativeMoney,
    tip: NonNegativeMoney,
    total: NonNegativeMoney,
  })
  .strict();
export const TaxRefundAllocation = z
  .object({ amount: NonNegativeMoney, historical: z.literal(true) })
  .strict();
export const DiscountRefundAllocation = z
  .object({ amount: NonNegativeMoney, historical: z.literal(true) })
  .strict();
export const TipRefundAllocation = z
  .object({
    amount: NonNegativeMoney,
    policy: z.enum([
      'non_refundable',
      'full_refund_only',
      'proportional',
      'manager_selectable',
      'support_required',
    ]),
  })
  .strict();
export const TenderRefundAllocation = z
  .object({
    originalTenderId: Uuid,
    tenderType: z.enum(['cash', 'manual_terminal']),
    amount: PositiveMoney,
    strategy: z.enum(['proportional', 'terminal_first', 'cash_first']),
  })
  .strict();

export const CashRefundInstruction = z
  .object({
    amount: PositiveMoney,
    currentShiftId: Uuid,
    currentRegisterId: Uuid,
    approvalRequired: z.boolean(),
    expectedCashAfter: NonNegativeMoney.nullable(),
  })
  .strict();

export const ManualTerminalRefundInstruction = z
  .object({
    status: PaymentReversalStatus,
    amount: PositiveMoney,
    correlationReference: CorrelationId,
    queryOnly: z.boolean(),
    canRetryAsNew: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'outcome_unknown' && (!value.queryOnly || value.canRetryAsNew)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An unknown outcome is query-only.',
      });
    }
  });

export const RefundPreview = z
  .object({
    previewId: Uuid,
    saleId: Uuid,
    originalReceiptId: Uuid,
    exceptionType: z.enum(['void', 'full_refund', 'partial_refund']),
    status: z.literal('preview_ready'),
    lines: z.array(RefundLinePreview).min(1).max(500),
    allocation: RefundAllocation,
    tax: TaxRefundAllocation,
    discount: DiscountRefundAllocation,
    tip: TipRefundAllocation,
    tenders: z.array(TenderRefundAllocation).min(1).max(16),
    cash: CashRefundInstruction.nullable(),
    manualTerminal: ManualTerminalRefundInstruction.nullable(),
    remainingRefundableAfter: NonNegativeMoney,
    approvalRequired: z.boolean(),
    reason: ExceptionReason,
    previewFingerprint: Fingerprint,
    expiresAt: IsoTimestamp,
    saleVersion: z.number().int().positive(),
    exceptionVersion: z.number().int().min(0),
    correlationReference: CorrelationId,
  })
  .strict();

export const RefundApprovalRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    saleId: Uuid,
    previewId: Uuid,
    commandId: Uuid,
    previewFingerprint: Fingerprint,
    commandFingerprint: Fingerprint,
    managerPin: z.string().regex(/^\d{4,8}$/),
  })
  .strict();
export const RefundApprovalResult = z
  .object({
    approvalId: Uuid,
    approvingOperatorReference: z.string().min(1).max(80),
    previewFingerprint: Fingerprint,
    expiresAt: IsoTimestamp,
    oneUse: z.literal(true),
  })
  .strict();

export const SaleExceptionCommand = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    previewId: Uuid,
    previewFingerprint: Fingerprint,
    approvalId: Uuid.nullable(),
    expectedSaleVersion: z.number().int().positive(),
    commandId: Uuid,
    idempotencyKey: Uuid,
    offline: z.literal(false).default(false),
  })
  .strict();

export const ExceptionReceiptLine = RefundLinePreview;
export const CompensatingReceipt = z
  .object({
    id: Uuid,
    publicReference: z.string().min(1).max(80),
    exceptionType: z.enum(['void', 'full_refund', 'partial_refund']),
    originalSaleReference: z.string().min(1).max(80),
    originalReceiptReference: z.string().min(1).max(80),
    originalBusinessDate: MerchantDate,
    exceptionBusinessDate: MerchantDate,
    merchantDisplayName: z.string().min(1).max(160),
    locationDisplayName: z.string().min(1).max(160),
    operatorReference: z.string().min(1).max(80),
    approvingOperatorReference: z.string().min(1).max(80).nullable(),
    lines: z.array(ExceptionReceiptLine).min(1).max(500),
    allocation: RefundAllocation,
    tenders: z.array(TenderRefundAllocation).min(1).max(16),
    terminalStatus: PaymentReversalStatus.nullable(),
    reason: ExceptionReason,
    createdAt: IsoTimestamp,
    correlationReference: CorrelationId,
  })
  .strict();

export const SaleExceptionResult = z
  .object({
    exceptionId: Uuid,
    saleId: Uuid,
    status: z.enum(['committed', 'outcome_unknown', 'reconciliation_required', 'recovered']),
    exceptionType: z.enum(['void', 'full_refund', 'partial_refund']),
    allocation: RefundAllocation,
    receipt: CompensatingReceipt.nullable(),
    remainingRefundable: NonNegativeMoney,
    correlationReference: CorrelationId,
    committedAt: IsoTimestamp.nullable(),
    retryAllowed: z.literal(false),
  })
  .strict();

export const ManualTerminalRefundOutcomeRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    outcome: PaymentReversalOutcome,
    commandId: Uuid,
    idempotencyKey: Uuid,
  })
  .strict();
export const ManualTerminalRefundOutcomeResult = z
  .object({
    previewId: Uuid,
    status: PaymentReversalStatus,
    instruction: ManualTerminalRefundInstruction,
    updatedAt: IsoTimestamp,
    correlationReference: CorrelationId,
  })
  .strict();

export const ExceptionHistoryEntry = z
  .object({
    exceptionId: Uuid,
    exceptionType: z.enum(['void', 'full_refund', 'partial_refund']),
    status: SaleExceptionStatus,
    reason: ExceptionReason,
    amount: NonNegativeMoney,
    operatorReference: z.string().min(1).max(80),
    approvingOperatorReference: z.string().min(1).max(80).nullable(),
    receiptReference: z.string().min(1).max(80).nullable(),
    createdAt: IsoTimestamp,
  })
  .strict();
export const ExceptionHistory = z
  .object({
    sale: RefundableSale,
    entries: z.array(ExceptionHistoryEntry).max(100),
    nextCursor: z.string().max(256).nullable(),
  })
  .strict();

export const ExceptionRecoveryState = z.enum([
  'none',
  'query_original_command',
  'preview_expired',
  'approval_expired',
  'outcome_unknown',
  'reconciliation_required',
  'committed_result_available',
  'credential_rotated',
  'permission_revoked',
  'support_required',
]);
export const ExceptionCommandRecoveryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandId: Uuid,
    idempotencyKey: Uuid,
  })
  .strict();
export const ExceptionCommandRecoveryResult = z
  .object({
    state: ExceptionRecoveryState,
    result: SaleExceptionResult.nullable(),
    terminalOutcome: ManualTerminalRefundOutcomeResult.nullable(),
    commandType: z.enum(['exception_commit', 'terminal_outcome']).nullable(),
    queryOnly: z.boolean(),
    safeAction: z.enum([
      'return_to_sale',
      'refresh_preview',
      'query_again',
      'verify_terminal',
      'contact_support',
    ]),
  })
  .strict();
export const ExceptionConflict = z
  .object({
    code: z.enum([
      'stale_preview',
      'sale_changed',
      'already_compensated',
      'fingerprint_mismatch',
      'outcome_unknown',
    ]),
    state: ExceptionRecoveryState,
    retryable: z.boolean(),
  })
  .strict();
export const SafeExceptionDiagnostic = z
  .object({
    exceptionReference: z.string().min(1).max(80).nullable(),
    commandId: Uuid,
    correlationReference: CorrelationId,
    state: SaleExceptionStatus,
    outcomeCode: z.string().min(1).max(80),
  })
  .strict();

export type SaleExceptionCommand = z.infer<typeof SaleExceptionCommand>;
export type SaleExceptionResult = z.infer<typeof SaleExceptionResult>;
export type RefundPreviewRequest = z.infer<typeof RefundPreviewRequest>;
export type RefundPreview = z.infer<typeof RefundPreview>;
export type SaleExceptionEligibilityQuery = z.infer<typeof SaleExceptionEligibilityQuery>;
export type SaleExceptionEligibility = z.infer<typeof SaleExceptionEligibility>;
export type ExceptionCommandRecoveryQuery = z.infer<typeof ExceptionCommandRecoveryQuery>;
export type ExceptionCommandRecoveryResult = z.infer<typeof ExceptionCommandRecoveryResult>;
export type RefundApprovalRequest = z.infer<typeof RefundApprovalRequest>;
export type RefundApprovalResult = z.infer<typeof RefundApprovalResult>;
export type ManualTerminalRefundOutcomeRequest = z.infer<typeof ManualTerminalRefundOutcomeRequest>;
export type ManualTerminalRefundOutcomeResult = z.infer<typeof ManualTerminalRefundOutcomeResult>;
export type ExceptionHistory = z.infer<typeof ExceptionHistory>;

export const posExceptionModels = {
  SaleExceptionType,
  SaleExceptionStatus,
  VoidEligibility,
  RefundEligibility,
  RefundableSale,
  RefundableLine,
  RefundableQuantity,
  RefundableAmount,
  ExceptionReason,
  VoidReason,
  RefundReason,
  RefundScope,
  RefundLineRequest,
  RefundLinePreview,
  RefundPreviewRequest,
  RefundPreview,
  RefundAllocation,
  TaxRefundAllocation,
  DiscountRefundAllocation,
  TipRefundAllocation,
  TenderRefundAllocation,
  CashRefundInstruction,
  ManualTerminalRefundInstruction,
  PaymentReversalStatus,
  PaymentReversalOutcome,
  RefundApprovalRequest,
  RefundApprovalResult,
  RestockDecision,
  SaleExceptionEligibilityQuery,
  SaleExceptionEligibility,
  SaleExceptionCommand,
  SaleExceptionResult,
  ManualTerminalRefundOutcomeRequest,
  ManualTerminalRefundOutcomeResult,
  CompensatingReceipt,
  ExceptionReceiptLine,
  ExceptionHistoryEntry,
  ExceptionHistory,
  ExceptionRecoveryState,
  ExceptionCommandRecoveryQuery,
  ExceptionCommandRecoveryResult,
  ExceptionConflict,
  SafeExceptionDiagnostic,
};
