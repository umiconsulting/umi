import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermission, Roles } from '../auth/roles.decorator';
import { RequireProduct } from '../auth/require-product.decorator';
import { AcceptRegisterToken } from '../auth/register-token.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { CashReadService } from './cash-read.service';
import { registerRole } from './cash-roles';
import { CashScanService } from './cash-scan.service';
import { ClientErrorDto } from './dto/client-error.dto';
import { CustomerRewardOverrideDto } from './dto/customer-reward.dto';
import { WalletPassAdapter } from '../../shared/adapters/wallet-pass.adapter';

const HOUR = 60 * 60 * 1000;
/** umi-cash allows ten customer exports an hour per staff member. */
const EXPORT_MAX_PER_HOUR = 10;
const DEFAULT_TZ = 'America/Mexico_City';
/** Roles that operate the register, and so can report its failures. */
const STAFF_ROLES = ['super_admin', 'owner', 'admin', 'staff'];

/**
 * Cash READ side (D11 — always live) + admin-config writes (settings branding,
 * reward-config) which are dashboard-owned and non-conflicting with umi-cash.
 * Gated on the `cash` product. Customer-facing wallet/ledger writes are NOT here
 * — see cash-write.controller.
 *
 * EVERY HANDLER NAMES A PERMISSION (workstream C step 4: "the client hides; the
 * API decides"). The product gate and the membership gate are separate checks;
 * the permission is the authority for the action.
 *
 * `settings` is the manager surface: the Dashboard's `settings` module
 * (`module-registry.js`) declares `merchant.manage` and hides the screen from a
 * cashier. Both halves of `settings` sit on `merchant.manage`.
 *
 * `reward-config` is SPLIT, and the split is deliberate: the READ is
 * `loyalty.read` (the weaker permission) and only the WRITE is `merchant.manage`.
 * The read serves three clients, and two of them are not the manager screen:
 *
 *   - umi-cash's till home (`apps/umi-cash/src/app/[slug]/(admin)/admin/page.tsx`)
 *     renders its "Recompensa activa" panel from this route, and that page is shown
 *     to a `STAFF` login (`(admin)/layout.tsx`: `roles: ['STAFF', 'ADMIN']`).
 *   - the Dashboard's merchant loader (`apps/umi-dashboard/src/data.jsx`
 *     `_loadMerchant`), which `DashboardLayout` (`app.jsx`) mounts for EVERY
 *     screen and which carries `rewardConfig` into the merchant model. The
 *     `loyalty-value` hub reads that model and its module declares
 *     `loyalty.read` / `gift_card.read` / `wallet.read` — the first of which a
 *     cashier holds.
 *
 * Gating the READ on `merchant.manage` was therefore stricter than any client
 * gate: it emptied `rewardConfig` in the Dashboard's merchant model and silently
 * removed the till's panel. The WRITE keeps `merchant.manage`, because it changes
 * what every issued pass shows and the only writer is the Settings screen, which
 * the client hides from a cashier. Do not re-tighten the read to match the write.
 *
 * The remaining register reads name the permission their readers already hold:
 * `stats`, `customers` and `customers/:id` use `loyalty.read` (every café role
 * holds it, so the till's own screens still work); `analytics` uses
 * `insights.read`; `gift-cards` uses `gift_card.read`; the customer CSV uses
 * `customer.contact.read`, because it exports every customer's phone and email.
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@RequireProduct('cash')
@AcceptRegisterToken()
@Controller('api/:merchantRef/admin')
export class CashController {
  private readonly logger = new Logger(CashController.name);

  constructor(
    private readonly cash: CashReadService,
    private readonly walletPass: WalletPassAdapter,
    private readonly rateLimit: RateLimitService,
    private readonly scan: CashScanService,
  ) {}

  /**
   * The sink for a failure that only the register's screen can see.
   *
   * A scan that commits and then loses its response leaves nothing here to find —
   * on this side the request succeeded. The screen is the only witness, so it
   * reports here and the line lands next to the request it belongs to.
   *
   * AUTHENTICATED ON PURPOSE, and role-checked like the register itself. An open
   * log endpoint is an unmetered write to our logs by anyone who finds the URL.
   *
   * `error` level, matching umi-cash: it has to surface in a log search that
   * nobody had to know to run.
   */
  @Post('client-error')
  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @HttpCode(204)
  reportClientError(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body() dto: ClientErrorDto,
  ): void {
    this.logger.error(
      `client_error ${JSON.stringify({
        merchant: t.merchantId,
        staff: user.id,
        action: dto.action,
        kind: dto.kind,
        online: dto.online ?? null,
        detail: dto.detail,
      })}`,
    );
  }

  @Get('settings')
  // Mirrors the Dashboard `settings` module (module-registry.js: permissions
  // ['merchant.manage']). The PATCH below has always required it; the read did not.
  @RequirePermission('merchant.manage')
  getSettings(@Merchant() t: MerchantAccess) {
    return this.cash.getSettings(t.merchantId);
  }

  @Get('messages')
  @RequirePermission('merchant.manage')
  getMessages(@Merchant() t: MerchantAccess, @Query() query: Record<string, unknown>) {
    return this.cash.getMessages(t.merchantId, query);
  }

  @Patch('settings')
  @RequirePermission('merchant.manage')
  async updateSettings(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    await this.cash.updateSettings(t.merchantId, body);
    // Not awaited. A café-wide refresh reaches every issued pass, and the café
    // must not wait for Apple to save a setting. It never throws — see the
    // adapter — so nothing can escape into this response.
    void this.walletPass.refreshMerchant(t.merchantId);
    return { ok: true };
  }

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
    return this.cash.getCustomers(t.merchantId, query);
  }

  /**
   * One customer. Same permission as the list beside it: the detail adds history,
   * not a new class of data.
   */
  @Get('customers/:id')
  @RequirePermission('loyalty.read')
  getCustomer(@Merchant() t: MerchantAccess, @Param('id', ParseUUIDPipe) id: string) {
    return this.cash.getCustomer(t.merchantId, id, registerRole(t));
  }

  /**
   * Set or clear one customer's reward. This is an owner decision, so the route
   * needs `merchant.manage` — the permission only `owner` and `admin` hold, and
   * the same gate as the redemption revert beside it. The legacy route allowed
   * only `ADMIN`; the canonical key names the same authority.
   *
   * The customer id is tenant-scoped. A customer from another café resolves to
   * not found. `null` clears the override and returns `customReward: null`.
   */
  @Patch('customers/:id')
  @RequirePermission('merchant.manage')
  async updateCustomerReward(
    @Merchant() t: MerchantAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CustomerRewardOverrideDto,
  ) {
    const result = await this.cash.setCustomerReward(t.merchantId, id, dto.customReward ?? null);
    // The pass shows the reward name. A failed push must not fail the save.
    void this.walletPass.refreshCard(result.cardId);
    return { success: true, customReward: result.customReward };
  }

  /**
   * The customers CSV.
   *
   * Rate limited per staff member, not per café: the export is every customer's
   * name, phone and email in one file, so the bucket has to follow the person
   * who can download it. Ten an hour, as umi-cash allows.
   */
  @Get('export')
  @RequirePermission('customer.contact.read')
  async exportCustomers(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const rl = this.rateLimit.hit(`export:${user.id}`, EXPORT_MAX_PER_HOUR, HOUR);
    if (!rl.allowed) {
      void reply.header('Retry-After', String(Math.ceil((rl.resetAt - Date.now()) / 1000)));
      throw new HttpException({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);
    }

    const csv = await this.cash.exportCustomersCsv(t.merchantId, t.timezone || DEFAULT_TZ);
    // The café's own key in the filename, never the raw :merchantRef — that
    // segment may be an opaque uuid, and the café would download `clientes-
    // 9f00…-2026-08-17.csv`.
    const name = t.handle ?? t.merchantId;
    const date = new Date().toISOString().slice(0, 10);
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="clientes-${name}-${date}.csv"`);
    return csv;
  }

  @Get('reward-config')
  // `loyalty.read`, NOT `merchant.manage` — the manager gate belongs on the write
  // below, not here. Two of the three readers of this route are not the Settings
  // screen: umi-cash's till home (`[slug]/(admin)/admin/page.tsx`, a `STAFF` page)
  // draws its "Recompensa activa" panel from it, and the Dashboard's
  // `loyalty-value` hub reads it out of the shared merchant model that
  // `_loadMerchant` fills on every screen. `loyalty.read` is what those readers
  // already require, and every role that reaches them holds it. Full trail in the
  // class comment.
  @RequirePermission('loyalty.read')
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  // Admin-config write (not the inert customer-facing path — preflight §4).
  //
  // Both of these change what every pass at the café shows. The reward name and
  // the stamps threshold appear on the card face, so each issued pass needs a
  // refresh. umi-cash also pushed here, but it did not touch the card rows first,
  // so the push did nothing. See ApplePushService.pushMerchant.
  //
  // `merchant.manage` here and `loyalty.read` on the read above is the intended
  // asymmetry, not an oversight: reading the reward is a cashier's screen,
  // changing it is the manager's.
  @Put('reward-config')
  @RequirePermission('merchant.manage')
  async putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body, 'replace');
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  @Patch('reward-config')
  @RequirePermission('merchant.manage')
  async patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body, 'patch');
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  /**
   * Re-render every pass at the café from current state, without changing any
   * configuration — the Rewards screen's "Actualizar pases" escape hatch for "I
   * changed the rewards and the passes didn't update". ADMIN-only and idempotent,
   * exactly as umi-cash had it.
   *
   * Apple only re-fetches a pass whose card row changed, so the touch is part of
   * the push (see ApplePushService.pushMerchant), not a separate step. A
   * café-wide Google re-PATCH is NOT ported yet: `google: null` says so rather
   * than reporting a number nobody measured.
   */
  @Post('reward-config/resync')
  @HttpCode(200)
  @RequirePermission('merchant.manage')
  async resyncRewardConfig(@Merchant() t: MerchantAccess, @Query('platform') platform?: string) {
    // BOTH PLATFORMS, and they are independent — one unreachable provider must not
    // silence the other. This used to answer `google: null` because the merchant-wide
    // Google refresh had no counterpart here; the operator saw "Google: 0/0" and every
    // Android pass kept yesterday's numbers.
    //
    // `?platform=apple|google` runs ONE half. It exists because the halves have very
    // different costs: refreshing Android at a café is ~100 object PATCHes, while
    // pushing Apple is one APNs round trip per card (449 at El Gran Ribera) and is what
    // outlives the proxy window in front of this API. When only one platform needs it,
    // asking for one platform is the difference between seconds and minutes.
    const only = platform === 'apple' || platform === 'google' ? platform : null;
    const [apple, google] = await Promise.all([
      only === 'google' ? null : this.walletPass.refreshMerchantWithCounts(t.merchantId),
      only === 'apple' ? null : this.walletPass.refreshMerchantGoogleObjects(t.merchantId),
    ]);
    return { apple, google };
  }

  /**
   * Undo a canje. ADMIN-only ("solo a mí"): staff can redeem, only the owner can
   * un-redeem, so a mistake has a supervised undo instead of a support ticket.
   * The customer's reward comes back, their pass is refreshed, and the canje stays
   * in the bitácora as reverted.
   */
  @Post('redemptions/:id/revert')
  @HttpCode(200)
  @RequirePermission('merchant.manage')
  revertRedemption(
    @Merchant() t: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scan.revertRedemption(t.merchantId, user.id, id);
  }

  @Get('gift-cards')
  @RequirePermission('gift_card.read')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }
}
