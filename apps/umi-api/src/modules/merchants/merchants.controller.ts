import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { MeMerchantsResponse } from '@umi/contract';
import { MerchantsService } from './merchants.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

/**
 * Merchant shell routes. All require a valid session (AuthGuard); the
 * `/merchants/:merchantId/*` routes additionally resolve + authorize membership
 * (MerchantAccessGuard) and gate on the `dashboard` entitlement.
 */
@UseGuards(AuthGuard)
@Controller('api')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get('me/merchants')
  async myMerchants(@CurrentUser() user: AuthUser): Promise<MeMerchantsResponse> {
    return { merchants: await this.merchants.listUserMerchants(user.id) };
  }

  @Get('merchants/:merchantId/capabilities')
  @UseGuards(MerchantAccessGuard)
  async capabilities(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    return this.merchants.buildCapabilities(merchant, locationId ?? null);
  }

  @Get('merchants/:merchantId/settings')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getSettings(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.merchants.buildCapabilities(merchant, locationId ?? null);
    return this.merchants.buildSettings(caps);
  }

  @Patch('merchants/:merchantId/settings')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateSettings(@Merchant() merchant: MerchantAccess, @Body() dto: UpdateSettingsDto) {
    await this.merchants.updateSettings(merchant.merchantId, dto);
    return { ok: true };
  }

  @Get('merchants/:merchantId/locations')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocations(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.merchants.buildCapabilities(merchant, locationId ?? null);
    return { locations: caps.locations };
  }

  @Get('merchants/:merchantId/locations/profiles')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocationProfiles(@Merchant() merchant: MerchantAccess) {
    return { locations: await this.merchants.listLocationProfiles(merchant.merchantId) };
  }

  @Patch('merchants/:merchantId/locations/:locationId')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateLocation(
    @Merchant() merchant: MerchantAccess,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    const location = await this.merchants.updateLocation(merchant.merchantId, locationId, dto);
    return { location };
  }
}
