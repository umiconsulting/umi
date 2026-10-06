import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import {
  type InventoryAllergenList,
  type InventoryAllergenQuery,
  type InventoryAllergenSetRequest,
  type InventoryAuthoringItemAllergenSetRequest,
  type InventoryAuthoringItemArchiveRequest,
  type InventoryAuthoringItemCreateRequest,
  type InventoryAuthoringItemList,
  type InventoryAuthoringItemQuery,
  type InventoryAuthoringItemUpdateRequest,
  type InventoryItemCostBasis,
  type InventoryRecipe,
  type InventoryRecipeComponent,
  type InventoryRecipeCreateRequest,
  type InventoryRecipeExplosion,
  type InventoryRecipeExplosionItem,
  type InventoryRecipeList,
  type InventoryRecipeQuery,
  type InventoryRecipeRetireRequest,
  type InventoryRecipeUpdateRequest,
  type InventoryUnitConversionList,
  type InventoryUnitConversionSetRequest,
  type PrepList,
  type PrepListItem,
  type PrepListQuery,
  UnitOfMeasure,
} from '@umi/contract';
import { LotRecall } from '@umi/contract';
import type { z } from 'zod';
import { getRequestContext } from '../../shared/database/request-context';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { IntegrityService } from '../integrity/integrity.service';
import type { TransactionContext } from '../integrity/integrity.types';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import {
  quantityCostMinor,
  shiftBusinessDate,
  toBigInt,
  toSafeNumber,
} from '../inventory-costing/inventory-costing-domain';
// THE ONE COST PATH. A recipe version's cost, and the explosion arithmetic it rests
// on, live with the costing module so the stored point, the live recipe read and the
// cost history cannot become three answers to one question.
import {
  explodedQuantity,
  recipeCostOutcome,
} from '../inventory-costing/inventory-costing.service';
import {
  InventoryAuthoringRepository,
  type AllergenListCursor,
  type ConversionListCursor,
  type ItemListCursor,
  type LotSaleRow,
  type RecipeExplosionRow,
  type RecipeComponentRow,
  type RecipeListCursor,
  type RecipeRow,
  type StoredRecipe,
} from './inventory-authoring.repository';

/** The recall model is published as a zod schema only, so its shape is read from it. */
type Recall = z.infer<typeof LotRecall>;

/** The writes this module publishes as administrative commands (plan §6.2). */
export type InventoryAuthoringOperation =
  | 'inventory.item.create'
  | 'inventory.item.update'
  | 'inventory.item.archive'
  | 'inventory.conversion.set'
  | 'inventory.allergen.set'
  | 'inventory.item_allergen.set'
  | 'inventory.recipe.create'
  | 'inventory.recipe.update'
  | 'inventory.recipe.retire';

/** The parameters the execution service parses before it calls in here. */
export type InventoryAuthoringCommandDto =
  | InventoryAuthoringItemCreateRequest
  | InventoryAuthoringItemUpdateRequest
  | InventoryAuthoringItemArchiveRequest
  | InventoryAuthoringItemAllergenSetRequest
  | InventoryUnitConversionSetRequest
  | InventoryAllergenSetRequest
  | InventoryRecipeCreateRequest
  | InventoryRecipeUpdateRequest
  | InventoryRecipeRetireRequest;

/**
 * The console's inventory AUTHORING surface (plan §11, phase 1): items, unit
 * conversions and allergen labels.
 *
 * WHY THE CONSOLE AND NOT THE TILL (plan D12). A dense food-cost editor belongs on
 * a browser surface. So these reads authenticate with a browser session and are
 * gated by `merchant.manage`, and every write is an administrative command on
 * `merchants.administrativeCommands` — never a route of its own. The routes the
 * till carries are versioned because the till lives in the field on an old build;
 * these are unversioned because the console deploys with the API.
 *
 * EVERY WRITE GOES THROUGH `IntegrityService.execute`. That is D15: the command is
 * claimed by its idempotency key, fingerprinted, and finished with an audit row, so
 * a retry after a lost response answers with the first attempt's own result instead
 * of authoring the item twice.
 */
@Injectable()
export class InventoryAuthoringService {
  constructor(
    private readonly repo: InventoryAuthoringRepository,
    private readonly integrity: IntegrityService,
    private readonly costing: InventoryCostingService,
  ) {}

  // ── The reads ──────────────────────────────────────────────────────────────

