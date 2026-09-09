import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { DashboardOperationsQuery, ReportsSalesQuery } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { DashboardOperationsService } from './dashboard-operations.service';

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/operations')
export class DashboardOperationsController {
  constructor(private readonly operations: DashboardOperationsService) {}

  @Get()
  snapshot(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Query(new ZodValidationPipe(DashboardOperationsQuery)) query: DashboardOperationsQuery,
  ) {
    return this.operations.snapshot(user, merchant, query);
  }

  @Get('sales/:saleId/receipt')
  saleReceipt(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Param('saleId') saleId: string,
  ) {
    return this.operations.saleReceipt(user, merchant, saleId);
  }

  @Get('reports/sales')
  salesSummary(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Query(new ZodValidationPipe(ReportsSalesQuery)) query: ReportsSalesQuery,
  ) {
    return this.operations.salesSummary(user, merchant, query);
  }

  @Get('cash-shifts/:shiftId')
  cashShiftDetail(
    @CurrentUser() user: AuthUser,
    @Merchant() merchant: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Param('shiftId') shiftId: string,
  ) {
    return this.operations.cashShiftDetail(user, merchant, shiftId);
  }
}
