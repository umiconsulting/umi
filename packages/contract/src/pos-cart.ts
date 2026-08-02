import { z } from 'zod';
import { CatalogMoney } from './pos-catalog';

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
    quantity: z.number().int().min(1).max(999),
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
    status: z.enum(['draft', 'prepared', 'abandoned']),
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

export type Cart = z.infer<typeof Cart>;
export type CartItem = z.infer<typeof CartItem>;
export type CartLineInput = z.infer<typeof CartLineInput>;
export type CreateCartRequest = z.infer<typeof CreateCartRequest>;
export type RemoveCartLineRequest = z.infer<typeof RemoveCartLineRequest>;
export type PrepareSaleRequest = z.infer<typeof PrepareSaleRequest>;
export type CartQuery = z.infer<typeof CartQuery>;
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
  PrepareSaleRequest,
  CartQuery,
};