  async items(
    access: MerchantAccess,
    query: InventoryAuthoringItemQuery,
  ): Promise<InventoryAuthoringItemList> {
    const { rows, hasMore } = await this.repo.listItems(
      access.merchantId,
      query,
      decodeItemCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      items: rows,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor({ reference: last.publicReference, id: last.id }) : null,
      },
      correlationId: this.correlationId(),
    };
  }

  async unitConversions(
    access: MerchantAccess,
    query: InventoryAuthoringItemQuery,
  ): Promise<InventoryUnitConversionList> {
    const { rows, hasMore } = await this.repo.listConversions(
      access.merchantId,
      query,
      decodeConversionCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      items: rows,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                inventoryItemId: last.inventoryItemId,
                fromUnit: last.fromUnit,
                toUnit: last.toUnit,
                version: last.version,
              })
            : null,
      },
      correlationId: this.correlationId(),
    };
  }

  async allergens(
    access: MerchantAccess,
    query: InventoryAllergenQuery,
  ): Promise<InventoryAllergenList> {
    // `InventoryAllergenQuery` accepts up to 200, but the response's `PageInfo` caps
    // a page at 100. So a larger request is served as 100 and REPORTED as 100, with a
    // cursor that continues it — the alternative is a payload that cannot parse
    // against the very model it answers with.
    const limit = Math.min(query.limit, 100);
    const { rows, hasMore } = await this.repo.listAllergens(
      access.merchantId,
      { ...query, limit },
      decodeAllergenCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      allergens: rows,
      page: {
        limit,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ code: last.code }) : null,
      },
      correlationId: this.correlationId(),
    };
  }

  // ── The recipe reads ──────────────────────────────────────────────────────

  /**
   * The console's recipe list, each version carrying the TRUE cost of one unit of its
   * yield. The cost is the sum over the raw items the recipe reaches: a component that
   * is itself a prep has no cost of its own, and charging it would charge the plate
   * twice.
   */
  async recipes(access: MerchantAccess, query: InventoryRecipeQuery): Promise<InventoryRecipeList> {
    const unitCosts = await this.unitCostsByItem(access);
    const { rows, hasMore } = await this.repo.listRecipes(
      access.merchantId,
      query,
      decodeRecipeCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      recipes: rows.map((stored) => recipeModel(stored, unitCosts)),
      page: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.recipe.createdAt, id: last.recipe.id })
            : null,
      },
      correlationId: this.correlationId(),
    };
  }

  /**
   * One recipe, exploded to raw items by `merchant.explode_inventory_recipe`.
   *
   * THE QUERY MODEL IS PARSED AND NOT FILTERED. The route declares
   * `InventoryRecipeQuery`, and every field on it chooses WHICH recipes a LIST shows.
   * A named recipe has exactly one version, so there is nothing left to choose — and
   * the model stays parsed so a malformed filter is refused rather than ignored.
   *
   * A RETIRED VERSION HAS NO EXPLOSION, and saying so beats answering with an empty
   * list: an empty list reads as "this recipe consumes nothing", which is the opposite
   * of the truth.
   */
  async explosion(
    access: MerchantAccess,
    recipeId: string,
    _query: InventoryRecipeQuery,
  ): Promise<InventoryRecipeExplosion> {
    if (!UUID_SHAPE.test(recipeId)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        fieldErrors: { recipeId: ['not a uuid'] },
      });
    }
    const header = await this.repo.readRecipeHeader(access.merchantId, recipeId);
    if (!header) throw new NotFoundException({ code: 'INVENTORY_RECIPE_NOT_FOUND' });
    if (!header.active) {
      throw new ConflictException({
        code: 'CONFLICT',
        details: { reason: 'INVENTORY_RECIPE_RETIRED' },
      });
    }
    const [rows, unitCosts] = await Promise.all([
      this.repo.explodeRecipe(access.merchantId, recipeId),
      this.unitCostsByItem(access),
    ]);
    return explosionModel(recipeId, header, rows, unitCosts);
  }

  // ── Production reads: the prep list, its labels, and a lot's recall ─────────

  /**
   * THE PREP LIST (plan D13 and §8.4). What the kitchen must make today.
   *
   * THE ARITHMETIC IS PAR MINUS ON-HAND MINUS FORECAST USAGE, floored at zero. PAR is
   * `inventory_item.par_quantity`, NOT the low-stock threshold: the threshold is a
   * purchase alarm, while par is the level the kitchen wants on hand.
   *
   * THE FORECAST IS THE COSTING MODULE'S OWN. `lowStock` answers the on-hand, the
   * consumption and the honest daily rate — divided by the days the item was actually
   * observed, never by a window it never had — and this read multiplies that rate by the
   * item's own shelf life. A second forecast here would be a second answer to the same
   * question.
   *
   * THE WINDOW IS STATED. The window is the longest shelf life among the candidates (the
   * plan's 28 days when nothing declares one, and never more than the forecast read's own
   * 180-day cap), and `from`/`to` name it in the answer.
   */
  async prepList(access: MerchantAccess, query: PrepListQuery): Promise<PrepList> {
    const candidates = await this.repo.prepCandidates(access.merchantId);
    const shelfLives = candidates
      .map((candidate) => candidate.recipeShelfLifeDays ?? candidate.itemShelfLifeDays)
      .filter((days): days is number => days !== null);
    const windowDays =
      shelfLives.length === 0 ? 28 : Math.min(180, Math.max(1, Math.max(...shelfLives)));

    const forecast = await this.costing.lowStock(access, {
      windowDays,
      belowThresholdOnly: false,
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
    });
    const observedByItem = new Map(
      forecast.items.map((item) => [item.inventoryItemId, item] as const),
    );

    const items: PrepListItem[] = [];
    for (const candidate of candidates) {
      const observed = observedByItem.get(candidate.inventoryItemId);
      if (!observed) continue;
      const unit = unitOfMeasure(candidate.baseUnit);
      const shelfLifeDays = candidate.recipeShelfLifeDays ?? candidate.itemShelfLifeDays;
      // The horizon the rate is projected over. An item with no shelf life uses the
      // window the list states.
      const horizon =
        shelfLifeDays === null ? windowDays : Math.min(180, Math.max(1, shelfLifeDays));
      const rate =
        observed.dailyRateQuantity === null ? 0n : BigInt(observed.dailyRateQuantity.value);
      const forecastUsage = rate * BigInt(horizon);
      // A negative on-hand (an item the business allows to go short) would only INCREASE
      // the quantity to make, so it is clamped onto the contract's non-negative shape.
      const onHand = BigInt(Math.max(0, observed.onHand.value));
      const par = BigInt(candidate.parQuantity);
      const shortfall = par - onHand - forecastUsage;
      const row: PrepListItem = {
        inventoryItemId: candidate.inventoryItemId,
        publicReference: candidate.publicReference,
        displayName: candidate.displayName,
        unit,
        quantityScale: candidate.quantityScale,
        parQuantity: itemScaleQuantity(par, candidate.quantityScale, unit),
        onHandQuantity: itemScaleQuantity(onHand, candidate.quantityScale, unit),
        forecastUsageQuantity: itemScaleQuantity(forecastUsage, candidate.quantityScale, unit),
        prepQuantity: itemScaleQuantity(
          shortfall > 0n ? shortfall : 0n,
          candidate.quantityScale,
          unit,
        ),
        shelfLifeDays,
        expiresOn: shelfLifeDays === null ? null : shiftBusinessDate(forecast.to, shelfLifeDays),
      };
      if (!query.includeAbovePar && row.prepQuantity.value === 0) continue;
      items.push(row);
    }
    // The list exists to be worked, so what is needed most comes first.
    items.sort(
      (left, right) =>
        right.prepQuantity.value - left.prepQuantity.value ||
        left.displayName.localeCompare(right.displayName),
    );

    return {
      items,
      locationId: forecast.locationId,
      from: forecast.from,
      to: forecast.to,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }

  /**
   * THE LABEL SHEET (plan D14 and §8.3). The SERVER renders it, and the café prints it
   * on the printer it already owns: there is no new printer integration in v1.
   *
   * One label per prep item, carrying the item's name, the batch code, the produced date
   * and the expiry. The sheet is a plain A4 grid so a person can cut it and stick one
   * label on each container.
   */
  async prepLabelSheet(access: MerchantAccess, query: PrepListQuery): Promise<Buffer> {
    const list = await this.prepList(access, query);
    return renderPrepLabelSheet(list);
  }

  /**
   * RECALL (plan §8.3 and D9). "Which sales consumed this lot?"
   *
   * THE BASIS IS STATED, NOT IMPLIED. Stock moves as quantity, and only a produced or
   * received batch carries a lot; a sale's ledger rows do not name the lot they took. V1
   * therefore answers the sales of the LOT'S ITEM inside the lot's own life window and
   * says so with `basis: 'item_and_window'`.
   */
  async recall(access: MerchantAccess, lotId: string): Promise<Recall> {
    if (!UUID_SHAPE.test(lotId)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        fieldErrors: { lotId: ['not a uuid'] },
      });
    }
    const lot = await this.repo.stockLot(access.merchantId, lotId);
    if (!lot) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    const lifeStart = lot.producedAt ?? lot.receivedAt;
    if (!lifeStart) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    const windowFrom = iso(lifeStart);
    const windowTo =
      lot.expiresOn === null ? new Date().toISOString() : iso(`${lot.expiresOn}T23:59:59.999Z`);
    const sales = await this.repo.lotSales(
      access.merchantId,
      lot.inventoryItemId,
      windowFrom,
      windowTo,
    );
    return {
      lotId: lot.lotId,
      lotReference: lot.lotReference,
      inventoryItemId: lot.inventoryItemId,
      inventoryItemName: lot.inventoryItemName,
      locationId: lot.locationId,
      inventoryLocationId: lot.inventoryLocationId,
      origin: lot.origin as Recall['origin'],
      producedAt: lot.producedAt === null ? null : iso(lot.producedAt),
      receivedAt: lot.receivedAt === null ? null : iso(lot.receivedAt),
      expiresOn: lot.expiresOn,
      basis: 'item_and_window',
      windowFrom,
      windowTo,
      sales: sales.map((sale) => saleModel(sale)),
      saleCount: sales.length,
      correlationId: this.correlationId(),
    };
  }

  // ── The writes ─────────────────────────────────────────────────────────────

  async executeAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    operation: InventoryAuthoringOperation,
    dto: InventoryAuthoringCommandDto,
  ) {
    switch (operation) {
      case 'inventory.item.create':
        return this.createItem(user, access, context, dto as InventoryAuthoringItemCreateRequest);
      case 'inventory.item.update':
        return this.updateItem(user, access, context, dto as InventoryAuthoringItemUpdateRequest);
      case 'inventory.item.archive':
        return this.archiveItem(user, access, context, dto as InventoryAuthoringItemArchiveRequest);
      case 'inventory.conversion.set':
        return this.setConversion(user, access, context, dto as InventoryUnitConversionSetRequest);
      case 'inventory.allergen.set':
        return this.setAllergen(user, access, context, dto as InventoryAllergenSetRequest);
      case 'inventory.item_allergen.set':
        return this.setItemAllergens(
          user,
          access,
          context,
          dto as InventoryAuthoringItemAllergenSetRequest,
        );
      case 'inventory.recipe.create':
        return this.createRecipe(user, access, context, dto as InventoryRecipeCreateRequest);
      case 'inventory.recipe.update':
        return this.updateRecipe(user, access, context, dto as InventoryRecipeUpdateRequest);
      case 'inventory.recipe.retire':
        return this.retireRecipe(user, access, context, dto as InventoryRecipeRetireRequest);
      default:
        throw new Error('unsupported_inventory_authoring_operation');
    }
  }

  /** Create an ingredient, a packaging item or any other item the model names. */
  private async createItem(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryAuthoringItemCreateRequest,
  ) {
    const result = await this.run(
      'inventory.item.create',
      access,
      context,
      dto,
      async (transaction) => {
        const item = await this.repo.createItem(
          transaction.client,
          access.merchantId,
          context.targetAggregateId,
          dto,
        );
        await transaction.appendAudit({
          eventType: 'inventory_item_created',
          entityType: 'inventory_item',
          entityId: item.id,
          outcome: 'success',
          publicData: {
            actorUserId: user.id,
            publicReference: item.publicReference,
            itemType: item.itemType,
          },
        });
        return item;
      },
    );
    return { commandId: result.commandId, item: result.value, correlationId: result.correlationId };
  }

  private async updateItem(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryAuthoringItemArchiveRequest,
  ) {
    const result = await this.run(
      'inventory.item.update',
      access,
      context,
      dto,
      async (transaction) => {
        const item = await this.repo.updateItem(
          transaction.client,
          access.merchantId,
          dto.inventoryItemId,
          dto,
        );
        await transaction.appendAudit({
          eventType: 'inventory_item_updated',
          entityType: 'inventory_item',
          entityId: item.id,
          outcome: 'success',
          publicData: { actorUserId: user.id, version: item.version },
        });
        return item;
      },
    );
    return { commandId: result.commandId, item: result.value, correlationId: result.correlationId };
  }

  private async archiveItem(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryAuthoringItemUpdateRequest,
  ) {
    const result = await this.run(
      'inventory.item.archive',
      access,
      context,
      dto,
      async (transaction) => {
        const item = await this.repo.archiveItem(
          transaction.client,
          access.merchantId,
          dto.inventoryItemId,
          dto.expectedVersion,
        );
        await transaction.appendAudit({
          eventType: 'inventory_item_archived',
          entityType: 'inventory_item',
          entityId: item.id,
          outcome: 'success',
          publicData: { actorUserId: user.id, publicReference: item.publicReference },
        });
        return item;
      },
    );
    return { commandId: result.commandId, item: result.value, correlationId: result.correlationId };
  }

  private async setConversion(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryUnitConversionSetRequest,
  ) {
    const result = await this.run(
      'inventory.conversion.set',
      access,
      context,
      dto,
      async (transaction) => {
        const conversion = await this.repo.setConversion(
          transaction.client,
          access.merchantId,
          dto.inventoryItemId,
          dto,
        );
        await transaction.appendAudit({
          eventType: 'inventory_unit_conversion_set',
          entityType: 'inventory_unit_conversion',
          entityId: conversion.id,
          outcome: 'success',
          publicData: {
            actorUserId: user.id,
            inventoryItemId: conversion.inventoryItemId,
            fromUnit: conversion.fromUnit,
            toUnit: conversion.toUnit,
            version: conversion.version,
          },
        });
        return conversion;
      },
    );
    return {
      commandId: result.commandId,
      conversion: result.value,
      correlationId: result.correlationId,
    };
  }

  private async setAllergen(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryAllergenSetRequest,
  ) {
    const result = await this.run(
      'inventory.allergen.set',
      access,
      context,
      dto,
      async (transaction) => {
        const allergen = await this.repo.setAllergen(
          transaction.client,
          access.merchantId,
          context.targetAggregateId,
          dto,
        );
        await transaction.appendAudit({
          eventType: 'inventory_allergen_set',
          entityType: 'inventory_allergen',
          entityId: allergen.id,
          outcome: 'success',
          publicData: { actorUserId: user.id, code: allergen.code, active: allergen.active },
        });
        return allergen;
      },
    );
    return {
      commandId: result.commandId,
      allergen: result.value,
      correlationId: result.correlationId,
    };
  }

  private async setItemAllergens(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryAuthoringItemAllergenSetRequest,
  ) {
    const result = await this.run(
      'inventory.item_allergen.set',
      access,
      context,
      dto,
      async (transaction) => {
        const item = await this.repo.setItemAllergens(
          transaction.client,
          access.merchantId,
          dto.inventoryItemId,
          dto,
        );
        await transaction.appendAudit({
          eventType: 'inventory_item_allergen_set',
          entityType: 'inventory_item',
          entityId: item.id,
          outcome: 'success',
          publicData: {
            actorUserId: user.id,
            allergenCount: item.allergens.length,
            version: item.version,
          },
        });
        return item;
      },
    );
    return { commandId: result.commandId, item: result.value, correlationId: result.correlationId };
  }

  /**
   * Create a recipe at version 1, under the id the command named.
   *
   * THE COST BASIS IS READ BEFORE THE TRANSACTION, because it is a different read
   * (`InventoryCostingService.costBasis`) with its own connection, and a cost is a
   * derived value: reading it inside the write would ask the same question twice and
   * could answer with two numbers. The basis is merchant-wide by definition, so a
   * receipt that lands mid-transaction moves the NEXT read, not this one.
   */
  private async createRecipe(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryRecipeCreateRequest,
  ) {
    const unitCosts = await this.unitCostsByItem(access);
    const result = await this.run(
      'inventory.recipe.create',
      access,
      context,
      dto,
      async (transaction) => {
        const stored = await this.repo.createRecipe(
          transaction.client,
          access.merchantId,
          context.targetAggregateId,
          dto,
        );
        await this.storeRecipeCost(transaction, access, stored, unitCosts);
        await transaction.appendAudit({
          eventType: 'inventory_recipe_created',
          entityType: 'inventory_recipe',
          entityId: stored.recipe.id,
          outcome: 'success',
          publicData: {
            actorUserId: user.id,
            targetKind: stored.recipe.targetKind,
            version: stored.recipe.version,
          },
        });
        return recipeModel(stored, unitCosts);
      },
    );
    return {
      commandId: result.commandId,
      recipe: result.value,
      correlationId: result.correlationId,
    };
  }

  /**
   * Amend a recipe: retire the version the caller read, write the next one, and repoint
   * the mapping that names it. The response carries the NEW version's id, which is what
   * the editor must use for its next write.
   */
  private async updateRecipe(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryRecipeUpdateRequest,
  ) {
    const unitCosts = await this.unitCostsByItem(access);
    const result = await this.run(
      'inventory.recipe.update',
      access,
      context,
      dto,
      async (transaction) => {
        const stored = await this.repo.updateRecipe(
          transaction.client,
          access.merchantId,
          dto.recipeId,
          dto,
        );
        // The NEW version is a new row, so it stores its own point. The retired row
        // keeps the cost it was written with, which is what the history read explains.
        await this.storeRecipeCost(transaction, access, stored, unitCosts);
        await transaction.appendAudit({
          eventType: 'inventory_recipe_updated',
          entityType: 'inventory_recipe',
          entityId: stored.recipe.id,
          outcome: 'success',
          publicData: {
            actorUserId: user.id,
            previousRecipeId: dto.recipeId,
            version: stored.recipe.version,
          },
        });
        return recipeModel(stored, unitCosts);
      },
    );
    return {
      commandId: result.commandId,
      recipe: result.value,
      correlationId: result.correlationId,
    };
  }

  /** Retire a recipe version. Nothing is deleted: the row and its history stay. */
  private async retireRecipe(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: InventoryRecipeRetireRequest,
  ) {
    const unitCosts = await this.unitCostsByItem(access);
    const result = await this.run(
      'inventory.recipe.retire',
      access,
      context,
      dto,
      async (transaction) => {
        const stored = await this.repo.retireRecipe(
          transaction.client,
          access.merchantId,
          dto.recipeId,
          dto.expectedVersion,
        );
        await transaction.appendAudit({
          eventType: 'inventory_recipe_retired',
          entityType: 'inventory_recipe',
          entityId: stored.recipe.id,
          outcome: 'success',
          publicData: { actorUserId: user.id, version: stored.recipe.version },
        });
        return recipeModel(stored, unitCosts);
      },
    );
    return {
      commandId: result.commandId,
      recipe: result.value,
      correlationId: result.correlationId,
    };
  }

  /**
   * THE one cost basis this module reads, keyed by item. It is the same read the
   * costing view uses, with `includeWithoutReceipts` on: an item nobody delivered has
   * NO basis, and the map simply has no entry for it, which is how "no cost" reaches
   * the arithmetic without ever becoming a zero.
   */
  private async unitCostsByItem(access: MerchantAccess): Promise<Map<string, bigint>> {
    const basis = await this.costing.costBasis(access, { includeWithoutReceipts: true });
    return unitCostsOf(basis.items);
  }

  /**
   * D3: the version records the cost it computed when it was written. The SAME
   * function that answers the read computes the point, so the stored number and the
   * live one cannot disagree.
   *
   * WHY THE WRITER IS PROBED. The unit suite drives the command door against a partial
   * repository double that has no database behind it; an unconditional call there would
   * test the double rather than this service. The production repository always carries
   * the writer, and `inventory-costing.integration.ts` proves the columns land on a
   * version a console command really wrote, so the probe cannot hide a wiring gap.
   */
  private async storeRecipeCost(
    transaction: TransactionContext,
    access: MerchantAccess,
    stored: StoredRecipe,
    unitCosts: Map<string, bigint>,
  ): Promise<void> {
    const cost = recipeCostOutcome(stored.explosion, unitCosts);
    await this.repo.storeRecipeCost(
      transaction.client,
      access.merchantId,
      stored.recipe.id,
      cost.costMinor,
      cost.defects,
    );
  }

  /**
   * The one door every write uses: claim the command, run the work, keep the audit.
   *
   * A replay returns the FIRST attempt's stored result, so the caller's second call
   * answers exactly what the first one did.
   */
  private async run<T>(
    commandType: string,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: { commandId: string; idempotencyKey: string },
    operation: (transaction: TransactionContext) => Promise<T>,
  ): Promise<{ commandId: string; correlationId: string; value: T }> {
    const result = await this.integrity.execute<T>(
      {
        merchantId: access.merchantId,
        locationId: context.locationId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        commandType,
        payload: dto,
        ...(context.targetVersion === null ? {} : { expectedVersion: context.targetVersion }),
      },
      async (transaction) => ({ ok: true as const, value: await operation(transaction) }),
    );
    if (result.status === 'succeeded' && result.result !== null) {
      return {
        commandId: result.commandId,
        correlationId: result.correlationId,
        value: result.result,
      };
    }
    throw new ConflictException({
      code: result.failureCode ?? 'CONFLICT',
      correlationId: result.correlationId,
    });
  }

  private correlationId(): string {
    return getRequestContext()?.requestId ?? 'unknown';
  }
}

