import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * The reads behind the costing view (plan §8E steps 5 and 6), against the real
 * schema.
 *
 * WHAT THIS FILE DOES AND DOES NOT DO. It does the joins — which is what SQL is for
 * — and it does NO money arithmetic. Every row it returns is integers or text that
 * becomes integers, and the sums, averages and roundings happen in
 * `inventory-costing-domain.ts`, where they are tested by property. The reason is
 * not architectural purity: `numeric` in Postgres and `number` in JavaScript would
 * both happily round a money value twice, and the one place a single rounding step
 * can be guaranteed is one function with one caller.
 *
 * SO WHY IS THE RECIPE EXPANSION STILL IN SQL? Because it is not arithmetic, it is a
 * JOIN — a product resolves to a mapping, a mapping to a recipe, a recipe to its
 * components — and the expression below is copied from
 * `pos-checkout.repository.ts`, which is the code that actually writes the
 * consumption ledger. A cost that disagrees with the consumption it is costing is
 * worse than no cost, so the conversion maths has to be the same maths, and the only
 * honest way to have the same maths twice is to have the same expression twice with
 * a comment saying why — which this is.
 */

/** One item's receipts, aggregated by (scale, unit cost). */
export type CostBucketRow = {
  inventoryItemId: string;
  scale: number;
  unitCostMinor: string;
  quantity: string;
};

export type ReceiptCountRow = {
  inventoryItemId: string;
  receiptCount: string;
  receiptLineCount: string;
};

export type ReceiptLocationRow = { locationId: string; locationName: string };

export type ItemRow = {
  inventoryItemId: string;
  publicReference: string;
  displayName: string;
  baseUnit: string;
  quantityScale: number;
  lowStockThreshold: string | null;
  active: boolean;
};

export type PlateMappingRow = {
  mappingId: string;
  productId: string;
  productName: string;
  productActive: boolean;
  productPriceMinor: string;
  variantId: string | null;
  variantName: string | null;
  variantPriceDeltaMinor: string;
  mappingType: 'direct' | 'recipe' | 'bundle' | 'non_stock';
};

export type PlateComponentRow = {
  mappingId: string;
  inventoryItemId: string;
  source: 'direct' | 'recipe_component';
  /** Null when the recipe does not divide into whole units of the item's scale. */
  quantity: string | null;
  quantityScale: number;
};

export type ConsumptionRow = {
  productId: string | null;
  variantId: string | null;
  inventoryItemId: string;
  scale: number;
  quantity: string;
};

export type DayRevenueRow = {
  businessDate: string;
  revenueMinor: string;
  grandTotalMinor: string;
  salesCount: string;
};

export type DayPlatesRow = { businessDate: string; platesSold: string };

/**
 * A sale line on a product NOTHING maps: the stock it consumed was never recorded, so the
 * day's cost of goods is unknown rather than zero.
 */
export type DayUnmappedRow = {
  businessDate: string;
  productId: string;
  productName: string;
  lines: string;
};

export type DayConsumptionRow = {
  businessDate: string;
  inventoryItemId: string;
  scale: number;
  quantity: string;
};

export type LowStockBucketRow = {
  inventoryItemId: string;
  scale: number;
  quantity: string;
};

/**
 * The denominator of the rate, kept apart from the quantity buckets on purpose: a day
 * count is scale-independent, so summing it per bucket would count a day twice if an
 * item's scale ever changed mid-window.
 */
export type LowStockDayStatsRow = {
  inventoryItemId: string;
  daysWithConsumption: string;
  firstConsumption: string;
};

export type OnHandRow = { inventoryItemId: string; onHand: string };

/**
 * One item's ledger, summed per (item, scale) over three windows at once: everything
 * BEFORE the period (the opening), everything UP TO its end (the closing), and the
 * period's own named effects.
 *
 * THE AVAILABLE BASIS IS SUMMED, not `quantity`: `effect_on_hand - effect_reserved -
 * effect_damaged - effect_quarantine` is the pool the availability guard measures, and
 * it is the only basis on which a damaged or quarantined item shows as usage at all,
 * because neither of those moves on-hand.
 */
export type VarianceLedgerRow = {
  inventoryItemId: string;
  scale: number;
  opening: string;
  closing: string;
  received: string;
  produced: string;
  waste: string;
  damage: string;
  countCorrection: string;
  yieldLoss: string;
};

