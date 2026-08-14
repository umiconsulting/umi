import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PosKitchenOrderQuery } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { KdsService } from './kds.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/kitchen')
export class KdsPosController {
  constructor(private readonly kds: KdsService) {}

  @Get('orders/:sourceOrderId')
  order(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('sourceOrderId') sourceOrderId: string,
    @Query(new ZodValidationPipe(PosKitchenOrderQuery)) query: PosKitchenOrderQuery,
  ) {
    return this.kds.statusForPos(user, merchantId, sourceOrderId, query);
  }
}