function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// ── Recipes: the derived shape and the money arithmetic ───────────────────────

/** The one cost per item, from the basis the costing service already computed. */
function unitCostsOf(items: readonly InventoryItemCostBasis[]): Map<string, bigint> {
  const costs = new Map<string, bigint>();
  for (const item of items) {
    // `basis: no_receipts` carries a null `unitCostMinor`, and null is NOT a zero: an
    // item nobody delivered has no cost, and the map has no entry for it.
    if (item.unitCostMinor === null) continue;
    costs.set(item.inventoryItemId, BigInt(item.unitCostMinor));
  }
  return costs;
}

/** One stored recipe version, as the contract publishes it. */
function recipeModel(stored: StoredRecipe, unitCosts: Map<string, bigint>): InventoryRecipe {
  const row = stored.recipe;
  const costMinor = recipeCostOutcome(stored.explosion, unitCosts).costMinor;
  // A margin needs a price, and only a product or a variant has one. A sub-recipe is
  // not sold, so its margin is null rather than zero.
  const priceMinor = row.priceMinor === null ? null : toBigInt(row.priceMinor);
  return {
    id: row.id,
    targetKind: row.targetKind,
    productId: row.productId,
    variantId: row.variantId,
    targetItemId: row.targetItemId,
    targetName: row.targetName,
    version: row.version,
    yieldQuantity: {
      value: toSafeNumber(toBigInt(row.yieldQuantity)),
      scale: row.yieldScale,
      unit: unitOfMeasure(row.yieldUnit),
    },
    shelfLifeDays: row.shelfLifeDays,
    active: row.active,
    effectiveAt: new Date(row.effectiveAt).toISOString(),
    retiredAt: row.retiredAt === null ? null : new Date(row.retiredAt).toISOString(),
    components: stored.components.map((component) => recipeComponentModel(component, unitCosts)),
    costMinor: costMinor === null ? null : toSafeNumber(costMinor),
    marginMinor:
      costMinor === null || priceMinor === null ? null : toSafeNumber(priceMinor - costMinor),
    usedInRecipeCount: toSafeNumber(toBigInt(row.usedInRecipeCount)),
  };
}

