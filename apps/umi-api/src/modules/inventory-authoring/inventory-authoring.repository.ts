import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  InventoryAllergen,
  InventoryAllergenQuery,
  InventoryAllergenSetRequest,
  InventoryAuthoringItem,
  InventoryAuthoringItemAllergenSetRequest,
  InventoryAuthoringItemCreateRequest,
  InventoryAuthoringItemOnHand,
  InventoryAuthoringItemQuery,
  InventoryAuthoringItemUpdateRequest,
  InventoryRecipeComponentInput,
  InventoryRecipeCreateRequest,
  InventoryRecipeQuery,
  InventoryRecipeUpdateRequest,
  InventoryItemType,
  InventoryUnitConversion,
  InventoryUnitConversionSetRequest,
  UnitOfMeasure,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';

/**
 * The console's inventory AUTHORING surface, against the real schema (plan §11,
 * phase 1). This file owns the items, their unit conversions and their allergen
 * labels. It writes no ledger row and no cost.
 *
 * WHY THERE IS NO COST COLUMN HERE. The cost basis is the weighted average of
 * receipts (`inventory-costing.ts`), so an item row holds no price. This module
 * therefore writes the model behind that read and never a number of its own — the
 * moment it stored one, the plate cost and the receipt would disagree.
 *
 * THE VERSION COLUMNS ARE THE CONCURRENCY CONTROL, and the task decides which one
 * each write names:
 *
 *   · `inventory_item.version` gates update, archive and the item's allergen set,
 *     because all three amend the item aggregate the editor read.
 *   · `inventory_unit_conversion.version` gates a conversion set, because a
 *     conversion for a pair may not exist yet — which is why the caller's
 *     `expectedVersion` is nullable on the first set.
 *   · `inventory_allergen.version` gates an allergen label set, for the same
 *     reason: the merchant's `code` may be new.
 *
 * A conversion is written as a NEW version with the previous row deactivated, not
 * as an in-place update. `inventory_unit_conversion` carries the version inside its
 * unique key, and the till's own read
 * (`pos-inventory.repository.ts`, `order by version desc limit 1`, `where active`)
 * is written to pick one active row out of several. So the read side already
 * expects the history, and this is the writer that produces it.
 */

/** One page key for the item list. `public_reference` is unique per merchant. */
export type ItemListCursor = { reference: string; id: string };

/** One page key for the conversion list; matches that table's unique key. */
export type ConversionListCursor = {
  inventoryItemId: string;
  fromUnit: string;
  toUnit: string;
  version: number;
};

/** One page key for the allergen list. `code` is unique per merchant. */
export type AllergenListCursor = { code: string };

/**
 * One page key for the recipe list. The key is the row's OWN `created_at` text and
 * its id, in the list's order: a version is a new row, so `created_at` orders the
 * list by the version that is current, and the id breaks a tie.
 */
export type RecipeListCursor = { createdAt: string; id: string };

/**
 * One recipe version as stored, with its components and its explosion already read.
 * The service does the money arithmetic on these rows; this file only joins.
 */
export type StoredRecipe = {
  recipe: RecipeRow;
  components: RecipeComponentRow[];
  explosion: RecipeExplosionRow[];
};

export type RecipeRow = {
  id: string;
  targetKind: 'product' | 'item';
  productId: string | null;
  variantId: string | null;
  targetItemId: string | null;
  targetName: string;
  version: number;
  yieldQuantity: string;
  yieldScale: number;
  yieldUnit: string;
  shelfLifeDays: number | null;
  active: boolean;
  effectiveAt: Date | string;
  retiredAt: Date | string | null;
  /** The text form, so the page key round-trips through the same `timestamptz`. */
  createdAt: string;
  /** The product's price plus the variant's delta. Null for an item target. */
  priceMinor: string | null;
  usedInRecipeCount: string;
};

export type RecipeComponentRow = {
  id: string;
  recipeId: string;
  inventoryItemId: string;
  publicReference: string;
  displayName: string;
  quantity: string;
  quantityScale: number;
  unit: string;
  conversionNumerator: string;
  conversionDenominator: string;
  roundingPolicy: string;
  required: boolean;
};

/**
 * One row of `merchant.explode_inventory_recipe`. `numerator`/`denominator` is the
 * EXACT rational quantity of the item, in its own base unit, for ONE unit of the
 * recipe's yield. `hasRecipe` marks an intermediate: it is shown, and it is not
 * priced, or the plate would be charged for the prep and for its ingredients.
 */
export type RecipeExplosionRow = {
  recipeId: string;
  inventoryItemId: string;
  numerator: string;
  denominator: string;
  depth: number;
  path: string[];
  hasRecipe: boolean;
  publicReference: string;
  displayName: string;
  baseUnit: string;
  quantityScale: number;
};

/** One item the prep list can name, with both shelf lives the expiry rule needs. */
export type PrepCandidateRow = {
  inventoryItemId: string;
  publicReference: string;
  displayName: string;
  baseUnit: string;
  quantityScale: number;
  parQuantity: string;
  recipeShelfLifeDays: number | null;
  itemShelfLifeDays: number | null;
};

/** One `stock_lot` row, with the item's own name derived rather than stored. */
export type StockLotRow = {
  lotId: string;
  lotReference: string;
  inventoryItemId: string;
  inventoryItemName: string;
  locationId: string;
  inventoryLocationId: string;
  origin: string;
  producedAt: string | null;
  receivedAt: string | null;
  expiresOn: string | null;
};

/** One sale's consumption of one item, from the ledger. */
export type LotSaleRow = {
  saleId: string;
  publicReference: string | null;
  productName: string;
  quantity: string;
  quantityScale: number;
  unit: string;
  occurredAt: string;
  businessDate: string;
};

type ItemRow = {
  id: string;
  publicReference: string;
  displayName: string;
  itemType: string;
  baseUnit: string;
  quantityScale: number;
  trackingPolicy: string;
  negativeStockPolicy: string;
  lowStockThreshold: string | null;
  parQuantity: string | null;
  shelfLifeDays: number | null;
  active: boolean;
  version: number;
};

type ConversionRow = {
  id: string;
  inventoryItemId: string;
  fromUnit: string;
  toUnit: string;
  numerator: string;
  denominator: string;
  targetScale: number;
  roundingPolicy: string;
  active: boolean;
  version: number;
};

type AllergenRow = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  version: number;
};

type ItemAllergenRow = AllergenRow & { inventoryItemId: string };

type OnHandRow = {
  inventoryItemId: string;
  locationId: string;
  inventoryLocationId: string;
  onHand: string;
};

