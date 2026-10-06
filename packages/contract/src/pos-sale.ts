import { z } from 'zod';
import { ReceiptSnapshot } from './platform';
import { Cart } from './pos-cart';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const IdempotencyKey = z.string().uuid();
const SafeText = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[<>]/.test(value), 'Markup is not permitted');
const SafeLabel = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[<>]/.test(value), 'Markup is not permitted');

export const SaleLifecycleState = z.enum([
  'building_cart',
  'suspended',
  'ready_for_checkout',
  'committed',
  'cancelled',
  'recovered',
]);

export const SaleCustomerSummary = z
  .object({
    id: Uuid,
    displayName: z.string().min(1).max(160),
    contactHint: z.string().max(120).nullable(),
  })
  .strict();

export const SaleSnapshot = z
  .object({
    id: Uuid,
    state: SaleLifecycleState,
    cart: Cart,
    label: z.string().max(120).nullable(),
    customer: SaleCustomerSummary.nullable(),
    originalOperatorSessionId: Uuid,
    currentOperatorSessionId: Uuid.nullable(),
    suspendedAt: Timestamp.nullable(),
    cancelledAt: Timestamp.nullable(),
    cancellationReason: z.string().max(160).nullable(),
    committedSaleId: Uuid.nullable(),
    sourceOrderId: Uuid.nullable(),
    receiptId: Uuid.nullable(),
    receiptRef: z.string().max(100).nullable(),
    updatedAt: Timestamp,
  })
  .strict();

export const SaleContextRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    idempotencyKey: IdempotencyKey,
  })
  .strict();

export const SaleMutationRequest = SaleContextRequest.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const SuspendSaleRequest = SaleMutationRequest.extend({
  label: z.string().trim().max(120).nullable().default(null),
}).strict();

export const ResumeSaleRequest = SaleContextRequest.extend({
  expectedVersion: z.number().int().positive(),
}).strict();

export const RenameSuspendedSaleRequest = SaleMutationRequest.extend({
  label: SafeLabel,
}).strict();

export const CancelSaleRequest = SaleMutationRequest.extend({
  reason: SafeText,
}).strict();

export const AttachSaleCustomerRequest = SaleMutationRequest.extend({
  customerId: Uuid,
}).strict();

export const SaleHistoryQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    state: z.enum(['suspended', 'committed', 'cancelled']).optional(),
    search: z.string().trim().max(120).default(''),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    cursor: z.string().max(240).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const SaleHistoryPage = z
  .object({
    items: z.array(SaleSnapshot).max(100),
    nextCursor: z.string().max(240).nullable(),
  })
  .strict();

export const PosCustomerSearchQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    search: z.string().trim().max(120).default(''),
    recent: z
      .preprocess(
        (value) => (value === 'true' ? true : value === 'false' ? false : value),
        z.boolean(),
      )
      .default(false),
    limit: z.coerce.number().int().min(1).max(30).default(12),
  })
  .strict();

export const PosCustomerSearchResult = z
  .object({
    items: z.array(SaleCustomerSummary).max(30),
  })
  .strict();

export const SaleReceiptResult = z
  .object({
    saleId: Uuid,
    kind: z.enum(['official', 'provisional']),
    provisionalReference: z.string().max(160).nullable(),
    receipt: ReceiptSnapshot.nullable(),
  })
  .strict();

export type SaleSnapshot = z.infer<typeof SaleSnapshot>;
export type SaleContextRequest = z.infer<typeof SaleContextRequest>;
export type SaleMutationRequest = z.infer<typeof SaleMutationRequest>;
export type SuspendSaleRequest = z.infer<typeof SuspendSaleRequest>;
export type ResumeSaleRequest = z.infer<typeof ResumeSaleRequest>;
export type RenameSuspendedSaleRequest = z.infer<typeof RenameSuspendedSaleRequest>;
export type CancelSaleRequest = z.infer<typeof CancelSaleRequest>;
export type AttachSaleCustomerRequest = z.infer<typeof AttachSaleCustomerRequest>;
export type SaleHistoryQuery = z.infer<typeof SaleHistoryQuery>;
export type PosCustomerSearchQuery = z.infer<typeof PosCustomerSearchQuery>;
export type SaleReceiptResult = z.infer<typeof SaleReceiptResult>;

export const posSaleModels = {
  SaleLifecycleState,
  SaleCustomerSummary,
  SaleSnapshot,
  SaleContextRequest,
  SaleMutationRequest,
  SuspendSaleRequest,
  ResumeSaleRequest,
  RenameSuspendedSaleRequest,
  CancelSaleRequest,
  AttachSaleCustomerRequest,
  SaleHistoryQuery,
  SaleHistoryPage,
  PosCustomerSearchQuery,
  PosCustomerSearchResult,
  SaleReceiptResult,
};
