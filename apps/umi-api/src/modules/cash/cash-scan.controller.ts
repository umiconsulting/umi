import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { AcceptRegisterToken } from '../auth/register-token.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { CashScanService } from './cash-scan.service';
import { ScanDto, ScanPreviewDto, ScanSealsDto } from './dto/scan.dto';

/**
 * Loyalty scan (staff operation). Same guard chain as the cash money writes:
 * session + merchant membership + `cash` product.
 *
 * Each action names its own permission. The old role list refused a cashier on
 * scan, preview and seals, even though a cashier is the operator who runs the
 * register. Scan and preview now use `loyalty.reward.redeem` (a cashier holds it);
 * bulk seals stay on `loyalty.adjust` (a cashier does not hold it). A role that may
 * scan therefore cannot bulk-credit by accident.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@AcceptRegisterToken()
@Controller('api/:merchantRef/admin/scan')
export class CashScanController {
  constructor(private readonly scan: CashScanService) {}

  @Post()
  @RequirePermission('loyalty.reward.redeem')
  run(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.scan.scan(t.merchantId, user.id, dto);
  }

  /**
   * Read the card before committing. Same permission as the scan: preview exposes a
   * customer's name, balance and reward state to the operator who is about to act.
   */
  @Post('preview')
  @HttpCode(200)
  @RequirePermission('loyalty.reward.redeem')
  preview(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: ScanPreviewDto,
  ) {
    return this.scan.preview(t.merchantId, user.id, dto);
  }

  /**
   * Credit several stamps at once (catch-up for a customer who came from another
   * loyalty system). Gated per café by `merchant.loyalty_program.multi_seal_enabled`,
   * checked in the service, and by `loyalty.adjust`: a role that may scan may not
   * automatically bulk-credit.
   */
  @Post('seals')
  @RequirePermission('loyalty.adjust')
  seals(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: ScanSealsDto) {
    return this.scan.seals(t.merchantId, user.id, dto);
  }
}
