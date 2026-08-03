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
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosCheckoutService } from './pos-checkout.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/checkout')
export class PosCheckoutController {
  constructor(private readonly checkoutService: PosCheckoutService) {}

  @Post()
  checkout(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CheckoutCommand)) dto: CheckoutCommand,
  ) {
    return this.checkoutService.checkout(user, merchantId, dto);
  }

  @Get('payments/:paymentId')
  paymentStatus(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('paymentId') paymentId: string,
    @Query(new ZodValidationPipe(PaymentStatusQuery)) query: PaymentStatusQuery,
  ) {
    return this.checkoutService.paymentStatus(user, merchantId, paymentId, query);
  }

  @Get('carts/:cartId')
  recovery(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Query(new ZodValidationPipe(CheckoutRecoveryQuery)) query: CheckoutRecoveryQuery,
  ) {
    return this.checkoutService.recovery(user, merchantId, cartId, query);
  }

  @Post('carts/:cartId/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Body(new ZodValidationPipe(CheckoutCancellationRequest)) dto: CheckoutCancellationRequest,
  ) {
    return this.checkoutService.cancel(user, merchantId, cartId, dto);
  }
}
