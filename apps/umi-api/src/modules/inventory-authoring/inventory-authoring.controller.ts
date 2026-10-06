import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  InventoryAllergenQuery,
  InventoryAuthoringItemQuery,
  InventoryRecipeQuery,
  LotRecallQuery,
  PrepListQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventoryAuthoringService } from './inventory-authoring.service';

/**
 * The merchant console's inventory authoring READS (plan §11, phase 1): the item
 * list, the conversion list and the allergen label list, plus the recipe list and the
 * explosion (phase 2).
 *
 * THREE READS AND NO WRITES, and the absence is the design. Plan D15 makes every
 * write in this cluster an administrative command on
 * `/api/merchants/:merchantId/administrative-commands`, which already claims the
 * idempotency key, stamps the fingerprint and writes the audit row. A write route
 * here would re-implement that machinery, and the second copy is the one that
 * drifts.
 *
 * THE GATE IS `merchant.manage`, the same one purchasing and costing use. An
 * `inventory.*` key is carried only by POS operator sessions, so it would put these
 * paths out of reach of the console that needs them. No new permission is invented:
 * a key no role holds is a feature nobody can use.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId')
export class InventoryAuthoringController {
  constructor(private readonly authoring: InventoryAuthoringService) {}

  /** Every item the merchant authors, with its conversions, labels and on-hand. */
  @Get('items')
  items(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryAuthoringItemQuery))
    query: InventoryAuthoringItemQuery,
  ) {
    return this.authoring.items(access, query);
  }

  /** The conversions the till divides a received or consumed unit by. */
  @Get('unit-conversions')
  unitConversions(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryAuthoringItemQuery))
    query: InventoryAuthoringItemQuery,
  ) {
    return this.authoring.unitConversions(access, query);
  }

  /** The merchant's own allergen labels. A product's list is derived, not stored. */
  @Get('allergens')
  allergens(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryAllergenQuery)) query: InventoryAllergenQuery,
  ) {
    return this.authoring.allergens(access, query);
  }

  /**
   * Every recipe the merchant authored, with the cost of one unit of its yield. The
   * cost is exploded to raw items, so a plate built on a sub-recipe still shows what it
   * truly costs.
   */
  @Get('recipes')
  recipes(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryRecipeQuery)) query: InventoryRecipeQuery,
  ) {
    return this.authoring.recipes(access, query);
  }

  /** One recipe, exploded to the items it consumes at every level. */
  @Get('recipes/:recipeId/explosion')
  explosion(
    @Merchant() access: MerchantAccess,
    @Param('recipeId') recipeId: string,
    @Query(new ZodValidationPipe(InventoryRecipeQuery)) query: InventoryRecipeQuery,
  ) {
    return this.authoring.explosion(access, recipeId, query);
  }

  /** What the kitchen must make today: par minus on-hand minus forecast usage. */
  @Get('prep-list')
  prepList(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(PrepListQuery)) query: PrepListQuery,
  ) {
    return this.authoring.prepList(access, query);
  }

  /**
   * The label sheet for the prep list, rendered by the server as a PNG. The response is
   * an image rather than a model, which is why the route table names no response shape.
   */
  @Get('prep-list/labels')
  async prepListLabels(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(PrepListQuery)) query: PrepListQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const png = await this.authoring.prepLabelSheet(access, query);
    reply
      .status(200)
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'no-store')
      .send(png);
  }

  /**
   * The recall answer for one lot: the sales of its ITEM inside its life window, with
   * the basis stated. The path names the lot; the contract's query model may repeat it.
   */
  @Get('stock-lots/:lotId/recall')
  recall(
    @Merchant() access: MerchantAccess,
    @Param('lotId') lotId: string,
    @Query(new ZodValidationPipe(LotRecallQuery.partial()))
    _query: Record<string, string | undefined>,
  ) {
    return this.authoring.recall(access, lotId);
  }
}
