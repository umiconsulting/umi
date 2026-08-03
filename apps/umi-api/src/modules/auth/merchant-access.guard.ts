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
import type { AuthedRequest, MerchantAccess } from './auth.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the active merchant from the route (`:merchantId` uuid or `:slug`),
 * verifies the authed user has an active membership, and attaches
 * `req.merchantAccess` + the RLS `merchantId` to the request context.
 *
 * Note (intentional hardening, D9): the legacy `/:slug/admin/*` routes had no
 * membership check in `server.js`. Under unified auth every merchant-scoped route
 * verifies membership here — closing that gap. Missing membership → 404
 * `merchant_not_found` (same shape as the dashboard's `requireMerchantAccess`).
 */
@Injectable()
export class MerchantAccessGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.authUser;
    if (!user) throw new UnauthorizedException('authentication_required');

    const merchantId = await this.resolveMerchantId(req);
    if (!merchantId) throw new NotFoundException({ error: 'merchant_not_found' });

    const access = await this.repo.findMembershipAccess(user.id, merchantId);
    if (!access) throw new NotFoundException({ error: 'merchant_not_found' });

    const role = normalizeRoleKey(access.roles);
    const merchantAccess: MerchantAccess = {
      merchantId: access.merchantId,
      slug: access.slug,
      name: access.name,
      timezone: access.timezone,
      membershipId: access.membershipId,
      role,
      roles: access.roles,
      permissions: effectivePermissions(role, access.permissions),
    };
    req.merchantAccess = merchantAccess;

    const ctx = getRequestContext();
    if (ctx) {
      ctx.merchantId = access.merchantId;
      const locationId = this.resolveLocationId(req);
      if (locationId) ctx.locationId = locationId;
    }

    return true;
  }

  private async resolveMerchantId(req: AuthedRequest): Promise<string | null> {
    const rawValues = [req.params?.merchantId, req.query?.merchantId, req.body?.merchantId];
    const raw = rawValues.find((value): value is string => typeof value === 'string');
    if (raw && UUID_RE.test(raw)) return raw;
    if (req.params?.slug) return this.repo.merchantIdForSlug(req.params.slug);
    // A non-uuid :merchantId could still be a slug in some routes.
    if (raw) return this.repo.merchantIdForSlug(raw);
    return null;
  }

  private resolveLocationId(req: AuthedRequest): string | null {
    const values = [
      req.params?.locationId,
      req.query?.locationId,
      req.body?.locationId,
    ];
    return (
      values.find(
        (value): value is string => typeof value === 'string' && UUID_RE.test(value),
      ) ?? null
    );
  }
}
