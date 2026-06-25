import {
  Body,
  Controller,
  Get,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { TenantsRepository } from '../tenants/tenants.repository';
import { HoursService } from './hours.service';
import { UpdateHoursDto } from './dto/update-hours.dto';

/**
 * Business hours over `ops.business_hours` (one row per day_of_week). Slug-routed
 * + membership-checked. Hours are stored per tenant/location; the effective
 * location is resolved from `?locationId` or the tenant default.
 */
@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/:slug/admin/hours')
export class HoursController {
  constructor(
    private readonly hours: HoursService,
    private readonly tenants: TenantsRepository,
  ) {}

  @Get()
  async get(
    @Tenant() tenant: TenantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const resolved = await this.tenants.resolveLocationId(
      tenant.tenantId,
      locationId ?? null,
    );
    return this.hours.getHours(tenant.tenantId, resolved, tenant.timezone);
  }

  @Patch()
  async update(
    @Tenant() tenant: TenantAccess,
    @Body() dto: UpdateHoursDto,
    @Query('locationId') locationId?: string,
  ) {
    const resolved = await this.tenants.resolveLocationId(
      tenant.tenantId,
      locationId ?? null,
    );
    await this.hours.updateHours(tenant.tenantId, resolved, dto.hours);
    return { ok: true };
  }
}
