import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest, TenantAccess } from './auth.types';
import type { PublicTenant } from './public-tenant.guard';

/** Injects the authenticated principal (set by AuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().authUser;
  },
);

/** Injects the resolved tenant membership (set by TenantAccessGuard). */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantAccess | undefined => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().tenantAccess;
  },
);

/** Injects the public tenant (set by PublicTenantGuard) for no-login routes. */
export const PubTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicTenant | undefined => {
    return ctx
      .switchToHttp()
      .getRequest<AuthedRequest & { publicTenant?: PublicTenant }>().publicTenant;
  },
);