/**
 * One component line of a stored recipe.
 *
 * THE LINE COST IS THE DIRECT BASIS OF THE ITEM IT NAMES, and it is null when that item
 * has no receipt. The RECIPE's cost is the exploded one (`recipeModel` above): a
 * component that is itself a prep has no basis of its own, and its ingredients' money
 * arrives through the explosion rather than through this line.
 */
function recipeComponentModel(
  component: RecipeComponentRow,
  unitCosts: Map<string, bigint>,
): InventoryRecipeComponent {
  const quantity = toBigInt(component.quantity);
  const unitCost = unitCosts.get(component.inventoryItemId) ?? null;
  return {
    id: component.id,
    inventoryItemId: component.inventoryItemId,
    publicReference: component.publicReference,
    displayName: component.displayName,
    quantity: {
      value: toSafeNumber(quantity),
      scale: component.quantityScale,
      unit: unitOfMeasure(component.unit),
    },
    conversionNumerator: toSafeNumber(toBigInt(component.conversionNumerator)),
    conversionDenominator: toSafeNumber(toBigInt(component.conversionDenominator)),
    roundingPolicy: component.roundingPolicy as InventoryRecipeComponent['roundingPolicy'],
    required: component.required,
    unitCostMinor: unitCost === null ? null : toSafeNumber(unitCost),
    lineCostMinor:
      unitCost === null
        ? null
        : toSafeNumber(
            quantityCostMinor({ value: quantity, scale: component.quantityScale }, unitCost),
          ),
  };
}

