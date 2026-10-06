import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  TenderAssertionRequest,
  TenderAttemptQuery,
  TenderCaptureRequest,
  TenderProviderQuery,
  TenderRefundRequest,
  TenderSettlementRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { TenderService } from './tender.service';

/**
 * The till's tender surface (plan §8G steps 2, 3 and 7).
 *
 * THE GATE CHAIN IS THE CHECKOUT'S, deliberately: `pos` and `checkout.commit`. Taking a
 * card is the same act as taking cash, so it is authorised by the same operator session
 * and the same permission the checkout already requires — not by a new key, because a
 * permission no role holds is a feature nobody can use.
 *
 * `capture` is the only route here that can move money, and the only one that creates an
 * attempt. The other three read: what happened to an attempt, what an operator was told,
 * and which providers this deployment can actually reach.
 */
@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId')
export class TenderController {
  constructor(private readonly tender: TenderService) {}

  @Post('tenders/capture')
  capture(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(TenderCaptureRequest)) dto: TenderCaptureRequest,
  ) {
    return this.tender.capture(user, merchantId, dto);
  }

  @Get('tenders/:commandIdentity')
  attempt(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandIdentity') commandIdentity: string,
    @Query(new ZodValidationPipe(TenderAttemptQuery)) query: TenderAttemptQuery,
  ) {
    return this.tender.attempt(user, merchantId, commandIdentity, query);
  }

  @Post('tenders/:commandIdentity/assertion')
  assert(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandIdentity') commandIdentity: string,
    @Body(new ZodValidationPipe(TenderAssertionRequest)) dto: TenderAssertionRequest,
  ) {
    return this.tender.assert(user, merchantId, commandIdentity, dto);
  }

  // The operator's DECISION, where `assertion` above is only their belief. A
  // manual terminal has nobody else to ask, so this is the route that lets an
  // unresolved attempt become final and its cart become usable again.
  //
  // The permission is enforced in the service, not by a decorator: this
  // controller's guard chain is the checkout's (`pos` + `checkout.commit`) and
  // carries no `RolesGuard`, so a `@RequirePermission` here would read as
  // enforcement while enforcing nothing. `settle` asks the operator's own
  // permission list for `checkout.terminal.confirm`.
  @Post('tenders/:commandIdentity/settlement')
  settle(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandIdentity') commandIdentity: string,
    @Body(new ZodValidationPipe(TenderSettlementRequest)) dto: TenderSettlementRequest,
  ) {
    return this.tender.settle(user, merchantId, commandIdentity, dto);
  }

  @Get('tender-providers')
  providers(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(TenderProviderQuery)) query: TenderProviderQuery,
  ) {
    return this.tender.providers(user, merchantId, query);
  }

  /**
   * GIVING THE MONEY BACK. It is addressed by the ATTEMPT it refunds and not by the
   * sale, because a partial refund needs the capture's payment id (research note 01
   * §4.3) and a capture is what has one. The gate is the platform's existing
   * `sale.refund.manual_terminal` — an operator may take money and still not be
   * allowed to give it back.
   */
  @Post('tenders/:attemptId/refund')
  refund(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(TenderRefundRequest)) dto: TenderRefundRequest,
  ) {
    return this.tender.refund(user, merchantId, attemptId, dto);
  }
}
