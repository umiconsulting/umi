import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import type { AuthedRequest } from './auth.types';

/**
 * A PLATFORM OPERATOR, on a route that has no café to belong to.
 *
 * Every other authorised route resolves a merchant and checks membership. This
 * one cannot: it is the route that CREATES the merchant, so there is nothing to
 * be a member of yet. `MerchantAccessGuard` and `RolesGuard` both key on
 * `req.merchantAccess` and would refuse it, correctly, forever.
 *
 * ⚠️ `super_admin` ONLY, and the distinction is the point. `umi.role` carries two
 * platform roles and `PLATFORM_GRANT_CTE` returns which one a user holds,
 * because they differ in authority: `developer` has cross-merchant REACH and
 * read-only AUTHORITY — "reach every café, change nothing". Admitting any
 * platform grant here would let a debugging login create cafés.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.authUser;
    if (!user) throw new UnauthorizedException('authentication_required');

    const role = await this.repo.platformRole(user.id);
    if (role !== 'super_admin') {
      throw new ForbiddenException({ error: 'platform_admin_required', role: role ?? 'none' });
    }
    return true;
  }
}
