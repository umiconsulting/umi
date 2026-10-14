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
  BindCartOriginRequest,
  SetCartAccountDetailsRequest,
  AssignCartTableRequest,
  OpenTableAccountRequest,
  ResumeCartAccountRequest,
  SuspendCartRequest,
  RemoveSentCartLineRequest,
  CartLineInput,
  CartQuery,
  ClearCartRequest,
  CreateCartRequest,
  PrepareSaleRequest,
  RemoveCartLineRequest,
  SetCartFulfillmentRequest,
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

  @Get('open-accounts')
  listAccounts(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(CartQuery)) query: CartQuery,
  ) {
    return this.cart.listAccounts(user, merchantId, query.locationId, query.operatorSessionId);
  }

  @Get('accounts/:cartId')
  readAccount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Query(new ZodValidationPipe(CartQuery)) query: CartQuery,
  ) {
    return this.cart.readAccount(
      user,
      merchantId,
      cartId,
      query.locationId,
      query.operatorSessionId,
    );
  }

  @Post('table')
  openTable(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(OpenTableAccountRequest)) dto: OpenTableAccountRequest,
  ) {
    return this.cart.openTable(user, merchantId, dto);
  }

  @Post('accounts/:cartId/resume')
  resumeAccount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Body(new ZodValidationPipe(ResumeCartAccountRequest)) dto: ResumeCartAccountRequest,
  ) {
    return this.cart.resumeAccount(user, merchantId, cartId, dto);
  }

  @Post('accounts/:cartId/details')
  setAccountDetails(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Body(new ZodValidationPipe(SetCartAccountDetailsRequest)) dto: SetCartAccountDetailsRequest,
  ) {
    return this.cart.setAccountDetails(user, merchantId, cartId, dto);
  }
  @Post('accounts/:cartId/table')
  assignAccountTable(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('cartId') cartId: string,
    @Body(new ZodValidationPipe(AssignCartTableRequest)) dto: AssignCartTableRequest,
  ) {
    return this.cart.assignAccountTable(user, merchantId, cartId, dto);
  }

  @Post('suspend')
  suspendAccount(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(SuspendCartRequest)) dto: SuspendCartRequest,
  ) {
    return this.cart.suspendAccount(user, merchantId, dto);
  }

  @Post('lines/:lineId/cancel-sent')
  removeSent(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(RemoveSentCartLineRequest)) dto: RemoveSentCartLineRequest,
  ) {
    return this.cart.removeSent(user, merchantId, lineId, dto);
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

  @Get('incoming-orders')
  incomingOrders(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(CartQuery)) query: CartQuery,
  ) {
    return this.cart.incomingOrders(user, merchantId, query.locationId, query.operatorSessionId);
  }

  @Post('origin')
  bindOrigin(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(BindCartOriginRequest)) dto: BindCartOriginRequest,
  ) {
    return this.cart.bindOrigin(user, merchantId, dto);
  }

  @Post('fulfillment')
  setFulfillment(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(SetCartFulfillmentRequest)) dto: SetCartFulfillmentRequest,
  ) {
    return this.cart.setFulfillment(user, merchantId, dto);
  }
}