const ITEM_COLUMNS = `i.id::text AS id,i.public_reference AS "publicReference",
  i.display_name AS "displayName",i.item_type AS "itemType",i.base_unit AS "baseUnit",
  i.quantity_scale AS "quantityScale",i.tracking_policy AS "trackingPolicy",
  i.negative_stock_policy AS "negativeStockPolicy",
  i.low_stock_threshold::text AS "lowStockThreshold",
  i.par_quantity::text AS "parQuantity",i.shelf_life_days AS "shelfLifeDays",
  i.active,i.version`;

const CONVERSION_COLUMNS = `c.id::text AS id,c.inventory_item_id::text AS "inventoryItemId",
  c.from_unit AS "fromUnit",c.to_unit AS "toUnit",c.numerator::text AS numerator,
  c.denominator::text AS denominator,c.target_scale AS "targetScale",
  c.rounding_policy AS "roundingPolicy",c.active,c.version`;

const ALLERGEN_COLUMNS = `a.id::text AS id,a.code,a.label,a.active,a.version`;

/**
 * One recipe version, its target's NAME, its price and its back-reference count.
 *
 * THE NAME IS DERIVED, and so is the count: a recipe stores no name of its own,
 * because the thing it targets already has one. `usedInRecipeCount` counts the ACTIVE
 * recipes that name this recipe's target ITEM as a component, so a plate recipe —
 * which names a product — answers zero.
 */
const RECIPE_COLUMNS = `r.id::text AS id,
  CASE WHEN r.target_item_id IS NOT NULL THEN 'item' ELSE 'product' END AS "targetKind",
  r.product_id::text AS "productId",r.variant_id::text AS "variantId",
  r.target_item_id::text AS "targetItemId",
  left(coalesce(
    CASE WHEN r.target_item_id IS NOT NULL THEN i.display_name
         WHEN r.variant_id IS NOT NULL THEN p.name || ' - ' || v.name
         ELSE p.name END,''),240) AS "targetName",
  r.version,r.yield_quantity::text AS "yieldQuantity",r.yield_scale AS "yieldScale",
  r.yield_unit AS "yieldUnit",r.shelf_life_days AS "shelfLifeDays",r.active,
  r.effective_at AS "effectiveAt",r.retired_at AS "retiredAt",
  r.created_at::text AS "createdAt",
  CASE WHEN r.product_id IS NULL THEN NULL
       ELSE (p.price + coalesce(v.price_delta,0))::text END AS "priceMinor",
  CASE WHEN r.target_item_id IS NULL THEN '0' ELSE (
    SELECT count(DISTINCT used.id)::text
      FROM merchant.inventory_recipe used
      JOIN merchant.inventory_recipe_component used_component
        ON used_component.merchant_id = used.merchant_id
       AND used_component.recipe_id = used.id
     WHERE used.merchant_id = r.merchant_id AND used.active
       AND used_component.inventory_item_id = r.target_item_id
  ) END AS "usedInRecipeCount"`;

/** The three joins a recipe's target name and price need, left so a target is never dropped. */
const RECIPE_FROM = `merchant.inventory_recipe r
  LEFT JOIN merchant.product p ON p.merchant_id = r.merchant_id AND p.id = r.product_id
  LEFT JOIN merchant.product_variant v ON v.merchant_id = r.merchant_id AND v.id = r.variant_id
  LEFT JOIN merchant.inventory_item i ON i.merchant_id = r.merchant_id AND i.id = r.target_item_id`;

const RECIPE_COMPONENT_COLUMNS = `c.id::text AS id,c.recipe_id::text AS "recipeId",
  c.inventory_item_id::text AS "inventoryItemId",
  i.public_reference AS "publicReference",i.display_name AS "displayName",
  c.quantity::text AS quantity,c.quantity_scale AS "quantityScale",c.unit,
  c.conversion_numerator::text AS "conversionNumerator",
  c.conversion_denominator::text AS "conversionDenominator",
  c.rounding_policy AS "roundingPolicy",c.required`;

/**
 * The explosion, read from `merchant.explode_inventory_recipe` — ONE walk for every
 * recipe, not a second copy in TypeScript. The function is the same one the allergen
 * read uses, so the editor, the kitchen ticket and the guest menu cannot disagree
 * about what a recipe consumes.
 */
const RECIPE_EXPLOSION_SELECT = `SELECT x.recipe_id::text AS "recipeId",
  e.inventory_item_id::text AS "inventoryItemId",
  e.numerator::text AS numerator,e.denominator::text AS denominator,e.depth,
  e.path::text[] AS path,e.has_recipe AS "hasRecipe",
  i.public_reference AS "publicReference",i.display_name AS "displayName",
  i.base_unit AS "baseUnit",i.quantity_scale AS "quantityScale"
  FROM unnest($2::uuid[]) AS x(recipe_id)
  CROSS JOIN LATERAL merchant.explode_inventory_recipe($1::uuid,x.recipe_id) e
  JOIN merchant.inventory_item i
    ON i.merchant_id = $1::uuid AND i.id = e.inventory_item_id
 ORDER BY x.recipe_id,e.depth,e.path`;

@Injectable()
export class InventoryAuthoringRepository {
  constructor(private readonly pg: PgService) {}

  // ── The reads ──────────────────────────────────────────────────────────────