/** One recipe exploded, as the contract publishes it. */
function explosionModel(
  recipeId: string,
  header: RecipeRow,
  rows: readonly RecipeExplosionRow[],
  unitCosts: Map<string, bigint>,
): InventoryRecipeExplosion {
  const items = rows.map((row) => explosionItemModel(row, unitCosts));
  return {
    recipeId,
    targetKind: header.targetKind,
    targetItemId: header.targetItemId,
    // The contract floors this at one: a recipe always consumes at least one line.
    depth: items.reduce((deepest, item) => Math.max(deepest, item.depth), 1),
    items,
  };
}

/**
 * One exploded item.
 *
 * ONLY A LEAF IS PRICED. A row with `hasRecipe` is an intermediate prep: it is shown
 * because the owner is looking at what the recipe consumes, and it carries NO cost,
 * because its cost IS its ingredients' cost and charging both would charge the plate
 * twice.
 */
function explosionItemModel(
  row: RecipeExplosionRow,
  unitCosts: Map<string, bigint>,
): InventoryRecipeExplosionItem {
  const quantity = explodedQuantity(row);
  const leaf = !row.hasRecipe;
  const unitCost = leaf && quantity.exact ? (unitCosts.get(row.inventoryItemId) ?? null) : null;
  return {
    inventoryItemId: row.inventoryItemId,
    publicReference: row.publicReference,
    displayName: row.displayName,
    quantity: {
      value: toSafeNumber(quantity.value),
      scale: row.quantityScale,
      unit: unitOfMeasure(row.baseUnit),
    },
    exact: quantity.exact,
    unitCostMinor: unitCost === null ? null : toSafeNumber(unitCost),
    lineCostMinor:
      unitCost === null
        ? null
        : toSafeNumber(
            quantityCostMinor({ value: quantity.value, scale: row.quantityScale }, unitCost),
          ),
    depth: row.depth,
    path: row.path,
  };
}

