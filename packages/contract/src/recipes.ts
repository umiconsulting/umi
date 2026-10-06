import { z } from 'zod';
import { CorrelationId, IsoTimestamp, OpaqueCursor, PageInfo, Uuid } from './platform';
// `UnitOfMeasure` and `InventoryItemType` are IMPORTED, not redefined. The database
// has ONE `base_unit` list and ONE `item_type` list, shared by `inventory_item`,
// `inventory_unit_conversion` and `inventory_recipe_component`. A second copy here
// would be a second author that can drift from the one the till already uses.
import { InventoryItemType, UnitOfMeasure } from './pos-inventory';

/**
 * Recipes and inventory — the console's authoring surface (recipes module plan §5
 * and §6).
 *
 * WHY THIS MODULE EXISTS. Checkout and costing READ `inventory_item`,
 * `inventory_unit_conversion`, `inventory_recipe` and `inventory_recipe_component`.
 * Nothing wrote them, so a recipe could only exist in a seed. This module describes
 * the writes that make those tables reachable from the owner console.
 *
 * THE RECIPE IS THE SOURCE OF TRUTH FOR COST, AND THE LEDGER IS THE SOURCE OF
 * TRUTH FOR STOCK. A recipe holds its components and their quantities. It holds no
 * price. `costMinor` and `marginMinor` below are numbers the server computed from
 * the cost basis of receipts (`inventory-costing.ts`), never a value a client sent.
 *
 * A RECIPE VERSION IS IMMUTABLE (plan D3). An update retires the old row and writes
 * a new one, so `expectedVersion` names the version the caller read, and the stored
 * cost of that version stays true.
 *
 * A RECIPE HAS EXACTLY ONE TARGET (plan D2): a product, a variant, or an inventory
 * item when the recipe makes a sub-recipe. The database counts those three columns,
 * so this contract refuses two at once and refuses none.
 *
 * MONEY IS INTEGER MINOR UNITS AND QUANTITIES ARE SCALED INTEGERS, exactly as in
 * `procurement.ts`: a `value`, a `scale` and a `unit`, never "0.25 kg". There is no
 * float in this file, and `z.number().int().safe()` is what refuses one.
 */

/** Integer minor units (centavos). The shape every amount in this file uses. */
const MinorUnits = z.number().int().min(0).safe();

/** A signed amount in minor units: a margin can be negative. */
const SignedMinorUnits = z.number().int().safe();

export const InventoryTrackingPolicy = z.enum(['not_tracked', 'tracked', 'reservation_required']);
export type InventoryTrackingPolicy = z.infer<typeof InventoryTrackingPolicy>;

export const InventoryNegativeStockPolicy = z.enum([
  'block',
  'manager_override',
  'allow_and_flag',
  'backorder',
  'not_applicable',
]);
export type InventoryNegativeStockPolicy = z.infer<typeof InventoryNegativeStockPolicy>;

/**
 * Mirror of the `rounding_policy` check on `inventory_unit_conversion` and
 * `inventory_recipe_component`. `exact` refuses a conversion that loses a unit, so
 * the default is the strict one.
 */
export const InventoryRoundingPolicy = z.enum(['exact', 'floor', 'ceiling', 'half_up']);
export type InventoryRoundingPolicy = z.infer<typeof InventoryRoundingPolicy>;

/** A scaled integer quantity. Mirrors `inventory_item.quantity_scale`. */
export const InventoryQuantity = z
  .object({
    value: z.number().int().min(0).max(9007199254740991).safe(),
    scale: z.number().int().min(0).max(6),
    unit: UnitOfMeasure,
  })
  .strict();
export type InventoryQuantity = z.infer<typeof InventoryQuantity>;

/**
 * A quantity at the item's OWN scale, carried as a bare integer. The item record
 * already names `quantityScale` and `baseUnit`, so repeating them on every amount
 * would create fields that can disagree with the row they describe. This is the
 * shape `inventory_item.low_stock_threshold` and the balance projection both use.
 */
const ItemScaleQuantity = z.number().int().safe();

/**
 * A quantity that must be more than zero: a yield, a conversion factor, a received
 * line. Zero is not a quantity, and a zero yield would price every production batch
 * as free.
 */
export const PositiveInventoryQuantity = InventoryQuantity.refine(
  (quantity) => quantity.value > 0,
  'A quantity must be more than zero.',
);
export type PositiveInventoryQuantity = z.infer<typeof PositiveInventoryQuantity>;

