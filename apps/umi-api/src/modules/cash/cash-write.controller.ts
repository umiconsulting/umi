import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { AcceptRegisterToken } from '../auth/register-token.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { CashWriteService } from './cash-write.service';
import { GiftCardCreateDto, PurchaseDto, TopupDto } from './dto/cash-write.dto';

// Staff-capable roles authorized to operate the register (umi-cash STAFF|ADMIN).
const STAFF_ROLES = ['super_admin', 'owner', 'admin', 'staff'];

/**
 * Customer-facing cash WRITES (live). Top-up, purchase (debit), and gift-card
 * issuance, gated on a valid session + merchant membership + the `cash` product +
 * a staff-capable role. Money moves through CashWriteService → the single wallet
 * write path. (Customer-facing gift redemption / scan are the next increment.)
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@AcceptRegisterToken()
@Roles(...STAFF_ROLES)
@Controller('api/:merchantRef/admin')
export class CashWriteController {
  constructor(private readonly cash: CashWriteService) {}

  @Post('topup')
  topup(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
    return this.cash.topup(t.merchantId, user.id, dto);
  }

  @Post('purchase')
  purchase(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: PurchaseDto) {
    return this.cash.purchase(t.merchantId, user.id, dto);
  }

  @Post('gift-cards')
  issueGiftCard(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: GiftCardCreateDto,
  ) {
    return this.cash.issueGiftCard(t.merchantId, user.id, dto);
  }
}
