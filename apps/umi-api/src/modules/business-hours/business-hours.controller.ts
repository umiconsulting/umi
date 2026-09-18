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
 * Business hours over `merchant.open_hours` (one row per day_of_week). Slug-routed
 * + membership-checked. Hours are stored per merchant/location; the effective
 * location is resolved from `?locationId` or the merchant default.
 *
 * `merchant.manage`, mirroring the Dashboard's `hours` module
 * (`module-registry.js` → `['merchant.manage']`). A cashier was refused here
 * before this guard existed, but only incidentally: her membership is
 * location-scoped and the location resolver throws `location_scope_required`
 * first. A cashier who is NOT location-scoped, or a request carrying a
 * `?locationId` she is scoped to, would have read and rewritten the café's
 * opening hours on a screen the client hides from her. The refusal must come
 * from the permission, not from where the resolution happens to stop.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, RolesGuard)
@Controller('api/:merchantRef/admin/hours')
export class BusinessHoursController {
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