  /**
   * The console's item list, each item with its conversions, its labels and its
   * on-hand per location.
   *
   * `includeItemsWithoutCost` is applied literally, and it defaults to false, the same
   * default the costing read takes. The console asks for the wider list explicitly,
   * because an owner who has just created an ingredient must see it and an ingredient
   * has no receipt until the first delivery arrives.
   */
  listItems(
    merchantId: string,
    query: InventoryAuthoringItemQuery,
    cursor: ItemListCursor | null,
  ): Promise<{ rows: InventoryAuthoringItem[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM merchant.inventory_item i
          WHERE i.merchant_id=$1::uuid
            AND ($2::boolean OR i.active)
            AND ($3::text IS NULL OR (i.public_reference,i.id) > ($3::text,$4::uuid))
            AND ($5::boolean OR EXISTS (
                  SELECT 1 FROM merchant.purchase_order_receipt_line l
                   WHERE l.merchant_id=i.merchant_id AND l.inventory_item_id=i.id))
          ORDER BY i.public_reference,i.id
          LIMIT $6`,
        [
          merchantId,
          query.includeArchived,
          cursor?.reference ?? null,
          cursor?.id ?? null,
          query.includeItemsWithoutCost,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      const page = result.rows.slice(0, query.limit);
      if (page.length === 0) return { rows: [], hasMore: false };
      const rows = await this.hydrateItems(
        client,
        merchantId,
        page.map((row) => row.id),
        query.includeArchived,
      );
      return { rows, hasMore };
    });
  }

  listConversions(
    merchantId: string,
    query: InventoryAuthoringItemQuery,
    cursor: ConversionListCursor | null,
  ): Promise<{ rows: InventoryUnitConversion[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<ConversionRow>(
        `SELECT ${CONVERSION_COLUMNS} FROM merchant.inventory_unit_conversion c
          WHERE c.merchant_id=$1::uuid
            AND ($2::boolean OR c.active)
            AND ($3::uuid IS NULL
                 OR (c.inventory_item_id,c.from_unit,c.to_unit,c.version) >
                    ($3::uuid,$4::text,$5::text,$6::int))
          ORDER BY c.inventory_item_id,c.from_unit,c.to_unit,c.version
          LIMIT $7`,
        [
          merchantId,
          query.includeArchived,
          cursor?.inventoryItemId ?? null,
          cursor?.fromUnit ?? null,
          cursor?.toUnit ?? null,
          cursor?.version ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      return { rows: result.rows.slice(0, query.limit).map(unitConversion), hasMore };
    });
  }

  listAllergens(
    merchantId: string,
    query: InventoryAllergenQuery,
    cursor: AllergenListCursor | null,
  ): Promise<{ rows: InventoryAllergen[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<AllergenRow>(
        `SELECT ${ALLERGEN_COLUMNS} FROM merchant.inventory_allergen a
          WHERE a.merchant_id=$1::uuid
            AND ($2::boolean OR a.active)
            AND ($3::text IS NULL OR a.code > $3::text)
          ORDER BY a.code
          LIMIT $4`,
        [merchantId, query.includeInactive, cursor?.code ?? null, query.limit + 1],
      );
      const hasMore = result.rows.length > query.limit;
      return { rows: result.rows.slice(0, query.limit).map(allergen), hasMore };
    });
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  /**
   * Create an item. The id comes from the command's `targetAggregateId`, so a
   * replay writes the same row rather than a second one.
   *
   * The duplicate reference is refused IN THE API'S OWN WORDS. The unique key
   * `(merchant_id, public_reference)` would otherwise surface as SQLSTATE 23505,
   * which is a 500 the console cannot act on; the catch below turns it into the one
   * code the contract publishes for it.
   */
  async createItem(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    dto: InventoryAuthoringItemCreateRequest,
  ): Promise<InventoryAuthoringItem> {
    try {
      await client.query(
        `INSERT INTO merchant.inventory_item
           (id,merchant_id,public_reference,display_name,item_type,base_unit,quantity_scale,
            tracking_policy,negative_stock_policy,reservation_required,low_stock_threshold,
            par_quantity,shelf_life_days)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          itemId,
          merchantId,
          dto.publicReference,
          dto.displayName,
          dto.itemType,
          dto.baseUnit,
          dto.quantityScale,
          dto.trackingPolicy,
          dto.negativeStockPolicy,
          // `inventory_item` ties the two: an untracked item must not reserve.
          dto.trackingPolicy !== 'not_tracked',
          dto.lowStockThreshold,
          dto.parQuantity,
          dto.shelfLifeDays,
        ],
      );
    } catch (error) {
      if (isDuplicateReference(error)) {
        throw new ConflictException({
          code: 'INVENTORY_ITEM_REFERENCE_TAKEN',
          fieldErrors: { publicReference: [dto.publicReference] },
        });
      }
      throw error;
    }
    return this.loadItem(client, merchantId, itemId, true);
  }

  /** Amend an item. `publicReference`, `itemType` and `baseUnit` are not editable. */
  async updateItem(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    dto: InventoryAuthoringItemUpdateRequest,
  ): Promise<InventoryAuthoringItem> {
    const current = await this.lockItem(client, merchantId, itemId);
    if (!current.active) throw new ConflictException({ code: 'INVENTORY_ITEM_ARCHIVED' });
    assertVersion('inventory_item', current.version, dto.expectedVersion);
    // A nullable field is a three-state input: absent leaves it, null clears it.
    // `coalesce` cannot tell those apart, so each nullable column moves only when
    // the caller sent the key at all.
    await client.query(
      `UPDATE merchant.inventory_item SET
         display_name=coalesce($3::text,display_name),
         tracking_policy=coalesce($4::text,tracking_policy),
         negative_stock_policy=coalesce($5::text,negative_stock_policy),
         low_stock_threshold=CASE WHEN $6::boolean THEN $7::bigint ELSE low_stock_threshold END,
         shelf_life_days=CASE WHEN $8::boolean THEN $9::integer ELSE shelf_life_days END,
         par_quantity=CASE WHEN $10::boolean THEN $11::bigint ELSE par_quantity END,
         reservation_required=coalesce($4::text,tracking_policy) <> 'not_tracked',
         version=version+1
       WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [
        merchantId,
        itemId,
        dto.displayName ?? null,
        dto.trackingPolicy ?? null,
        dto.negativeStockPolicy ?? null,
        dto.lowStockThreshold !== undefined,
        dto.lowStockThreshold ?? null,
        dto.shelfLifeDays !== undefined,
        dto.shelfLifeDays ?? null,
        dto.parQuantity !== undefined,
        dto.parQuantity ?? null,
      ],
    );
    return this.loadItem(client, merchantId, itemId, true);
  }

  /**
   * Archive an item: `active=false` and the timestamp that records when. Nothing is
   * deleted, because the ledger and the recipes already name the row.
   */
  async archiveItem(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    expectedVersion: number,
  ): Promise<InventoryAuthoringItem> {
    const current = await this.lockItem(client, merchantId, itemId);
    assertVersion('inventory_item', current.version, expectedVersion);
    if (!current.active) throw new ConflictException({ code: 'INVENTORY_ITEM_ARCHIVED' });
    await client.query(
      `UPDATE merchant.inventory_item
          SET active=false,archived_at=coalesce(archived_at,clock_timestamp()),version=version+1
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, itemId],
    );
    return this.loadItem(client, merchantId, itemId, true);
  }

  // ── Unit conversions ──────────────────────────────────────────────────────

  /**
   * Set the conversion for one `from_unit` → `to_unit` pair of one item.
   *
   * THE ARITHMETIC. A conversion says `1 fromUnit = numerator/denominator toUnit`.
   * The stored scale is the item's own, so the value a reader computes for one
   * from-unit is `numerator * 10^targetScale / denominator` in scaled integers. An
   * `exact` policy promises that division has no remainder: the same division the
   * till performs (`pos-inventory.repository.ts`, `normalizeQuantity`), evaluated
   * here once at the definition instead of at every sale. A lossy conversion is
   * therefore refused while the owner is looking at it, not at the first sale.
   */
  async setConversion(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    dto: InventoryUnitConversionSetRequest,
  ): Promise<InventoryUnitConversion> {
    const item = await this.lockItem(client, merchantId, itemId);
    if (!item.active) throw new ConflictException({ code: 'INVENTORY_ITEM_ARCHIVED' });
    if (dto.fromUnit === dto.toUnit) throw invalidConversion('fromUnit must differ from toUnit');
    if (dto.targetScale !== item.quantityScale) {
      throw invalidConversion('targetScale must equal the item quantity scale');
    }
    if (dto.roundingPolicy === 'exact') {
      const scaled = BigInt(dto.numerator) * 10n ** BigInt(dto.targetScale);
      if (scaled % BigInt(dto.denominator) !== 0n) {
        throw invalidConversion('the conversion loses a unit under an exact policy');
      }
    }

    const existing = await client.query<{ version: number }>(
      `SELECT version FROM merchant.inventory_unit_conversion
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
          AND from_unit=$3 AND to_unit=$4
        ORDER BY version DESC FOR UPDATE`,
      [merchantId, itemId, dto.fromUnit, dto.toUnit],
    );
    const previous = existing.rows[0]?.version ?? null;
    // `expectedVersion` is null only on a FIRST set, so a caller that sends null
    // while a conversion exists is as stale as one that names the wrong version.
    if (previous === null ? dto.expectedVersion !== null : dto.expectedVersion !== previous) {
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: previous,
      });
    }

    await client.query(
      `UPDATE merchant.inventory_unit_conversion SET active=false
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid
          AND from_unit=$3 AND to_unit=$4 AND active`,
      [merchantId, itemId, dto.fromUnit, dto.toUnit],
    );
    const inserted = await client.query<ConversionRow>(
      `INSERT INTO merchant.inventory_unit_conversion AS c
         (merchant_id,inventory_item_id,from_unit,to_unit,numerator,denominator,
          target_scale,rounding_policy,version,active)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,true)
       RETURNING ${CONVERSION_COLUMNS}`,
      [
        merchantId,
        itemId,
        dto.fromUnit,
        dto.toUnit,
        dto.numerator,
        dto.denominator,
        dto.targetScale,
        dto.roundingPolicy,
        (previous ?? 0) + 1,
      ],
    );
    return unitConversion(inserted.rows[0]);
  }

  // ── Allergens ─────────────────────────────────────────────────────────────

  /**
   * Set one allergen label. The merchant's own `code` is the key, which is why the
   * first set has no version to expect: the console names the id, and a second set
   * of the same code amends the row that exists.
   *
   * `active` and `archived_at` move together, because the table's own check ties
   * them: `(archived_at is null) = active`.
   */
  async setAllergen(
    client: PoolClient,
    merchantId: string,
    allergenId: string,
    dto: InventoryAllergenSetRequest,
  ): Promise<InventoryAllergen> {
    const existing = await client.query<AllergenRow>(
      `SELECT ${ALLERGEN_COLUMNS} FROM merchant.inventory_allergen a
        WHERE a.merchant_id=$1::uuid AND a.code=$2 FOR UPDATE`,
      [merchantId, dto.code],
    );
    const current = existing.rows[0];
    if (current) {
      if (dto.expectedVersion === null || dto.expectedVersion !== current.version) {
        throw new ConflictException({
          code: 'OPTIMISTIC_VERSION_CONFLICT',
          currentVersion: current.version,
        });
      }
      const updated = await client.query<AllergenRow>(
        `UPDATE merchant.inventory_allergen AS a SET
           label=$3,active=$4,
           archived_at=CASE WHEN $4 THEN NULL ELSE coalesce(archived_at,clock_timestamp()) END,
           version=version+1
         WHERE merchant_id=$1::uuid AND code=$2
         RETURNING ${ALLERGEN_COLUMNS}`,
        [merchantId, dto.code, dto.label, dto.active],
      );
      return allergen(updated.rows[0]);
    }
    if (dto.expectedVersion !== null) {
      throw new ConflictException({ code: 'OPTIMISTIC_VERSION_CONFLICT', currentVersion: null });
    }
    const inserted = await client.query<AllergenRow>(
      `INSERT INTO merchant.inventory_allergen AS a
         (id,merchant_id,code,label,active,archived_at)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,
               CASE WHEN $5 THEN NULL ELSE clock_timestamp() END)
       RETURNING ${ALLERGEN_COLUMNS}`,
      [allergenId, merchantId, dto.code, dto.label, dto.active],
    );
    return allergen(inserted.rows[0]);
  }

  /**
   * Replace the whole allergen set of one item, in one write.
   *
   * The item's own version moves with it. The contract's words are "the version the
   * caller read makes two editors on one item refuse instead of merging", so the
   * set has to leave that version behind, or the second editor would still win.
   */
  async setItemAllergens(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    dto: InventoryAuthoringItemAllergenSetRequest,
  ): Promise<InventoryAuthoringItem> {
    const current = await this.lockItem(client, merchantId, itemId);
    assertVersion('inventory_item', current.version, dto.expectedVersion);
    if (!current.active) throw new ConflictException({ code: 'INVENTORY_ITEM_ARCHIVED' });

    // A repeat of one id is the same label twice, and the table's unique key refuses
    // the pair; de-duplicating here answers with the set the caller meant.
    const allergenIds = [...new Set(dto.allergenIds)];
    if (allergenIds.length > 0) {
      const known = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM merchant.inventory_allergen
          WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND active`,
        [merchantId, allergenIds],
      );
      if (known.rows.length !== allergenIds.length) {
        throw new NotFoundException({ code: 'INVENTORY_ALLERGEN_NOT_FOUND' });
      }
    }

    await client.query(
      `DELETE FROM merchant.inventory_item_allergen
        WHERE merchant_id=$1::uuid AND inventory_item_id=$2::uuid`,
      [merchantId, itemId],
    );
    if (allergenIds.length > 0) {
      await client.query(
        `INSERT INTO merchant.inventory_item_allergen
           (merchant_id,inventory_item_id,inventory_allergen_id)
         SELECT $1::uuid,$2::uuid,t.id FROM unnest($3::uuid[]) AS t(id)`,
        [merchantId, itemId, allergenIds],
      );
    }
    await client.query(
      `UPDATE merchant.inventory_item SET version=version+1
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, itemId],
    );
    return this.loadItem(client, merchantId, itemId, true);
  }

  // ── Recipes ───────────────────────────────────────────────────────────────

  /**
   * The console's recipe list: every version the merchant has, with its components
   * and its explosion.
   *
   * THE EXPLOSION IS READ FOR EVERY ROW because the cost per unit of yield is the sum
   * over the RAW items a recipe reaches, and a component that is itself a prep has no
   * cost of its own. Pricing the direct components instead would price a prep that no
   * receipt ever priced, and would show a plate as free.
   */
  listRecipes(
    merchantId: string,
    query: InventoryRecipeQuery,
    cursor: RecipeListCursor | null,
  ): Promise<{ rows: StoredRecipe[]; hasMore: boolean }> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<RecipeRow>(
        `SELECT ${RECIPE_COLUMNS} FROM ${RECIPE_FROM}
          WHERE r.merchant_id=$1::uuid
            AND ($2::boolean OR r.active)
            AND ($3::uuid IS NULL OR r.product_id=$3::uuid)
            AND ($4::uuid IS NULL OR r.target_item_id=$4::uuid)
            AND ($5::text IS NULL OR (r.created_at,r.id) < ($5::timestamptz,$6::uuid))
          ORDER BY r.created_at DESC,r.id DESC
          LIMIT $7`,
        [
          merchantId,
          query.includeRetired,
          query.productId ?? null,
          query.targetItemId ?? null,
          cursor?.createdAt ?? null,
          cursor?.id ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      const page = result.rows.slice(0, query.limit);
      if (page.length === 0) return { rows: [], hasMore: false };
      const recipeIds = page.map((row) => row.id);
      const components = await this.readRecipeComponents(client, merchantId, recipeIds);
      const explosion = await this.readExplosionRows(client, merchantId, recipeIds);
      const componentsByRecipe = groupBy(components, (row) => row.recipeId);
      const explosionByRecipe = groupBy(explosion, (row) => row.recipeId);
      return {
        rows: page.map((recipe) => ({
          recipe,
          components: componentsByRecipe.get(recipe.id) ?? [],
          explosion: explosionByRecipe.get(recipe.id) ?? [],
        })),
        hasMore,
      };
    });
  }

  /**
   * ONE recipe exploded, for the editor's drill-down. The recipe header is read first
   * so a retired version is answered as retired rather than as an empty explosion,
   * which would read as "this recipe consumes nothing".
   */
  readRecipeHeader(merchantId: string, recipeId: string): Promise<RecipeRow | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query<RecipeRow>(
        `SELECT ${RECIPE_COLUMNS} FROM ${RECIPE_FROM}
          WHERE r.merchant_id=$1::uuid AND r.id=$2::uuid`,
        [merchantId, recipeId],
      );
      return result.rows[0] ?? null;
    });
  }

  /** The explosion of one recipe, as `merchant.explode_inventory_recipe` returns it. */
  explodeRecipe(merchantId: string, recipeId: string): Promise<RecipeExplosionRow[]> {
    return this.pg.runWithMerchant(merchantId, null, (client) =>
      this.readExplosionRows(client, merchantId, [recipeId]),
    );
  }

  /**
   * The items the prep list can name: an ACTIVE item that carries a PAR level and an
   * ACTIVE recipe, because a kitchen cannot make what no recipe describes.
   *
   * PAR is `inventory_item.par_quantity` and NOT `low_stock_threshold`; the threshold is
   * a purchase alarm and par is what the kitchen wants on hand (migration 76).
   */
  prepCandidates(merchantId: string): Promise<PrepCandidateRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<PrepCandidateRow>(
        `SELECT i.id::text AS "inventoryItemId",i.public_reference AS "publicReference",
                i.display_name AS "displayName",i.base_unit AS "baseUnit",
                i.quantity_scale AS "quantityScale",i.par_quantity::text AS "parQuantity",
                r.shelf_life_days AS "recipeShelfLifeDays",
                i.shelf_life_days AS "itemShelfLifeDays"
           FROM merchant.inventory_item i
           JOIN merchant.inventory_recipe r
             ON r.merchant_id=i.merchant_id AND r.target_item_id=i.id AND r.active
          WHERE i.merchant_id=$1::uuid AND i.active AND i.par_quantity IS NOT NULL
          ORDER BY i.display_name,i.id`,
        [merchantId],
      );
      return rows;
    });
  }

  /** One lot, read back with the facts a recall answers. */
  stockLot(merchantId: string, lotId: string): Promise<StockLotRow | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<StockLotRow>(
        `SELECT l.id::text AS "lotId",l.public_reference AS "lotReference",
                l.inventory_item_id::text AS "inventoryItemId",
                i.display_name AS "inventoryItemName",l.location_id::text AS "locationId",
                l.inventory_location_id::text AS "inventoryLocationId",l.origin,
                l.produced_at::text AS "producedAt",l.received_at::text AS "receivedAt",
                l.expires_on::text AS "expiresOn"
           FROM merchant.stock_lot l
           JOIN merchant.inventory_item i
             ON i.merchant_id=l.merchant_id AND i.id=l.inventory_item_id
          WHERE l.merchant_id=$1::uuid AND l.id=$2::uuid`,
        [merchantId, lotId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * THE sales of one item inside one window, from the ledger.
   *
   * V1 HAS NO LOT-ATTRIBUTED SALE CONSUMPTION: a sale's ledger rows carry no lot, so the
   * honest answer names the sales of the lot's ITEM inside the lot's own life window and
   * says so in `basis`. The lot's own movements are excluded — they are production, not a
   * sale.
   */
  lotSales(
    merchantId: string,
    inventoryItemId: string,
    from: string,
    to: string,
  ): Promise<LotSaleRow[]> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<LotSaleRow>(
        `SELECT e.sale_id::text AS "saleId",r.receipt_number AS "publicReference",
                l.product_name AS "productName",e.quantity::text AS quantity,
                e.quantity_scale AS "quantityScale",e.unit,
                e.occurred_at::text AS "occurredAt",e.business_date::text AS "businessDate"
           FROM merchant.stock_ledger_entry e
           JOIN merchant.pos_committed_sale s
             ON s.merchant_id=e.merchant_id AND s.id=e.sale_id
           JOIN merchant.receipt_snapshot r
             ON r.merchant_id=s.merchant_id AND r.id=s.receipt_snapshot_id
           JOIN merchant.pos_cart_line l
             ON l.merchant_id=e.merchant_id AND l.id=e.sale_line_id
          WHERE e.merchant_id=$1::uuid AND e.inventory_item_id=$2::uuid
            AND e.entry_type='sale_committed'
            AND e.occurred_at >= $3::timestamptz AND e.occurred_at <= $4::timestamptz
          ORDER BY e.occurred_at,e.id
          LIMIT 1000`,
        [merchantId, inventoryItemId, from, to],
      );
      return rows;
    });
  }

  /**
   * Create a recipe at version 1. The id comes from the command's
   * `targetAggregateId`, so a replay writes the same row rather than a second one.
   *
   * THE DATABASE REFUSES THE SHAPES THIS FILE MUST TRANSLATE. The exactly-one-target
   * check and the target foreign keys refuse a bad target, and the cycle and depth
   * triggers refuse a chain. `recipeWriteError` turns each into the contract's own
   * code, because a SQLSTATE the console cannot act on is a 500.
   */
  async createRecipe(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    dto: InventoryRecipeCreateRequest,
  ): Promise<StoredRecipe> {
    try {
      await client.query(
        `INSERT INTO merchant.inventory_recipe
           (id,merchant_id,product_id,variant_id,target_item_id,version,yield_quantity,
            yield_scale,yield_unit,shelf_life_days,active)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,1,$6::bigint,$7::smallint,
                 $8::text,$9::integer,true)`,
        [
          recipeId,
          merchantId,
          dto.targetKind === 'product' ? (dto.productId ?? null) : null,
          dto.targetKind === 'product' ? (dto.variantId ?? null) : null,
          dto.targetKind === 'item' ? (dto.targetItemId ?? null) : null,
          dto.yieldQuantity.value,
          dto.yieldQuantity.scale,
          dto.yieldQuantity.unit,
          dto.shelfLifeDays ?? null,
        ],
      );
      await this.insertRecipeComponents(client, merchantId, recipeId, dto.components);
    } catch (error) {
      throw recipeWriteError(error);
    }
    return this.loadRecipe(client, merchantId, recipeId);
  }

  /**
   * Amend a recipe. D3: the row the caller read is RETIRED and the next version is
   * WRITTEN, so the stored cost of the version the owner saw stays explainable. The
   * old row is retired first, because one target has one active version.
   *
   * AN ACTIVE CATALOG MAPPING IS REPOINTED TO THE NEW VERSION in the same
   * transaction. A mapping left on the retired row stops consuming and stops costing,
   * and it would do so silently: the plate would simply cost nothing.
   */
  async updateRecipe(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    dto: InventoryRecipeUpdateRequest,
  ): Promise<StoredRecipe> {
    const current = await this.lockRecipe(client, merchantId, recipeId);
    if (!current.active) throw retiredRecipe();
    assertVersion('inventory_recipe', current.version, dto.expectedVersion);

    const yieldValue = dto.yieldQuantity?.value ?? current.yieldQuantity;
    const yieldScale = dto.yieldQuantity?.scale ?? current.yieldScale;
    const yieldUnit = dto.yieldQuantity?.unit ?? (current.yieldUnit as UnitOfMeasure);
    // A nullable field is a three-state input: absent leaves it, null clears it.
    const shelfLifeDays =
      dto.shelfLifeDays === undefined ? current.shelfLifeDays : dto.shelfLifeDays;

    let nextRecipeId: string;
    try {
      await client.query(
        `UPDATE merchant.inventory_recipe
            SET active=false,retired_at=coalesce(retired_at,clock_timestamp())
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [merchantId, recipeId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO merchant.inventory_recipe
           (merchant_id,product_id,variant_id,target_item_id,version,yield_quantity,
            yield_scale,yield_unit,shelf_life_days,active)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::integer,$6::bigint,$7::smallint,
                 $8::text,$9::integer,true)
         RETURNING id::text AS id`,
        [
          merchantId,
          current.productId,
          current.variantId,
          current.targetItemId,
          current.version + 1,
          yieldValue,
          yieldScale,
          yieldUnit,
          shelfLifeDays,
        ],
      );
      nextRecipeId = inserted.rows[0].id;
      if (dto.components) {
        await this.insertRecipeComponents(client, merchantId, nextRecipeId, dto.components);
      } else {
        await this.copyRecipeComponents(client, merchantId, nextRecipeId, recipeId);
      }
      await client.query(
        `UPDATE merchant.inventory_catalog_mapping SET recipe_id=$3::uuid
          WHERE merchant_id=$1::uuid AND recipe_id=$2::uuid AND active`,
        [merchantId, recipeId, nextRecipeId],
      );
    } catch (error) {
      throw recipeWriteError(error);
    }
    return this.loadRecipe(client, merchantId, nextRecipeId);
  }

  /**
   * Retire a recipe version: `active=false` and the timestamp that records when.
   * Nothing is deleted, because a plate cost moved and its owner asks why.
   */
  async retireRecipe(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    expectedVersion: number,
  ): Promise<StoredRecipe> {
    const current = await this.lockRecipe(client, merchantId, recipeId);
    if (!current.active) throw retiredRecipe();
    assertVersion('inventory_recipe', current.version, expectedVersion);
    await client.query(
      `UPDATE merchant.inventory_recipe
          SET active=false,retired_at=coalesce(retired_at,clock_timestamp())
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, recipeId],
    );
    return this.loadRecipe(client, merchantId, recipeId);
  }

  /** Lock the version row: every recipe write reads its version before it moves it. */
  private async lockRecipe(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
  ): Promise<{
    version: number;
    active: boolean;
    productId: string | null;
    variantId: string | null;
    targetItemId: string | null;
    yieldQuantity: string;
    yieldScale: number;
    yieldUnit: string;
    shelfLifeDays: number | null;
  }> {
    const result = await client.query<{
      version: number;
      active: boolean;
      productId: string | null;
      variantId: string | null;
      targetItemId: string | null;
      yieldQuantity: string;
      yieldScale: number;
      yieldUnit: string;
      shelfLifeDays: number | null;
    }>(
      `SELECT version,active,product_id::text AS "productId",variant_id::text AS "variantId",
              target_item_id::text AS "targetItemId",
              yield_quantity::text AS "yieldQuantity",yield_scale AS "yieldScale",
              yield_unit AS "yieldUnit",shelf_life_days AS "shelfLifeDays"
         FROM merchant.inventory_recipe
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, recipeId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'INVENTORY_RECIPE_NOT_FOUND' });
    return row;
  }

  /**
   * D3: a version records the cost it computed when it was written. The columns are
   * written in the SAME transaction as the version, so a version can never be read
   * without its point — and `computed_at` is what tells the reader that the number is
   * the version's own rather than one the cost history re-derived today.
   *
   * A NULL cost with the defects that explain it is a real answer. Zero would be a lie.
   */
  async storeRecipeCost(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    costMinor: bigint | null,
    defects: readonly string[],
  ): Promise<void> {
    await client.query(
      `UPDATE merchant.inventory_recipe
          SET computed_cost_minor=$3::bigint,computed_defects=$4::text[],
              computed_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, recipeId, costMinor === null ? null : costMinor.toString(), [...defects]],
    );
  }

  /** The component lines of the versions the caller sent to write. */
  private async insertRecipeComponents(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    components: readonly InventoryRecipeComponentInput[],
  ): Promise<void> {
    if (components.length === 0) return;
    await client.query(
      `INSERT INTO merchant.inventory_recipe_component
         (merchant_id,recipe_id,inventory_item_id,quantity,unit,quantity_scale,
          conversion_numerator,conversion_denominator,rounding_policy,required)
       SELECT $1::uuid,$2::uuid,c.item_id,c.quantity,c.unit,c.scale,c.numerator,
              c.denominator,c.policy,c.required
         FROM unnest($3::uuid[],$4::bigint[],$5::text[],$6::smallint[],$7::bigint[],
                     $8::bigint[],$9::text[],$10::boolean[])
              AS c(item_id,quantity,unit,scale,numerator,denominator,policy,required)`,
      [
        merchantId,
        recipeId,
        components.map((component) => component.inventoryItemId),
        components.map((component) => component.quantity.value),
        components.map((component) => component.quantity.unit),
        components.map((component) => component.quantity.scale),
        components.map((component) => component.conversionNumerator),
        components.map((component) => component.conversionDenominator),
        components.map((component) => component.roundingPolicy),
        components.map((component) => component.required),
      ],
    );
  }

  /**
   * Carry an unchanged component list into the new version. The copy is an INSERT, so
   * the cycle trigger runs again on every line: a version that would close a loop is
   * refused here exactly as it is on create.
   */
  private async copyRecipeComponents(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
    sourceRecipeId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO merchant.inventory_recipe_component
         (merchant_id,recipe_id,inventory_item_id,modifier_id,quantity,unit,quantity_scale,
          conversion_numerator,conversion_denominator,rounding_policy,required)
       SELECT c.merchant_id,$3::uuid,c.inventory_item_id,c.modifier_id,c.quantity,c.unit,
              c.quantity_scale,c.conversion_numerator,c.conversion_denominator,
              c.rounding_policy,c.required
         FROM merchant.inventory_recipe_component c
        WHERE c.merchant_id=$1::uuid AND c.recipe_id=$2::uuid`,
      [merchantId, sourceRecipeId, recipeId],
    );
  }

  /** One version, read back as stored, with its components and its explosion. */
  private async loadRecipe(
    client: PoolClient,
    merchantId: string,
    recipeId: string,
  ): Promise<StoredRecipe> {
    const result = await client.query<RecipeRow>(
      `SELECT ${RECIPE_COLUMNS} FROM ${RECIPE_FROM}
        WHERE r.merchant_id=$1::uuid AND r.id=$2::uuid`,
      [merchantId, recipeId],
    );
    const recipe = result.rows[0];
    if (!recipe) throw new NotFoundException({ code: 'INVENTORY_RECIPE_NOT_FOUND' });
    const components = await this.readRecipeComponents(client, merchantId, [recipeId]);
    const explosion = await this.readExplosionRows(client, merchantId, [recipeId]);
    return { recipe, components, explosion };
  }

  private async readRecipeComponents(
    client: PoolClient,
    merchantId: string,
    recipeIds: string[],
  ): Promise<RecipeComponentRow[]> {
    const result = await client.query<RecipeComponentRow>(
      `SELECT ${RECIPE_COMPONENT_COLUMNS}
         FROM merchant.inventory_recipe_component c
         JOIN merchant.inventory_item i
           ON i.merchant_id = c.merchant_id AND i.id = c.inventory_item_id
        WHERE c.merchant_id=$1::uuid AND c.recipe_id=ANY($2::uuid[])
        ORDER BY c.recipe_id,i.public_reference,c.id`,
      [merchantId, recipeIds],
    );
    return result.rows;
  }

  private async readExplosionRows(
    client: PoolClient,
    merchantId: string,
    recipeIds: string[],
  ): Promise<RecipeExplosionRow[]> {
    const result = await client.query<RecipeExplosionRow>(RECIPE_EXPLOSION_SELECT, [
      merchantId,
      recipeIds,
    ]);
    return result.rows;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Lock the item row: every write below reads its version before it moves it. */
  private async lockItem(
    client: PoolClient,
    merchantId: string,
    itemId: string,
  ): Promise<{ version: number; active: boolean; quantityScale: number }> {
    const result = await client.query<{
      version: number;
      active: boolean;
      quantityScale: number;
    }>(
      `SELECT version,active,quantity_scale AS "quantityScale" FROM merchant.inventory_item
        WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, itemId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException({ code: 'INVENTORY_ITEM_NOT_FOUND' });
    return row;
  }

  /** One item with its conversions, its labels and its on-hand, read back as stored. */
  private async loadItem(
    client: PoolClient,
    merchantId: string,
    itemId: string,
    includeArchived: boolean,
  ): Promise<InventoryAuthoringItem> {
    const rows = await this.hydrateItems(client, merchantId, [itemId], includeArchived);
    const item = rows[0];
    if (!item) throw new NotFoundException({ code: 'INVENTORY_ITEM_NOT_FOUND' });
    return item;
  }

  /**
   * Three batched reads rather than three per item: a page of 100 items would
   * otherwise cost 300 round trips.
   */
  private async hydrateItems(
    client: PoolClient,
    merchantId: string,
    itemIds: string[],
    includeArchived: boolean,
  ): Promise<InventoryAuthoringItem[]> {
    // SEQUENTIAL, not `Promise.all`: these share ONE PoolClient, and pg refuses to
    // run two queries on one connection at the same time.
    const items = await client.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM merchant.inventory_item i
          WHERE i.merchant_id=$1::uuid AND i.id=ANY($2::uuid[])
          ORDER BY i.public_reference,i.id`,
      [merchantId, itemIds],
    );
    const conversions = await client.query<ConversionRow>(
      `SELECT ${CONVERSION_COLUMNS} FROM merchant.inventory_unit_conversion c
          WHERE c.merchant_id=$1::uuid AND c.inventory_item_id=ANY($2::uuid[])
            AND ($3::boolean OR c.active)
          ORDER BY c.inventory_item_id,c.from_unit,c.to_unit,c.version DESC`,
      [merchantId, itemIds, includeArchived],
    );
    const labels = await client.query<ItemAllergenRow>(
      `SELECT ia.inventory_item_id::text AS "inventoryItemId",${ALLERGEN_COLUMNS}
           FROM merchant.inventory_item_allergen ia
           JOIN merchant.inventory_allergen a
             ON a.merchant_id=ia.merchant_id AND a.id=ia.inventory_allergen_id
          WHERE ia.merchant_id=$1::uuid AND ia.inventory_item_id=ANY($2::uuid[])
            AND a.active
          ORDER BY a.code`,
      [merchantId, itemIds],
    );
    const onHand = await client.query<OnHandRow>(
      `SELECT b.inventory_item_id::text AS "inventoryItemId",
                b.location_id::text AS "locationId",
                b.inventory_location_id::text AS "inventoryLocationId",
                b.on_hand::text AS "onHand"
           FROM merchant.stock_balance b
          WHERE b.merchant_id=$1::uuid AND b.inventory_item_id=ANY($2::uuid[])
          ORDER BY b.location_id,b.inventory_location_id`,
      [merchantId, itemIds],
    );

    const conversionsByItem = groupBy(conversions.rows, (row) => row.inventoryItemId);
    const labelsByItem = groupBy(labels.rows, (row) => row.inventoryItemId);
    const onHandByItem = groupBy(onHand.rows, (row) => row.inventoryItemId);
    return items.rows.map((row): InventoryAuthoringItem => ({
      id: row.id,
      publicReference: row.publicReference,
      displayName: row.displayName,
      itemType: row.itemType as InventoryItemType,
      baseUnit: row.baseUnit as UnitOfMeasure,
      quantityScale: row.quantityScale,
      trackingPolicy: row.trackingPolicy as InventoryAuthoringItem['trackingPolicy'],
      negativeStockPolicy: row.negativeStockPolicy as InventoryAuthoringItem['negativeStockPolicy'],
      lowStockThreshold: row.lowStockThreshold === null ? null : Number(row.lowStockThreshold),
      // PAR is not the low-stock threshold: it is the level the kitchen wants on hand,
      // and the prep list is what subtracts from it (plan §8.4).
      parQuantity: row.parQuantity === null ? null : Number(row.parQuantity),
      shelfLifeDays: row.shelfLifeDays,
      active: row.active,
      version: row.version,
      allergens: (labelsByItem.get(row.id) ?? []).map((label) => ({
        id: label.id,
        code: label.code,
        label: label.label,
        active: label.active,
        version: label.version,
      })),
      conversions: (conversionsByItem.get(row.id) ?? []).map(unitConversion),
      onHand: (onHandByItem.get(row.id) ?? []).map(onHandRow),
    }));
  }
}

