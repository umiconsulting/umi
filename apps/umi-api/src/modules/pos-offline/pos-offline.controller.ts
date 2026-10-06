import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  AcknowledgeReconciliationRequest,
  BeginReplayRequest,
  ReconcileRequest,
  ReplayBatch,
  ReplayContextQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosOfflineService } from './pos-offline.service';

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/offline')
export class PosOfflineController {
  constructor(private readonly offline: PosOfflineService) {}

  @Get('policy')
  policy(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.issuePolicy(user, merchantId, query);
  }

  @Post('replay/begin')
  begin(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(BeginReplayRequest)) dto: BeginReplayRequest,
  ) {
    return this.offline.begin(user, merchantId, dto);
  }

  @Post('replay/batch')
  batch(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(ReplayBatch)) dto: ReplayBatch,
  ) {
    return this.offline.batch(user, merchantId, dto);
  }

  @Post('reconcile')
  reconcile(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query('locationId') locationId: string,
    @Query('operatorSessionId') operatorSessionId: string,
    @Query('credentialVersion') credentialVersion: string,
    @Body(new ZodValidationPipe(ReconcileRequest)) dto: ReconcileRequest,
  ) {
    return this.offline.reconcile(
      user,
      merchantId,
      locationId,
      operatorSessionId,
      Number(credentialVersion),
      dto,
    );
  }

  @Get('replay/cursor')
  cursor(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.readCursor(user, merchantId, query);
  }

  @Get('replay/commands/:commandId')
  commandResult(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.commandResult(user, merchantId, query, commandId);
  }

  @Get('conflicts')
  conflicts(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.conflicts(user, merchantId, query);
  }

  @Get('diagnostics')
  diagnostics(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.diagnostics(user, merchantId, query);
  }

  @Post('reconcile/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
    @Body(new ZodValidationPipe(AcknowledgeReconciliationRequest))
    dto: AcknowledgeReconciliationRequest,
  ) {
    return this.offline.acknowledge(user, merchantId, query, dto.reconciliationId);
  }
}
