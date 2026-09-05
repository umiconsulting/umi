import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformElevationService } from './platform-elevation.service';
import type { AuthUser } from './auth.types';

const ChallengeRequest = z.object({ merchantId: z.string().uuid() }).strict();
const VerifyRequest = z
  .object({ merchantId: z.string().uuid(), code: z.string().min(4).max(16) })
  .strict();

/**
 * Step-up for a platform operator about to act inside a merchant.
 *
 * These two routes are deliberately NOT in `@umi/contract`: they are internal
 * platform-operator tooling, not part of the surface a café's clients speak.
 */
@UseGuards(AuthGuard, PlatformAdminGuard)
@Controller('api/v1/platform/elevation')
export class PlatformElevationController {
  constructor(private readonly elevation: PlatformElevationService) {}

  @Post('challenge')
  challenge(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ChallengeRequest)) _dto: z.infer<typeof ChallengeRequest>,
  ) {
    return this.elevation.challenge(user);
  }

  @Post('verify')
  verify(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(VerifyRequest)) dto: z.infer<typeof VerifyRequest>,
  ) {
    return this.elevation.verify(user, dto.merchantId, dto.code);
  }
}