// `explodedQuantity` and `recipeCostOutcome` are imported above: the cost path lives
// with the costing module, which is the module the recipe read's own cost already came
// from.

/**
 * A quantity for the contract. The unit is re-validated rather than cast: the column
 * has a CHECK constraint, and a cast that trusted it would turn a schema mistake into
 * an invalid payload instead of a loud failure.
 */
function unitOfMeasure(unit: string): UnitOfMeasure {
  const parsed = UnitOfMeasure.safeParse(unit);
  if (!parsed.success) throw new Error(`unitOfMeasure: unknown unit: ${unit}`);
  return parsed.data;
}

/** A quantity at an item's own scale, for the contract's scaled-quantity shapes. */
function itemScaleQuantity(value: bigint, scale: number, unit: UnitOfMeasure) {
  return { value: toSafeNumber(value), scale, unit };
}

/** The `timestamptz` text Postgres writes, as the ISO form the contract publishes. */
function iso(value: string): string {
  return new Date(value).toISOString();
}

/** One sale's consumption of the recalled lot's item, as the contract publishes it. */
function saleModel(row: LotSaleRow): Recall['sales'][number] {
  return {
    saleId: row.saleId,
    publicReference: row.publicReference,
    productName: row.productName,
    quantity: itemScaleQuantity(toBigInt(row.quantity), row.quantityScale, unitOfMeasure(row.unit)),
    occurredAt: iso(row.occurredAt),
    businessDate: row.businessDate,
  };
}

