import { z } from 'zod';
import {
  MerchantDate,
  CorrelationId,
  CurrencyCode,
  IsoTimestamp,
  Money,
  PaymentAmbiguity,
  ReceiptSnapshot,
  Uuid,
} from './platform';
import { CartItem, DiscountPreview, TotalsPreview } from './pos-cart';

export const PaymentMethod = z.enum(['cash', 'external_terminal']);
export const CheckoutState = z.enum([
  'ready',
  'selecting_tender',
  'collecting_payment',
  'awaiting_authorization',
  'payment_accepted',
  'payment_rejected',
  'payment_unknown',
  'receipt_available',
  'completed',
  'recovered',
]);
export const TenderType = z.enum(['cash', 'manual_terminal']);
export const TenderStatus = z.enum([
  'draft',
  'operator_processing_externally',
  'awaiting_operator_confirmation',
  'confirmed_success',
  'operator_reported_failure',
  'outcome_unknown',
  'cancelled_before_confirmation',
  'committed',
]);
export const ManualTerminalOutcome = z.enum([
  'not_started',
  'operator_processing_externally',
  'awaiting_operator_confirmation',
  'confirmed_success',
  'operator_reported_failure',
  'outcome_unknown',
  'cancelled_before_confirmation',
]);
export const PartialPaymentState = z.enum([
  'no_tender_applied',
  'partially_covered',
  'fully_covered',
  'overpayment_invalid',
]);
export const TenderDraft = z
  .object({
    id: Uuid,
    type: TenderType,
    amount: Money.refine((value) => value.minorUnits > 0, 'Tender amount must be positive.'),
    amountReceived: Money.nullable().default(null),
    status: TenderStatus.default('draft'),
    correlationId: CorrelationId.nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.amountReceived && value.amountReceived.currency !== value.amount.currency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tender currencies must match.' });
    }
    if (value.type === 'manual_terminal' && value.amountReceived !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A manual terminal tender cannot include cash received.',
      });
    }
  });
export const TenderAllocation = z
  .object({
    tenderId: Uuid,
    type: TenderType,
    applied: Money,
    received: Money.nullable(),
    change: Money,
    status: TenderStatus,
  })
  .strict();
export const CashTenderInput = z
  .object({
    tenderId: Uuid,
    amount: Money.refine((value) => value.minorUnits > 0, 'Cash amount must be positive.'),
    amountReceived: Money.refine(
      (value) => value.minorUnits > 0,
      'Cash received must be positive.',
    ),
  })
  .strict();
export const CashTenderPreview = z
  .object({
    allocation: TenderAllocation,
    amountDue: Money,
    remainingBalance: Money,
  })
  .strict();
export const ManualTerminalAttempt = z
  .object({
    tenderId: Uuid,
    outcome: ManualTerminalOutcome,
    correlationId: CorrelationId,
    queryOnly: z.boolean(),
    updatedAt: IsoTimestamp,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'outcome_unknown' && !value.queryOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An unknown terminal outcome must be query-only.',
      });
    }
  });
export const TipPolicy = z
  .object({
    enabled: z.boolean(),
    presetBasisPoints: z.array(z.number().int().min(0).max(10000)).max(8),
    customPercentageEnabled: z.boolean(),
    customFixedEnabled: z.boolean(),
    maximumTip: Money,
    requiredPermission: z.string().min(1).max(100).nullable(),
    version: z.string().min(1).max(64),
  })
  .strict();
export const TipDraft = z
  .object({
    kind: z.enum(['none', 'percentage', 'fixed']),
    basisPoints: z.number().int().min(0).max(10000).nullable(),
    fixedAmount: Money.nullable(),
  })
  .strict();
export const TipPreview = z
  .object({
    draft: TipDraft,
    amount: Money,
    policyVersion: z.string().min(1).max(64),
  })
  .strict();
export const DiscountType = z.enum([
  'line_percentage',
  'line_fixed',
  'order_percentage',
  'order_fixed',
]);
export const DiscountPolicy = z
  .object({
    enabled: z.boolean(),
    maximumBasisPoints: z.number().int().min(0).max(10000),
    maximumAmount: Money,
    cashierThreshold: Money,
    customRequiresApproval: z.boolean(),
    requiredPermission: z.string().min(1).max(100),
    approvalPermission: z.string().min(1).max(100),
    version: z.string().min(1).max(64),
  })
  .strict();
