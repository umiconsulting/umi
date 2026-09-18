import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  InventoryCostBasisQuery,
  InventoryCostingDayQuery,
  InventoryPlateQuery,
  InventoryRecipeCostQuery,
  InventoryUsageVarianceQuery,
  LowStockForecastQuery,
  MenuEngineeringQuery,
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
import { InventoryCostingService } from './inventory-costing.service';

/**
 * The merchant console's costing surface (plan §8E steps 5 and 6).
 *
 * READS AND NO WRITES. A cost is not something a person types — it is what a supplier
 * charged, and it enters the system through receiving. So this controller has no POST,
 * no PUT and no PATCH, and that absence is the design: if a cost could be edited here,
 * it would immediately disagree with the receipts it is supposed to be derived from.
 * The variance, the cost history and the menu classes are three more reads of the same
 * ledger and the same recipes (plan §11 phase 4).
 *
 * THE GATE IS `merchant.manage`, the same one purchasing uses. Reading what a plate
 * costs and what a day made is a manager's question about money, and the alternative
 * — an `inventory.*` key — is carried only by POS operator sessions, which would put
 * these routes out of reach of the surface that needs them. No new permission is
 * invented: a key no role holds is a feature nobody can use.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/inventory-costing')
export class InventoryCostingController {
  constructor(private readonly costing: InventoryCostingService) {}

  /** What each item cost, weighted across the receipts it actually arrived on. */
  @Get('cost-basis')
  costBasis(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryCostBasisQuery)) query: InventoryCostBasisQuery,
  ) {
    return this.costing.costBasis(access, query);
  }

  /** What a plate costs, what it sells for, and what its components took out of stock. */
  @Get('plates')
  plates(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryPlateQuery)) query: InventoryPlateQuery,
  ) {
    return this.costing.plates(access, query);
  }

  /** Revenue, cost of goods and margin, per trading day. */
  @Get('days')
  days(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryCostingDayQuery)) query: InventoryCostingDayQuery,
  ) {
    return this.costing.days(access, query);
  }

  /** The 28-day rate, the days of cover, and what is already below its threshold. */
  @Get('low-stock')
  lowStock(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(LowStockForecastQuery)) query: LowStockForecastQuery,
  ) {
    return this.costing.lowStock(access, query);
  }

  /**
   * What the kitchen used against what the sales say it should have used, decomposed
   * by the named reason each quantity left the available pool (plan D7).
   */
  @Get('usage-variance')
  usageVariance(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryUsageVarianceQuery))
    query: InventoryUsageVarianceQuery,
  ) {
    return this.costing.usageVariance(access, query);
  }

  /**
   * Why a plate's cost moved: every version in the window with the cost it computed
   * when it was written (plan D3).
   */
  @Get('recipe-costs')
  recipeCosts(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(InventoryRecipeCostQuery)) query: InventoryRecipeCostQuery,
  ) {
    return this.costing.recipeCostHistory(access, query);
  }

  /** Margin against popularity: the stars, plow horses, puzzles and dogs (plan D16). */
  @Get('menu-engineering')
  menuEngineering(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(MenuEngineeringQuery)) query: MenuEngineeringQuery,
  ) {
    return this.costing.menuEngineering(access, query);
  }
}
