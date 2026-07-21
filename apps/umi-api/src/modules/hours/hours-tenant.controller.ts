import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { TenantsRepository } from '../tenants/tenants.repository';
import { HoursService } from './hours.service';
import { UpdateHoursDto } from './dto/update-hours.dto';

/**
 * Tenant-routed hours façade the dashboard SPA calls
 * (`/api/tenants/:tenantId/conversaflow/hours`). Dispatches directly to the same
 * HoursService as the slug route, mirroring CashTenantController. Without it the
 * SPA's tenant-routed hours calls 404 against umi-api in cookie mode. The
 * `:tenantId` is resolved + membership-checked by the same guard stack.
 */
@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/tenants/:tenantId/conversaflow/hours')
export class HoursTenantController {
  constructor(
    private readonly hours: HoursService,
    private readonly tenants: TenantsRepository,
  ) {}

  @Get()
  async get(@Tenant() tenant: TenantAccess, @Query('locationId') locationId?: string) {
    const resolved = await this.tenants.resolveLocationId(tenant.tenantId, locationId ?? null);
    return this.hours.getHours(tenant.tenantId, resolved, tenant.timezone);
  }

  @Patch()
  async update(
    @Tenant() tenant: TenantAccess,
    @Body() dto: UpdateHoursDto,
    @Query('locationId') locationId?: string,
  ) {
    const resolved = await this.tenants.resolveLocationId(tenant.tenantId, locationId ?? null);
    await this.hours.updateAll(tenant.tenantId, resolved, {
      hours: dto.hours,
      timezone: dto.timezone,
      ordering: dto.ordering,
    });
    return { ok: true };
  }
}
