import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CartLineInput,
  CartQuery,
  ClearCartRequest,
  CreateCartRequest,
  PrepareSaleRequest,
  RemoveCartLineRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosCartService } from './pos-cart.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/cart')
export class PosCartController {
  constructor(private readonly cart: PosCartService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CreateCartRequest)) dto: CreateCartRequest,
  ) {
    return this.cart.create(user, merchantId, dto);
  }

  @Get()
  read(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(CartQuery)) query: CartQuery,
  ) {
    return this.cart.read(user, merchantId, query.locationId, query.operatorSessionId);
  }

  @Post('lines')
  add(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CartLineInput)) dto: CartLineInput,
  ) {
    return this.cart.add(user, merchantId, dto);
  }

  @Patch('lines/:lineId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(CartLineInput)) dto: CartLineInput,
  ) {
    return this.cart.update(user, merchantId, lineId, dto);
  }

  @Delete('lines/:lineId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(RemoveCartLineRequest)) dto: RemoveCartLineRequest,
  ) {
    return this.cart.remove(user, merchantId, lineId, dto);
  }

  @Post('prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(PrepareSaleRequest)) dto: PrepareSaleRequest,
  ) {
    return this.cart.prepare(user, merchantId, dto);
  }

  @Post('clear')
  clear(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(ClearCartRequest)) dto: ClearCartRequest,
  ) {
    return this.cart.clear(user, merchantId, dto);
  }
}
