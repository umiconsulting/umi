import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';

/**
 * Cash READ side (D11 — always live) + admin-config writes (settings branding,
 * reward-config) which are dashboard-owned and non-conflicting with umi-cash.
 * Gated on the `cash` product. Customer-facing wallet/ledger writes are NOT here
 * — see cash-write.controller (inert, unmounted unless CASH_WRITE_ENABLED).
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@Controller('api/:slug/admin')
export class CashController {
  constructor(private readonly cash: CashReadService) {}

  @Get('settings')
  getSettings(@Merchant() t: MerchantAccess) {
    return this.cash.getSettings(t.merchantId);
  }

  @Patch('settings')
  async updateSettings(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    await this.cash.updateSettings(t.merchantId, body);
    return { ok: true };
  }

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

  @Get('reward-config')
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  // Admin-config write (not the inert customer-facing path — preflight §4).
  @Put('reward-config')
  putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }

  @Patch('reward-config')
  patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }

  @Get('gift-cards')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }
}
