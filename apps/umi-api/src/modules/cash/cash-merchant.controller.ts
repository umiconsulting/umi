import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import { hasPermission } from '../auth/roles';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';
import { CashReadService } from './cash-read.service';
import { CashRegisterService } from './cash-register.service';
import { CashScanService } from './cash-scan.service';
import { RegisterDto } from './dto/register.dto';
import { ScanDto, ScanPreviewDto, ScanSealsDto } from './dto/scan.dto';
import { registerRole } from './cash-roles';

/**
 * Merchant-scoped cash façade the dashboard SPA calls (`/api/merchants/:merchantId/cash/*`).
 * server.js exposes the same surface by 307-redirecting these to `/api/:merchantRef/admin/*`;
 * we dispatch directly to CashReadService instead (one round-trip, no redirect), which
 * keeps the dashboard's existing paths working unchanged against umi-api. The `:merchantId`
 * is resolved + membership-checked by the same guard stack as the reference-addressed routes.
 *
 * `reward-config` is SPLIT here exactly as in CashController, and for the same
 * reason: the READ is `loyalty.read`, only the WRITE is `merchant.manage`. The
 * Dashboard's `settings` module declares `merchant.manage` and hides the screen
 * from a cashier, but this route is not only the Settings screen's — the shared
 * merchant model (`data.jsx` `_loadMerchant`, mounted by `DashboardLayout` on
 * every screen) fetches it for the `loyalty-value` hub, and umi-cash's till home
 * (`apps/umi-cash/src/app/[slug]/(admin)/admin/page.tsx`, a `STAFF` page) draws
 * its "Recompensa activa" panel from the reference-addressed twin. Gating the
 * read on `merchant.manage` refused a cashier a value her own screens display, so
 * it is `loyalty.read`; the write keeps the manager gate because it changes what
 * every issued pass shows. Every read names the permission its caller already
 * holds: `stats`, `customers` and `members` use `loyalty.read`; `analytics` uses
 * `insights.read`; `gift-cards` uses `gift_card.read`. A cashier keeps the till
 * reads and is refused analytics, which is the policy for that action.
 *
 * Contact fields follow `customer.contact.read`. The loyalty row stays available
 * to `loyalty.read`; the phone, the email and the birthday become `null` without
 * the contact permission. The merchant-id surface mirrors the legacy one.
 *
 * `settings` is the Cash-only settings writer. It persists `merchant.loyalty_program`
 * fields under `merchant.manage` and never goes through the unrelated merchant DTO.
 *
 * `POST customers` is the authenticated shop-floor registration path. It needs
 * `customer.create` and returns the card, not a customer session. The public
 * `POST /api/:merchantRef/customers` stays proof-required and token-free.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@Controller('api/merchants/:merchantId/cash')
export class CashMerchantController {
  constructor(
    private readonly cash: CashReadService,
    private readonly register: CashRegisterService,
    private readonly walletPass: WalletPassAdapter,
    private readonly scanService: CashScanService,
  ) {}

  @Get('stats')
  @RequirePermission('loyalty.read')
  getStats(@Merchant() t: MerchantAccess) {
    return this.cash.getStats(t.merchantId, registerRole(t));
  }

  @Get('analytics')
  @RequirePermission('insights.read')
  getAnalytics(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getAnalytics(t.merchantId, query);
  }

  @Get('customers')
  @RequirePermission('loyalty.read')
  getCustomers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query, {
      includeContact: hasPermission(t.permissions, 'customer.contact.read'),
    });
  }

  @Get('customers/:id')
  @RequirePermission('loyalty.read')
  getCustomer(@Merchant() t: MerchantAccess, @Param('id', ParseUUIDPipe) id: string) {
    return this.cash.getCustomer(t.merchantId, id, registerRole(t), {
      includeContact: hasPermission(t.permissions, 'customer.contact.read'),
    });
  }

  // server.js maps `members` -> `customers`.
  @Get('members')
  @RequirePermission('loyalty.read')
  getMembers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query, {
      includeContact: hasPermission(t.permissions, 'customer.contact.read'),
    });
  }

  @Get('members/:id')
  @RequirePermission('loyalty.read')
  getMember(@Merchant() t: MerchantAccess, @Param('id', ParseUUIDPipe) id: string) {
    return this.cash.getCustomer(t.merchantId, id, registerRole(t), {
      includeContact: hasPermission(t.permissions, 'customer.contact.read'),
    });
  }

  /**
   * Authenticated member registration for the dashboard dialog.
   *
   * The permission is `customer.create`; a cashier holds it. The response
   * carries the card so the dialog can show the number. It carries no access or
   * refresh token: a staff action never opens a customer session.
   */
  @Post('customers')
  @HttpCode(200)
  @RequirePermission('customer.create')
  registerMember(@Merchant() t: MerchantAccess, @Body() dto: RegisterDto) {
    return this.register.registerStaff(t.merchantId, t.name, dto);
  }

  @Get('gift-cards')
  @RequirePermission('gift_card.read')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }

  /**
   * Cash-only settings. The response carries the fields the Cash settings screen
   * edits, including `topupEnabled`, `selfRegistration` and `multiSealEnabled`.
   * The write changes `merchant.loyalty_program`, not `merchant.merchant`.
   */
  @Get('settings')
  @RequirePermission('merchant.manage')
  getSettings(@Merchant() t: MerchantAccess) {
    return this.cash.getSettings(t.merchantId);
  }

  @Patch('settings')
  @RequirePermission('merchant.manage')
  async updateSettings(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const changed = await this.cash.updateSettings(t.merchantId, body);
    // Not awaited. A café-wide refresh reaches every issued pass, and the save
    // must not wait for Apple. The adapter never throws. An empty PATCH wrote
    // nothing, so it must not refresh every pass.
    if (changed) void this.walletPass.refreshMerchant(t.merchantId);
    return { ok: true };
  }

  @Get('reward-config')
  // `loyalty.read`, not `merchant.manage` — see the class comment. This read feeds
  // the Dashboard's `loyalty-value` hub and umi-cash's till home, both reachable by
  // a cashier; the write below is the manager-gated half.
  @RequirePermission('loyalty.read')
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  @Put('reward-config')
  @RequirePermission('merchant.manage')
  putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body, 'replace');
  }

  @Patch('reward-config')
  @RequirePermission('merchant.manage')
  patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    return this.cash.updateRewardConfig(t.merchantId, body, 'patch');
  }

  @Post('scan')
  @RequirePermission('loyalty.reward.redeem')
  runScan(@Merchant() t: MerchantAccess, @CurrentUser() user: AuthUser, @Body() dto: ScanDto) {
    return this.scanService.scan(t.merchantId, user.id, dto);
  }

  @Post('scan/preview')
  @HttpCode(200)
  @RequirePermission('loyalty.reward.redeem')
  previewScan(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: ScanPreviewDto,
  ) {
    return this.scanService.preview(t.merchantId, user.id, dto);
  }

  @Post('scan/seals')
  @RequirePermission('loyalty.adjust')
  creditSeals(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: ScanSealsDto,
  ) {
    return this.scanService.seals(t.merchantId, user.id, dto);
  }
}
