import { z } from 'zod';
import { nationalDigitsAreValid, phoneLengthMessage } from './phone';
import { CatalogMoney } from './pos-catalog';
import { InventoryAllergenRef } from './pos-inventory';

const Uuid = z.string().uuid();
const Timestamp = z.string().datetime({ offset: true });
const Currency = z.string().regex(/^[A-Z]{3}$/);
const SafeNote = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !/[<>]/.test(value), 'Markup is not permitted');

/**
 * TABLE-ORDER INTAKE (§8I step 2). The guest-facing half of the decision recorded in
 * `docs/architecture/2026-09-13-pos-channel-attribution-adr.md` §9: a seated guest
 * ORDERS from the table, and PAYS AT THE COUNTER.
 *
 * WHY THE MENU IS ITS OWN SHAPE AND NOT `CatalogProductSummary`. The till's catalog
 * carries operator vocabulary — `saleAction`, `hasBarcode`, `taxRateBasisPoints`,
 * stock-derived availability — and a guest must receive none of it: a `gift_card`
 * line the till may ring is not something a QR page can sell, and a tax-rate integer
 * on a public endpoint is a pricing implementation detail with no use on the other
 * side. The prices here are the SAME numbers (both read `merchant.product.price`), and
 * the write path re-prices from the server, so the two cannot drift in the direction
 * that matters: what the guest is charged.
 *
 * WHAT THE GUEST MAY NOT NAME, enforced by `.strict()` on every request object rather
 * than by a filter: a price, a discount, a customer id, a tax rate or a table id in the
 * body is not ignored, it is REJECTED. Dropping unknown keys would make a request that
 * tried to state a price look like one that did not, and the refusal is what the guest
 * (and a pen test) can see.
 */

export const TableOrderModifier = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    /** Centavos, signed — a modifier can subtract. Server-authored, never the guest's. */
    priceDelta: CatalogMoney,
  })
  .strict();

export const TableOrderOptionGroup = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    minSelect: z.number().int().min(0).max(99),
    maxSelect: z.number().int().min(1).max(99).nullable(),
    modifiers: z.array(TableOrderModifier).max(100),
  })
  .strict();

export const TableOrderMenuItem = z
  .object({
    productId: Uuid,
    name: z.string().min(1).max(240),
    description: z.string().max(2000).nullable(),
    price: CatalogMoney,
    /**
     * §8.5. The allergen labels this product carries, derived from its recipe when
     * the menu is read. A product whose catalogue entry maps to no stock carries an
     * empty list, which says that no ingredient is recorded rather than claiming
     * the dish is free of an allergen.
     */
    allergens: z.array(InventoryAllergenRef).max(50),
    /**
     * The same five values the till sees, minus the stock-derived reason. A guest page
     * that hides an unavailable item and one that shows it as "agotado" are both
     * acceptable products; the server repeats the check on the way in either way, so a
     * page that mis-renders this field cannot sell an 86'd dish.
     */
    availability: z.enum([
      'enabled',
      'disabled',
      'temporarily_unavailable',
      'out_of_assortment',
      'future_availability',
    ]),
    /**
     * TRUE when the product is sold in variants. Table-order intake deliberately
     * accepts no variant: `{productId, quantity, modifiers}` cannot express "the large
     * one", and guessing a variant would put a price on the guest's tab that they did
     * not choose. The page states it must be ordered with the waiter.
     */
    hasVariants: z.boolean(),
    optionGroups: z.array(TableOrderOptionGroup).max(20),
  })
  .strict();

export const TableOrderMenu = z
  .object({
    merchantName: z.string().min(1).max(240),
    locationName: z.string().min(1).max(240),
    /** The floor plan's label for this table, as the guest reads it on the table. */
    tableLabel: z.string().min(1).max(120),
    currency: Currency,
    /** The order is placed here and paid at the counter. Stated by the server, so no
     * client has to invent the sentence and none can leave it out. */
    paymentAtCounter: z.literal(true),
    items: z.array(TableOrderMenuItem).max(500),
  })
  .strict();

export const TableOrderModifierSelection = z
  .object({
    modifierId: Uuid,
    quantity: z.number().int().min(1).max(20),
  })
  .strict();

export const TableOrderLine = z
  .object({
    productId: Uuid,
    quantity: z.number().int().min(1).max(50),
    modifiers: z.array(TableOrderModifierSelection).max(50).default([]),
    /** The per-line note a guest actually needs: "sin azúcar", "sin cebolla". */
    note: SafeNote.nullable().default(null),
  })
  .strict();

