import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { PointStoreCreateRequest, PointTerminalBindRequest } from '@umi/contract';
import type { PointStore, PointTerminal, PointTerminalList } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import type { MerchantAccess } from '../auth/auth.types';
import { Merchant } from '../auth/current-user.decorator';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PointTerminalService } from './point-terminal.service';

/**
 * THE TERMINAL CONFIGURATION OF THE `/devices` SCREEN — plan section 4 phase 5 steps 3 and 4.
 *
 * THE GATE IS THE CONSOLE'S, and it is the same pair its sibling `PointOAuthController` uses:
 * `dashboard` + `merchant.manage`. Which terminal takes the cafe's cards, and whether the point
 * of sale drives it, is a decision about where the money lands — an owner's decision, not a
 * cashier's — and no new permission key is invented, because a key no role holds is a feature
 * nobody can use.
 *
 * THE MERCHANT IS THE MEMBERSHIP'S, NEVER THE PATH'S. Every handler takes `@Merchant() access`
 * and the service compares `access.merchantId` against the id in the path before it does
 * anything, so a merchant id typed into a URL cannot become the scope of a statement. The path
 * only names WHICH terminal inside that merchant the operator means.
 *
 * THE BODY IS VALIDATED, THE PATH IS NOT, and that is not an oversight: `terminalId` is the
 * vendor's own `type__serial` string (migration 72's COMMENT says never rebuild it), so the
 * route carries it verbatim and the only check worth making is that it is a terminal this
 * account actually lists — which the service asks the vendor rather than a regex. `deviceId`
 * and `locationId` are the body's, and the contract's schema plus the composite foreign keys of
 * `device_point_terminal` are what keep them meaningful.
 *
 * THE DELETE ANSWERS 200 WITH A BODY. It is not a 204: the caller gets the terminal as it now
 * stands — unbound, with the store and point of sale the account still knows about — and a 204
 * would say "done" while hiding what was released.
 */
@Controller()
export class PointTerminalController {
  constructor(private readonly terminals: PointTerminalService) {}

  /**
   * Create the cafe's store at the vendor, from an address the operator typed.
   *
   * A POST on a collection with `idempotent: true`, which looks like a contradiction and is not:
   * the resource is the cafe's ONE store — the vendor's own model has one per account here — so
   * the client supplies the same derived external id every time and a retry collides at the
   * vendor rather than creating a second store with a second fiscal address. The address is
   * required, because the alternative is a program inventing where a business is.
   */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Post('api/merchants/:merchantId/mp-point/store')
  createStore(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(PointStoreCreateRequest)) dto: PointStoreCreateRequest,
  ): Promise<PointStore> {
    return this.terminals.createStore(access, merchantId, dto);
  }

  /** Every terminal this cafe's account holds, with our binding joined onto each. */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Get('api/merchants/:merchantId/mp-point/terminals')
  list(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
  ): Promise<PointTerminalList> {
    return this.terminals.list(access, merchantId);
  }

  /**
   * Point one terminal at one register and choose which side drives it.
   *
   * A PUT on the terminal rather than a POST on a collection, because the binding is identified
   * by the terminal: binding the same terminal again is the same resource twice, which is what
   * the route table's `idempotent: true` promises, and `unique (device_id)` means the write is a
   * MOVE — one register, one terminal — rather than an addition.
   */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Put('api/merchants/:merchantId/mp-point/terminals/:terminalId')
  bind(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
    @Param('terminalId') terminalId: string,
    @Body(new ZodValidationPipe(PointTerminalBindRequest)) dto: PointTerminalBindRequest,
  ): Promise<PointTerminal> {
    return this.terminals.bind(access, merchantId, terminalId, dto);
  }

  /**
   * Stop offering this terminal from any register of this cafe.
   *
   * The terminal must still be the account's — the service asks the vendor's list first — and
   * the account's own operating mode is left alone: this releases OUR claim, it does not decide
   * how the device in front of a customer is configured.
   */
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  @UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @Delete('api/merchants/:merchantId/mp-point/terminals/:terminalId')
  @HttpCode(200)
  unbind(
    @Merchant() access: MerchantAccess,
    @Param('merchantId') merchantId: string,
    @Param('terminalId') terminalId: string,
  ): Promise<PointTerminal> {
    return this.terminals.unbind(access, merchantId, terminalId);
  }
}
