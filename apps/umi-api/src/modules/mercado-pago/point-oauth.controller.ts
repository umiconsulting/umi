import { Controller, Delete, Get, Param, Query, Redirect, UseGuards } from '@nestjs/common';
import type { PointAuthorization, PointCredentialStatus } from '@umi/contract';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PointCredentialService } from './point-credential.service';

/**
 * CONNECTING THE CAFÉ'S OWN MERCADO PAGO ACCOUNT — Phase 5 steps 1 and 3.
 *
 * THE TWO MUTATING ROUTES ARE THE CONSOLE'S, and gated by `merchant.manage` on the dashboard
 * product, the same pair the fiscal documents and the floor plan use. Which account receives
 * the café's money is an owner's decision; a cashier at the counter is not the person who
 * makes it, and no new permission key is invented (a key no role holds is a feature nobody
 * can use).
 *
 * THE CALLBACK IS PUBLIC, AND THAT IS NOT A HOLE. The vendor's servers send the seller's
 * BROWSER here, on a cross-site navigation, and the only thing that authorises it is the state
 * WE signed and handed out: without it the callback does nothing but redirect. The code it
 * carries is exchanged immediately and never echoed, logged or stored.
 */
@Controller()
export class PointOAuthController {
  constructor(private readonly credentials: PointCredentialService) {}

  /** Where to send the seller to authorize this café, and for how long that link is good. */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Get('api/merchants/:merchantId/mp-point/authorization')
  authorize(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
  ): PointAuthorization {
    // The merchant id in the path is the one the membership was checked against, so the state
    // names the café the OPERATOR is allowed to act for rather than one they typed.
    return this.credentials.authorize(user, access.merchantId ?? merchantId);
  }

  /** Is this café connected, to which account, and how much of the token's life is left. */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Get('api/merchants/:merchantId/mp-point')
  status(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
  ): Promise<PointCredentialStatus> {
    return this.credentials.status(access.merchantId ?? merchantId);
  }

  /**
   * STOP CHARGING THIS ACCOUNT. The owner's own act, and the one the console's unlink
   * control calls: the material is erased in place and the row stays, which is what the
   * migration's no-DELETE doctrine asks for (`repository.revoke` states the whole argument).
   *
   * The answer is the status AFTER the change rather than an acknowledgement, so the screen
   * renders the state it is actually in — `connected: false` — instead of assuming one, and
   * a second call answers identically.
   */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Delete('api/merchants/:merchantId/mp-point')
  disconnect(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
  ): Promise<PointCredentialStatus> {
    return this.credentials.disconnect(access.merchantId ?? merchantId);
  }

  /**
   * THE RETURN TRIP. The vendor appends `code` and the `state` we minted; the browser follows
   * our redirect back to the console with the outcome on it. No guard: this is not a session
   * request, it is a redirect, and the signature on the state is the authorisation.
   */
  @Get('api/mp-point/oauth/callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
  ): Promise<{ url: string; statusCode: number }> {
    return {
      url: await this.credentials.complete({ code: code ?? null, state: state ?? null }),
      // A 302 rather than a 200: the seller is in the middle of a flow and must land back on
      // the console, not on JSON.
      statusCode: 302,
    };
  }
}
