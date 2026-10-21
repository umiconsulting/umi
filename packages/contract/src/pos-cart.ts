import { z } from 'zod';
import { CatalogMoney, CatalogSaleAction } from './pos-catalog';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const Idempotency = z.string().uuid();
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const SafeNote = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !/[<>]/.test(value), 'Markup is not permitted');

export const VariantSelection = z
  .object({
    variantId: Uuid,
    name: z.string().min(1).max(160),
    attributes: z.record(z.string().max(120)),
  })
  .strict();
export const ModifierSelection = z
  .object({
    modifierId: Uuid,
    groupId: Uuid,
    name: z.string().min(1).max(160),
    quantity: z.number().int().min(1).max(99),
    priceDelta: CatalogMoney,
  })
  .strict();
export const PriceSnapshot = z
  .object({
    unitPrice: CatalogMoney,
    lineSubtotal: CatalogMoney,
    tax: CatalogMoney,
    lineTotal: CatalogMoney,
    taxRateBasisPoints: z.number().int().min(0).max(10000),
  })
  .strict();
export const CartItem = z
  .object({
    id: Uuid,
    productId: Uuid,
    productName: z.string().min(1).max(240),
    saleAction: CatalogSaleAction,
    quantity: z.number().int().min(1).max(999),
    /**
     * §8H step 4. Which course this line is served in, 1-based. It is on the LINE and
     * not on the product because the same drink is a first course on one ticket and a
     * second on another — "coffee after the meal" is a fact about the order, not about
     * the coffee. The till defaults it to 1, so a counter that never sets a course
     * behaves exactly as it did before this field existed.
     */
    courseNumber: z.number().int().min(1).max(20),
    variant: VariantSelection.nullable(),
    modifiers: z.array(ModifierSelection).max(100),
    note: SafeNote.nullable(),
    /**
     * Whether this line has reached the order and its kitchen ticket (plan §8.2
     * F6). A cart that fired once accepts new lines; they arrive with `fired:
     * false` until the second fire sends them. The till reads this to show which
     * lines the kitchen already has and which are still only on the screen.
     */
    fired: z.boolean(),
    firedOrderItemId: Uuid.nullable().optional(),
    price: PriceSnapshot,
  })
  .strict();
export const DiscountPreview = z
  .object({
    total: CatalogMoney,
    entries: z
      .array(
        z.object({
          code: z.string().max(80),
          label: z.string().max(160),
          amount: CatalogMoney,
          lineId: Uuid.nullable().default(null),
        }),
      )
      .max(20),
  })
  .strict();
export const TotalsPreview = z
  .object({
    subtotal: CatalogMoney,
    tax: CatalogMoney,
    discounts: DiscountPreview,
    grandTotal: CatalogMoney,
    businessDate: z.string().date(),
  })
  .strict();
export const Cart = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    accountOwnerActive: z.boolean().optional(),
    status: z.enum(['draft', 'prepared', 'committed', 'abandoned']),
    accountName: z.string().max(120).nullable().optional(),
    accountFolio: z.string().min(1).max(64).optional(),
    createdAt: Timestamp.optional(),
    operatorName: z.string().max(240).nullable().optional(),
    tableId: Uuid.nullable().optional(),
    tableName: z.string().max(160).nullable().optional(),
    tableVisitId: Uuid.nullable().optional(),
    lifecycleState: z
      .enum([
        'building_cart',
        'suspended',
        'ready_for_checkout',
        'committed',
        'cancelled',
        'recovered',
      ])
      .optional(),
    version: z.number().int().positive(),
    /**
     * The order THIS cart created when it was fired, or null (ADR
     * 2026-10-07-pos-fired-order §7). The cart view carries it so the till can
     * show "sent to the kitchen" and stop offering to fire a cart that already
     * has a ticket. Distinct from `origin_order_id`, which is an order that
     * arrived from somewhere else.
     */
    firedOrderId: Uuid.nullable(),
    /**
     * How the order leaves the counter (plan §8.2 F3, decision D5). The operator
     * chooses it in the POS top bar; the server writes it onto the order at fire
     * or checkout. Only the two values this café uses — no delivery yet.
     */
    fulfillmentType: z.enum(['dine_in', 'takeout']),
    items: z.array(CartItem).max(250),
    totals: TotalsPreview,
    checkoutEnabled: z.literal(false),
    checkoutMessageCode: z.literal('CHECKOUT_GATE_NOT_AVAILABLE'),
    updatedAt: Timestamp,
  })
  .strict();
