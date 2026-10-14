import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { FireOrderRequest } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosCartService } from './pos-cart.service';

/**
 * The fired order — `POST …/orders/fire`.
 *
 * A controller of its own rather than a route on the cart's, because the path differs: the
 * cart is what is fired, but the ORDER is what comes out, and the order-level actions that
 * follow (a second round, a split) belong under `/orders` too.
 *
 * `order.fire` is enforced in the service against the OPERATOR SESSION's permission list,
 * which is where every other POS action is authorized — a POS request is authorized by the
 * session running on the device, not by the dashboard membership a server-side guard would
 * read. Declaring it here as well would check a different list and pass a different caller.
 */
@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/orders')
export class PosOrderController {
  constructor(private readonly cart: PosCartService) {}

  @Post('fire')
  fire(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(FireOrderRequest)) dto: FireOrderRequest,
  ) {
    return this.cart.fire(user, merchantId, dto);
  }
}
