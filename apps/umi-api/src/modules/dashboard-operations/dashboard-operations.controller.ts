import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { DashboardOperationsQuery } from '@umi/contract';
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
}
