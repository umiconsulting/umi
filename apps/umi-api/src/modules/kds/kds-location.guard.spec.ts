import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { KdsLocationGuard } from './kds-location.guard';

const locationId = 'a1000000-0000-4000-8000-000000000001';

function context(
  permissions: string[],
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
) {
  const request = {
    authUser: { id: 'a5000000-0000-4000-8000-000000000001' },
    merchantAccess: {
      merchantId: 'a0000000-0000-4000-8000-000000000001',
      permissions,
    },
    params,
    query,
    body: {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('KdsLocationGuard', () => {
  it('allows the exact assigned location', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
      dashboardLocationAllowed: vi.fn().mockResolvedValue(true),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(guard.canActivate(context(['kitchen.read'], { locationId }))).resolves.toBe(true);
    expect(repository.dashboardLocationAllowed).toHaveBeenCalledWith(
      'a5000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      locationId,
    );
  });

  it('denies another location and a missing location', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
      dashboardLocationAllowed: vi.fn().mockResolvedValue(false),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(
      guard.canActivate(context(['kitchen.read'], { locationId })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context(['kitchen.read']))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows merchant scope only through its exact permission', async () => {
    const repository = { dashboardResourceLocation: vi.fn(), dashboardLocationAllowed: vi.fn() };
    const guard = new KdsLocationGuard(repository as never);
    await expect(guard.canActivate(context(['kitchen.merchant.read']))).resolves.toBe(true);
    expect(repository.dashboardLocationAllowed).not.toHaveBeenCalled();
  });

  it('binds a mutation to its authoritative resource location', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: true, locationId }),
      dashboardLocationAllowed: vi.fn().mockResolvedValue(true),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(
      guard.canActivate(context(['kitchen.station.manage'], {}, { stationId: 'station' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        context(
          ['kitchen.station.manage'],
          { locationId: 'a1000000-0000-4000-8000-000000000002' },
          { stationId: 'station' },
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a merchant station without a location', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: true, locationId: null }),
      dashboardLocationAllowed: vi.fn(),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(
      guard.canActivate(
        context(['kitchen.station.manage'], { locationId }, { stationId: 'station' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.dashboardLocationAllowed).not.toHaveBeenCalled();
  });

  it('denies a missing mutation resource', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
      dashboardLocationAllowed: vi.fn(),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(
      guard.canActivate(
        context(['kitchen.station.manage'], { locationId }, { stationId: 'missing' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
