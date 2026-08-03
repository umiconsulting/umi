import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { BusinessHoursService } from './business-hours.service';
import { UpdateHoursDto } from './dto/update-hours.dto';

/**
 * Business hours over `merchant.open_hours` (one row per day_of_week). Slug-routed
 * + membership-checked. Hours are stored per merchant/location; the effective
 * location is resolved from `?locationId` or the merchant default.
 */
@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/:slug/admin/hours')
export class BusinessHoursController {
  constructor(
    private readonly hours: BusinessHoursService,
    private readonly merchants: MerchantsRepository,
  ) {}

  @Get()
  async get(@Merchant() merchant: MerchantAccess, @Query('locationId') locationId?: string) {
    const resolved = await this.merchants.resolveLocationId(
      merchant.merchantId,
      locationId ?? null,
    );
    return this.hours.getHours(merchant.merchantId, resolved, merchant.timezone);
  }

  @Patch()
  async update(
    @Merchant() merchant: MerchantAccess,
    @Body() dto: UpdateHoursDto,
    @Query('locationId') locationId?: string,
  ) {
    const resolved = await this.merchants.resolveLocationId(
      merchant.merchantId,
      locationId ?? null,
    );
    await this.hours.updateAll(merchant.merchantId, resolved, {
      hours: dto.hours,
      timezone: dto.timezone,
      ordering: dto.ordering,
    });
    return { ok: true };
  }
}
