import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { BusinessHoursService } from './business-hours.service';
import { UpdateHoursDto } from './dto/update-hours.dto';

/**
 * Merchant-routed hours façade the dashboard SPA calls
 * (`/api/merchants/:merchantId/conversaflow/hours`). Dispatches directly to the same
 * BusinessHoursService as the reference-addressed route, mirroring CashMerchantController. Without it the
 * SPA's merchant-routed hours calls 404 against umi-api in cookie mode. The
 * `:merchantId` is resolved + membership-checked by the same guard stack.
 *
 * `merchant.manage` on both verbs, mirroring the Dashboard's `hours` module
 * (`module-registry.js` → `['merchant.manage']`). This is the route the Hours
 * screen actually calls (`data.jsx`, `_loadBusinessHours` / `saveBusinessHours`),
 * and it carried no permission at all: the cashier's refusal came from the
 * location resolver, not from the gate. See the twin comment in
 * business-hours.controller.ts.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, RolesGuard)
@Controller('api/merchants/:merchantId/conversaflow/hours')
export class BusinessHoursMerchantController {
  constructor(
    private readonly hours: BusinessHoursService,
    private readonly merchants: MerchantsRepository,
  ) {}

  @Get()
  @RequirePermission('merchant.manage')
  async get(@Merchant() merchant: MerchantAccess, @Query('locationId') locationId?: string) {
    const resolved = await this.merchants.resolveLocationId(
      merchant.merchantId,
      resolveLocationAuthority(merchant, locationId),
    );
    return this.hours.getHours(merchant.merchantId, resolved, merchant.timezone);
  }

  @Patch()
  @RequirePermission('merchant.manage')
  async update(
    @Merchant() merchant: MerchantAccess,
    @Body() dto: UpdateHoursDto,
    @Query('locationId') locationId?: string,
  ) {
    const resolved = await this.merchants.resolveLocationId(
      merchant.merchantId,
      resolveLocationAuthority(merchant, locationId),
    );
    await this.hours.updateAll(merchant.merchantId, resolved, {
      hours: dto.hours,
      timezone: dto.timezone,
      ordering: dto.ordering,
    });
    return { ok: true };
  }
}
