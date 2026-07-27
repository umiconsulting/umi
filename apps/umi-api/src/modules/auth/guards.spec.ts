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
const BRANCH = '10000000-0000-4000-8000-000000000000';
const OTHER_BRANCH = '20000000-0000-4000-8000-000000000000';

describe('AuthGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('allows @Public routes without a cookie', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation(
      (k: string) => k === IS_PUBLIC,
    );
    const guard = new AuthGuard({ verifyAccess: vi.fn() } as never, reflector, {
      sessionIsActive: vi.fn(),
    } as never);
    expect(await guard.canActivate(ctxFor({}))).toBe(true);
  });

  it('401s when no access cookie is present', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const guard = new AuthGuard({ verifyAccess: vi.fn() } as never, reflector, {
      sessionIsActive: vi.fn(),
    } as never);
    await expect(guard.canActivate(ctxFor({ cookies: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the principal from a valid cookie', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const jwt = {
      verifyAccess: vi.fn().mockResolvedValue({
        sub: 'u1',
        email: 'a@b.co',
        sessionId: ACCESS,
        deviceId: null,
      }),
    };
    const guard = new AuthGuard(jwt as never, reflector, {
      sessionIsActive: vi.fn().mockResolvedValue(true),
    } as never);
    const req: Record<string, unknown> = { cookies: { umi_access: 'tok' } };
    expect(await guard.canActivate(ctxFor(req))).toBe(true);
    expect(req.authUser).toEqual({
      id: 'u1',
      email: 'a@b.co',
      sessionId: ACCESS,
      deviceId: null,
    });
  });

  it('rejects a valid access JWT after durable session revocation', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const guard = new AuthGuard(
      {
        verifyAccess: vi.fn().mockResolvedValue({
          sub: 'u1',
          email: 'a@b.co',
          sessionId: ACCESS,
          deviceId: null,
        }),
      } as never,
      reflector,
      {
        sessionIsActive: vi.fn().mockResolvedValue(false),
        writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
      } as never,
    );
    await expect(
      guard.canActivate(ctxFor({ cookies: { umi_access: 'tok' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('TenantAccessGuard', () => {
  it('404s when the user has no active membership', async () => {
    const repo = {
      findMembershipAccess: vi.fn().mockResolvedValue(null),
      tenantIdForSlug: vi.fn(),
      deniedPermissions: vi.fn().mockResolvedValue([]),
      allowedPermissions: vi.fn().mockResolvedValue([]),
      writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
    };
    const guard = new TenantAccessGuard(repo as never);
    const req = { authUser: { id: 'u1' }, params: { tenantId: ACCESS } };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves a slug → tenant and attaches membership access', async () => {
    const repo = {
      tenantIdForSlug: vi.fn().mockResolvedValue(ACCESS),
      deniedPermissions: vi.fn().mockResolvedValue([]),
      allowedPermissions: vi.fn().mockResolvedValue([]),
      writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
      findMembershipAccess: vi.fn().mockResolvedValue({
        membershipId: 'm1',
        tenantId: ACCESS,
        slug: 'kala',
        name: 'Kala',
        timezone: 'America/Mexico_City',
        roles: ['owner'],
        permissions: ['cash.read'],
        branchIds: [],
        allBranches: true,
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

  it('attaches a validated branch scope for an all-branch membership', async () => {
    const repo = {
      tenantIdForSlug: vi.fn(),
      deniedPermissions: vi.fn().mockResolvedValue([]),
      allowedPermissions: vi.fn().mockResolvedValue([]),
      writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
      branchBelongsToTenant: vi.fn().mockResolvedValue(true),
      findMembershipAccess: vi.fn().mockResolvedValue({
        membershipId: 'm1',
        tenantId: ACCESS,
        slug: 'kala',
        name: 'Kala',
        timezone: 'America/Mexico_City',
        roles: ['owner'],
        permissions: [],
        branchIds: [],
        allBranches: true,
      }),
    };
    const guard = new TenantAccessGuard(repo as never);
    const req: Record<string, unknown> = {
      authUser: { id: 'u1' },
      params: { tenantId: ACCESS },
      headers: { 'x-umi-branch-id': BRANCH },
    };

    expect(await guard.canActivate(ctxFor(req))).toBe(true);
    expect(repo.branchBelongsToTenant).toHaveBeenCalledWith(BRANCH, ACCESS);
    expect((req.tenantAccess as { branchId: string }).branchId).toBe(BRANCH);
  });

  it('fails closed when a restricted membership requests another branch', async () => {
    const repo = {
      tenantIdForSlug: vi.fn(),
      deniedPermissions: vi.fn().mockResolvedValue([]),
      allowedPermissions: vi.fn().mockResolvedValue([]),
      writeSecurityAudit: vi.fn().mockResolvedValue(undefined),
      branchBelongsToTenant: vi.fn(),
      findMembershipAccess: vi.fn().mockResolvedValue({
        membershipId: 'm1',
        tenantId: ACCESS,
        slug: 'kala',
        name: 'Kala',
        timezone: 'America/Mexico_City',
        roles: ['staff'],
        permissions: [],
        branchIds: [BRANCH],
        allBranches: false,
      }),
    };
    const guard = new TenantAccessGuard(repo as never);
    const req = {
      authUser: { id: 'u1' },
      params: { tenantId: ACCESS },
      headers: { 'x-umi-branch-id': OTHER_BRANCH },
    };

    await expect(guard.canActivate(ctxFor(req))).rejects.toMatchObject({
      response: { error: 'branch_not_found' },
    });
    expect(repo.branchBelongsToTenant).not.toHaveBeenCalled();
  });
});

describe('EntitlementGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('passes through when no @RequireProduct is set', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const guard = new EntitlementGuard(reflector, { effectiveEntitlement: vi.fn() } as never);
    expect(await guard.canActivate(ctxFor({}))).toBe(true);
  });

  it('403 product_not_active when the entitlement is inactive', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === REQUIRE_PRODUCT ? 'cash' : undefined,
    );
    const repo = {
      effectiveEntitlement: vi.fn().mockResolvedValue({
        enabled: true,
        subscriptionStatus: 'canceled',
      }),
    };
    const guard = new EntitlementGuard(reflector, repo as never);
    const req = { tenantAccess: { tenantId: ACCESS } };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows active/trialing entitlements', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === REQUIRE_PRODUCT ? 'cash' : undefined,
    );
    const repo = {
      effectiveEntitlement: vi.fn().mockResolvedValue({
        enabled: true,
        subscriptionStatus: 'trialing',
      }),
    };
    const guard = new EntitlementGuard(reflector, repo as never);
    expect(await guard.canActivate(ctxFor({ tenantAccess: { tenantId: ACCESS } }))).toBe(true);
  });
});

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() } as unknown as Reflector;

  it('403s when the membership lacks the required role', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === ROLES_KEY ? ['owner'] : undefined,
    );
    const guard = new RolesGuard(reflector, { writeSecurityAudit: vi.fn() } as never);
    const req = { tenantAccess: { roles: ['staff'], permissions: [] } };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows when a required role is present', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((k: string) =>
      k === ROLES_KEY ? ['owner', 'admin'] : undefined,
    );
    const guard = new RolesGuard(reflector, { writeSecurityAudit: vi.fn() } as never);
    const req = { tenantAccess: { roles: ['admin'], permissions: [] } };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('fails closed when an explicit deny overrides a role permission', async () => {
    (reflector.getAllAndOverride as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'umi:permission' ? 'staff.manage' : undefined,
    );
    const audit = vi.fn();
    const guard = new RolesGuard(reflector, { writeSecurityAudit: audit } as never);
    const req = {
      authUser: { id: 'u1', sessionId: ACCESS },
      tenantAccess: {
        tenantId: ACCESS,
        branchId: BRANCH,
        roles: ['owner'],
        permissions: ['*'],
        deniedPermissions: ['staff.manage'],
      },
    };
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'authorization.denied' }),
    );
  });
});