/**
 * One term of the theoretical usage: the product quantity sold times the exact
 * rational quantity of one raw item the sale therefore consumed. The division happens
 * in the service, where the module's one rounding rule lives.
 */
export type TheoreticalUsageRow = {
  inventoryItemId: string;
  numerator: string;
  denominator: string;
};

/** What the menu sold in the window, per product and variant, with its own price. */
export type SoldProductRow = {
  productId: string;
  variantId: string | null;
  productName: string;
  soldQuantity: string;
  soldPriceMinor: string;
};

/** One recipe version in the cost-history window, with its stored point if it has one. */
export type RecipeCostVersionRow = {
  recipeId: string;
  productId: string | null;
  variantId: string | null;
  targetItemId: string | null;
  targetName: string;
  version: number;
  effectiveAt: string;
  retiredAt: string | null;
  computedCostMinor: string | null;
  computedDefects: string[] | null;
  computedAt: string | null;
};

/** One row of the cost history's own explosion of a version. See `readRecipeCostRows`. */
export type RecipeCostRow = {
  recipeId: string;
  inventoryItemId: string;
  numerator: string;
  denominator: string;
  quantityScale: number;
  hasRecipe: boolean;
};

@Injectable()
export class InventoryCostingRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * The merchant's own trading day, derived exactly as `merchant.tg_business_date`
   * derives it for a sale: `(now at the merchant's timezone - business_day_start)`.
   * Read here rather than computed in TypeScript because the timezone database is the
   * database's, and a café whose day ends at 04:00 must get the same answer from the
   * report as the till gets when it writes a sale.
   */
  currentBusinessDate(merchantId: string): Promise<string> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<{ businessDate: string }>(
        `SELECT ((now() AT TIME ZONE m.timezone) - m.business_day_start::interval)::date::text
                AS "businessDate"
           FROM merchant.merchant m WHERE m.id = $1::uuid`,
        [merchantId],
      );
      const date = result.rows[0]?.businessDate;
      if (!date) throw new Error(`currentBusinessDate: no merchant ${merchantId}`);
      return date;
    });
  }

  /**
   * THE COST BASIS, from received goods only.
   *
   * `purchase_order_receipt_line`, never `purchase_order_line`: an order is what the
   * business intended to pay, and a receipt is what it did pay. The average is
   * quantity-weighted, so it is grouped by (item, scale, unit cost) and the weighting
   * happens in the domain module.
   *
   * NO LOCATION FILTER, deliberately. The basis is merchant-wide: one item has one
   * cost per business, and a per-branch average would make the same plate cost two
   * numbers depending on who looked. Where the receipts came from is returned
   * alongside so the scope is visible rather than implied.
   */
  readCostBasis(merchantId: string): Promise<{
    buckets: CostBucketRow[];
    counts: ReceiptCountRow[];
    locations: ReceiptLocationRow[];
  }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const buckets = await client.query<CostBucketRow>(
        `SELECT rl.inventory_item_id::text AS "inventoryItemId",
                rl.quantity_scale AS "scale",
                rl.actual_unit_cost_minor::text AS "unitCostMinor",
                sum(rl.received_quantity)::text AS "quantity"
           FROM merchant.purchase_order_receipt_line rl
          WHERE rl.merchant_id = $1::uuid
          GROUP BY 1, 2, 3`,
        [merchantId],
      );
      const counts = await client.query<ReceiptCountRow>(
        `SELECT rl.inventory_item_id::text AS "inventoryItemId",
                count(DISTINCT rl.receipt_id)::text AS "receiptCount",
                count(*)::text AS "receiptLineCount"
           FROM merchant.purchase_order_receipt_line rl
          WHERE rl.merchant_id = $1::uuid
          GROUP BY 1`,
        [merchantId],
      );
      const locations = await client.query<ReceiptLocationRow>(
        `SELECT DISTINCT r.location_id::text AS "locationId", l.name AS "locationName"
           FROM merchant.purchase_order_receipt r
           JOIN merchant.location l
             ON l.id = r.location_id AND l.merchant_id = r.merchant_id
          WHERE r.merchant_id = $1::uuid
          ORDER BY l.name`,
        [merchantId],
      );
      return { buckets: buckets.rows, counts: counts.rows, locations: locations.rows };
    });
  }

  items(merchantId: string): Promise<ItemRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<ItemRow>(
        `SELECT id::text AS "inventoryItemId", public_reference AS "publicReference",
                display_name AS "displayName", base_unit AS "baseUnit",
                quantity_scale AS "quantityScale",
                low_stock_threshold::text AS "lowStockThreshold", active
           FROM merchant.inventory_item
          WHERE merchant_id = $1::uuid
          ORDER BY display_name`,
        [merchantId],
      );
      return result.rows;
    });
  }

  /**
   * The plates: one per ACTIVE mapping, which is the unit the cart resolves against.
   *
   * `productId`/`variantId` narrow to a single plate when a screen asks for one.
   * `includeUnmapped` adds active products with no active mapping at all, so the view
   * can name what has no recipe rather than only drawing what has one.
   */
  readPlates(
    merchantId: string,
    filter: { productId: string | null; variantId: string | null; includeUnmapped: boolean },
  ): Promise<{ mappings: PlateMappingRow[]; components: PlateComponentRow[] }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const mappings = await client.query<PlateMappingRow>(
        `SELECT m.id::text AS "mappingId", p.id::text AS "productId", p.name AS "productName",
                p.active AS "productActive", p.price::text AS "productPriceMinor",
                m.variant_id::text AS "variantId", v.name AS "variantName",
                coalesce(v.price_delta, 0)::text AS "variantPriceDeltaMinor",
                m.mapping_type AS "mappingType"
           FROM merchant.inventory_catalog_mapping m
           JOIN merchant.product p
             ON p.id = m.product_id AND p.merchant_id = m.merchant_id
           LEFT JOIN merchant.product_variant v
             ON v.id = m.variant_id AND v.merchant_id = m.merchant_id
          WHERE m.merchant_id = $1::uuid AND m.active
            AND ($2::uuid IS NULL OR m.product_id = $2::uuid)
            AND ($3::uuid IS NULL OR m.variant_id = $3::uuid)
          UNION ALL
          -- The products nothing maps. Only when the caller asks: the default list is
          -- "plates we can price", and a screen that wants the gaps asks for them.
          SELECT NULL::text, p.id::text, p.name, p.active, p.price::text,
                 NULL::text, NULL::text, '0', 'non_stock'
            FROM merchant.product p
           WHERE $4::boolean AND p.merchant_id = $1::uuid AND p.active
             AND ($2::uuid IS NULL OR p.id = $2::uuid)
             AND $3::uuid IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM merchant.inventory_catalog_mapping m
                WHERE m.merchant_id = p.merchant_id AND m.product_id = p.id AND m.active
             )
          ORDER BY "productName", "variantName" NULLS FIRST`,
        [merchantId, filter.productId, filter.variantId, filter.includeUnmapped],
      );

      const components = await client.query<PlateComponentRow>(
        `WITH chosen AS (
           SELECT m.id AS mapping_id, m.merchant_id, m.mapping_type, m.inventory_item_id,
                  m.recipe_id, m.conversion_numerator, m.conversion_denominator
             FROM merchant.inventory_catalog_mapping m
            WHERE m.merchant_id = $1::uuid AND m.active
              AND ($2::uuid IS NULL OR m.product_id = $2::uuid)
              AND ($3::uuid IS NULL OR m.variant_id = $3::uuid)
         ), expanded AS (
           -- A DIRECT mapping: one plate consumes numerator/denominator whole base units.
           SELECT c.mapping_id, c.inventory_item_id AS item_id, 'direct'::text AS source,
                  c.conversion_numerator::numeric AS numerator,
                  c.conversion_denominator::numeric AS denominator
             FROM chosen c
            WHERE c.mapping_type = 'direct'
           UNION ALL
           -- A RECIPE: the same expression pos-checkout.repository.ts resolves a sold
           -- line with, with the cart line quantity fixed at one plate and the modifier
           -- term fixed at one — because this is the BASE recipe. A modifier's extra
           -- portion is real consumption and it shows up in the consumed columns from
           -- the ledger, not here.
           SELECT c.mapping_id, rc.inventory_item_id,
                  'recipe_component'::text,
                  (rc.quantity * rc.conversion_numerator *
                   power(10::numeric, r.yield_scale + i.quantity_scale)),
                  (r.yield_quantity::numeric * rc.conversion_denominator *
                   power(10::numeric, rc.quantity_scale))
             FROM chosen c
             JOIN merchant.inventory_recipe r
               ON r.id = c.recipe_id AND r.merchant_id = c.merchant_id AND r.active
             JOIN merchant.inventory_recipe_component rc
               ON rc.recipe_id = r.id AND rc.merchant_id = r.merchant_id
             JOIN merchant.inventory_item i
               ON i.id = rc.inventory_item_id AND i.merchant_id = rc.merchant_id
            WHERE c.mapping_type IN ('recipe', 'bundle') AND rc.modifier_id IS NULL
         )
         SELECT e.mapping_id::text AS "mappingId",
                e.item_id::text AS "inventoryItemId",
                e.source,
                CASE WHEN mod(e.numerator, e.denominator) = 0
                     THEN (e.numerator / e.denominator)::bigint::text ELSE NULL END AS quantity,
                i.quantity_scale AS "quantityScale"
           FROM expanded e
           JOIN merchant.inventory_item i
             ON i.id = e.item_id AND i.merchant_id = $1::uuid
          ORDER BY e.mapping_id, e.item_id`,
        [merchantId, filter.productId, filter.variantId],
      );
      return { mappings: mappings.rows, components: components.rows };
    });
  }

  /**
   * What a product ACTUALLY consumed, from the ledger, over a window.
   *
   * The join is `sale_line_id → pos_cart_line`, which is how a ledger row knows which
   * catalogue item took the stock out. A ledger row written by a modifier's component
   * points at the same sale line as the base recipe, so those extra portions are
   * included — which is what "the stock it consumed" means.
   */
  readPlateConsumption(merchantId: string, from: string, to: string): Promise<ConsumptionRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<ConsumptionRow>(
        `SELECT l.product_id::text AS "productId", l.variant_id::text AS "variantId",
                le.inventory_item_id::text AS "inventoryItemId",
                le.quantity_scale AS "scale",
                sum(le.quantity)::text AS "quantity"
           FROM merchant.stock_ledger_entry le
           JOIN merchant.pos_cart_line l
             ON l.id = le.sale_line_id AND l.merchant_id = le.merchant_id
          WHERE le.merchant_id = $1::uuid
            AND le.entry_type = 'sale_committed'
            AND le.business_date BETWEEN $2::date AND $3::date
          GROUP BY 1, 2, 3, 4`,
        [merchantId, from, to],
      );
      return result.rows;
    });
  }

  /**
   * A day's two sides, read from the SAME transactions: revenue from the frozen
   * receipt the sale issued, cost from the stock the same sale took out.
   *
   * `subtotal` is read from the receipt's own JSON and falls back to the grand total
   * when a snapshot predates it, with a guard on the cast: a `jsonb` field a report
   * trusts blindly is a report that 500s when one row is odd.
   */
  readDays(
    merchantId: string,
    from: string,
    to: string,
    locationId: string | null,
  ): Promise<{
    revenue: DayRevenueRow[];
    plates: DayPlatesRow[];
    consumption: DayConsumptionRow[];
    unmapped: DayUnmappedRow[];
  }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const revenue = await client.query<DayRevenueRow>(
        `SELECT r.business_date::text AS "businessDate",
                sum(CASE WHEN r.snapshot->'subtotal'->>'minorUnits' ~ '^[0-9]+$'
                         THEN (r.snapshot->'subtotal'->>'minorUnits')::bigint
                         ELSE r.grand_total END)::text AS "revenueMinor",
                sum(r.grand_total)::text AS "grandTotalMinor",
                count(*)::text AS "salesCount"
           FROM merchant.receipt_snapshot r
           JOIN merchant.pos_committed_sale s
             ON s.receipt_snapshot_id = r.id AND s.merchant_id = r.merchant_id
          WHERE r.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR r.location_id = $2::uuid)
            AND r.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1 ORDER BY 1`,
        [merchantId, locationId, from, to],
      );
      const plates = await client.query<DayPlatesRow>(
        /*
         * GROUPED BY THE RECEIPT's trading day, not the cart's. The two can differ — a
         * cart opened at 23:50 that is paid at 00:05 is one sale on one day, and the
         * receipt is the frozen fact that says which — and taking the count from a
         * different column than the revenue would put two sides of one day in two
         * buckets. That is how a report grows a row with revenue 0 and plates 3.
         */
        `SELECT r.business_date::text AS "businessDate", sum(l.quantity)::text AS "platesSold"
           FROM merchant.pos_committed_sale s
           JOIN merchant.pos_cart c
             ON c.id = s.cart_id AND c.merchant_id = s.merchant_id
           JOIN merchant.receipt_snapshot r
             ON r.id = s.receipt_snapshot_id AND r.merchant_id = s.merchant_id
           JOIN merchant.pos_cart_line l
             ON l.cart_id = c.id AND l.merchant_id = c.merchant_id
          WHERE s.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR s.location_id = $2::uuid)
            AND r.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1 ORDER BY 1`,
        [merchantId, locationId, from, to],
      );
      const consumption = await client.query<DayConsumptionRow>(
        `SELECT le.business_date::text AS "businessDate",
                le.inventory_item_id::text AS "inventoryItemId",
                le.quantity_scale AS "scale",
                sum(le.quantity)::text AS "quantity"
           FROM merchant.stock_ledger_entry le
          WHERE le.merchant_id = $1::uuid
            AND le.entry_type = 'sale_committed'
            AND ($2::uuid IS NULL OR le.location_id = $2::uuid)
            AND le.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1, 2, 3 ORDER BY 1, 2`,
        [merchantId, locationId, from, to],
      );
      /*
       * WHAT THE DAY SOLD THAT NOTHING MAPS. A committed sale line with no active
       * catalogue mapping took stock out of the kitchen and put none in the ledger, so
       * the day cannot be costed — and saying "cost 0, margin 100 %" for it would be the
       * same mistake as pricing a plate whose ingredient was never received.
       */
      const unmapped = await client.query<DayUnmappedRow>(
        `SELECT r.business_date::text AS "businessDate",
                l.product_id::text AS "productId",
                max(l.product_name) AS "productName",
                count(*)::text AS lines
           FROM merchant.pos_committed_sale s
           JOIN merchant.pos_cart c
             ON c.id = s.cart_id AND c.merchant_id = s.merchant_id
           JOIN merchant.receipt_snapshot r
             ON r.id = s.receipt_snapshot_id AND r.merchant_id = s.merchant_id
           JOIN merchant.pos_cart_line l
             ON l.cart_id = c.id AND l.merchant_id = c.merchant_id
          WHERE s.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR s.location_id = $2::uuid)
            AND r.business_date BETWEEN $3::date AND $4::date
            AND NOT EXISTS (
              SELECT 1 FROM merchant.inventory_catalog_mapping m
               WHERE m.merchant_id = l.merchant_id AND m.product_id = l.product_id
                 AND m.active
            )
          GROUP BY 1, 2
          ORDER BY 1, "productName"`,
        [merchantId, locationId, from, to],
      );
      return {
        revenue: revenue.rows,
        plates: plates.rows,
        consumption: consumption.rows,
        unmapped: unmapped.rows,
      };
    });
  }

  /**
   * The forecast's inputs: what is on the shelf now, and what left it over the window.
   *
   * `daysWithConsumption` and `firstConsumption` are read here because they decide the
   * DENOMINATOR of the rate, and that decision belongs with the data: a day count
   * computed on the client would be a second opinion about the window.
   */
  readLowStock(
    merchantId: string,
    from: string,
    to: string,
    locationId: string | null,
  ): Promise<{
    onHand: OnHandRow[];
    buckets: LowStockBucketRow[];
    dayStats: LowStockDayStatsRow[];
  }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const onHand = await client.query<OnHandRow>(
        `SELECT b.inventory_item_id::text AS "inventoryItemId", sum(b.on_hand)::text AS "onHand"
           FROM merchant.stock_balance b
          WHERE b.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR b.location_id = $2::uuid)
          GROUP BY 1`,
        [merchantId, locationId],
      );
      const buckets = await client.query<LowStockBucketRow>(
        `SELECT le.inventory_item_id::text AS "inventoryItemId",
                le.quantity_scale AS "scale",
                sum(le.quantity)::text AS "quantity"
           FROM merchant.stock_ledger_entry le
          WHERE le.merchant_id = $1::uuid
            AND le.entry_type = 'sale_committed'
            AND ($2::uuid IS NULL OR le.location_id = $2::uuid)
            AND le.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1, 2`,
        [merchantId, locationId, from, to],
      );
      const dayStats = await client.query<LowStockDayStatsRow>(
        `SELECT le.inventory_item_id::text AS "inventoryItemId",
                count(DISTINCT le.business_date)::text AS "daysWithConsumption",
                min(le.business_date)::text AS "firstConsumption"
           FROM merchant.stock_ledger_entry le
          WHERE le.merchant_id = $1::uuid
            AND le.entry_type = 'sale_committed'
            AND ($2::uuid IS NULL OR le.location_id = $2::uuid)
            AND le.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1`,
        [merchantId, locationId, from, to],
      );
      return { onHand: onHand.rows, buckets: buckets.rows, dayStats: dayStats.rows };
    });
  }

  // ── Step 7: variance, cost history and menu engineering (plan §9) ───────────

  /**
   * THE LEDGER SIDE OF THE VARIANCE (plan D6 and D7), in one pass per item.
   *
   * The window is stated as two dates and the arithmetic is a CASE per effect, because
   * the opening, the closing and the period's named parts come from the SAME rows: a
   * second query for the opening could read a row that landed between the two and the
   * three numbers would stop reconciling.
   *
   * NOTHING IS MATERIALISED. Variance is computed on read, because a stored variance
   * row would drift from the ledger and the ledger is the door every movement uses.
   */
  readVariance(
    merchantId: string,
    from: string,
    to: string,
    locationId: string | null,
  ): Promise<VarianceLedgerRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<VarianceLedgerRow>(
        `SELECT le.inventory_item_id::text AS "inventoryItemId",
                le.quantity_scale AS "scale",
                sum(CASE WHEN le.business_date < $3::date
                         THEN le.effect_on_hand - le.effect_reserved - le.effect_damaged
                              - le.effect_quarantine ELSE 0 END)::text AS opening,
                sum(CASE WHEN le.business_date <= $4::date
                         THEN le.effect_on_hand - le.effect_reserved - le.effect_damaged
                              - le.effect_quarantine ELSE 0 END)::text AS closing,
                sum(CASE WHEN le.entry_type = 'purchase_received'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN le.quantity ELSE 0 END)::text AS received,
                sum(CASE WHEN le.entry_type = 'production_produced'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN le.quantity ELSE 0 END)::text AS produced,
                -- EVERY NAMED PART IS THE MOVEMENT, NOT THE ROW'S QUANTITY. A part
                -- explains usage only if it actually took stock out of the pool, and
                -- the pool is the available basis. Reading the quantity column instead
                -- count a row whose effect columns do not match it — which is exactly
                -- what a production_yield_loss written before the loss moved stock
                -- looks like, and it turned one batch into a phantom explanation of
                -- every other item's variance.
                sum(CASE WHEN le.entry_type = 'waste_recorded'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN -(le.effect_on_hand - le.effect_reserved - le.effect_damaged
                                - le.effect_quarantine) ELSE 0 END)::text AS waste,
                sum(CASE WHEN le.entry_type = 'damage_recorded'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN -(le.effect_on_hand - le.effect_reserved - le.effect_damaged
                                - le.effect_quarantine) ELSE 0 END)::text AS damage,
                -- A count can ADD stock as well as take it, so the same sign rule
                -- covers it: a decrease is usage and an increase is not.
                sum(CASE WHEN le.entry_type = 'count_correction'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN -(le.effect_on_hand - le.effect_reserved - le.effect_damaged
                                - le.effect_quarantine) ELSE 0 END)::text AS "countCorrection",
                sum(CASE WHEN le.entry_type = 'production_yield_loss'
                          AND le.business_date BETWEEN $3::date AND $4::date
                         THEN -(le.effect_on_hand - le.effect_reserved - le.effect_damaged
                                - le.effect_quarantine) ELSE 0 END)::text AS "yieldLoss"
           FROM merchant.stock_ledger_entry le
           JOIN merchant.inventory_item i
             ON i.merchant_id = le.merchant_id AND i.id = le.inventory_item_id
          WHERE le.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR le.location_id = $2::uuid)
            AND i.tracking_policy <> 'not_tracked'
            AND le.business_date <= $4::date
          GROUP BY 1, 2`,
        [merchantId, locationId, from, to],
      );
      return result.rows;
    });
  }

  /**
   * THE THEORETICAL USAGE (plan §9.1): what the period's own sales say the kitchen
   * used, exploded to RAW items.
   *
   * The mapping is chosen per sold line exactly as the checkout chooses it — the exact
   * variant first, then the mapping that names no variant — because a report that
   * priced a different mapping than the sale consumed would disagree with the ledger
   * for no reason an owner could see.
   *
   * THE EXPLOSION IS `merchant.explode_inventory_recipe`'s, CALLED ONCE PER MAPPING
   * through a lateral join. The arithmetic is not repeated here: each row leaves with
   * an exact numerator and denominator and the service divides ONCE.
   *
   * A PRODUCT NOTHING MAPS CONTRIBUTES NOTHING. It is not an error: the ledger never
   * saw its stock either, and the day view is the read that refuses to price it.
   */
  readTheoreticalUsage(
    merchantId: string,
    from: string,
    to: string,
    locationId: string | null,
  ): Promise<TheoreticalUsageRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<TheoreticalUsageRow>(
        `WITH sold AS (
           SELECT l.product_id, l.variant_id, sum(l.quantity)::bigint AS sold_quantity
             FROM merchant.pos_committed_sale s
             JOIN merchant.pos_cart c
               ON c.id = s.cart_id AND c.merchant_id = s.merchant_id
             JOIN merchant.receipt_snapshot r
               ON r.id = s.receipt_snapshot_id AND r.merchant_id = s.merchant_id
             JOIN merchant.pos_cart_line l
               ON l.cart_id = c.id AND l.merchant_id = c.merchant_id
            WHERE s.merchant_id = $1::uuid
              AND ($2::uuid IS NULL OR s.location_id = $2::uuid)
              AND r.business_date BETWEEN $3::date AND $4::date
            GROUP BY 1, 2
         ), chosen AS (
           SELECT sold.sold_quantity, selected.*
             FROM sold
             JOIN LATERAL (
               SELECT candidate.* FROM merchant.inventory_catalog_mapping candidate
                WHERE candidate.merchant_id = $1::uuid
                  AND candidate.product_id = sold.product_id
                  AND candidate.active
                  AND (candidate.variant_id = sold.variant_id OR candidate.variant_id IS NULL)
                ORDER BY (candidate.variant_id = sold.variant_id) DESC NULLS LAST LIMIT 1
             ) selected ON true
         ), expanded AS (
           SELECT m.inventory_item_id,
                  m.sold_quantity::numeric * m.conversion_numerator AS numerator,
                  m.conversion_denominator::numeric AS denominator
             FROM chosen m
            WHERE m.mapping_type = 'direct'
           UNION ALL
           SELECT e.inventory_item_id,
                  m.sold_quantity::numeric * e.numerator,
                  e.denominator
             FROM chosen m
             CROSS JOIN LATERAL merchant.explode_inventory_recipe($1::uuid, m.recipe_id) e
            WHERE m.mapping_type IN ('recipe', 'bundle')
         )
         SELECT x.inventory_item_id::text AS "inventoryItemId",
                x.numerator::text AS numerator, x.denominator::text AS denominator
           FROM expanded x
           JOIN merchant.inventory_item i
             ON i.merchant_id = $1::uuid AND i.id = x.inventory_item_id
          WHERE i.tracking_policy <> 'not_tracked'
            AND x.denominator > 0`,
        [merchantId, locationId, from, to],
      );
      return result.rows;
    });
  }

  /**
   * WHAT THE PERIOD SOLD, per product and variant, with the price those lines
   * carried. Menu engineering's popularity axis is this count and nothing else.
   */
  readSoldProducts(
    merchantId: string,
    from: string,
    to: string,
    locationId: string | null,
  ): Promise<SoldProductRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<SoldProductRow>(
        `SELECT l.product_id::text AS "productId", l.variant_id::text AS "variantId",
                coalesce(p.name, max(l.product_name)) AS "productName",
                sum(l.quantity)::bigint::text AS "soldQuantity",
                max(l.base_price + l.variant_delta)::text AS "soldPriceMinor"
           FROM merchant.pos_committed_sale s
           JOIN merchant.pos_cart c
             ON c.id = s.cart_id AND c.merchant_id = s.merchant_id
           JOIN merchant.receipt_snapshot r
             ON r.id = s.receipt_snapshot_id AND r.merchant_id = s.merchant_id
           JOIN merchant.pos_cart_line l
             ON l.cart_id = c.id AND l.merchant_id = c.merchant_id
           LEFT JOIN merchant.product p
             ON p.merchant_id = l.merchant_id AND p.id = l.product_id
          WHERE s.merchant_id = $1::uuid
            AND ($2::uuid IS NULL OR s.location_id = $2::uuid)
            AND r.business_date BETWEEN $3::date AND $4::date
          GROUP BY 1, 2, p.name
          ORDER BY sum(l.quantity) DESC, "productName"`,
        [merchantId, locationId, from, to],
      );
      return result.rows;
    });
  }

  /**
   * EVERY RECIPE VERSION IN THE WINDOW (plan D3 and §9.5), with the point it stored.
   *
   * The window is `effective_at`, the moment the version became the one the plate
   * costs against. A version written before this phase has no stored point, and the
   * read costs it instead — with `capturedAt` set to the read's own moment, so the
   * reader can tell a stored point from a fresh one.
   */
  readRecipeCostVersions(
    merchantId: string,
    filter: { recipeId: string | null; productId: string | null; from: string; to: string },
  ): Promise<RecipeCostVersionRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<RecipeCostVersionRow>(
        `SELECT r.id::text AS "recipeId", r.product_id::text AS "productId",
                r.variant_id::text AS "variantId",
                r.target_item_id::text AS "targetItemId",
                left(coalesce(
                  CASE WHEN r.target_item_id IS NOT NULL THEN i.display_name
                       WHEN r.variant_id IS NOT NULL THEN p.name || ' - ' || v.name
                       ELSE p.name END,''),240) AS "targetName",
                r.version, r.effective_at::text AS "effectiveAt",
                r.retired_at::text AS "retiredAt",
                r.computed_cost_minor::text AS "computedCostMinor",
                r.computed_defects::text[] AS "computedDefects",
                r.computed_at::text AS "computedAt"
           FROM merchant.inventory_recipe r
           LEFT JOIN merchant.product p
             ON p.merchant_id = r.merchant_id AND p.id = r.product_id
           LEFT JOIN merchant.product_variant v
             ON v.merchant_id = r.merchant_id AND v.id = r.variant_id
           LEFT JOIN merchant.inventory_item i
             ON i.merchant_id = r.merchant_id AND i.id = r.target_item_id
           JOIN merchant.merchant m
             ON m.id = r.merchant_id
          WHERE r.merchant_id = $1::uuid
            -- The window is the merchant's OWN trading days, derived exactly as the
            -- repository's currentBusinessDate derives them: the session's timezone is
            -- not the cafe's, and a version written at 21:00 must not fall into tomorrow.
            AND ((r.effective_at AT TIME ZONE m.timezone) - m.business_day_start::interval)::date
                  BETWEEN $2::date AND $3::date
            AND ($4::uuid IS NULL OR r.id = $4::uuid)
            AND ($5::uuid IS NULL OR r.product_id = $5::uuid)
          ORDER BY "targetName", r.version`,
        [merchantId, filter.from, filter.to, filter.recipeId, filter.productId],
      );
      return result.rows;
    });
  }

  /**
   * THE EXPLOSION OF NAMED VERSIONS, for the ones that stored no cost.
   *
   * THIS IS `merchant.explode_inventory_recipe`'s OWN EXPRESSION with ONE difference:
   * the root version is not required to be ACTIVE. The function refuses a retired root
   * because a kitchen cannot cook a retired recipe, but the cost history exists to
   * explain retired versions, and refusing to cost them would answer "no cost" for
   * every point before the current one. A sub-recipe is still resolved through its
   * ACTIVE version, which is the version a plate costs against today.
   */
  readRecipeCostRows(merchantId: string, recipeIds: readonly string[]): Promise<RecipeCostRow[]> {
    if (recipeIds.length === 0) return Promise.resolve([]);
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<RecipeCostRow>(
        /*
         * THE EXPLOSION HAS ONE AUTHOR, and this is not it. The arithmetic lives in
         * `merchant.explode_inventory_recipe`, which the plate read and the production
         * path already call; repeating it here is how the modifier-line and
         * retired-recipe bugs started. The fourth argument asks it to walk a RETIRED
         * ROOT, which the history needs and the current-cost reads must not have.
         */
        `SELECT x.recipe_id::text AS "recipeId",
                e.inventory_item_id::text AS "inventoryItemId",
                e.numerator::text AS numerator, e.denominator::text AS denominator,
                i.quantity_scale AS "quantityScale",
                e.has_recipe AS "hasRecipe"
           FROM unnest($2::uuid[]) AS x(recipe_id)
           CROSS JOIN LATERAL merchant.explode_inventory_recipe($1::uuid, x.recipe_id, 12, true) e
           JOIN merchant.inventory_item i
             ON i.merchant_id = $1::uuid AND i.id = e.inventory_item_id
          ORDER BY x.recipe_id, e.depth`,
        [merchantId, [...recipeIds]],
      );
      return result.rows;
    });
  }
}
