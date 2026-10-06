import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ClearTableRequest,
  MarkTableAwaitingPaymentRequest,
  MarkTableOrderedRequest,
  MarkTableServedRequest,
  MergeTablesRequest,
  MovePartyRequest,
  OpenTableRequest,
  PosTableStateQuery,
  SeatTableRequest,
  SplitPartyRequest,
  TableStateQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TableMapService } from './table-map.service';

/**
 * The POS surface: the till reads the room and moves parties on it.
 *
 * One route per operation rather than one polymorphic verb, so a refusal names
 * the operation it refused (`TABLE_NOT_OCCUPIED` on a move is not the same fact
 * as `TABLE_NOT_OCCUPIED` on a clear) and the contract can publish a different
 * error set for each.
 */
@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/table-state')
export class PosTableMapController {
  constructor(private readonly tables: TableMapService) {}

  @Get()
  read(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosTableStateQuery)) query: PosTableStateQuery,
  ) {
    return this.tables.readForPos(user, merchantId, query);
  }

  @Post('seat')
  seat(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(SeatTableRequest)) dto: SeatTableRequest,
  ) {
    return this.tables.seat(user, merchantId, dto);
  }

  @Post('move')
  move(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(MovePartyRequest)) dto: MovePartyRequest,
  ) {
    return this.tables.move(user, merchantId, dto);
  }

  @Post('merge')
  merge(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(MergeTablesRequest)) dto: MergeTablesRequest,
  ) {
    return this.tables.merge(user, merchantId, dto);
  }

  @Post('split')
  split(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(SplitPartyRequest)) dto: SplitPartyRequest,
  ) {
    return this.tables.split(user, merchantId, dto);
  }

  @Post('clear')
  clear(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(ClearTableRequest)) dto: ClearTableRequest,
  ) {
    return this.tables.clear(user, merchantId, dto);
  }

  @Post('open')
  openTable(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(OpenTableRequest)) dto: OpenTableRequest,
  ) {
    return this.tables.openTable(user, merchantId, dto);
  }

  /**
   * The three service transitions: the party stays where it is, the front of
   * house says where it has got to. Three routes rather than one, for the same
   * reason as the siblings above — a `TABLE_NOT_OCCUPIED` refusal on "served"
   * means something different from one on "clear", and the contract publishes a
   * different error set for each.
   */
  @Post('ordered')
  markOrdered(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(MarkTableOrderedRequest)) dto: MarkTableOrderedRequest,
  ) {
    return this.tables.markOrdered(user, merchantId, dto);
  }

  @Post('served')
  markServed(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(MarkTableServedRequest)) dto: MarkTableServedRequest,
  ) {
    return this.tables.markServed(user, merchantId, dto);
  }

  @Post('awaiting-payment')
  markAwaitingPayment(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(MarkTableAwaitingPaymentRequest))
    dto: MarkTableAwaitingPaymentRequest,
  ) {
    return this.tables.markAwaitingPayment(user, merchantId, dto);
  }
}

/**
 * The console's read of the same state. The dashboard owns the floor-plan screen,
 * and a manager looking at a table that "looks wrong" needs to see who is on it
 * and for how long without a till. It is gated exactly like the plan screen
 * (`merchant.manage`), so the client's gate and the server's answer cannot drift.
 *
 * No write verbs here: the console edits the LAYOUT, the till runs the ROOM.
 */
@RequireProduct('dashboard')
@RequirePermission('merchant.manage')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard, RolesGuard)
@Controller('api/merchants/:merchantId/table-state')
export class TableMapController {
  constructor(private readonly tables: TableMapService) {}

  @Get()
  read(
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(TableStateQuery)) query: { locationId: string },
  ) {
    return this.tables.read(access, query.locationId);
  }
}