export const CreateCartRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    idempotencyKey: Idempotency,
    accountName: z.string().trim().min(1).max(120).nullable().optional(),
  })
  .strict();
export const OpenTableAccountRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    tableId: Uuid,
    // The POS sends null when the operator did not state a party size. Absent
    // and null mean the same thing here: the account has no party count.
    partySize: z.number().int().min(1).max(64).nullish(),
    expectedVersion: z.number().int().positive().optional(),
    idempotencyKey: Idempotency,
  })
  .strict();
export const ResumeCartAccountRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();
const AccountName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[<>]/.test(value))
  .nullable();
export const SuspendCartRequest = ResumeCartAccountRequest.extend({
  cartId: Uuid,
  accountName: AccountName.optional(),
});
export const SetCartAccountDetailsRequest = ResumeCartAccountRequest.extend({
  accountName: AccountName,
});
export const AssignCartTableRequest = ResumeCartAccountRequest.extend({
  tableId: Uuid,
  partySize: z.number().int().min(1).max(64).nullish(),
});
export const OpenCartAccounts = z.object({ accounts: z.array(Cart).max(250) }).strict();
export const RemoveSentCartLineRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
    reasonCode: z.enum(['customer_changed', 'operator_mistake', 'duplicate', 'other']),
    /**
     * The manager elevation that authorizes cancelling a line whose preparation
     * ALREADY STARTED. A line the kitchen has not touched needs neither field: that
     * cancel is the operator's own act, and `sale.void.create` is only asked for when
     * there is something already made to throw away.
     *
     * Nullable with a default, like every other optional-on-write field here, so a
     * client that never heard of the elevation keeps sending the body it always sent
     * and gets the same answer while the kitchen still holds the line.
     */
    approvalId: Uuid.nullable().default(null),
    /** Binds the elevation to THIS cancel: the API recomputes it and refuses a mismatch. */
    approvalFingerprint: Fingerprint.nullable().default(null),
  })
  .strict();

