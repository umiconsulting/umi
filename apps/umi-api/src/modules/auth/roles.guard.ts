import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from './roles';
import { PERMISSION_KEY, ROLES_KEY } from './roles.decorator';
import type { AuthedRequest } from './auth.types';

/**
 * Enforces `@Roles(...)` and `@RequirePermission(...)` against the membership
 * resolved by TenantAccessGuard. Runs after it. super_admin (permissions `['*']`)
 * passes any permission check.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length && !requiredPermission) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const access = req.tenantAccess;
    if (!access) throw new UnauthorizedException('authentication_required');

    if (requiredRoles?.length) {
      const ok = access.roles.some((r) => requiredRoles.includes(r));
      if (!ok) throw new ForbiddenException({ error: 'insufficient_role' });
    }
    if (requiredPermission && !hasPermission(access.permissions, requiredPermission)) {
      throw new ForbiddenException({ error: 'insufficient_permission' });
    }
    return true;
  }
}