function unitConversion(row: ConversionRow): InventoryUnitConversion {
  return {
    id: row.id,
    inventoryItemId: row.inventoryItemId,
    fromUnit: row.fromUnit as UnitOfMeasure,
    toUnit: row.toUnit as UnitOfMeasure,
    numerator: Number(row.numerator),
    denominator: Number(row.denominator),
    targetScale: row.targetScale,
    roundingPolicy: row.roundingPolicy as InventoryUnitConversion['roundingPolicy'],
    active: row.active,
    version: row.version,
  };
}

function allergen(row: AllergenRow): InventoryAllergen {
  return { id: row.id, code: row.code, label: row.label, active: row.active, version: row.version };
}

function onHandRow(row: OnHandRow): InventoryAuthoringItemOnHand {
  return {
    locationId: row.locationId,
    inventoryLocationId: row.inventoryLocationId,
    onHand: Number(row.onHand),
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = grouped.get(id);
    if (bucket) bucket.push(row);
    else grouped.set(id, [row]);
  }
  return grouped;
}

/** The version check every write makes before it writes. */
function assertVersion(aggregate: string, current: number, expected: number): void {
  if (current !== expected) {
    throw new ConflictException({
      code: 'OPTIMISTIC_VERSION_CONFLICT',
      details: { aggregate, currentVersion: current },
    });
  }
}

