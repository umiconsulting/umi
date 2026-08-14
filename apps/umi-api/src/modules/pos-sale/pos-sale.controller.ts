import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AttachSaleCustomerRequest,
  CancelSaleRequest,
  PosCustomerSearchQuery,
  RenameSuspendedSaleRequest,
  ResumeSaleRequest,
  SaleContextRequest,
  SaleHistoryQuery,
  SaleMutationRequest,
  SuspendSaleRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosSaleService } from './pos-sale.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/sales')
export class PosSaleController {
  constructor(private readonly sales: PosSaleService) {}

  @Post()
  start(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(SaleContextRequest)) dto: SaleContextRequest,
  ) {
    return this.sales.start(user, merchantId, dto);
  }

  @Get('current')
  current(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(SaleHistoryQuery)) query: SaleHistoryQuery,
  ) {
    return this.sales.current(user, merchantId, query);
  }

  @Get('customers')
  customers(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosCustomerSearchQuery)) query: PosCustomerSearchQuery,
  ) {
    return this.sales.customers(user, merchantId, query);
  }

  @Get()
  history(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(SaleHistoryQuery)) query: SaleHistoryQuery,
  ) {
    return this.sales.history(user, merchantId, query);
  }

  @Post(':saleId/suspend')
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(SuspendSaleRequest)) dto: SuspendSaleRequest,
  ) {
    return this.sales.suspend(user, merchantId, saleId, dto);
  }

  @Post(':saleId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(ResumeSaleRequest)) dto: ResumeSaleRequest,
  ) {
    return this.sales.resume(user, merchantId, saleId, dto);
  }

  @Post(':saleId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(CancelSaleRequest)) dto: CancelSaleRequest,
  ) {
    return this.sales.cancel(user, merchantId, saleId, dto);
  }

  @Post(':saleId/rename')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(RenameSuspendedSaleRequest))
    dto: RenameSuspendedSaleRequest,
  ) {
    return this.sales.rename(user, merchantId, saleId, dto);
  }

  @Post(':saleId/customer')
  attachCustomer(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(AttachSaleCustomerRequest))
    dto: AttachSaleCustomerRequest,
  ) {
    return this.sales.attachCustomer(user, merchantId, saleId, dto);
  }

  @Delete(':saleId/customer')
  detachCustomer(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(SaleMutationRequest)) dto: SaleMutationRequest,
  ) {
    return this.sales.detachCustomer(user, merchantId, saleId, dto);
  }

  @Get(':saleId/receipt')
  receipt(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Query(new ZodValidationPipe(SaleHistoryQuery)) query: SaleHistoryQuery,
  ) {
    return this.sales.receipt(user, merchantId, saleId, query);
  }
}
