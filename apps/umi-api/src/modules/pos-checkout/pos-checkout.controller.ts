import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CheckoutCancellationRequest,
  CheckoutCommand,
  CheckoutRecoveryQuery,
  PaymentStatusQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { PosCheckoutService } from './pos-checkout.service';

@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/pos/tenants/:tenantId/checkout')
export class PosCheckoutController {
  constructor(private readonly checkoutService: PosCheckoutService) {}

  @Post()
  checkout(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(CheckoutCommand)) dto: CheckoutCommand,
  ) {
    return this.checkoutService.checkout(user, tenantId, dto);
  }

  @Get('payments/:paymentId')
  paymentStatus(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('paymentId') paymentId: string,
    @Query(new ZodValidationPipe(PaymentStatusQuery)) query: PaymentStatusQuery,
  ) {
    return this.checkoutService.paymentStatus(user, tenantId, paymentId, query);
  }

  @Get('carts/:cartId')
  recovery(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('cartId') cartId: string,
    @Query(new ZodValidationPipe(CheckoutRecoveryQuery)) query: CheckoutRecoveryQuery,
  ) {
    return this.checkoutService.recovery(user, tenantId, cartId, query);
  }

  @Post('carts/:cartId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('cartId') cartId: string,
    @Body(new ZodValidationPipe(CheckoutCancellationRequest)) dto: CheckoutCancellationRequest,
  ) {
    return this.checkoutService.cancel(user, tenantId, cartId, dto);
  }
}
