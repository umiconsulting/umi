import { z } from 'zod';
import { CorrelationId, IsoTimestamp, MerchantDate, Uuid } from './platform';
import { NonNegativeScaledQuantity, ScaledQuantity, UnitOfMeasure } from './pos-inventory';

/**
 * Inventory costing — workstream E, steps 5 and 6 of the plan: "Add a costing view
 * per plate and per day" and "Add a low-stock forecast from the last 28 days of
 * sales".
 *
 * ── where the numbers come from, and where they do not ────────────────────────
 *
 * THERE IS NO COST COLUMN. `inventory_item` carries no price, and that is not an
 * oversight in the schema: a cost is what a supplier actually charged, and the only
 * two places that fact exists are `purchase_order_line.unit_cost_minor` (what was
 * ordered) and `purchase_order_receipt_line.actual_unit_cost_minor` (what actually
 * arrived and was paid for). This module averages the RECEIPTS, never the orders: an
 * order is an intention, and an intention that was never delivered is not a cost.
 *
 * AN ITEM WITH NO RECEIPT HAS NO COST, AND THE RESPONSE SAYS SO. It does not report
 * zero. A zero cost makes every margin a hundred percent, which is worse than saying
 * "we do not know" — and a plate built from such an item is reported `incomplete`
 * and NAMES the items, rather than being priced as if the ingredient were free.
 *
 * CONSUMPTION COMES FROM THE LEDGER, AND SO DOES THE MONEY. `stock_ledger_entry`
 * rows with `entry_type = 'sale_committed'` are what a sale actually took out of
 * stock, and `receipt_snapshot` is what that same sale was rung up at. Both carry
 * the same `business_date`, so a day's revenue and its cost of goods are read from
 * the same transactions rather than from two systems that might disagree.
 *
 * ── what this module cannot do, stated rather than hidden ─────────────────────
 *
 * The cost basis is the CURRENT weighted average, computed when the read runs. The
 * platform does not yet store a cost per receipt per sale, so a day six weeks ago is
 * re-costed at today's average, and `costBasis.asOf` names the moment. That is a
 * real limitation, not a rounding detail, and a caller that needs an audited
 * historical cost needs an explicit cost layer that does not exist yet.
 *
 * MONEY IS INTEGER MINOR UNITS AND QUANTITIES ARE SCALED INTEGERS, as everywhere
 * else on this platform. There is no float in this file, and `z.number().int().safe()`
 * is what refuses one.
 */

/** Integer minor units (centavos). The shape every amount in this file uses. */
const MinorUnits = z.number().int().min(0).safe();

/** A signed amount in minor units: a margin can be negative. */
const SignedMinorUnits = z.number().int().safe();

/**
 * Basis points, not a percentage float: 42 percent is 4200 and stays an integer.
 * The platform's tax rates are stored the same way and for the same reason.
 */
const BasisPoints = z.number().int().safe();

/**
 * How a cost number was arrived at. Spelled out in the payload so a client never has
 * to guess, and so a second basis (a moving average, a landed cost) can arrive later
 * without silently changing what the existing numbers mean.
 */
export const CostBasisKind = z.enum(['weighted_average_of_receipts', 'no_receipts']);
export type CostBasisKind = z.infer<typeof CostBasisKind>;

/**
 * Why a plate could not be costed. A typed reason rather than a sentence: the
 * dashboard has to render a different action for each one.
 *
 *   no_inventory_mapping  nothing in the catalogue says what this product consumes
 *   no_recipe_components  the mapping points at a recipe that has no components
 *   no_cost_basis         a component has never been received, so it has no cost
 *   non_stock_mapping     the product is deliberately not stocked; its cost is unknown
 *   unit_conversion_not_exact  the recipe does not divide into whole units of the
 *                              item at its own scale — the sale path refuses this
 *                              too, so the plate could not have been sold as written
 */
export const PlateCostDefect = z.enum([
  'no_inventory_mapping',
  'no_recipe_components',
  'no_cost_basis',
  'non_stock_mapping',
  'unit_conversion_not_exact',
]);
export type PlateCostDefect = z.infer<typeof PlateCostDefect>;

export const PlateCostState = z.enum(['complete', 'incomplete', 'not_costed']);
export type PlateCostState = z.infer<typeof PlateCostState>;