// ── The label sheet ─────────────────────────────────────────────────────────

/** A4 at 150 dots per inch, which is legible on a café's own printer. */
const SHEET_WIDTH = 1240;
const SHEET_MIN_HEIGHT = 1754;
const LABEL_MARGIN = 40;
const LABEL_GAP = 16;
const LABEL_COLUMNS = 2;
const LABEL_WIDTH = Math.floor((SHEET_WIDTH - 2 * LABEL_MARGIN - LABEL_GAP) / LABEL_COLUMNS);
const LABEL_HEIGHT = 170;

/**
 * The A4-wide label sheet, rasterised with `sharp`.
 *
 * The sheet is deliberately plain: a cut border, the item's name and three dated facts.
 * One image carries every prep item, so the width stays A4 and the height grows with the
 * list rather than the list being silently truncated.
 */
async function renderPrepLabelSheet(list: PrepList): Promise<Buffer> {
  const rows = Math.max(1, Math.ceil(list.items.length / LABEL_COLUMNS));
  const height = Math.max(
    SHEET_MIN_HEIGHT,
    LABEL_MARGIN + rows * (LABEL_HEIGHT + LABEL_GAP) + LABEL_MARGIN,
  );
  const labels = list.items
    .map((item, index) => {
      const column = index % LABEL_COLUMNS;
      const row = Math.floor(index / LABEL_COLUMNS);
      const x = LABEL_MARGIN + column * (LABEL_WIDTH + LABEL_GAP);
      const y = LABEL_MARGIN + row * (LABEL_HEIGHT + LABEL_GAP);
      return prepLabel(item, list.to, x, y);
    })
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${height}">` +
    `<rect width="${SHEET_WIDTH}" height="${height}" fill="#ffffff"/>${labels}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** One label. The batch code is the item's reference plus the day the batch belongs to. */
function prepLabel(item: PrepListItem, businessDate: string, x: number, y: number): string {
  const batchCode = `${item.publicReference}-${businessDate.replace(/-/g, '')}`;
  const expiry = item.expiresOn ?? 'sin caducidad';
  return (
    `<rect x="${x}" y="${y}" width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" ` +
    `fill="#ffffff" stroke="#000000" stroke-width="2"/>` +
    text(x + 16, y + 40, 28, 'bold', item.displayName) +
    text(x + 16, y + 78, 22, 'normal', `Lote: ${batchCode}`) +
    text(x + 16, y + 114, 22, 'normal', `Producido: ${businessDate}`) +
    text(x + 16, y + 150, 22, 'normal', `Caduca: ${expiry}`)
  );
}

