import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { PosPushService } from './pos-push.service';

const registerBody = z.object({
  token: z.string().min(20).max(4096),
  platform: z.literal('android'),
  operatorSessionId: z.string().uuid(),
});
const revokeBody = z.object({ token: z.string().min(20).max(4096) });

@RequireProduct('pos')
@UseGuards(AuthGuard, MerchantAccessGuard, EntitlementGuard)
@Controller('api/v1/pos/merchants/:merchantId/push-tokens')
export class PosPushController {
  constructor(private readonly push: PosPushService) {}

  @Post()
  register(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(registerBody)) body: z.infer<typeof registerBody>,
  ) {
    return this.push.register(user, merchantId, body);
  }

  @Delete()
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('merchantId') merchantId: string,
    @Body(new ZodValidationPipe(revokeBody)) body: z.infer<typeof revokeBody>,
  ) {
    return this.push.revoke(user, merchantId, body);
  }
}
