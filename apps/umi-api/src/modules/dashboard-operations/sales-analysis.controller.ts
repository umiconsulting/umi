import { Body, Controller, Delete, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  SalesAnalysisGroupWrite,
  SalesAnalysisQuery,
  SalesAnalysisOptionsQuery,
  SalesAnalysisDeleteQuery,
} from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { SalesAnalysisService } from './sales-analysis.service';

const GroupId = z.string().uuid();

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/operations/reports/sales/analysis')
export class SalesAnalysisController {
  constructor(private readonly analysis: SalesAnalysisService) {}

  @Get()
  read(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(SalesAnalysisQuery)) query: SalesAnalysisQuery,
  ) {
    return this.analysis.read(user, access, query);
  }

  @Get('options')
  options(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Query(new ZodValidationPipe(SalesAnalysisOptionsQuery))
    query: z.infer<typeof SalesAnalysisOptionsQuery>,
  ) {
    return this.analysis.options(user, access, query.locationId);
  }

  @Put('groups/:groupId')
  saveGroup(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Param('groupId', new ZodValidationPipe(GroupId)) id: string,
    @Body(new ZodValidationPipe(SalesAnalysisGroupWrite)) input: SalesAnalysisGroupWrite,
  ) {
    return this.analysis.saveGroup(user, access, id, input);
  }

  @Delete('groups/:groupId')
  deleteGroup(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Param('groupId', new ZodValidationPipe(GroupId)) id: string,
    @Query(new ZodValidationPipe(SalesAnalysisDeleteQuery))
    query: z.infer<typeof SalesAnalysisDeleteQuery>,
  ) {
    return this.analysis.deleteGroup(user, access, id, query.expectedVersion);
  }
}