export const DiscountDraft = z
  .object({
    id: Uuid,
    type: DiscountType,
    lineId: Uuid.nullable(),
    basisPoints: z.number().int().min(1).max(10000).nullable(),
    fixedAmount: Money.nullable(),
    reason: z.string().trim().min(1).max(160),
  })
  .strict();
export const CheckoutPolicy = z
  .object({
    version: z.string().min(1).max(64),
    manualTerminalEnabled: z.boolean(),
    mixedTenderEnabled: z.boolean(),
    maximumTenderLines: z.number().int().min(1).max(8),
    manualTerminalApprovalThreshold: Money,
    manualTerminalApprovalPermission: z.string().min(1).max(100),
    tip: TipPolicy,
    discount: DiscountPolicy,
  })
  .strict();
export const ReceiptDestination = z.enum(['display', 'print_later', 'digital', 'none']);
export const ReceiptDeliveryIntent = z
  .object({
    destination: ReceiptDestination,
    channel: z.enum(['email', 'sms']).nullable(),
    customerContactId: Uuid.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const digital = value.destination === 'digital';
    if (digital !== (value.channel !== null && value.customerContactId !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Digital receipt intent requires a channel and a customer contact.',
      });
    }
  });
export const CheckoutConfirmation = z
  .object({
    checkoutId: Uuid,
    checkoutVersion: z.number().int().positive(),
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedAt: IsoTimestamp,
  })
  .strict();
export const PaymentRecoveryState = z.enum([
  'none',
  'insufficient_cash',
  'invalid_amount',
  'remaining_balance',
  'totals_changed',
  'discount_rejected',
  'tip_rejected',
  'approval_required',
  'approval_expired',
  'terminal_reported_failure',
  'terminal_outcome_unknown',
  'network_unavailable',
  'device_revoked',
  'credential_rotated',
  'permission_revoked',
  'checkout_conflict',
  'payment_already_applied',
  'receipt_pending',
]);
export const PaymentConflict = z
  .object({
    code: PaymentRecoveryState.exclude(['none']),
    retryPolicy: z.enum(['none', 'transport_safe', 'query_only', 'reconfirm', 'reauthenticate']),
    actionCode: z.string().min(1).max(100),
    correlationId: CorrelationId,
    requiredPermission: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();
export const PaymentSummary = z
  .object({
    checkoutId: Uuid,
    state: CheckoutState,
    tenders: z.array(TenderAllocation).max(8),
    amountDue: Money,
    appliedAmount: Money,
    remainingBalance: Money,
    change: Money,
    partialPaymentState: PartialPaymentState,
    tip: TipPreview.nullable(),
    discounts: DiscountPreview,
  })
  .strict();
export const PaymentCommitResult = z
  .object({
    saleId: Uuid,
    checkoutId: Uuid,
    paymentSummary: PaymentSummary,
    receipt: ReceiptSnapshot,
    committedAt: IsoTimestamp,
  })
  .strict();
export const CheckoutRecoveryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();
export const CheckoutCancellationRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    reason: z.string().trim().min(1).max(160),
    checkoutFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    approvalIds: z.array(Uuid).max(1).default([]),
    idempotencyKey: Uuid,
  })
  .strict();
export const CheckoutCancellationResult = z
  .object({
    cartId: Uuid,
    checkoutId: Uuid.nullable(),
    state: z.literal('ready'),
    cancelledAt: IsoTimestamp,
  })
  .strict();
export const PaymentState = z.enum([
  'pending',
  'succeeded',
  'declined',
  'cancelled',
  'unknown',
  'timeout',
]);
export const PaymentIntent = z
  .object({
    id: Uuid,
    method: PaymentMethod,
    amount: Money,
    status: PaymentState,
    expiresAt: IsoTimestamp.nullable(),
  })
  .strict();
