import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { getRequestContext } from '../../shared/database/request-context';
import { AuthRepository } from './auth.repository';
import type { AuthedRequest } from './auth.types';

export interface PublicTenant {
  tenantId: string;
  name: string;
  slug: string;
}

/**
 * Resolves the tenant from `:slug` for PUBLIC (no-login) routes — customer
 * registration, gift-card redemption — WITHOUT membership verification. It seeds
 * `getRequestContext().tenantId` so `PgService.withTenant()` works on these
 * routes (it otherwise throws without an auth-set context). Missing slug → 404
 * with umi-cash's exact Spanish body (`Tenant no encontrado`).
 */
@Injectable()
export class PublicTenantGuard implements CanActivate {
  constructor(private readonly repo: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<AuthedRequest & { publicTenant?: PublicTenant }>();
    const slug = req.params?.slug;
    const tenant = slug ? await this.repo.tenantBySlug(slug) : null;
    if (!tenant) throw new NotFoundException({ error: 'Tenant no encontrado' });

    req.publicTenant = { tenantId: tenant.id, name: tenant.name, slug: tenant.slug };
    const ctx = getRequestContext();
    if (ctx) ctx.tenantId = tenant.id;
    return true;
  }
}
