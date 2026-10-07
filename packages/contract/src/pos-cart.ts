import { z } from 'zod';
import { CatalogMoney, CatalogSaleAction } from './pos-catalog';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const Idempotency = z.string().uuid();
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
    status: z.enum(['draft', 'prepared', 'committed', 'abandoned']),
    version: z.number().int().positive(),
    items: z.array(CartItem).max(250),
    totals: TotalsPreview,
    checkoutEnabled: z.literal(false),
    checkoutMessageCode: z.literal('CHECKOUT_GATE_NOT_AVAILABLE'),
    updatedAt: Timestamp,
  })
  .strict();
export const CreateCartRequest = z
  .object({ locationId: Uuid, operatorSessionId: Uuid, idempotencyKey: Idempotency })
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
export type PosIncomingOrder = z.infer<typeof PosIncomingOrder>;
export type PosIncomingOrders = z.infer<typeof PosIncomingOrders>;
export type FireOrderRequest = z.infer<typeof FireOrderRequest>;
export type FireOrderResult = z.infer<typeof FireOrderResult>;
export const posCartModels = {
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
  PosIncomingOrder,
  PosIncomingOrders,
  FireOrderRequest,
  FireOrderResult,
};
