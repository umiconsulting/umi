import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { KdsLocationGuard } from './kds-location.guard';

const locationId = 'a1000000-0000-4000-8000-000000000001';
const merchantId = 'a0000000-0000-4000-8000-000000000001';

function context(
  permissions: string[],
  query: Record<string, unknown> = {},
  params: Record<string, string> = {},
) {
  const request = {
    authUser: { id: 'a5000000-0000-4000-8000-000000000001' },
    merchantAccess: {
      merchantId,
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

  it('allows merchant scope only with kitchen and location permissions', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
      dashboardLocationAllowed: vi.fn(),
      merchantLocationExists: vi.fn(),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(
      guard.canActivate(context(['kitchen.merchant.read', 'location.switch'])),
    ).resolves.toBe(true);
    expect(repository.dashboardLocationAllowed).not.toHaveBeenCalled();
  });

  it('denies merchant scope when location.switch is absent', async () => {
    const repository = {
      dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
      dashboardLocationAllowed: vi.fn(),
    };
    const guard = new KdsLocationGuard(repository as never);
    await expect(guard.canActivate(context(['kitchen.merchant.read']))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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

  /**
   * THE PARAMS THE ROUTER ACTUALLY SENDS.
   *
   * Every case above passes `params` that hold a KDS resource id or nothing at
   * all, and `context` defaults the argument to `{}`. No route is shaped that
   * way. All 21 routes on `KdsLocationGuard` are declared under
   * `/merchants/:merchantId/kds/...` or `/:merchantRef/admin/...`, so the
   * merchant identifier is ALWAYS a path param.
   *
   * That gap hid a dead feature. `hasResourceId` read every param, so the
   * merchant id alone made it true, the resource lookup found nothing, and the
   * guard threw `kitchen_scope_denied` before it could grant a merchant-wide
   * read. Twelve routes answered 403 to every caller — four of them writes, so
   * a merchant could not create a station or a route, provision a device, or
   * issue a pairing PIN. The suite stayed green throughout.
   *
   * The rule these cases pin: a route is resource-scoped ONLY when it names a
   * station, route, device, pairing or ticket. The merchant identifier never
   * makes it one.
   */
  describe('with the merchant identifier the router always supplies', () => {
    const merchantScoped: Array<[string, Record<string, string>]> = [
      ['GET /kds/devices', { merchantId }],
      ['GET /kds/orders', { merchantId }],
      ['GET /kds/ticker', { merchantId }],
      ['GET /kds/stations', { merchantId }],
      ['POST /kds/stations', { merchantId }],
      ['GET /kds/routes', { merchantId }],
      ['POST /kds/routes', { merchantId }],
      ['GET /kds/devices/pairing', { merchantId }],
      ['POST /kds/devices/provision', { merchantId }],
      ['POST /kds/devices/pairing-pin', { merchantId }],
      ['GET /:merchantRef/admin/devices', { merchantRef: 'kalalacafe' }],
      ['GET /:merchantRef/admin/orders', { merchantRef: 'kalalacafe' }],
    ];

    it.each(merchantScoped)('grants merchant scope on %s', async (_route, params) => {
      const repository = {
        dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
        dashboardLocationAllowed: vi.fn(),
        merchantLocationExists: vi.fn(),
      };
      const guard = new KdsLocationGuard(repository as never);
      await expect(
        guard.canActivate(context(['kitchen.merchant.read', 'location.switch'], {}, params)),
      ).resolves.toBe(true);
      // Merchant-wide, so no per-location check is consulted.
      expect(repository.dashboardLocationAllowed).not.toHaveBeenCalled();
    });

    it('still refuses merchant scope without location.switch', async () => {
      const repository = {
        dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
        dashboardLocationAllowed: vi.fn(),
      };
      const guard = new KdsLocationGuard(repository as never);
      await expect(
        guard.canActivate(context(['kitchen.merchant.read'], {}, { merchantId })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still binds a resource id that travels beside the merchant id', async () => {
      const repository = {
        dashboardResourceLocation: vi.fn().mockResolvedValue({ found: false, locationId: null }),
        dashboardLocationAllowed: vi.fn(),
      };
      const guard = new KdsLocationGuard(repository as never);
      // A named station that resolves to nothing is still a denial — the merchant
      // id must not dilute the resource check into a merchant-wide pass.
      await expect(
        guard.canActivate(
          context(
            ['kitchen.merchant.read', 'location.switch'],
            {},
            { merchantId, stationId: 'missing' },
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
