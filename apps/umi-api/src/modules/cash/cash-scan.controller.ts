import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { CashScanService } from './cash-scan.service';
import { ScanDto, ScanPreviewDto } from './dto/scan.dto';

const STAFF_ROLES = ['super_admin', 'owner', 'admin', 'staff'];

/**
 * Loyalty scan (staff operation). Same guard chain as the cash money writes:
 * session + merchant membership + `cash` product + a staff-capable role.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@Roles(...STAFF_ROLES)
@Controller('api/:merchantRef/admin/scan')
export class CashScanController {
  constructor(private readonly scan: CashScanService) {}

  @Post()
  run(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.scan.scan(t.merchantId, user.id, dto);
  }

  /**
   * Read the card before committing. Same guard chain as the write: preview
   * exposes a customer's name, balance and reward state, so it is staff-only for
   * the same reason the scan is.
   */
  @Post('preview')
  @HttpCode(200)
  preview(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: ScanPreviewDto,
  ) {
    return this.scan.preview(t.merchantId, user.id, dto);
  }
}