export const PlaceTableOrderRequest = z
  .object({
    /**
     * The retry key. A guest on café wifi who taps twice must not be billed for two
     * dinners, so the same key replays the first answer and a DIFFERENT body under the
     * same key is refused (IDEMPOTENCY_CONFLICT) rather than answered.
     */
    idempotencyKey: z.string().uuid(),
    lines: z.array(TableOrderLine).min(1).max(50),
    guestName: z.string().trim().min(1).max(160).nullable().default(null),
    /**
     * Assembled `+<dial><national>`, exactly as the registration form submits it — the
     * page supplies the country code from a picker and the guest types only the national
     * digits. The shared rule is `nationalDigitsAreValid`, so a wrong-length Mexican
     * number is refused HERE rather than stored as a plausible number that reaches
     * nobody (see `phone.ts`).
     */
    guestPhone: z
      .string()
      .trim()
      .min(7)
      .max(20)
      .refine(nationalDigitsAreValid, (v) => ({ message: phoneLengthMessage(v) }))
      .nullable()
      .default(null),
    note: SafeNote.nullable().default(null),
  })
  .strict();

export const TableOrderPlaced = z
  .object({
    orderId: Uuid,
    /**
     * What the counter and the kitchen board show for this order. It begins with the
     * table's label — "MESA 7 · 3F2A9C" — because a dine-in ticket whose reference does
     * not name the table is a ticket the cook has to decode.
     */
    reference: z.string().min(1).max(160),
    status: z.literal('placed'),
    total: CatalogMoney,
    /**
     * How many UNITS were ordered (Σ quantity), which is what a guest's confirmation
     * says: "2 Americanos".
     *
     * NOT `PosIncomingOrder.itemCount`, and the name is different on purpose. That field
     * is the till's and counts LINES — its SQL is `count(*)` over the order's live
     * `order_item` rows — so one card for two coffees reads `itemCount: 1`. Two contracts
     * using one name for two quantities is how a client ends up rendering "1 artículo"
     * over a two-coffee order.
     */
    unitCount: z.number().int().positive(),
    placedAt: Timestamp,
    /**
     * Whether the write this ANSWER came from created the order.
     *
     * A REPLAY RETURNS THE ORIGINAL ANSWER VERBATIM, including `created: true`, because
     * the command journal stores the first response and returns it — that is what makes a
     * retry indistinguishable from the original, which is the point. `created: false`
     * therefore means something narrower and rarer: the journal did not own this key (its
     * row had passed retention) and `writeOrder` found the order already existed. A client
     * must not read either value as "this request was the first".
     */
    created: z.boolean(),
  })
  .strict();

// ── Issuing and revoking a table's credential (the console's side) ────────────

export const IssueTableOrderCredentialRequest = z
  .object({
    locationId: Uuid,
    tableId: Uuid,
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const RevokeTableOrderCredentialRequest = z
  .object({ idempotencyKey: z.string().uuid() })
  .strict();

/**
 * The console addresses a location explicitly on every one of these routes, the way
 * `TableStateQuery` does: a manager who may switch locations has no implicit one, and a
 * list that silently defaulted to "all locations" would answer a question nobody asked.
 */
export const TableOrderCredentialQuery = z.object({ locationId: Uuid }).strict();

export const TableOrderCredential = z
  .object({
    credentialId: Uuid,
    locationId: Uuid,
    tableId: Uuid,
    tableLabel: z.string().max(120),
    /**
     * The raw token, returned ONCE — at issue time and never again. The database stores
     * only its sha256 (`table_order_credential.token_hash`), so this response is the
     * only moment the QR can be printed.
     */
    token: z.string().min(20).max(120),
    createdAt: Timestamp,
    revokedAt: Timestamp.nullable(),
  })
  .strict();

export const TableOrderCredentialList = z
  .object({
    /** Live and revoked, newest first: the owner's audit of what is in the room. */
    credentials: z
      .array(TableOrderCredential.omit({ token: true }).extend({ token: z.null() }))
      .max(500),
  })
  .strict();

export type TableOrderMenu = z.infer<typeof TableOrderMenu>;
export type TableOrderMenuItem = z.infer<typeof TableOrderMenuItem>;
export type TableOrderOptionGroup = z.infer<typeof TableOrderOptionGroup>;
export type TableOrderModifier = z.infer<typeof TableOrderModifier>;
export type TableOrderLine = z.infer<typeof TableOrderLine>;
export type PlaceTableOrderRequest = z.infer<typeof PlaceTableOrderRequest>;
export type TableOrderPlaced = z.infer<typeof TableOrderPlaced>;
export type IssueTableOrderCredentialRequest = z.infer<typeof IssueTableOrderCredentialRequest>;
export type RevokeTableOrderCredentialRequest = z.infer<typeof RevokeTableOrderCredentialRequest>;
export type TableOrderCredentialQuery = z.infer<typeof TableOrderCredentialQuery>;
export type TableOrderCredential = z.infer<typeof TableOrderCredential>;
export type TableOrderCredentialList = z.infer<typeof TableOrderCredentialList>;

export const tableOrderModels = {
  TableOrderModifier,
  TableOrderOptionGroup,
  TableOrderMenuItem,
  TableOrderMenu,
  TableOrderModifierSelection,
  TableOrderLine,
  PlaceTableOrderRequest,
  TableOrderPlaced,
  IssueTableOrderCredentialRequest,
  RevokeTableOrderCredentialRequest,
  TableOrderCredentialQuery,
  TableOrderCredential,
  TableOrderCredentialList,
};