function invalidConversion(reason: string): ConflictException {
  return new ConflictException({ code: 'INVENTORY_UNIT_CONVERSION_INVALID', details: { reason } });
}

/** A version a caller asked to change after it was already retired. */
function retiredRecipe(): ConflictException {
  return new ConflictException({
    code: 'CONFLICT',
    details: { reason: 'INVENTORY_RECIPE_RETIRED' },
  });
}

/**
 * The database's refusals, in the contract's own words.
 *
 * WHY THIS EXISTS AT ALL. The cycle guard and the target check are TRIGGERS and CHECK
 * constraints, so they arrive as SQLSTATE `P0001` and `23514`. Untranslated, both are
 * a 500 — a screen that says "something went wrong" about a chain the owner can see
 * going round in a circle. Each code below names the one thing that was wrong.
 *
 * A unique violation that is NOT the one-active-version index is re-thrown: guessing
 * at a cause is how a real defect is hidden behind a plausible code.
 */
function recipeWriteError(error: unknown): unknown {
  const source = error as { code?: unknown; constraint?: unknown; message?: unknown };
  const code = typeof source?.code === 'string' ? source.code : '';
  const constraint = typeof source?.constraint === 'string' ? source.constraint : '';
  const message = typeof source?.message === 'string' ? source.message : '';

  if (code === 'P0001') {
    if (message.includes('INVENTORY_RECIPE_CYCLE')) {
      return new ConflictException({ code: 'INVENTORY_RECIPE_CYCLE' });
    }
    if (message.includes('INVENTORY_RECIPE_TOO_DEEP')) {
      return new ConflictException({ code: 'INVENTORY_RECIPE_TOO_DEEP' });
    }
    if (message.includes('INVENTORY_RECIPE_NOT_FOUND')) {
      return new NotFoundException({ code: 'INVENTORY_RECIPE_NOT_FOUND' });
    }
    return error;
  }
  if (code === '23514') {
    return new ConflictException({
      code: 'INVENTORY_RECIPE_TARGET_INVALID',
      details: { constraint },
    });
  }
  if (code === '23503') {
    // A component names an item that does not exist; a target names a product, a
    // variant or an item that does not exist. The two are different answers.
    return constraint.includes('inventory_recipe_component')
      ? new NotFoundException({ code: 'INVENTORY_ITEM_NOT_FOUND' })
      : new ConflictException({
          code: 'INVENTORY_RECIPE_TARGET_INVALID',
          details: { constraint },
        });
  }
  if (code === '23505' && constraint.includes('inventory_recipe_active_target_uidx')) {
    return new ConflictException({
      code: 'CONFLICT',
      details: { reason: 'an active recipe version already exists for this target' },
    });
  }
  return error;
}

/**
 * SQLSTATE 23505 on the item insert. The constraint name names the cause, so a
 * unique violation that is NOT the merchant's reference is re-thrown rather than
 * mislabelled.
 */
function isDuplicateReference(error: unknown): boolean {
  const source = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (source?.code !== '23505') return false;
  const constraint = typeof source.constraint === 'string' ? source.constraint : '';
  const message = typeof source.message === 'string' ? source.message : '';
  return `${constraint}${message}`.includes('public_reference');
}
