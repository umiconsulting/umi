import { describe, expect, it, vi } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { TenantAccessGuard } from './tenant-access.guard';
import { EntitlementGuard } from './entitlement.guard';
import { RolesGuard } from './roles.guard';
import { REQUIRE_PRODUCT } from './require-product.decorator';
import { IS_PUBLIC } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

function ctxFor(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

const ACCESS = '00000000-0000-4000-8000-000000000000';

describe('AuthGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('allows @Public routes without a cookie', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (k: string) => k === IS_PUBLIC,
    );
    const guard = new AuthGuard({ verifyAccess: vi.fn() } as never, reflector);
    expect(await guard.canActivate(ctxFor({}))).toBe(true);
  });

  it('401s when no access cookie is present', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const guard = new AuthGuard({ verifyAccess: vi.fn() } as never, reflector);
    await expect(guard.canActivate(ctxFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the principal from a valid cookie', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const jwt = {
      verifyAccess: vi.fn().mockResolvedValue({ sub: 'u1', email: 'a@b.co' }),
    };
    const guard = new AuthGuard(jwt as never, reflector);
    const req: Record<string, unknown> = { cookies: { umi_access: 'tok' } };
    expect(await guard.canActivate(ctxFor(req))).toBe(true);
    expect(req.authUser).toEqual({ id: 'u1', email: 'a@b.co' });
  });
});

describe('TenantAccessGuard', () => {
  it('404s when the user has no active membership', async () => {
    const repo = {
      findMembershipAccess: vi.fn().mockResolvedValue(null),
      tenantIdForSlug: vi.fn(),
    };
    const guard = new TenantAccessGuard(repo as never);
    const req = { authUser: { id: 'u1' }, params: { tenantId: ACCESS } };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves a slug → tenant and attaches membership access', async () => {
    const repo = {
      tenantIdForSlug: vi.fn().mockResolvedValue(ACCESS),
      findMembershipAccess: vi.fn().mockResolvedValue({
        membershipId: 'm1',
        tenantId: ACCESS,
        slug: 'kala',
        name: 'Kala',
        timezone: 'America/Mexico_City',
        roles: ['owner'],
        permissions: ['cash.read'],
      }),
    };
    const guard = new TenantAccessGuard(repo as never);
    const req: Record<string, unknown> = {
      authUser: { id: 'u1' },
      params: { slug: 'kala' },
    };
    expect(await guard.canActivate(ctxFor(req))).toBe(true);
    expect(repo.tenantIdForSlug).toHaveBeenCalledWith('kala');
    expect((req.tenantAccess as { role: string }).role).toBe('owner');
  });
});

describe('EntitlementGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('passes through when no @RequireProduct is set', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const guard = new EntitlementGuard(reflector, { productStatus: vi.fn() } as never);
    expect(await guard.canActivate(ctxFor({}))).toBe(true);
  });

  it('403 product_not_active when the entitlement is inactive', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === REQUIRE_PRODUCT ? 'cash' : undefined,
    );
    const repo = { productStatus: vi.fn().mockResolvedValue('canceled') };
    const guard = new EntitlementGuard(reflector, repo as never);
    const req = { tenantAccess: { tenantId: ACCESS } };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows active/trialing entitlements', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === REQUIRE_PRODUCT ? 'cash' : undefined,
    );
    const repo = { productStatus: vi.fn().mockResolvedValue('trialing') };
    const guard = new EntitlementGuard(reflector, repo as never);
    expect(await guard.canActivate(ctxFor({ tenantAccess: { tenantId: ACCESS } }))).toBe(true);
  });
});

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('403s when the membership lacks the required role', () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === ROLES_KEY ? ['owner'] : undefined,
    );
    const guard = new RolesGuard(reflector);
    const req = { tenantAccess: { roles: ['staff'], permissions: [] } };
    expect(() => guard.canActivate(ctxFor(req))).toThrow(ForbiddenException);
  });

  it('allows when a required role is present', () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === ROLES_KEY ? ['owner', 'admin'] : undefined,
    );
    const guard = new RolesGuard(reflector);
    const req = { tenantAccess: { roles: ['admin'], permissions: [] } };
    expect(guard.canActivate(ctxFor(req))).toBe(true);
  });
});
