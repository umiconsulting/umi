import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { CurrentUser, Tenant } from '../auth/current-user.decorator';
import type { AuthUser, TenantAccess } from '../auth/auth.types';
import { TenantsService } from './tenants.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateLocationDto } from './dto/update-location.dto';

/**
 * Tenant shell routes. All require a valid session (AuthGuard); the
 * `/tenants/:tenantId/*` routes additionally resolve + authorize membership
 * (TenantAccessGuard) and gate on the `dashboard` entitlement.
 */
@UseGuards(AuthGuard)
@Controller('api')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('me/tenants')
  async myTenants(@CurrentUser() user: AuthUser) {
    return { tenants: await this.tenants.listUserTenants(user.id) };
  }

  @Get('tenants/:tenantId/capabilities')
  @UseGuards(TenantAccessGuard)
  async capabilities(
    @Tenant() tenant: TenantAccess,
    @Query('locationId') locationId?: string,
  ) {
    return this.tenants.buildCapabilities(tenant, locationId ?? null);
  }

  @Get('tenants/:tenantId/settings')
  @UseGuards(TenantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getSettings(
    @Tenant() tenant: TenantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.tenants.buildCapabilities(tenant, locationId ?? null);
    return this.tenants.buildSettings(caps);
  }

  @Patch('tenants/:tenantId/settings')
  @UseGuards(TenantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateSettings(
    @Tenant() tenant: TenantAccess,
    @Body() dto: UpdateSettingsDto,
  ) {
    await this.tenants.updateSettings(tenant.tenantId, dto);
    return { ok: true };
  }

  @Get('tenants/:tenantId/locations')
  @UseGuards(TenantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocations(
    @Tenant() tenant: TenantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.tenants.buildCapabilities(tenant, locationId ?? null);
    return { locations: caps.locations };
  }

  @Get('tenants/:tenantId/locations/profiles')
  @UseGuards(TenantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocationProfiles(@Tenant() tenant: TenantAccess) {
    return { locations: await this.tenants.listLocationProfiles(tenant.tenantId) };
  }

  @Patch('tenants/:tenantId/locations/:locationId')
  @UseGuards(TenantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateLocation(
    @Tenant() tenant: TenantAccess,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    const location = await this.tenants.updateLocation(
      tenant.tenantId,
      locationId,
      dto,
    );
    return { location };
  }
}
