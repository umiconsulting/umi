import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MetricsQuery, type MetricsQueryInput } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { MetricsService } from './metrics.service';

@UseGuards(AuthGuard, MerchantAccessGuard)
@Controller('api/merchants/:merchantId/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Post('query')
  query(
    @CurrentUser() user: AuthUser,
    @Merchant() access: MerchantAccess,
    @Body(new ZodValidationPipe(MetricsQuery)) query: MetricsQueryInput,
  ) {
    return this.metrics.query(user, access, query);
  }
}
