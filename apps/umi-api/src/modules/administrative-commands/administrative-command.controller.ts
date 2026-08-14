import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { DashboardAdministrativeCommandRequest } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { AdministrativeCommandExecutionService } from './administrative-command-execution.service';

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/administrative-commands')
export class AdministrativeCommandController {
  constructor(private readonly commands: AdministrativeCommandExecutionService) {}

  @Post()
  execute(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Param('merchantId') _merchantId: string,
    @Body(new ZodValidationPipe(DashboardAdministrativeCommandRequest))
    request: DashboardAdministrativeCommandRequest,
  ) {
    return this.commands.execute(user, access, request);
  }
}