export const CartLineInput = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    productId: Uuid,
    variantId: Uuid.nullable().default(null),
    modifierSelections: z
      .array(z.object({ modifierId: Uuid, quantity: z.number().int().min(1).max(99) }).strict())
      .max(100)
      .default([]),
    quantity: z.number().int().min(1).max(999),
    /**
     * Optional on WRITE and defaulted, so every existing client keeps working and the
     * identity key is untouched: changing the course of a line updates that line rather
     * than splitting it into a second one.
     */
    courseNumber: z.number().int().min(1).max(20).default(1),
    note: SafeNote.nullable().default(null),
    /**
     * The durable line identity the till already painted. The server uses it as
     * the official line id, so an offline update or remove keeps one identity
     * when the command travels through a local hub.
     */
    // The Dart model writes every field. A null here means "the till has no
    // durable line identity to send", which is the same as an absent field.
    clientLineId: Uuid.nullish(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();
export const RemoveCartLineRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();
export const ClearCartRequest = RemoveCartLineRequest;
export const PrepareSaleRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();
export const CartQuery = z.object({ locationId: Uuid, operatorSessionId: Uuid }).strict();

// Channel attribution (ADR 2026-09-13-pos-channel-attribution). Bind the active cart to the
// upstream commercial order it settles, so the committed sale freezes the channel and the linked
// order is closed at checkout. originOrderId=null detaches the cart (a plain walk_in sale).
export const BindCartOriginRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    originOrderId: Uuid.nullable(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();

// The order type (plan §8.2 F3, decision D5). The operator chooses how the order
// leaves the counter in the POS top bar; the cart carries it so the fire and the
// checkout write the same fact onto the order instead of both assuming dine-in.
export const CartFulfillmentType = z.enum(['dine_in', 'takeout']);
export const SetCartFulfillmentRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    fulfillmentType: CartFulfillmentType,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();

// One incoming commercial order a till can pick up: a customer channel (never 'pos', never staff
// 'dashboard' entry) that has not reached a terminal status. A compact card for the POS
// incoming-orders surface; the operator rings the items, so lines are not auto-loaded.
export const PosIncomingOrder = z
  .object({
    orderId: Uuid,
    channel: z.enum(['whatsapp', 'web', 'aggregator']),
    status: z.enum(['placed', 'preparing', 'ready']),
    reference: z.string().max(160).nullable(),
    customerName: z.string().max(240).nullable(),
    itemCount: z.number().int().nonnegative(),
    totalMinorUnits: z.number().int().nonnegative(),
    placedAt: Timestamp.nullable(),
  })
  .strict();
export const PosIncomingOrders = z.object({ orders: z.array(PosIncomingOrder).max(100) }).strict();

// The fired order (ADR 2026-10-07-pos-fired-order-adr). Firing writes the order and
// projects its kitchen ticket WITHOUT taking money, and the checkout later settles that
// same order instead of minting a second one — a second order projects a second ticket,
// and the bar makes the drinks twice. The request names the cart because the cart is what
// is fired; the ORDER is what comes out, which is why the route lives under `/orders`.
//
// `expectedVersion` is the cart's, not the order's: the order does not exist until this
// call succeeds, so the only thing there is to be stale against is the cart the operator
// is looking at.
export const FireOrderRequest = z
  .object({
    cartId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: Idempotency,
  })
  .strict();

// What the till gets back. `reference` is the string the kitchen ticket shows, so it is
// what an operator reads to a cook; `lineCount` is never zero, because an empty cart is
// refused rather than fired — a ticket with no items is a cook walking to a screen to find
// nothing.
export const FireOrderResult = z
  .object({
    cartId: Uuid,
    cartVersion: z.number().int().positive(),
    orderId: Uuid,
    reference: z.string().max(160).nullable(),
    lineCount: z.number().int().positive(),
    firedAt: Timestamp,
  })
  .strict();

export type Cart = z.infer<typeof Cart>;
export type CartItem = z.infer<typeof CartItem>;
export type CartLineInput = z.infer<typeof CartLineInput>;
export type CreateCartRequest = z.infer<typeof CreateCartRequest>;
export type RemoveCartLineRequest = z.infer<typeof RemoveCartLineRequest>;
export type ClearCartRequest = z.infer<typeof ClearCartRequest>;
export type PrepareSaleRequest = z.infer<typeof PrepareSaleRequest>;
export type CartQuery = z.infer<typeof CartQuery>;
export type BindCartOriginRequest = z.infer<typeof BindCartOriginRequest>;
export type CartFulfillmentType = z.infer<typeof CartFulfillmentType>;
export type SetCartFulfillmentRequest = z.infer<typeof SetCartFulfillmentRequest>;
export type PosIncomingOrder = z.infer<typeof PosIncomingOrder>;
export type PosIncomingOrders = z.infer<typeof PosIncomingOrders>;
export type FireOrderRequest = z.infer<typeof FireOrderRequest>;
export type FireOrderResult = z.infer<typeof FireOrderResult>;
export type OpenTableAccountRequest = z.infer<typeof OpenTableAccountRequest>;
export type ResumeCartAccountRequest = z.infer<typeof ResumeCartAccountRequest>;
export type SuspendCartRequest = z.infer<typeof SuspendCartRequest>;
export type OpenCartAccounts = z.infer<typeof OpenCartAccounts>;
export type RemoveSentCartLineRequest = z.infer<typeof RemoveSentCartLineRequest>;
export type SetCartAccountDetailsRequest = z.infer<typeof SetCartAccountDetailsRequest>;
export type AssignCartTableRequest = z.infer<typeof AssignCartTableRequest>;
export const posCartModels = {
  OpenTableAccountRequest,
  ResumeCartAccountRequest,
  SuspendCartRequest,
  OpenCartAccounts,
  RemoveSentCartLineRequest,
  SetCartAccountDetailsRequest,
  AssignCartTableRequest,
  VariantSelection,
  ModifierSelection,
  PriceSnapshot,
  CartItem,
  DiscountPreview,
  TotalsPreview,
  Cart,
  CreateCartRequest,
  CartLineInput,
  RemoveCartLineRequest,
  ClearCartRequest,
  PrepareSaleRequest,
  CartQuery,
  BindCartOriginRequest,
  CartFulfillmentType,
  SetCartFulfillmentRequest,
  PosIncomingOrder,
  PosIncomingOrders,
  FireOrderRequest,
  FireOrderResult,
};
