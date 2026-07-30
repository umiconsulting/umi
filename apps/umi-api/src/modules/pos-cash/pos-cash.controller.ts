import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CashCenterQuery,
  CashCommandRecoveryQuery,
  CashMovementRequest,
  OpenCashShiftRequest,
  ReconcileCashShiftRequest,
  RecountRequest,
  NoSaleDrawerRequest,
  ResolveCashVarianceRequest,
  ShiftCloseRequest,
  ShiftHandoffRequest,
  ShiftTransitionRequest,
  SubmitBlindCountRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { PosCashService } from './pos-cash.service';

@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/pos/tenants/:tenantId/cash')
export class PosCashController {
  constructor(private readonly cash: PosCashService) {}

  @Get()
  center(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(CashCenterQuery)) query: CashCenterQuery,
  ) {
    return this.cash.center(user, tenantId, query.branchId, query.operatorSessionId);
  }

  @Get('commands/:commandId')
  commandRecovery(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(CashCommandRecoveryQuery)) query: CashCommandRecoveryQuery,
  ) {
    return this.cash.commandRecovery(user, tenantId, commandId, query);
  }

  @Post('shifts')
  open(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(OpenCashShiftRequest)) dto: OpenCashShiftRequest,
  ) {
    return this.cash.open(user, tenantId, dto);
  }

  @Post('shifts/:shiftId/movements')
  movement(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(CashMovementRequest)) dto: CashMovementRequest,
  ) {
    return this.cash.movement(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/counts')
  count(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(SubmitBlindCountRequest)) dto: SubmitBlindCountRequest,
  ) {
    return this.cash.count(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/counts/recount')
  recount(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(RecountRequest)) dto: RecountRequest,
  ) {
    return this.cash.recount(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/variance')
  variance(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ResolveCashVarianceRequest)) dto: ResolveCashVarianceRequest,
  ) {
    return this.cash.resolve(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/reconcile')
  reconcile(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ReconcileCashShiftRequest)) dto: ReconcileCashShiftRequest,
  ) {
    return this.cash.reconcile(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ShiftCloseRequest)) dto: ShiftCloseRequest,
  ) {
    return this.cash.close(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/suspend')
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ShiftTransitionRequest)) dto: ShiftTransitionRequest,
  ) {
    return this.cash.transition(user, tenantId, shiftId, dto, 'suspended');
  }

  @Post('shifts/:shiftId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ShiftTransitionRequest)) dto: ShiftTransitionRequest,
  ) {
    return this.cash.transition(user, tenantId, shiftId, dto, 'open');
  }

  @Post('shifts/:shiftId/handoff')
  handoff(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(ShiftHandoffRequest)) dto: ShiftHandoffRequest,
  ) {
    return this.cash.handoff(user, tenantId, shiftId, dto);
  }

  @Post('shifts/:shiftId/no-sale')
  noSale(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('shiftId') shiftId: string,
    @Body(new ZodValidationPipe(NoSaleDrawerRequest)) dto: NoSaleDrawerRequest,
  ) {
    return this.cash.noSale(user, tenantId, shiftId, dto);
  }
}
