import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';

/**
 * Tenant-scoped cash façade the dashboard SPA calls (`/api/tenants/:tenantId/cash/*`).
 * server.js exposes the same surface by 307-redirecting these to `/api/:slug/admin/*`;
 * we dispatch directly to CashReadService instead (one round-trip, no redirect), which
 * keeps the dashboard's existing paths working unchanged against umi-api. The `:tenantId`
 * is resolved + membership-checked by the same guard stack as the slug routes.
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@Controller('api/tenants/:tenantId/cash')
export class CashTenantController {
  constructor(private readonly cash: CashReadService) {}

  @Get('stats')
  getStats(@Tenant() t: TenantAccess) {
    return this.cash.getStats(t.tenantId);
  }

  @Get('analytics')
  getAnalytics(@Tenant() t: TenantAccess) {
    return this.cash.getAnalytics(t.tenantId);
  }

  @Get('customers')
  getCustomers(@Tenant() t: TenantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.tenantId, query);
  }

  // server.js maps `members` -> `customers`.
  @Get('members')
  getMembers(@Tenant() t: TenantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.tenantId, query);
  }

  @Get('gift-cards')
  getGiftCards(@Tenant() t: TenantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.tenantId, query);
  }

  @Get('reward-config')
  getRewardConfig(@Tenant() t: TenantAccess) {
    return this.cash.getRewardConfig(t.tenantId);
  }

  @Put('reward-config')
  putRewardConfig(@Tenant() t: TenantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.tenantId, body);
  }

  @Patch('reward-config')
  patchRewardConfig(@Tenant() t: TenantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.tenantId, body);
  }
}
