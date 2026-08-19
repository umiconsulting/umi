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
import { Roles } from '../auth/roles.decorator';
import { RequireProduct } from '../auth/require-product.decorator';
import { AcceptRegisterToken } from '../auth/register-token.decorator';
import { Merchant } from '../auth/current-user.decorator';
import type { MerchantAccess } from '../auth/auth.types';
import type { FastifyReply } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { CashReadService } from './cash-read.service';
import { ClientErrorDto } from './dto/client-error.dto';
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
 * — see cash-write.controller (inert, unmounted unless CASH_WRITE_ENABLED).
 */
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@RequireProduct('cash')
@AcceptRegisterToken()
@Controller('api/:merchantRef/admin')
export class CashController {
  private readonly logger = new Logger(CashController.name);

  constructor(
    private readonly cash: CashReadService,
    private readonly walletPass: WalletPassAdapter,
    private readonly rateLimit: RateLimitService,
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
  getSettings(@Merchant() t: MerchantAccess) {
    return this.cash.getSettings(t.merchantId);
  }

  @Patch('settings')
  async updateSettings(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    await this.cash.updateSettings(t.merchantId, body);
    // Not awaited. A café-wide refresh reaches every issued pass, and the café
    // must not wait for Apple to save a setting. It never throws — see the
    // adapter — so nothing can escape into this response.
    void this.walletPass.refreshMerchant(t.merchantId);
    return { ok: true };
  }

  @Get('stats')
  getStats(@Merchant() t: MerchantAccess) {
    return this.cash.getStats(t.merchantId);
  }

  @Get('analytics')
  getAnalytics(@Merchant() t: MerchantAccess) {
    return this.cash.getAnalytics(t.merchantId);
  }

  @Get('customers')
  getCustomers(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getCustomers(t.merchantId, query);
  }

  /**
   * One customer. Same guards as the list beside it, which already exposes her
   * phone, email and balance — the detail adds history, not a new class of data.
   */
  @Get('customers/:id')
  getCustomer(@Merchant() t: MerchantAccess, @Param('id', ParseUUIDPipe) id: string) {
    return this.cash.getCustomer(t.merchantId, id);
  }

  /**
   * The customers CSV.
   *
   * Rate limited per staff member, not per café: the export is every customer's
   * name, phone and email in one file, so the bucket has to follow the person
   * who can download it. Ten an hour, as umi-cash allows.
   */
  @Get('export')
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
  getRewardConfig(@Merchant() t: MerchantAccess) {
    return this.cash.getRewardConfig(t.merchantId);
  }

  // Admin-config write (not the inert customer-facing path — preflight §4).
  //
  // Both of these change what every pass at the café shows. The reward name and
  // the stamps threshold appear on the card face, so each issued pass needs a
  // refresh. umi-cash also pushed here, but it did not touch the card rows first,
  // so the push did nothing. See ApplePushService.pushMerchant.
  @Put('reward-config')
  async putRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body);
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  @Patch('reward-config')
  async patchRewardConfig(@Merchant() t: MerchantAccess, @Body() body: Record<string, unknown>) {
    const result = await this.cash.updateRewardConfig(t.merchantId, body);
    void this.walletPass.refreshMerchant(t.merchantId);
    return result;
  }

  @Get('gift-cards')
  getGiftCards(@Merchant() t: MerchantAccess, @Query() query: Record<string, string>) {
    return this.cash.getGiftCards(t.merchantId, query);
  }
}