/** One item a plate's cost could not be built without, named so it can be fixed. */
export const UncostedItem = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    /** Null when the failure is not about this item's cost (see `reason`). */
    defect: PlateCostDefect,
  })
  .strict();
export type UncostedItem = z.infer<typeof UncostedItem>;

// ── The cost basis, per item ────────────────────────────────────────────────

export const InventoryCostBasisQuery = z
  .object({
    /** Omitted: every tracked item. False (the default) hides items with no receipt. */
    includeWithoutReceipts: z.coerce.boolean().default(false),
  })
  .strict();
export type InventoryCostBasisQuery = z.infer<typeof InventoryCostBasisQuery>;

/**
 * One item's cost basis.
 *
 * `unitCostMinor` is the cost of ONE WHOLE BASE UNIT — per kilogram, per piece, per
 * box — which is the unit `purchase_order_line.unit_cost_minor` and
 * `purchase_order_receipt_line.actual_unit_cost_minor` are both written in. A
 * component's cost is therefore (its scaled quantity x this number / 10^scale), and
 * never a number with a decimal point.
 */
export const InventoryItemCostBasis = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    baseUnit: z.string().min(1).max(20),
    quantityScale: z.number().int().min(0).max(6),
    basis: CostBasisKind,
    /** Null when `basis` is `no_receipts`. Never zero as a stand-in. */
    unitCostMinor: MinorUnits.nullable(),
    /** Distinct receipts the average rests on. Zero when there are none. */
    receiptCount: z.number().int().min(0),
    /** Receipt LINES: one delivery of three items is one receipt and three lines. */
    receiptLineCount: z.number().int().min(0),
    /** Total received quantity the average is weighted by, at the item's scale. */
    receivedQuantity: NonNegativeScaledQuantity,
    /** The cheapest and dearest receipts behind the average, so a spread is visible. */
    lowestUnitCostMinor: MinorUnits.nullable(),
    highestUnitCostMinor: MinorUnits.nullable(),
  })
  .strict();
export type InventoryItemCostBasis = z.infer<typeof InventoryItemCostBasis>;

export const InventoryCostBasisList = z
  .object({
    items: z.array(InventoryItemCostBasis).max(1000),
    /**
     * The scope this read used. The basis is MERCHANT-WIDE on purpose: one item has
     * one cost per business, and a per-branch average would make the same plate cost
     * two different numbers depending on who looked. `receiptLocations` names the
     * branches the receipts came from so the scope is never a mystery.
     */
    receiptLocations: z.array(z.object({ locationId: Uuid, locationName: z.string() })).max(200),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryCostBasisList = z.infer<typeof InventoryCostBasisList>;

// ── The plate ───────────────────────────────────────────────────────────────

export const InventoryPlateQuery = z
  .object({
    productId: Uuid.optional(),
    variantId: Uuid.optional(),
    /**
     * Include active products whose catalogue entry maps to no stock at all, so the
     * screen can show what has no recipe rather than only what has one.
     */
    includeUnmapped: z.coerce.boolean().default(false),
    /** The window the "stock it consumed" columns cover, in business dates. */
    consumptionFrom: MerchantDate.optional(),
    consumptionTo: MerchantDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(200),
  })
  .strict();
export type InventoryPlateQuery = z.infer<typeof InventoryPlateQuery>;

export const InventoryPlateComponent = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    /** What ONE plate is built from, per the recipe or the direct mapping. */
    quantity: NonNegativeScaledQuantity,
    unitCostMinor: MinorUnits.nullable(),
    /** Null when this component has no cost basis. Zero would be a lie. */
    lineCostMinor: MinorUnits.nullable(),
    hasCostBasis: z.boolean(),
    /**
     * What this item ACTUALLY left stock over the consumption window, from the
     * ledger — not the recipe. A modifier's extra portion is included here even
     * though it is not part of the base recipe.
     */
    consumedQuantity: NonNegativeScaledQuantity,
    /**
     * `direct` and `recipe_component` are the base plate. `modifier_component` is
     * stock a SALE consumed that the base recipe does not name — an extra portion — so
     * its planned quantity is zero and its money is in the day's cost of goods rather
     * than in the plate's recipe cost. Reporting it here is the difference between
     * "the plate is made of this" and "this left the shelf because of this plate".
     */
    source: z.enum(['direct', 'recipe_component', 'modifier_component']),
  })
  .strict();
