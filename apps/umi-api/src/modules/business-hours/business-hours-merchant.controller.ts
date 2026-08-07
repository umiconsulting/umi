import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { BusinessHoursService } from './business-hours.service';
import { UpdateHoursDto } from './dto/update-hours.dto';

/**
 * Merchant-routed hours façade the dashboard SPA calls
 * (`/api/merchants/:merchantId/conversaflow/hours`). Dispatches directly to the same
 * BusinessHoursService as the reference-addressed route, mirroring CashMerchantController. Without it the
 * SPA's merchant-routed hours calls 404 against umi-api in cookie mode. The
 * `:merchantId` is resolved + membership-checked by the same guard stack.
 */
@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/conversaflow/hours')
export class BusinessHoursMerchantController {
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
