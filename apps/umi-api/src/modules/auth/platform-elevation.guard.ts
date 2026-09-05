import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { AuthedRequest } from './auth.types';
import { PlatformElevationService } from './platform-elevation.service';

/**
 * Requires a step-up ONLY from a platform operator acting where they do not work.
 *
 * `membershipId` is null exactly when access came from a platform grant instead
 * of employment (see `PLATFORM_GRANT_CTE`). Someone who genuinely works at the
 * café passes straight through, so putting this guard on a route never changes
 * behaviour for the café's own staff — which is why it can be added to a route
 * without auditing every caller.
 */
@Injectable()
export class PlatformElevationGuard implements CanActivate {
  constructor(private readonly elevation: PlatformElevationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.authUser;
    const access = req.merchantAccess;
    if (!user) throw new UnauthorizedException('authentication_required');
    // No merchant resolved on this route, or real employment here: nothing to
    // step up for. `MerchantAccessGuard` owns the merchant decision itself.
    if (!access || access.membershipId !== null) return true;

    await this.elevation.assertElevated(user.id, access.merchantId);
    return true;
  }
}