function text(x: number, y: number, size: number, weight: string, value: string): string {
  return (
    `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" ` +
    `font-weight="${weight}" fill="#000000">${escapeXml(value)}</text>`
  );
}

/** An item name is merchant-authored text, so it never reaches the SVG unescaped. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The page keys of the reads, and the shape each key must have. */
type CursorField = 'uuid' | 'integer' | 'text' | 'timestamp';

function decodeItemCursor(cursor: string | undefined): ItemListCursor | null {
  const value = decodeCursor(cursor, [
    ['reference', 'text'],
    ['id', 'uuid'],
  ]);
  return value ? { reference: String(value.reference), id: String(value.id) } : null;
}

function decodeConversionCursor(cursor: string | undefined): ConversionListCursor | null {
  const value = decodeCursor(cursor, [
    ['inventoryItemId', 'uuid'],
    ['fromUnit', 'text'],
    ['toUnit', 'text'],
    ['version', 'integer'],
  ]);
  if (!value) return null;
  return {
    inventoryItemId: String(value.inventoryItemId),
    fromUnit: String(value.fromUnit),
    toUnit: String(value.toUnit),
    version: Number(value.version),
  };
}

function decodeAllergenCursor(cursor: string | undefined): AllergenListCursor | null {
  const value = decodeCursor(cursor, [['code', 'text']]);
  return value ? { code: String(value.code) } : null;
}

function decodeRecipeCursor(cursor: string | undefined): RecipeListCursor | null {
  const value = decodeCursor(cursor, [
    ['createdAt', 'timestamp'],
    ['id', 'uuid'],
  ]);
  if (!value) return null;
  return { createdAt: String(value.createdAt), id: String(value.id) };
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `timestamptz` text Postgres writes, which is the form this module puts in a
 * cursor and casts straight back. Anything else would be a page key this module did not
 * write, and casting it would be a server fault for something the caller sent.
 */
const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?)?$/;

/**
 * A cursor a caller sent must be one this module wrote. Anything else is a client
 * error, not a 500, so it answers with the contract's validation code. The shapes
 * are checked here because the keys become `::uuid` and `::int` casts in SQL, and a
 * cast failure would surface as a server fault for something the caller sent.
 */
function decodeCursor(
  cursor: string | undefined,
  fields: ReadonlyArray<readonly [string, CursorField]>,
): Record<string, string | number> | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    const record = value as Record<string, unknown>;
    const decoded: Record<string, string | number> = {};
    for (const [key, kind] of fields) {
      const field = record[key];
      if (kind === 'uuid' && !(typeof field === 'string' && UUID_SHAPE.test(field))) {
        throw new Error('invalid');
      }
      if (
        kind === 'integer' &&
        !(typeof field === 'number' && Number.isInteger(field) && field > 0)
      ) {
        throw new Error('invalid');
      }
      if (kind === 'text' && !(typeof field === 'string' && field.length > 0)) {
        throw new Error('invalid');
      }
      if (kind === 'timestamp' && !(typeof field === 'string' && TIMESTAMP_SHAPE.test(field))) {
        throw new Error('invalid');
      }
      decoded[key] = field as string | number;
    }
    return decoded;
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED' });
  }
}
