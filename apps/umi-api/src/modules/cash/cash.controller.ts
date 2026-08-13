import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';

/**
 * Cash READ side (D11 — always live) + admin-config writes (settings branding,
 * reward-config) which are dashboard-owned and non-conflicting with umi-cash.
 * Gated on the `cash` product. Customer-facing wallet/ledger writes are NOT here
 * — see cash-write.controller (inert, unmounted unless CASH_WRITE_ENABLED).
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@Controller('api/:merchantRef/admin')
export class CashController {
  constructor(
    private readonly cash: CashReadService,
    private readonly walletPass: WalletPassAdapter,
  ) {}

  @Get('settings')
  getSettings(@Merchant() t: MerchantAccess) {
    return this.cash.getSettings(t.merchantId);
  }

  @Patch('settings')
  async updateSettings(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    await this.cash.updateSettings(t.merchantId, body);
    // Not awaited. A café-wide refresh reaches every issued pass, and the café
    // must not wait for Apple to save a setting. It never throws — see the
    // adapter — so nothing can escape into this response.
    void this.walletPass.refreshMerchant(t.merchantId);
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
  //
  // Both of these change what every pass at the café shows. The reward name and
  // the stamps threshold appear on the card face, so each issued pass needs a
  // refresh. umi-cash also pushed here, but it did not touch the card rows first,
  // so the push did nothing. See ApplePushService.pushMerchant.
  @Put('reward-config')
  async putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body);
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  @Patch('reward-config')
  async patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body);
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  @Get('gift-cards')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }
}
