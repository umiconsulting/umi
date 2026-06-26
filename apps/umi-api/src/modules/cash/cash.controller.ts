import {
  Body,
  Controller,
  Get,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { CashReadService } from './cash-read.service';

/**
 * Cash READ side (D11 — always live) + admin-config writes (settings branding,
 * reward-config) which are dashboard-owned and non-conflicting with umi-cash.
 * Gated on the `cash` product. Customer-facing wallet/ledger writes are NOT here
 * — see cash-write.controller (inert, unmounted unless CASH_WRITE_ENABLED).
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@Controller('api/:slug/admin')
export class CashController {
  constructor(private readonly cash: CashReadService) {}

  @Get('settings')
  getSettings(@Tenant() t: TenantAccess) {
    return this.cash.getSettings(t.tenantId);
  }

  @Patch('settings')
  async updateSettings(@Tenant() t: TenantAccess, @Body() body: Record<string, unknown>) {
    await this.cash.updateSettings(t.tenantId, body);
    return { ok: true };
  }

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

  @Get('reward-config')
  getRewardConfig(@Tenant() t: TenantAccess) {
    return this.cash.getRewardConfig(t.tenantId);
  }

  // Admin-config write (not the inert customer-facing path — preflight §4).
  @Put('reward-config')
  putRewardConfig(@Tenant() t: TenantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.tenantId, body);
  }

  @Patch('reward-config')
  patchRewardConfig(@Tenant() t: TenantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.tenantId, body);
  }

  @Get('gift-cards')
  getGiftCards(@Tenant() t: TenantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.tenantId, query);
  }
}
