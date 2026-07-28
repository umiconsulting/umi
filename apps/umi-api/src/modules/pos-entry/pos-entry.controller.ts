import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ManagerApprovalRequest,
  StartOperatorSessionRequest,
  VerifyOperatorPinRequest,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PosEntryService } from './pos-entry.service';

@UseGuards(AuthGuard)
@Controller('api/pos')
export class PosEntryController {
  constructor(private readonly entry: PosEntryService) {}

  @Get('entry-context')
  context(@CurrentUser() user: AuthUser) {
    return this.entry.entryContext(user);
  }

  @Post('operator-sessions')
  start(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StartOperatorSessionRequest)) dto: StartOperatorSessionRequest,
  ) {
    return this.entry.start(user, dto.tenantId, dto.branchId);
  }

  @Post('operator-sessions/:id/lock')
  lock(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.entry.transition(user, id, 'locked');
  }

  @Post('operator-sessions/:id/end')
  end(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.entry.transition(user, id, 'ended');
  }

  @Post('elevation/pin')
  pin(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(VerifyOperatorPinRequest)) dto: VerifyOperatorPinRequest,
  ) {
    return this.entry.verifyPin(user, dto);
  }

  @Post('elevation/manager-approval')
  managerApproval(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ManagerApprovalRequest)) dto: ManagerApprovalRequest,
  ) {
    return this.entry.approveByManager(user, dto);
  }
}
