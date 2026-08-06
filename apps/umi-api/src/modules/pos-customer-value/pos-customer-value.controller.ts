import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  CreateCustomerRequest,
  CustomerMergeRequest,
  CustomerSearchRequest,
  CustomerValuePreviewRequest,
  CustomerValueRecoveryQuery,
  GiftCardActivation,
  GiftCardLookupRequest,
  RewardAuthorizationRequest,
  StoredValueAuthorizationRequest,
  ValueReleaseRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosCustomerValueService } from './pos-customer-value.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId')
export class PosCustomerValueController {
  constructor(private readonly service: PosCustomerValueService) {}

  @Get('customers')
  search(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(CustomerSearchRequest)) query: CustomerSearchRequest,
  ) {
    return this.service.search(user, merchantId, query);
  }

  @Post('customers')
  create(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CreateCustomerRequest)) dto: CreateCustomerRequest,
  ) {
    return this.service.create(user, merchantId, dto);
  }

  @Get('customers/:customerId/history')
  history(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(CustomerSearchRequest)) query: CustomerSearchRequest,
  ) {
    return this.service.history(user, merchantId, customerId, query);
  }

  @Post('customers/merge')
  merge(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CustomerMergeRequest)) dto: CustomerMergeRequest,
  ) {
    return this.service.merge(user, merchantId, dto);
  }

  @Post('customer-value/preview')
  preview(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(CustomerValuePreviewRequest)) dto: CustomerValuePreviewRequest,
  ) {
    return this.service.preview(user, merchantId, dto);
  }

  @Post('customer-value/rewards/authorize')
  authorizeReward(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(RewardAuthorizationRequest)) dto: RewardAuthorizationRequest,
  ) {
    return this.service.authorizeReward(user, merchantId, dto);
  }

  @Post('customer-value/rewards/release')
  releaseReward(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(ValueReleaseRequest)) dto: ValueReleaseRequest,
  ) {
    return this.service.releaseReward(user, merchantId, dto);
  }

  @Post('customer-value/stored-value/authorize')
  authorizeStoredValue(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(StoredValueAuthorizationRequest))
    dto: StoredValueAuthorizationRequest,
  ) {
    return this.service.authorizeStoredValue(user, merchantId, dto);
  }

  @Post('customer-value/stored-value/release')
  releaseStoredValue(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(ValueReleaseRequest)) dto: ValueReleaseRequest,
  ) {
    return this.service.releaseStoredValue(user, merchantId, dto);
  }

  @Post('customer-value/gift-cards/lookup')
  giftCardLookup(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(GiftCardLookupRequest)) dto: GiftCardLookupRequest,
  ) {
    return this.service.giftCardLookup(user, merchantId, dto);
  }

  @Post('customer-value/gift-cards/activate')
  giftCardActivate(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(GiftCardActivation)) dto: GiftCardActivation,
  ) {
    return this.service.activateGiftCard(user, merchantId, dto);
  }

  @Get('customer-value/commands/:commandId')
  command(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(CustomerValueRecoveryQuery)) query: CustomerValueRecoveryQuery,
  ) {
    return this.service.command(user, merchantId, commandId, query);
  }
}
