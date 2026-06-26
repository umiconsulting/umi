import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { Tenant } from '../auth/current-user.decorator';
import type { TenantAccess } from '../auth/auth.types';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

/**
 * Staff CRUD over `core.staff_members`. Slug-routed; TenantAccessGuard resolves
 * the slug → tenant and verifies membership (no membership check existed in
 * server.js — hardened here). No product entitlement gate, matching server.js.
 */
@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/:slug/admin/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  async list(@Tenant() tenant: TenantAccess) {
    return { staff: await this.staff.list(tenant.tenantId) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Tenant() tenant: TenantAccess,
    @Body() dto: CreateStaffDto,
    @Query('locationId') locationId?: string,
  ) {
    return {
      staff: await this.staff.create(tenant.tenantId, locationId ?? null, dto),
    };
  }

  @Patch(':staffId')
  async update(
    @Tenant() tenant: TenantAccess,
    @Param('staffId') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return { staff: await this.staff.update(tenant.tenantId, staffId, dto) };
  }

  @Delete(':staffId')
  async remove(
    @Tenant() tenant: TenantAccess,
    @Param('staffId') staffId: string,
  ) {
    await this.staff.remove(tenant.tenantId, staffId);
    return { ok: true };
  }
}
