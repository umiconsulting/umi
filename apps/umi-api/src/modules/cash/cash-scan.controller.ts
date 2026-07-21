import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, Tenant } from '../auth/current-user.decorator';
import type { AuthUser, TenantAccess } from '../auth/auth.types';
import { CashScanService } from './cash-scan.service';
import { ScanDto } from './dto/scan.dto';

const STAFF_ROLES = ['super_admin', 'owner', 'admin', 'staff'];

/**
 * Loyalty scan (staff operation). Same guard chain as the cash money writes:
 * session + tenant membership + `cash` product + a staff-capable role.
 */
@UseGuards(AuthGuard, TenantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@Roles(...STAFF_ROLES)
@Controller('api/:slug/admin/scan')
export class CashScanController {
  constructor(private readonly scan: CashScanService) {}

  @Post()
  run(@Tenant() t: TenantAccess, @CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.scan.scan(t.tenantId, user.id, dto);
  }
}