/**
 * The command identity every write in this module carries. Same discipline as
 * `procurement.ts` and `InventoryCommandContext`: an idempotency key the server
 * claims in `merchant.business_command`, and — where a row already exists — the
 * version the caller believed it was writing.
 *
 * There is no `operatorSessionId` and no `businessDate`: this is the CONSOLE's
 * surface, not the till's. It authenticates with a browser session, so there is no
 * operator session to assert, and the business date is derived by the database from
 * the merchant's timezone rather than supplied by the caller.
 */
const commandShape = {
  commandId: Uuid,
  idempotencyKey: Uuid,
};

// ── Allergens ───────────────────────────────────────────────────────────────

/**
 * The merchant's own key for a label. Lowercase, and it mirrors the
 * `inventory_allergen.code` check exactly, so a code the contract accepts is a code
 * the database stores.
 */
export const InventoryAllergenCode = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/);
export type InventoryAllergenCode = z.infer<typeof InventoryAllergenCode>;

export const InventoryAllergenQuery = z
  .object({
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100),
    includeInactive: z.coerce.boolean().default(false),
  })
  .strict();
export type InventoryAllergenQuery = z.infer<typeof InventoryAllergenQuery>;

export const InventoryAllergen = z
  .object({
    id: Uuid,
    code: InventoryAllergenCode,
    label: z.string().min(1).max(80),
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export type InventoryAllergen = z.infer<typeof InventoryAllergen>;

export const InventoryAllergenList = z
  .object({
    allergens: z.array(InventoryAllergen).max(200),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryAllergenList = z.infer<typeof InventoryAllergenList>;

/**
 * Setting an allergen is an upsert on the merchant's own `code`, which is why
 * `expectedVersion` is nullable: the first set has no version to expect, and a
 * later set must name the version it read.
 */
export const InventoryAllergenSetRequest = z
  .object({
    ...commandShape,
    code: InventoryAllergenCode,
    label: z.string().trim().min(1).max(80),
    active: z.boolean().default(true),
    expectedVersion: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type InventoryAllergenSetRequest = z.infer<typeof InventoryAllergenSetRequest>;

// ── Unit conversions ────────────────────────────────────────────────────────

export const InventoryUnitConversion = z
  .object({
    id: Uuid,
    inventoryItemId: Uuid,
    fromUnit: UnitOfMeasure,
    toUnit: UnitOfMeasure,
    numerator: z.number().int().min(1).max(9007199254740991).safe(),
    denominator: z.number().int().min(1).max(9007199254740991).safe(),
    targetScale: z.number().int().min(0).max(6),
    roundingPolicy: InventoryRoundingPolicy,
    active: z.boolean(),
    version: z.number().int().positive(),
  })
  .strict();
export type InventoryUnitConversion = z.infer<typeof InventoryUnitConversion>;

export const InventoryUnitConversionSetRequest = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    fromUnit: UnitOfMeasure,
    toUnit: UnitOfMeasure,
    numerator: z.number().int().min(1).max(9007199254740991).safe(),
    denominator: z.number().int().min(1).max(9007199254740991).safe(),
    targetScale: z.number().int().min(0).max(6),
    roundingPolicy: InventoryRoundingPolicy,
    /** Nullable: the first conversion for a pair has no version to expect. */
    expectedVersion: z.number().int().positive().nullable().default(null),
  })
  .strict();
export type InventoryUnitConversionSetRequest = z.infer<typeof InventoryUnitConversionSetRequest>;

export const InventoryUnitConversionList = z
  .object({
    items: z.array(InventoryUnitConversion).max(500),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryUnitConversionList = z.infer<typeof InventoryUnitConversionList>;

// ── Inventory items ─────────────────────────────────────────────────────────

export const InventoryAuthoringItemQuery = z
  .object({
    cursor: z.coerce.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    includeArchived: z.coerce.boolean().default(false),
    /**
     * Items no receipt has ever priced. FALSE BY DEFAULT, the same default the costing
     * read takes. An authoring console that wants a freshly created ingredient in the
     * list must ASK for it, because an ingredient has no receipt until the first
     * delivery arrives.
     *
     * THE ASYMMETRY IS DELIBERATE AND IT IS A TRAP WORTH NAMING. The query model
     * coerces booleans, so the string `false` is TRUE (`Boolean('false')`). Only the
     * default can express "no", which is why the default is the narrow one: a caller
     * that wants the wider list sends `true` explicitly, and a caller that wants the
     * narrow list sends nothing at all.
     */
    includeItemsWithoutCost: z.coerce.boolean().default(false),
  })
  .strict();
export type InventoryAuthoringItemQuery = z.infer<typeof InventoryAuthoringItemQuery>;

/**
 * On-hand is a per-location read, so one item shows a different number per shop.
 * Signed, because `allow_and_flag` permits a negative balance and reporting one as
 * zero would hide the very item a manager needs to see.
 */
export const InventoryAuthoringItemOnHand = z
  .object({
    locationId: Uuid,
    inventoryLocationId: Uuid,
    onHand: ItemScaleQuantity,
  })
  .strict();
export type InventoryAuthoringItemOnHand = z.infer<typeof InventoryAuthoringItemOnHand>;

export const InventoryAuthoringItem = z
  .object({
    id: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    itemType: InventoryItemType,
    baseUnit: UnitOfMeasure,
    quantityScale: z.number().int().min(0).max(6),
    trackingPolicy: InventoryTrackingPolicy,
    negativeStockPolicy: InventoryNegativeStockPolicy,
    lowStockThreshold: ItemScaleQuantity.nullable(),
    /**
     * What the kitchen wants on hand. The prep list subtracts the on-hand and the
     * forecast usage from this number to decide what to make (§8.4).
     */
    parQuantity: ItemScaleQuantity.nullable(),
    shelfLifeDays: z.number().int().min(0).max(3650).nullable(),
    active: z.boolean(),
    version: z.number().int().positive(),
    allergens: z.array(InventoryAllergen).max(100),
    conversions: z.array(InventoryUnitConversion).max(200),
    onHand: z.array(InventoryAuthoringItemOnHand).max(200),
  })
  .strict();
export type InventoryAuthoringItem = z.infer<typeof InventoryAuthoringItem>;

export const InventoryAuthoringItemList = z
  .object({
    items: z.array(InventoryAuthoringItem).max(100),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryAuthoringItemList = z.infer<typeof InventoryAuthoringItemList>;

export const InventoryAuthoringItemCreateRequest = z
  .object({
    ...commandShape,
    /** The merchant's own code for the item, and the key a duplicate is refused on. */
    publicReference: z.string().regex(/^[A-Za-z0-9._:-]{1,80}$/),
    displayName: z.string().trim().min(1).max(160),
    itemType: InventoryItemType,
    baseUnit: UnitOfMeasure,
    quantityScale: z.number().int().min(0).max(6),
    trackingPolicy: InventoryTrackingPolicy,
    negativeStockPolicy: InventoryNegativeStockPolicy,
    lowStockThreshold: ItemScaleQuantity.nullable().default(null),
    shelfLifeDays: z.number().int().min(0).max(3650).nullable().default(null),
    parQuantity: ItemScaleQuantity.nullable().default(null),
  })
  .strict();
export type InventoryAuthoringItemCreateRequest = z.infer<
  typeof InventoryAuthoringItemCreateRequest
>;

/**
 * Amending an item. `publicReference`, `itemType` and `baseUnit` are deliberately
 * absent: ledger rows and recipes already name them, and rewriting them would
 * silently reinterpret history.
 */
export const InventoryAuthoringItemUpdateRequest = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    displayName: z.string().trim().min(1).max(160).optional(),
    lowStockThreshold: ItemScaleQuantity.nullable().optional(),
    shelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
    parQuantity: ItemScaleQuantity.nullable().optional(),
    trackingPolicy: InventoryTrackingPolicy.optional(),
    negativeStockPolicy: InventoryNegativeStockPolicy.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type InventoryAuthoringItemUpdateRequest = z.infer<
  typeof InventoryAuthoringItemUpdateRequest
>;

/** Archive, never delete: the ledger and the recipes still name the item. */
export const InventoryAuthoringItemArchiveRequest = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type InventoryAuthoringItemArchiveRequest = z.infer<
  typeof InventoryAuthoringItemArchiveRequest
>;

/**
 * The whole allergen set for one item, in one write. A set of ids replaces the
 * previous list, so an empty array clears it, and the version the caller read makes
 * two editors on one item refuse instead of merging.
 */
export const InventoryAuthoringItemAllergenSetRequest = z
  .object({
    ...commandShape,
    inventoryItemId: Uuid,
    allergenIds: z.array(Uuid).max(100),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type InventoryAuthoringItemAllergenSetRequest = z.infer<
  typeof InventoryAuthoringItemAllergenSetRequest
>;

// ── Recipes ─────────────────────────────────────────────────────────────────

/** A product recipe, a variant recipe, or a sub-recipe that makes an item. */
export const InventoryRecipeTargetKind = z.enum(['product', 'item']);
export type InventoryRecipeTargetKind = z.infer<typeof InventoryRecipeTargetKind>;

/**
 * One line of a recipe as the editor sends it.
 *
 * `quantity` must be MORE THAN ZERO, because that is what the database stores
 * (`inventory_recipe_component.quantity` is `between 1 and 9007199254740991`) and
 * what checkout consumes. A line the cook wants to switch off is removed from the
 * new version: the old version stays readable, and switching the line back on is a
 * third version rather than a zero that means two different things.
 */
export const InventoryRecipeComponentInput = z
  .object({
    inventoryItemId: Uuid,
    quantity: PositiveInventoryQuantity,
    conversionNumerator: z.number().int().min(1).max(9007199254740991).safe().default(1),
    conversionDenominator: z.number().int().min(1).max(9007199254740991).safe().default(1),
    roundingPolicy: InventoryRoundingPolicy.default('exact'),
    required: z.boolean().default(true),
  })
  .strict();
export type InventoryRecipeComponentInput = z.infer<typeof InventoryRecipeComponentInput>;

/** A stored component: the input plus what the server resolved it to. */
export const InventoryRecipeComponent = z
  .object({
    id: Uuid,
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    quantity: InventoryQuantity,
    conversionNumerator: z.number().int().min(1).max(9007199254740991).safe(),
    conversionDenominator: z.number().int().min(1).max(9007199254740991).safe(),
    roundingPolicy: InventoryRoundingPolicy,
    required: z.boolean(),
    /** Null when the item has no receipt: zero would be a lie (see costing). */
    unitCostMinor: MinorUnits.nullable(),
    lineCostMinor: MinorUnits.nullable(),
  })
  .strict();
export type InventoryRecipeComponent = z.infer<typeof InventoryRecipeComponent>;

export const InventoryRecipeQuery = z
  .object({
    cursor: OpaqueCursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    productId: Uuid.optional(),
    targetItemId: Uuid.optional(),
    /** A retired version stays readable: a plate cost moved and the owner asks why. */
    includeRetired: z.coerce.boolean().default(false),
  })
  .strict();
export type InventoryRecipeQuery = z.infer<typeof InventoryRecipeQuery>;

export const InventoryRecipe = z
  .object({
    id: Uuid,
    targetKind: InventoryRecipeTargetKind,
    productId: Uuid.nullable(),
    variantId: Uuid.nullable(),
    targetItemId: Uuid.nullable(),
    /**
     * The target's own name, read from the product or the item. It is DERIVED: a
     * recipe stores no name of its own, because the thing it names already has one
     * and a second copy would go stale on the next rename.
     */
    targetName: z.string().min(1).max(240),
    version: z.number().int().positive(),
    yieldQuantity: PositiveInventoryQuantity,
    shelfLifeDays: z.number().int().min(0).max(3650).nullable(),
    active: z.boolean(),
    effectiveAt: IsoTimestamp,
    retiredAt: IsoTimestamp.nullable(),
    components: z.array(InventoryRecipeComponent).max(200),
    costMinor: MinorUnits.nullable(),
    marginMinor: SignedMinorUnits.nullable(),
    /** How many other recipes name this one as a component. */
    usedInRecipeCount: z.number().int().min(0),
  })
  .strict();
export type InventoryRecipe = z.infer<typeof InventoryRecipe>;

export const InventoryRecipeList = z
  .object({
    recipes: z.array(InventoryRecipe).max(100),
    page: PageInfo,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryRecipeList = z.infer<typeof InventoryRecipeList>;

/**
 * A new recipe, at version 1. The target is exactly one of a product, a variant or
 * an inventory item, which is the database's own check (plan D2). A component list
 * of fewer than one line would be a recipe that consumes nothing, so it is refused
 * here rather than discovered at checkout.
 *
 * A VARIANT RECIPE NAMES THE PRODUCT TOO. `inventory_recipe` keeps `product_id`
 * NOT NULL for a product target, and its composite foreign key
 * `(product_id, variant_id) -> product_variant(product_id, id)` is what scopes the
 * variant to its product. A variant id alone would be a row the database refuses.
 */
export const InventoryRecipeCreateRequest = z
  .object({
    ...commandShape,
    targetKind: InventoryRecipeTargetKind,
    productId: Uuid.optional(),
    variantId: Uuid.optional(),
    targetItemId: Uuid.optional(),
    yieldQuantity: PositiveInventoryQuantity,
    shelfLifeDays: z.number().int().min(0).max(3650).optional(),
    components: z.array(InventoryRecipeComponentInput).min(1).max(200),
  })
  .strict()
  .refine(
    (value) =>
      value.targetKind === 'item'
        ? value.targetItemId !== undefined &&
          value.productId === undefined &&
          value.variantId === undefined
        : value.productId !== undefined && value.targetItemId === undefined,
    'targetKind item needs targetItemId alone. targetKind product needs productId, and may add variantId.',
  )
  .refine(
    (value) => value.variantId === undefined || value.targetKind === 'product',
    'variantId belongs to a product target.',
  );
export type InventoryRecipeCreateRequest = z.infer<typeof InventoryRecipeCreateRequest>;

/**
 * An edit writes a NEW IMMUTABLE VERSION (plan D3). The old row is retired, not
 * rewritten, so the cost the owner saw on the previous version stays explainable.
 * `expectedVersion` therefore names the version that was read, not the next one.
 */
export const InventoryRecipeUpdateRequest = z
  .object({
    ...commandShape,
    recipeId: Uuid,
    yieldQuantity: PositiveInventoryQuantity.optional(),
    shelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
    components: z.array(InventoryRecipeComponentInput).min(1).max(200).optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type InventoryRecipeUpdateRequest = z.infer<typeof InventoryRecipeUpdateRequest>;

/** Retire is the end of a recipe's life. The row and its cost history stay. */
export const InventoryRecipeRetireRequest = z
  .object({
    ...commandShape,
    recipeId: Uuid,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export type InventoryRecipeRetireRequest = z.infer<typeof InventoryRecipeRetireRequest>;

/**
 * The recipe exploded to raw items. `path` names the chain of recipes that reached
 * this item, so the same item reached by two chains appears twice and a cycle is
 * visible in the response rather than inferred.
 */
export const InventoryRecipeExplosionItem = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    quantity: InventoryQuantity,
    /**
     * FALSE when the exact rational of the explosion does not divide at this item's
     * scale. `quantity` then carries the FLOORED value and both costs are null,
     * because a cost built on a rounded quantity is a cost nobody can reconcile.
     * This mirrors the plate's `unit_conversion_not_exact` defect.
     */
    exact: z.boolean(),
    unitCostMinor: MinorUnits.nullable(),
    lineCostMinor: MinorUnits.nullable(),
    depth: z.number().int().min(1).max(12),
    path: z.array(Uuid).max(12),
  })
  .strict();
export type InventoryRecipeExplosionItem = z.infer<typeof InventoryRecipeExplosionItem>;

export const InventoryRecipeExplosion = z
  .object({
    recipeId: Uuid,
    targetKind: InventoryRecipeTargetKind,
    targetItemId: Uuid.nullable(),
    /** The deepest level this explosion reached. */
    depth: z.number().int().min(1).max(12),
    items: z.array(InventoryRecipeExplosionItem).max(1000),
  })
  .strict();
export type InventoryRecipeExplosion = z.infer<typeof InventoryRecipeExplosion>;

export const recipesModels = {
  // `UnitOfMeasure` and `InventoryItemType` are NOT listed: `posInventoryModels`
  // already publishes them, and two authors for one list is how a list drifts.
  InventoryAllergenCode,
  InventoryTrackingPolicy,
  InventoryNegativeStockPolicy,
  InventoryRoundingPolicy,
  InventoryQuantity,
  PositiveInventoryQuantity,
  InventoryAllergenQuery,
  InventoryAllergen,
  InventoryAllergenList,
  InventoryAllergenSetRequest,
  InventoryUnitConversion,
  InventoryUnitConversionSetRequest,
  InventoryUnitConversionList,
  InventoryAuthoringItemQuery,
  InventoryAuthoringItemOnHand,
  InventoryAuthoringItem,
  InventoryAuthoringItemList,
  InventoryAuthoringItemCreateRequest,
  InventoryAuthoringItemUpdateRequest,
  InventoryAuthoringItemArchiveRequest,
  InventoryAuthoringItemAllergenSetRequest,
  InventoryRecipeTargetKind,
  InventoryRecipeComponentInput,
  InventoryRecipeComponent,
  InventoryRecipeQuery,
  InventoryRecipe,
  InventoryRecipeList,
  InventoryRecipeCreateRequest,
  InventoryRecipeUpdateRequest,
  InventoryRecipeRetireRequest,
  InventoryRecipeExplosionItem,
  InventoryRecipeExplosion,
};
