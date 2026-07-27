import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from './auth.types';
import { AuthRepository } from './auth.repository';
import { ELEVATION_KEY, type ElevationPolicy } from './require-elevation.decorator';

@Injectable()
export class ElevationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly repo: AuthRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<ElevationPolicy>(ELEVATION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.authUser || !req.tenantAccess) {
      throw new UnauthorizedException('authentication_required');
    }
    const allowed = await this.repo.hasElevation({
      sessionId: req.authUser.sessionId,
      businessId: req.tenantAccess.tenantId,
      branchId: req.tenantAccess.branchId,
      permission: policy.permission,
      method: policy.method,
    });
    if (allowed) return true;
    await this.repo.writeSecurityAudit({
      actorUserId: req.authUser.id,
      sessionId: req.authUser.sessionId,
      businessId: req.tenantAccess.tenantId,
      branchId: req.tenantAccess.branchId,
      eventType: 'authorization.elevation_required',
      entityType: 'permission',
      outcome: 'denied',
      reasonCode: policy.method,
      metadata: { permission: policy.permission },
    });
    throw new ForbiddenException({ error: 'elevation_required', method: policy.method });
  }
}
