import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ElevationGuard } from './elevation.guard';

const context = {
  getHandler: () => () => undefined,
  getClass: () => class {},
  switchToHttp: () => ({
    getRequest: () => ({
      authUser: {
        id: '00000000-0000-4000-8000-000000000001',
        sessionId: '00000000-0000-4000-8000-000000000002',
      },
      tenantAccess: {
        tenantId: '00000000-0000-4000-8000-000000000003',
        branchId: null,
      },
    }),
  }),
} as unknown as ExecutionContext;

describe('ElevationGuard', () => {
  it('allows a current server-side elevation grant', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        permission: 'refund.approve',
        method: 'manager_approval',
      }),
    };
    const guard = new ElevationGuard(
      reflector as unknown as Reflector,
      { hasElevation: vi.fn().mockResolvedValue(true) } as never,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('fails closed and audits a missing elevation grant', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        permission: 'refund.approve',
        method: 'operator_pin',
      }),
    };
    const audit = vi.fn();
    const guard = new ElevationGuard(
      reflector as unknown as Reflector,
      {
        hasElevation: vi.fn().mockResolvedValue(false),
        writeSecurityAudit: audit,
      } as never,
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'authorization.elevation_required' }),
    );
  });
});
