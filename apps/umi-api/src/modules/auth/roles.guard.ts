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
import { AuthRepository } from './auth.repository';

/**
 * Enforces `@Roles(...)` and `@RequirePermission(...)` against the membership
 * resolved by TenantAccessGuard. Runs after it. super_admin (permissions `['*']`)
 * passes any permission check.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      if (!ok) {
        await this.auditDenied(req, 'role', requiredRoles.join(','));
        throw new ForbiddenException({ error: 'insufficient_role' });
      }
    }
    if (
      requiredPermission &&
      !hasPermission(access.permissions, requiredPermission, access.deniedPermissions)
    ) {
      await this.auditDenied(req, 'permission', requiredPermission);
      throw new ForbiddenException({ error: 'insufficient_permission' });
    }
    return true;
  }

  private async auditDenied(
    req: AuthedRequest,
    kind: 'role' | 'permission',
    requirement: string,
  ): Promise<void> {
    await this.repo.writeSecurityAudit({
      actorUserId: req.authUser?.id ?? null,
      sessionId: req.authUser?.sessionId ?? null,
      businessId: req.tenantAccess?.tenantId,
      branchId: req.tenantAccess?.branchId,
      eventType: 'authorization.denied',
      entityType: kind,
      outcome: 'denied',
      reasonCode: `missing_${kind}`,
      metadata: { requirement },
    });
  }
}