export const PaymentAttempt = PaymentIntent.extend({
  correlationId: CorrelationId,
  queryOnly: z.boolean(),
  createdAt: IsoTimestamp,
}).strict();
export const PaymentOutcome = z
  .object({
    attempt: PaymentAttempt,
    ambiguity: PaymentAmbiguity.nullable(),
  })
  .strict();
export const InventoryReservation = z
  .object({
    id: Uuid,
    status: z.enum(['reserved', 'released', 'expired', 'commit_prepared']),
    expiresAt: IsoTimestamp,
    lineCount: z.number().int().positive().max(250),
  })
  .strict();
export const TaxBreakdown = z
  .object({
    total: Money,
    entries: z
      .array(
        z
          .object({
            rateBasisPoints: z.number().int().min(0).max(10000),
            taxableAmount: Money,
            taxAmount: Money,
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const DiscountBreakdown = DiscountPreview;
export const TotalsConfirmation = z
  .object({
    cartVersion: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    totals: TotalsPreview,
    taxes: TaxBreakdown,
    discounts: DiscountBreakdown,
    catalogVersion: z.string().min(1).max(128),
    pricingVersion: z.string().min(1).max(128),
    taxVersion: z.string().min(1).max(128),
    snapshotAt: IsoTimestamp,
    confirmedAt: IsoTimestamp.nullable(),
  })
  .strict();
export const CheckoutCommand = z
  .object({
    commandId: Uuid.optional(),
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    cashShiftId: Uuid.nullable().optional(),
    expectedCartVersion: z.number().int().positive(),
    paymentMethod: PaymentMethod,
    totalsFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    idempotencyKey: Uuid,
    tenderDrafts: z.array(TenderDraft).max(8).default([]),
    tipDraft: TipDraft.nullable().default(null),
    discountDrafts: z.array(DiscountDraft).max(20).default([]),
    approvalIds: z.array(Uuid).max(10).default([]),
    receiptDelivery: ReceiptDeliveryIntent.default({
      destination: 'display',
      channel: null,
      customerContactId: null,
    }),
  })
  .strict();
export const CommittedSale = z
  .object({
    id: Uuid,
    orderId: Uuid,
    receiptId: Uuid,
    receiptRef: z.string().min(1).max(100),
    status: z.literal('committed'),
    committedAt: IsoTimestamp,
    totals: TotalsPreview,
  })
  .strict();
export const CheckoutFailure = z
  .object({
    code: z.enum([
      'CHECKOUT_CONFIRMATION_REQUIRED',
      'CHECKOUT_CART_CHANGED',
      'INVENTORY_UNAVAILABLE',
      'PAYMENT_DECLINED',
      'PAYMENT_UNKNOWN',
      'PAYMENT_TIMEOUT',
      'RECEIPT_CREATION_FAILED',
      'OPTIMISTIC_VERSION_CONFLICT',
      'INSUFFICIENT_CASH',
      'INVALID_TENDER_AMOUNT',
      'REMAINING_BALANCE',
      'TENDER_OVERALLOCATION',
      'TIP_REJECTED',
      'DISCOUNT_REJECTED',
      'APPROVAL_REQUIRED',
      'APPROVAL_EXPIRED',
      'TERMINAL_REPORTED_FAILURE',
      'TERMINAL_OUTCOME_UNKNOWN',
      'PAYMENT_ALREADY_APPLIED',
      'PERMISSION_REVOKED',
    ]),
    retryable: z.boolean(),
    operatorGuidance: z.enum([
      'confirm_totals',
      'correct_cart',
      'query_payment',
      'contact_manager',
      'correct_tenders',
      'verify_terminal_outcome',
      'reauthenticate',
    ]),
    correlationId: CorrelationId,
    requiredPermission: z.string().min(1).max(100).nullable().default(null),
  })
  .strict();
export const CheckoutResult = z
  .object({
    status: z.enum(['confirmation_required', 'payment_pending', 'payment_unknown', 'completed']),
    confirmation: TotalsConfirmation,
    payment: PaymentOutcome.nullable(),
    payments: z.array(PaymentOutcome).max(8).default([]),
    reservation: InventoryReservation.nullable(),
    sale: CommittedSale.nullable(),
    receipt: ReceiptSnapshot.nullable(),
    failure: CheckoutFailure.nullable(),
    paymentSummary: PaymentSummary.nullable().default(null),
    recoveryState: PaymentRecoveryState.default('none'),
    receiptDelivery: ReceiptDeliveryIntent.default({
      destination: 'display',
      channel: null,
      customerContactId: null,
    }),
    policy: CheckoutPolicy.nullable().default(null),
  })
  .strict();
export const CheckoutRecoverySnapshot = z
  .object({
    checkoutId: Uuid,
    cartId: Uuid,
    checkoutVersion: z.number().int().positive(),
    state: CheckoutState,
    tenderDrafts: z.array(TenderDraft).max(8),
    tipDraft: TipDraft.nullable(),
    discountDrafts: z.array(DiscountDraft).max(20),
    receiptDelivery: ReceiptDeliveryIntent,
    paymentSummary: PaymentSummary.nullable(),
    paymentOutcome: PaymentOutcome.nullable(),
    result: CheckoutResult.nullable(),
    recoveryState: PaymentRecoveryState,
    checkoutFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    updatedAt: IsoTimestamp,
  })
  .strict();
export const PaymentStatusQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();

export type CheckoutCommand = z.infer<typeof CheckoutCommand>;
export type CheckoutResult = z.infer<typeof CheckoutResult>;
export type PaymentStatusQuery = z.infer<typeof PaymentStatusQuery>;
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export type CheckoutState = z.infer<typeof CheckoutState>;
export type TenderType = z.infer<typeof TenderType>;
export type TenderDraft = z.infer<typeof TenderDraft>;
export type TenderAllocation = z.infer<typeof TenderAllocation>;
export type PaymentSummary = z.infer<typeof PaymentSummary>;
export type TipPolicy = z.infer<typeof TipPolicy>;
export type TipDraft = z.infer<typeof TipDraft>;
export type DiscountPolicy = z.infer<typeof DiscountPolicy>;
export type DiscountDraft = z.infer<typeof DiscountDraft>;
export type CheckoutPolicy = z.infer<typeof CheckoutPolicy>;
export type ReceiptDeliveryIntent = z.infer<typeof ReceiptDeliveryIntent>;
export type PaymentRecoveryState = z.infer<typeof PaymentRecoveryState>;
export type CheckoutRecoveryQuery = z.infer<typeof CheckoutRecoveryQuery>;
export type CheckoutRecoverySnapshot = z.infer<typeof CheckoutRecoverySnapshot>;
export type CheckoutCancellationRequest = z.infer<typeof CheckoutCancellationRequest>;
export type CheckoutCancellationResult = z.infer<typeof CheckoutCancellationResult>;
export type PaymentOutcome = z.infer<typeof PaymentOutcome>;
export type InventoryReservation = z.infer<typeof InventoryReservation>;
export type TaxBreakdown = z.infer<typeof TaxBreakdown>;
export type TotalsConfirmation = z.infer<typeof TotalsConfirmation>;

export const posCheckoutModels = {
  PaymentMethod,
  CheckoutState,
  TenderType,
  TenderStatus,
  ManualTerminalOutcome,
  PartialPaymentState,
  TenderDraft,
  TenderAllocation,
  CashTenderInput,
  CashTenderPreview,
  ManualTerminalAttempt,
  PaymentSummary,
  TipPolicy,
  TipDraft,
  TipPreview,
  DiscountType,
  DiscountPolicy,
  DiscountDraft,
  CheckoutPolicy,
  ReceiptDestination,
  ReceiptDeliveryIntent,
  CheckoutConfirmation,
  PaymentRecoveryState,
  PaymentConflict,
  PaymentCommitResult,
  CheckoutRecoveryQuery,
  CheckoutRecoverySnapshot,
  CheckoutCancellationRequest,
  CheckoutCancellationResult,
  PaymentState,
  PaymentIntent,
  PaymentAttempt,
  PaymentOutcome,
  InventoryReservation,
  TaxBreakdown,
  DiscountBreakdown,
  TotalsConfirmation,
  CheckoutCommand,
  CommittedSale,
  CheckoutFailure,
  CheckoutResult,
  PaymentStatusQuery,
  CartItem,
  CurrencyCode,
  MerchantDate,
};
