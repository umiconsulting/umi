import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';

/**
 * Merchant-scoped cash façade the dashboard SPA calls (`/api/merchants/:merchantId/cash/*`).
 * server.js exposes the same surface by 307-redirecting these to `/api/:merchantRef/admin/*`;
 * we dispatch directly to CashReadService instead (one round-trip, no redirect), which
 * keeps the dashboard's existing paths working unchanged against umi-api. The `:merchantId`
 * is resolved + membership-checked by the same guard stack as the reference-addressed routes.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@Controller('api/merchants/:merchantId/cash')
export class CashMerchantController {
  constructor(private readonly cash: CashReadService) {}

  @Get('stats')
  getStats(@Merchant() t: MerchantAccess) {
    return this.cash.getStats(t.merchantId);
  }

  @Get('analytics')
  getAnalytics(@Merchant() t: MerchantAccess) {
    return this.cash.getAnalytics(t.merchantId);
  }

  @Get('customers')
  getCustomers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query);
  }

  // server.js maps `members` -> `customers`.
  @Get('members')
  getMembers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query);
  }

  @Get('gift-cards')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }

  @Get('reward-config')
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  @Put('reward-config')
  putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }

  @Patch('reward-config')
  patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }
}
