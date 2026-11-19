import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';
import { registerRole } from './cash-roles';

/**
 * Merchant-scoped cash façade the dashboard SPA calls (`/api/merchants/:merchantId/cash/*`).
 * server.js exposes the same surface by 307-redirecting these to `/api/:merchantRef/admin/*`;
 * we dispatch directly to CashReadService instead (one round-trip, no redirect), which
 * keeps the dashboard's existing paths working unchanged against umi-api. The `:merchantId`
 * is resolved + membership-checked by the same guard stack as the reference-addressed routes.
 *
 * `reward-config` is SPLIT here exactly as in CashController, and for the same
 * reason: the READ is `loyalty.read`, only the WRITE is `merchant.manage`. The
 * Dashboard's `settings` module declares `merchant.manage` and hides the screen
 * from a cashier, but this route is not only the Settings screen's — the shared
 * merchant model (`data.jsx` `_loadMerchant`, mounted by `DashboardLayout` on
 * every screen) fetches it for the `loyalty-value` hub, and umi-cash's till home
 * (`apps/umi-cash/src/app/[slug]/(admin)/admin/page.tsx`, a `STAFF` page) draws
 * its "Recompensa activa" panel from the reference-addressed twin. Gating the
 * read on `merchant.manage` refused a cashier a value her own screens display, so
 * it is `loyalty.read`; the write keeps the manager gate because it changes what
 * every issued pass shows. Every read names the permission its caller already
 * holds: `stats`, `customers` and `members` use `loyalty.read`; `analytics` uses
 * `insights.read`; `gift-cards` uses `gift_card.read`. A cashier keeps the till
 * reads and is refused analytics, which is the policy for that action.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@Controller('api/merchants/:merchantId/cash')
export class CashMerchantController {
  constructor(private readonly cash: CashReadService) {}

  @Get('stats')
  @RequirePermission('loyalty.read')
  getStats(@Merchant() t: MerchantAccess) {
    return this.cash.getStats(t.merchantId, registerRole(t));
  }

  @Get('analytics')
  @RequirePermission('insights.read')
  getAnalytics(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getAnalytics(t.merchantId, query);
  }

  @Get('customers')
  @RequirePermission('loyalty.read')
  getCustomers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query);
  }

  // server.js maps `members` -> `customers`.
  @Get('members')
  @RequirePermission('loyalty.read')
  getMembers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query);
  }

  @Get('gift-cards')
  @RequirePermission('gift_card.read')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }

  @Get('reward-config')
  // `loyalty.read`, not `merchant.manage` — see the class comment. This read feeds
  // the Dashboard's `loyalty-value` hub and umi-cash's till home, both reachable by
  // a cashier; the write below is the manager-gated half.
  @RequirePermission('loyalty.read')
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  @Put('reward-config')
  @RequirePermission('merchant.manage')
  putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }

  @Patch('reward-config')
  @RequirePermission('merchant.manage')
  patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body);
  }
}
