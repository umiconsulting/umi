import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AvailabilityQuery,
  CreateInventoryCountRequest,
  DamageRecord,
  InventoryAdjustment,
  InventoryQuery,
  InventoryReconciliation,
  InventoryRecoveryQuery,
  QuarantineRecord,
  RestockCommand,
  SubmitInventoryCountRequest,
  WasteRecord,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosInventoryService } from './pos-inventory.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/inventory')
export class PosInventoryController {
  constructor(private readonly inventory: PosInventoryService) {}

  @Get()
  overview(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(InventoryQuery)) query: InventoryQuery,
  ) {
    return this.inventory.overview(user, merchantId, query);
  }

  @Get('availability')
  availability(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(AvailabilityQuery)) query: AvailabilityQuery,
  ) {
    return this.inventory.availability(user, merchantId, query);
  }

  @Get('history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(InventoryQuery)) query: InventoryQuery,
  ) {
    return this.inventory.history(user, merchantId, query);
  }

  @Post('adjustments')
  adjustment(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(InventoryAdjustment)) dto: InventoryAdjustment,
  ) {
    return this.inventory.adjustment(user, merchantId, dto);
  }

  @Post('waste')
  waste(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(WasteRecord)) dto: WasteRecord,
  ) {
    return this.inventory.waste(user, merchantId, dto);
  }

  @Post('damage')
  damage(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(DamageRecord)) dto: DamageRecord,
  ) {
    return this.inventory.damage(user, merchantId, dto);
  }

  @Post('quarantine')
  quarantine(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(QuarantineRecord)) dto: QuarantineRecord,
  ) {
    return this.inventory.quarantine(user, merchantId, dto);
  }

  @Post('restock')
  restock(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(RestockCommand)) dto: RestockCommand,
  ) {
    return this.inventory.restock(user, merchantId, dto);
  }

  @Post('counts')
  createCount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CreateInventoryCountRequest)) dto: CreateInventoryCountRequest,
  ) {
    return this.inventory.createCount(user, merchantId, dto);
  }

  @Post('counts/:countId/submit')
  submitCount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('countId') countId: string,
    @Body(new ZodValidationPipe(SubmitInventoryCountRequest)) dto: SubmitInventoryCountRequest,
  ) {
    return this.inventory.submitCount(user, merchantId, countId, dto);
  }

  @Post('counts/:countId/reconcile')
  reconcileCount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('countId') countId: string,
    @Body(new ZodValidationPipe(InventoryReconciliation)) dto: InventoryReconciliation,
  ) {
    return this.inventory.reconcileCount(user, merchantId, countId, dto);
  }

  @Get('commands/:commandId')
  recovery(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(InventoryRecoveryQuery)) query: InventoryRecoveryQuery,
  ) {
    return this.inventory.recovery(user, merchantId, commandId, query);
  }
}
