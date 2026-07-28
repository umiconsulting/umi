import { z } from 'zod';
import {
  BusinessDate,
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
    cartId: Uuid,
    branchId: Uuid,
    operatorSessionId: Uuid,
    expectedCartVersion: z.number().int().positive(),
    paymentMethod: PaymentMethod,
    totalsFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    idempotencyKey: Uuid,
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
    ]),
    retryable: z.boolean(),
    operatorGuidance: z.enum([
      'confirm_totals',
      'correct_cart',
      'query_payment',
      'contact_manager',
    ]),
    correlationId: CorrelationId,
  })
  .strict();
export const CheckoutResult = z
  .object({
    status: z.enum(['confirmation_required', 'payment_pending', 'payment_unknown', 'completed']),
    confirmation: TotalsConfirmation,
    payment: PaymentOutcome.nullable(),
    reservation: InventoryReservation.nullable(),
    sale: CommittedSale.nullable(),
    receipt: ReceiptSnapshot.nullable(),
    failure: CheckoutFailure.nullable(),
  })
  .strict();
export const PaymentStatusQuery = z
  .object({
    branchId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();

export type CheckoutCommand = z.infer<typeof CheckoutCommand>;
export type CheckoutResult = z.infer<typeof CheckoutResult>;
export type PaymentStatusQuery = z.infer<typeof PaymentStatusQuery>;
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export type PaymentOutcome = z.infer<typeof PaymentOutcome>;
export type InventoryReservation = z.infer<typeof InventoryReservation>;
export type TaxBreakdown = z.infer<typeof TaxBreakdown>;
export type TotalsConfirmation = z.infer<typeof TotalsConfirmation>;

export const posCheckoutModels = {
  PaymentMethod,
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
  BusinessDate,
};
