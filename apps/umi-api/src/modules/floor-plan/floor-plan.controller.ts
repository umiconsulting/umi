import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import {
  FloorPlanQuery,
  PosFloorPlanQuery,
  PublishFloorPlanRequest,
  SaveFloorPlanRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { FloorPlanService } from './floor-plan.service';

@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/floor-plan')
export class FloorPlanController {
  constructor(private readonly plans: FloorPlanService) {}
  @Get()
  read(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(FloorPlanQuery)) query: { locationId: string },
  ) {
    return this.plans.read(access, query.locationId);
  }
  @Put()
  save(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(SaveFloorPlanRequest)) dto: SaveFloorPlanRequest,
  ) {
    return this.plans.change(access, dto);
  }
  @Post('publish')
  publish(
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(PublishFloorPlanRequest)) dto: PublishFloorPlanRequest,
  ) {
    return this.plans.change(access, dto);
  }
}

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/floor-plan')
export class PosFloorPlanController {
  constructor(private readonly plans: FloorPlanService) {}
  @Get()
  read(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosFloorPlanQuery)) query: PosFloorPlanQuery,
  ) {
    return this.plans.readForPos(user, merchantId, query);
  }
}
