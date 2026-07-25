import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import { AuthRepository } from './auth.repository';
import { effectivePermissions, normalizeRoleKey } from './roles';
import type { AuthedRequest, TenantAccess } from './auth.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the active tenant from the route (`:tenantId` uuid or `:slug`),
 * verifies the authed user has an active membership, and attaches
 * `req.tenantAccess` + the RLS `tenantId` to the request context.
 *
 * Note (intentional hardening, D9): the legacy `/:slug/admin/*` routes had no
 * membership check in `server.js`. Under unified auth every tenant-scoped route
 * verifies membership here — closing that gap. Missing membership → 404
 * `tenant_not_found` (same shape as the dashboard's `requireTenantAccess`).
 */
@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.authUser;
    if (!user) throw new UnauthorizedException('authentication_required');

    const tenantId = await this.resolveTenantId(req.params ?? {});
    if (!tenantId) throw new NotFoundException({ error: 'tenant_not_found' });

    const access = await this.repo.findMembershipAccess(user.id, tenantId);
    if (!access) throw new NotFoundException({ error: 'tenant_not_found' });

    const requestedBranch = this.header(req, 'x-umi-branch-id');
    let branchId: string | null = requestedBranch;
    if (requestedBranch) {
      const permitted = access.allBranches || access.branchIds.includes(requestedBranch);
      if (
        !UUID_RE.test(requestedBranch) ||
        !permitted ||
        !(await this.repo.branchBelongsToTenant(requestedBranch, access.tenantId))
      ) {
        throw new NotFoundException({ error: 'branch_not_found' });
      }
    } else if (!access.allBranches) {
      if (access.branchIds.length !== 1) {
        throw new NotFoundException({ error: 'branch_required' });
      }
      branchId = access.branchIds[0];
    }

    const role = normalizeRoleKey(access.roles);
    const tenantAccess: TenantAccess = {
      tenantId: access.tenantId,
      branchId,
      branchIds: access.branchIds,
      allBranches: access.allBranches,
      slug: access.slug,
      name: access.name,
      timezone: access.timezone,
      membershipId: access.membershipId,
      role,
      roles: access.roles,
      permissions: effectivePermissions(role, access.permissions),
    };
    req.tenantAccess = tenantAccess;

    const ctx = getRequestContext();
    if (ctx) {
      ctx.tenantId = access.tenantId;
      ctx.branchId = branchId;
    }

    return true;
  }

  private header(req: AuthedRequest, name: string): string | null {
    const value = req.headers?.[name];
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private async resolveTenantId(params: Record<string, string>): Promise<string | null> {
    const raw = params.tenantId;
    if (raw && UUID_RE.test(raw)) return raw;
    if (params.slug) return this.repo.tenantIdForSlug(params.slug);
    // A non-uuid :tenantId could still be a slug in some routes.
    if (raw) return this.repo.tenantIdForSlug(raw);
    return null;
  }
}
