import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ExceptionCommandRecoveryQuery,
  ManualTerminalRefundOutcomeRequest,
  RefundApprovalRequest,
  RefundPreviewRequest,
  SaleExceptionCommand,
  SaleExceptionEligibilityQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosExceptionService } from './pos-exception.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId')
export class PosExceptionController {
  constructor(private readonly exceptions: PosExceptionService) {}

  @Get('sales/:saleId/exceptions/eligibility')
  eligibility(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Query(new ZodValidationPipe(SaleExceptionEligibilityQuery))
    query: SaleExceptionEligibilityQuery,
  ) {
    return this.exceptions.eligibility(user, merchantId, saleId, query);
  }

  @Post('sales/:saleId/exceptions/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(RefundPreviewRequest)) dto: RefundPreviewRequest,
  ) {
    return this.exceptions.preview(user, merchantId, saleId, dto);
  }

  @Post('sales/:saleId/exceptions/approval')
  approval(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(RefundApprovalRequest)) dto: RefundApprovalRequest,
  ) {
    return this.exceptions.approval(user, merchantId, saleId, dto);
  }

  @Post('sales/:saleId/exceptions')
  commit(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Body(new ZodValidationPipe(SaleExceptionCommand)) dto: SaleExceptionCommand,
  ) {
    return this.exceptions.commit(user, merchantId, saleId, dto);
  }

  @Get('sales/:saleId/exceptions')
  history(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Query(new ZodValidationPipe(SaleExceptionEligibilityQuery))
    query: SaleExceptionEligibilityQuery,
  ) {
    return this.exceptions.history(user, merchantId, saleId, query);
  }

  @Get('sales/:saleId/exceptions/:exceptionId')
  result(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Param('exceptionId') exceptionId: string,
    @Query(new ZodValidationPipe(SaleExceptionEligibilityQuery))
    query: SaleExceptionEligibilityQuery,
  ) {
    return this.exceptions.result(user, merchantId, saleId, exceptionId, query);
  }

  @Post('sales/:saleId/exceptions/previews/:previewId/terminal-outcome')
  terminalOutcome(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('saleId') saleId: string,
    @Param('previewId') previewId: string,
    @Body(new ZodValidationPipe(ManualTerminalRefundOutcomeRequest))
    dto: ManualTerminalRefundOutcomeRequest,
  ) {
    return this.exceptions.terminalOutcome(user, merchantId, saleId, previewId, dto);
  }

  @Get('exceptions/commands/:commandId')
  command(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(ExceptionCommandRecoveryQuery))
    query: ExceptionCommandRecoveryQuery,
  ) {
    return this.exceptions.command(user, merchantId, commandId, query);
  }
}
