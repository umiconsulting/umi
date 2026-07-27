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
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffService } from './staff.service';
import {
  CreateStaffRequest,
  UpdateStaffRequest,
  type CreateStaffRequest as CreateStaffInput,
  type UpdateStaffRequest as UpdateStaffInput,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';

/**
 * Staff CRUD over `tenant.staff`. Slug-routed; TenantAccessGuard resolves
 * the slug → tenant and verifies membership (no membership check existed in
 * server.js — hardened here). No product entitlement gate, matching server.js.
 */
@UseGuards(AuthGuard, TenantAccessGuard, RolesGuard)
@Controller('api/:slug/admin/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('staff.read')
  async list(@Tenant() tenant: TenantAccess) {
    return { staff: await this.staff.list(tenant.tenantId) };
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('staff.manage')
  async create(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStaffRequest)) dto: CreateStaffInput,
    @Query('locationId') locationId?: string,
  ) {
    return {
      staff: await this.staff.create(
        tenant.tenantId,
        locationId ?? null,
        dto,
        user.id,
        user.sessionId,
      ),
    };
  }

  @Patch(':staffId')
  @RequirePermission('staff.manage')
  async update(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('staffId') staffId: string,
    @Body(new ZodValidationPipe(UpdateStaffRequest)) dto: UpdateStaffInput,
  ) {
    return {
      staff: await this.staff.update(tenant.tenantId, staffId, dto, user.id, user.sessionId),
    };
  }

  @Delete(':staffId')
  @RequirePermission('staff.manage')
  async remove(
    @Tenant() tenant: TenantAccess,
    @CurrentUser() user: AuthUser,
    @Param('staffId') staffId: string,
  ) {
    await this.staff.remove(tenant.tenantId, staffId, user.id, user.sessionId);
    return { ok: true };
  }
}
