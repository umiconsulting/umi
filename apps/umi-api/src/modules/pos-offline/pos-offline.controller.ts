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
import { TenantAccessGuard } from '../auth/tenant-access.guard';
import { PosOfflineService } from './pos-offline.service';

@UseGuards(AuthGuard, TenantAccessGuard)
@Controller('api/pos/tenants/:tenantId/offline')
export class PosOfflineController {
  constructor(private readonly offline: PosOfflineService) {}

  @Get('policy')
  policy(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.issuePolicy(user, tenantId, query);
  }

  @Post('replay/begin')
  begin(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(BeginReplayRequest)) dto: BeginReplayRequest,
  ) {
    return this.offline.begin(user, tenantId, dto);
  }

  @Post('replay/batch')
  batch(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(ReplayBatch)) dto: ReplayBatch,
  ) {
    return this.offline.batch(user, tenantId, dto);
  }

  @Post('reconcile')
  reconcile(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query('branchId') branchId: string,
    @Query('operatorSessionId') operatorSessionId: string,
    @Query('credentialVersion') credentialVersion: string,
    @Body(new ZodValidationPipe(ReconcileRequest)) dto: ReconcileRequest,
  ) {
    return this.offline.reconcile(
      user,
      tenantId,
      branchId,
      operatorSessionId,
      Number(credentialVersion),
      dto,
    );
  }

  @Get('replay/cursor')
  cursor(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.readCursor(user, tenantId, query);
  }

  @Get('replay/commands/:commandId')
  commandResult(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Param('commandId') commandId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.commandResult(user, tenantId, query, commandId);
  }

  @Get('conflicts')
  conflicts(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.conflicts(user, tenantId, query);
  }

  @Get('diagnostics')
  diagnostics(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
  ) {
    return this.offline.diagnostics(user, tenantId, query);
  }

  @Post('reconcile/acknowledge')
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ReplayContextQuery)) query: ReplayContextQuery,
    @Body(new ZodValidationPipe(AcknowledgeReconciliationRequest))
    dto: AcknowledgeReconciliationRequest,
  ) {
    return this.offline.acknowledge(user, tenantId, query, dto.reconciliationId);
  }
}
