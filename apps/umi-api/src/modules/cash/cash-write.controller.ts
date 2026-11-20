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
import { CashWriteService } from './cash-write.service';
import { GiftCardCreateDto, PurchaseDto, TopupDto } from './dto/cash-write.dto';

/**
 * Customer-facing cash WRITES (live). Top-up, purchase (debit), and gift-card
 * issuance, gated on a valid session + merchant membership + the `cash` product.
 *
 * Each handler names the permission that authorizes the action. The old class-level
 * role list (`super_admin`, `owner`, `admin`, `staff`) is gone: it refused a cashier
 * on every write even though `cash-roles.ts` maps `cashier` to the register's STAFF
 * role and the seeded grant matrix gives a cashier `wallet.authorize`,
 * `wallet.redeem` and `loyalty.reward.redeem`. The permission is now the authority;
 * a role with the grant can act, and a role without it is refused. Money still moves
 * through CashWriteService → the single wallet write path.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@AcceptRegisterToken()
@Controller('api/:merchantRef/admin')
export class CashWriteController {
  constructor(private readonly cash: CashWriteService) {}

  @Post('topup')
  @RequirePermission('wallet.authorize')
  topup(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
    return this.cash.topup(t.merchantId, user.id, dto);
  }

  @Post('purchase')
  @RequirePermission('wallet.redeem')
  purchase(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: PurchaseDto) {
    return this.cash.purchase(t.merchantId, user.id, dto);
  }

  @Post('gift-cards')
  @HttpCode(200)
  @RequirePermission('gift_card.issue')
  issueGiftCard(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: GiftCardCreateDto,
  ) {
    return this.cash.issueGiftCard(t.merchantId, user.id, dto);
  }
}
