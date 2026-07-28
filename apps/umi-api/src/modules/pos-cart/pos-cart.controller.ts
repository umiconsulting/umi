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
  CreateCartRequest,
  PrepareSaleRequest,
  RemoveCartLineRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { PosCartService } from './pos-cart.service';

@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/pos/tenants/:tenantId/cart')
export class PosCartController {
  constructor(private readonly cart: PosCartService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(CreateCartRequest)) dto: CreateCartRequest,
  ) {
    return this.cart.create(user, tenantId, dto);
  }

  @Get()
  read(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(CartQuery)) query: CartQuery,
  ) {
    return this.cart.read(user, tenantId, query.branchId, query.operatorSessionId);
  }

  @Post('lines')
  add(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(CartLineInput)) dto: CartLineInput,
  ) {
    return this.cart.add(user, tenantId, dto);
  }

  @Patch('lines/:lineId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(CartLineInput)) dto: CartLineInput,
  ) {
    return this.cart.update(user, tenantId, lineId, dto);
  }

  @Delete('lines/:lineId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('lineId') lineId: string,
    @Body(new ZodValidationPipe(RemoveCartLineRequest)) dto: RemoveCartLineRequest,
  ) {
    return this.cart.remove(user, tenantId, lineId, dto);
  }

  @Post('prepare')
  prepare(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(PrepareSaleRequest)) dto: PrepareSaleRequest,
  ) {
    return this.cart.prepare(user, tenantId, dto);
  }
}