export type InventoryPlateComponent = z.infer<typeof InventoryPlateComponent>;

export const InventoryPlate = z
  .object({
    productId: Uuid,
    productName: z.string().min(1).max(240),
    productActive: z.boolean(),
    variantId: Uuid.nullable(),
    variantName: z.string().min(1).max(160).nullable(),
    /** Null when the product has no active mapping: nothing says what it consumes. */
    mappingType: z.enum(['direct', 'recipe', 'bundle', 'non_stock']).nullable(),
    /** Menu price: the product's own price plus the variant's delta, in minor units. */
    priceMinor: MinorUnits,
    /** Null when the plate is not fully costed. NEVER 0 as a stand-in for unknown. */
    costMinor: MinorUnits.nullable(),
    marginMinor: SignedMinorUnits.nullable(),
    marginBasisPoints: BasisPoints.nullable(),
    state: PlateCostState,
    /** Why it is not `complete`. Empty when it is. */
    defects: z.array(PlateCostDefect).max(10),
    uncostedItems: z.array(UncostedItem).max(500),
    components: z.array(InventoryPlateComponent).max(1000),
  })
  .strict();
export type InventoryPlate = z.infer<typeof InventoryPlate>;

export const InventoryPlateList = z
  .object({
    plates: z.array(InventoryPlate).max(200),
    /**
     * The window the consumption columns cover, echoed rather than left implicit:
     * a rate or a total with no stated window is a number nobody can check.
     */
    consumptionFrom: MerchantDate,
    consumptionTo: MerchantDate,
    /** True when more plates exist than `limit` allowed. */
    truncated: z.boolean(),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryPlateList = z.infer<typeof InventoryPlateList>;

// ── The day ─────────────────────────────────────────────────────────────────

export const InventoryCostingDayQuery = z
  .object({
    locationId: Uuid.optional(),
    from: MerchantDate.optional(),
    to: MerchantDate.optional(),
  })
  .strict();
export type InventoryCostingDayQuery = z.infer<typeof InventoryCostingDayQuery>;

export const InventoryCostingDay = z
  .object({
    businessDate: MerchantDate,
    /**
     * Net of tax: the receipt's own `subtotal`, which is what a margin is measured
     * against. `grandTotalMinor` carries the tax-inclusive figure the drawer holds,
     * so the two reconcile instead of competing.
     */
    revenueMinor: MinorUnits,
    grandTotalMinor: MinorUnits,
    costMinor: MinorUnits.nullable(),
    marginMinor: SignedMinorUnits.nullable(),
    marginBasisPoints: BasisPoints.nullable(),
    /** Committed sales (tickets) on the day. */
    salesCount: z.number().int().min(0),
    /** Units rung up: the sum of the sale lines' quantities. */
    platesSold: z.number().int().min(0),
    /**
     * Sale lines whose product nothing maps, so nobody recorded what they consumed.
     *
     * THIS IS WHY `state` CAN BE `incomplete` ON A DAY WITH NO UNCOSTED ITEM. A day whose
     * sales took nothing off the shelf is not a day with free ingredients; it is a day
     * nobody tracked. Reporting cost 0 and margin 100 percent for it is the same lie as
     * reporting a zero cost for an item that was never received, one level up — and it is
     * the more dangerous one, because it looks like good news.
     */
    salesLinesWithoutMapping: z.number().int().min(0),
    /** The products behind that count, capped, so a screen can name them. */
    uncostedProducts: z
      .array(
        z
          .object({
            productId: Uuid,
            productName: z.string().min(1).max(240),
          })
          .strict(),
      )
      .max(200),
    state: PlateCostState,
    uncostedItems: z.array(UncostedItem).max(500),
  })
  .strict();
export type InventoryCostingDay = z.infer<typeof InventoryCostingDay>;

export const InventoryCostingDays = z
  .object({
    days: z.array(InventoryCostingDay).max(400),
    from: MerchantDate,
    to: MerchantDate,
    /** Null means every branch of the merchant. */
    locationId: Uuid.nullable(),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryCostingDays = z.infer<typeof InventoryCostingDays>;

// ── The low-stock forecast ──────────────────────────────────────────────────

export const LowStockForecastQuery = z
  .object({
    locationId: Uuid.optional(),
    /** The window the rate is measured over. The plan names 28 days. */
    windowDays: z.coerce.number().int().min(1).max(180).default(28),
    /** Return only items already below their own threshold. */
    belowThresholdOnly: z.coerce.boolean().default(false),
  })
  .strict();
export type LowStockForecastQuery = z.infer<typeof LowStockForecastQuery>;

/**
 * One item's forecast.
 *
 * `observedDays` is the honest denominator and it is NOT always the window. An item
 * whose first sale was four days ago has four days of history; dividing its
 * consumption by 28 would invent 24 days of quiet and report a rate far below what
 * the kitchen is actually using, which then reports days of cover that are far too
 * generous. So the rate divides by the days the item was actually observed, and
 * `insufficientHistory` says when that is fewer than the window.
 */
export const LowStockForecastItem = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    baseUnit: z.string().min(1).max(20),
    quantityScale: z.number().int().min(0).max(6),
    /** Summed across the reported location scope. */
    onHand: NonNegativeScaledQuantity,
    lowStockThreshold: NonNegativeScaledQuantity.nullable(),
    belowThreshold: z.boolean(),
    consumedQuantity: NonNegativeScaledQuantity,
    /** Consumption per day at the item's own scale, rounded to the nearest unit. */
    dailyRateQuantity: NonNegativeScaledQuantity.nullable(),
    /** Whole days of cover, floored. Null when nothing was consumed. */
    daysOfCover: z.number().int().min(0).safe().nullable(),
    /** Distinct trading days in the window on which this item was consumed. */
    daysWithConsumption: z.number().int().min(0),
    observedDays: z.number().int().min(0),
    insufficientHistory: z.boolean(),
    hasCostBasis: z.boolean(),
    unitCostMinor: MinorUnits.nullable(),
    /** On-hand value at the current cost basis. Null when there is no basis. */
    onHandValueMinor: MinorUnits.nullable(),
  })
  .strict();
export type LowStockForecastItem = z.infer<typeof LowStockForecastItem>;

export const LowStockForecast = z
  .object({
    items: z.array(LowStockForecastItem).max(1000),
    /** The window, stated in the response rather than left implicit. */
    from: MerchantDate,
    to: MerchantDate,
    windowDays: z.number().int().min(1).max(180),
    locationId: Uuid.nullable(),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type LowStockForecast = z.infer<typeof LowStockForecast>;

// ── Usage variance (recipes module plan §9) ─────────────────────────────────
//
// THE VARIANCE IS COMPUTED ON READ, AND IT NAMES ITS PARTS (plan D6 and D7). A
// materialised variance row would drift from the ledger, and the ledger is the door
// every stock movement already uses. The report decomposes the difference by ledger
// entry type, and the unexplained remainder is the headline number: one total hides
// the reason.
//
// ACTUAL USAGE IS A SUBTRACTION, so it is signed. Opening plus receipts plus
// production produced, minus closing, can legitimately come out negative when a
// count correction lands, and a schema that refused it would refuse a true answer.
// The quantities that only ever add stock stay non-negative.

export const InventoryUsageVarianceQuery = z
  .object({
    locationId: Uuid.optional(),
    from: MerchantDate.optional(),
    to: MerchantDate.optional(),
    inventoryItemId: Uuid.optional(),
  })
  .strict();
export type InventoryUsageVarianceQuery = z.infer<typeof InventoryUsageVarianceQuery>;

export const InventoryUsageVarianceLine = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    unit: UnitOfMeasure,
    quantityScale: z.number().int().min(0).max(6),
    openingQuantity: NonNegativeScaledQuantity,
    receivedQuantity: NonNegativeScaledQuantity,
    productionProducedQuantity: NonNegativeScaledQuantity,
    closingQuantity: NonNegativeScaledQuantity,
    /** Opening + receipts + produced − closing. See the note above the block. */
    actualUsageQuantity: ScaledQuantity,
    /** The sum over the period's sales of every component, exploded to raw items. */
    theoreticalUsageQuantity: NonNegativeScaledQuantity,
    /** Actual − theoretical. Waste and damage explain part of it, never all of it. */
    varianceQuantity: ScaledQuantity,
    wasteQuantity: NonNegativeScaledQuantity,
    damageQuantity: NonNegativeScaledQuantity,
    /** A correction can add stock as well as take it, so it is signed. */
    countCorrectionQuantity: ScaledQuantity,
    yieldLossQuantity: NonNegativeScaledQuantity,
    /** What no named effect explains. This is the number an owner acts on. */
    unexplainedQuantity: ScaledQuantity,
  })
  .strict();
export type InventoryUsageVarianceLine = z.infer<typeof InventoryUsageVarianceLine>;

export const InventoryUsageVariance = z
  .object({
    /**
     * WHAT POOL THE NUMBERS MEASURE, stated rather than left to the reader. Every
     * quantity in this answer is on the AVAILABLE basis: on-hand minus reserved,
     * damaged and quarantined. That is the pool the kitchen can actually cook from,
     * and it is the only basis on which a damaged or quarantined item can appear as
     * usage at all — neither of those moves on-hand.
     */
    basis: z.literal('available_stock'),
    lines: z.array(InventoryUsageVarianceLine).max(1000),
    from: MerchantDate,
    to: MerchantDate,
    locationId: Uuid.nullable(),
    totalVarianceQuantity: ScaledQuantity,
    totalUnexplainedQuantity: ScaledQuantity,
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryUsageVariance = z.infer<typeof InventoryUsageVariance>;

// ── Recipe cost history (plan D3 and §9.5) ──────────────────────────────────

export const InventoryRecipeCostQuery = z
  .object({
    recipeId: Uuid.optional(),
    productId: Uuid.optional(),
    from: MerchantDate.optional(),
    to: MerchantDate.optional(),
  })
  .strict();
export type InventoryRecipeCostQuery = z.infer<typeof InventoryRecipeCostQuery>;

/**
 * The cost one recipe version computed when its inputs changed. A daily cost per
 * recipe would copy the ledger, so a point exists only where the version changed.
 */
export const InventoryRecipeCostPoint = z
  .object({
    recipeId: Uuid,
    version: z.number().int().positive(),
    effectiveAt: IsoTimestamp,
    retiredAt: IsoTimestamp.nullable(),
    /** Null when the version could not be costed. Zero would be a lie. */
    costMinor: MinorUnits.nullable(),
    /** Why it could not be costed, using the plate's own defect vocabulary. */
    defects: z.array(PlateCostDefect).max(10),
    capturedAt: IsoTimestamp,
  })
  .strict();
export type InventoryRecipeCostPoint = z.infer<typeof InventoryRecipeCostPoint>;

export const InventoryRecipeCostHistory = z
  .object({
    recipes: z
      .array(
        z
          .object({
            recipeId: Uuid,
            productId: Uuid.nullable(),
            targetItemId: Uuid.nullable(),
            /**
             * The target's own name, read from the product or the item. A recipe
             * stores no name of its own.
             */
            targetName: z.string().min(1).max(240),
            points: z.array(InventoryRecipeCostPoint).max(500),
          })
          .strict(),
      )
      .max(200),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type InventoryRecipeCostHistory = z.infer<typeof InventoryRecipeCostHistory>;

// ── The prep list (plan D13 and §8.4) ───────────────────────────────────────

export const PrepListQuery = z
  .object({
    locationId: Uuid.optional(),
    /** Show the items already above par, so the board is not only a shortage list. */
    includeAbovePar: z.coerce.boolean().default(false),
  })
  .strict();
export type PrepListQuery = z.infer<typeof PrepListQuery>;

export const PrepListItem = z
  .object({
    inventoryItemId: Uuid,
    publicReference: z.string().min(1).max(80),
    displayName: z.string().min(1).max(160),
    unit: UnitOfMeasure,
    quantityScale: z.number().int().min(0).max(6),
    /** Null when the item has no par. Then nothing says how much to prepare. */
    parQuantity: NonNegativeScaledQuantity.nullable(),
    onHandQuantity: NonNegativeScaledQuantity,
    /** Forecast usage over the shelf-life window. The forecast read already exists. */
    forecastUsageQuantity: NonNegativeScaledQuantity,
    /** Par − on hand − forecast usage, floored at zero. */
    prepQuantity: NonNegativeScaledQuantity,
    shelfLifeDays: z.number().int().min(0).max(3650).nullable(),
    /** The date a batch produced today would expire, from the shelf life. */
    expiresOn: MerchantDate.nullable(),
  })
  .strict();
export type PrepListItem = z.infer<typeof PrepListItem>;

/**
 * THE PREP LIST AS THE TILL ASKS FOR IT. It extends the console's own query with the two
 * facts a POS read has to prove, which the console proves with a browser session
 * instead: WHICH operator session is asking, and WHICH branch it is asking about. Both
 * are required here, because the POS guard resolves them and refuses without them. A
 * prep list is stock information, and stock is scoped to a branch.
 *
 * It lives in this file rather than beside the other POS models because `PrepListQuery`
 * does, and importing this module from `pos-inventory.ts` would close a cycle the two
 * already nearly share.
 */
export const PosPrepListQuery = PrepListQuery.extend({
  locationId: Uuid,
  operatorSessionId: Uuid,
}).strict();
export type PosPrepListQuery = z.infer<typeof PosPrepListQuery>;

export const PrepList = z
  .object({
    items: z.array(PrepListItem).max(1000),
    locationId: Uuid.nullable(),
    /** The window the forecast usage covers, stated rather than left implicit. */
    from: MerchantDate,
    to: MerchantDate,
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type PrepList = z.infer<typeof PrepList>;

// ── Menu engineering (plan D16 and §9.5) ────────────────────────────────────

/** Margin times popularity: a star, a plow horse, a puzzle or a dog. */
export const MenuEngineeringClass = z.enum(['star', 'plow_horse', 'puzzle', 'dog', 'unclassified']);
export type MenuEngineeringClass = z.infer<typeof MenuEngineeringClass>;

export const MenuEngineeringQuery = z
  .object({
    locationId: Uuid.optional(),
    from: MerchantDate.optional(),
    to: MerchantDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(200),
  })
  .strict();
export type MenuEngineeringQuery = z.infer<typeof MenuEngineeringQuery>;

export const MenuEngineeringItem = z
  .object({
    productId: Uuid,
    productName: z.string().min(1).max(240),
    soldQuantity: z.number().int().min(0).safe(),
    priceMinor: MinorUnits,
    /** Null when the plate is not fully costed: its class is then `unclassified`. */
    plateCostMinor: MinorUnits.nullable(),
    marginMinor: SignedMinorUnits.nullable(),
    marginBasisPoints: BasisPoints.nullable(),
    /** This item's share of units sold over the period, in basis points. */
    popularityShareBasisPoints: BasisPoints,
    /** This item's share of the period's margin, in basis points. */
    marginShareBasisPoints: BasisPoints,
    classification: MenuEngineeringClass,
  })
  .strict();
export type MenuEngineeringItem = z.infer<typeof MenuEngineeringItem>;

export const MenuEngineering = z
  .object({
    items: z.array(MenuEngineeringItem).max(200),
    from: MerchantDate,
    to: MerchantDate,
    locationId: Uuid.nullable(),
    asOf: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type MenuEngineering = z.infer<typeof MenuEngineering>;

export const inventoryCostingModels = {
  CostBasisKind,
  PlateCostDefect,
  PlateCostState,
  UncostedItem,
  InventoryCostBasisQuery,
  InventoryItemCostBasis,
  InventoryCostBasisList,
  InventoryPlateQuery,
  InventoryPlateComponent,
  InventoryPlate,
  InventoryPlateList,
  InventoryCostingDayQuery,
  InventoryCostingDay,
  InventoryCostingDays,
  LowStockForecastQuery,
  LowStockForecastItem,
  LowStockForecast,
  InventoryUsageVarianceQuery,
  InventoryUsageVarianceLine,
  InventoryUsageVariance,
  InventoryRecipeCostQuery,
  InventoryRecipeCostPoint,
  InventoryRecipeCostHistory,
  PrepListQuery,
  PrepListItem,
  PrepList,
  PosPrepListQuery,
  MenuEngineeringClass,
  MenuEngineeringQuery,
  MenuEngineeringItem,
  MenuEngineering,
};
