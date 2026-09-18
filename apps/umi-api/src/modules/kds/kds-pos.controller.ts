import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  PosKitchenAllDayQuery,
  PosKitchenCommandRequest,
  PosKitchenOrderQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { KdsService } from './kds.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/kitchen')
export class KdsPosController {
  constructor(private readonly kds: KdsService) {}

  @Get('orders/:sourceOrderId')
  order(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('sourceOrderId') sourceOrderId: string,
    @Query(new ZodValidationPipe(PosKitchenOrderQuery)) query: PosKitchenOrderQuery,
  ) {
    return this.kds.statusForPos(user, merchantId, sourceOrderId, query);
  }

  // The whole-location kitchen board for the POS-role device's unified KDS mode.
  @Get('board')
  board(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosKitchenOrderQuery)) query: PosKitchenOrderQuery,
  ) {
    return this.kds.boardForPos(user, merchantId, query);
  }

  // The board's wake-up (§8H step 8). A held request: it answers when a ticket moves,
  // or when the hold expires with `changed: false` — the poll, kept as the floor.
  @Get('board/watch')
  boardWatch(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosKitchenOrderQuery)) query: PosKitchenOrderQuery,
  ) {
    return this.kds.watchBoardForPos(user, merchantId, query);
  }

  // The all-day count: how many of each item the kitchen has been asked for
  // today, which is the first number a cook reads (§8H step 6). Its own route
  // rather than a field on the board because the board is polled and this is one
  // aggregate per day.
  @Get('all-day')
  allDay(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(PosKitchenAllDayQuery)) query: PosKitchenAllDayQuery,
  ) {
    return this.kds.allDayForPos(user, merchantId, query);
  }

  // Working the board: the per-item bump, the ticket moves and recall (defect D33).
  // The iPad's `POST /api/kds/command` is the same command over a station-scoped
  // device session; a till has no station, so it authorises the operator instead.
  @Post('command')
  command(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(PosKitchenCommandRequest)) dto: PosKitchenCommandRequest,
  ) {
    return this.kds.commandForPos(user, merchantId, dto);
  }
}
