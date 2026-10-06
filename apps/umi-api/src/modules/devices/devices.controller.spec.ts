import { describe, expect, it, vi } from 'vitest';
import type { MerchantAccess } from '../auth/auth.types';
import { DevicesController } from './devices.controller';

const merchant = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  handle: 'cafe',
  name: 'Café',
  timezone: 'America/Mazatlan',
  membershipId: '00000000-0000-4000-8000-000000000002',
  role: 'admin',
  roles: ['admin'],
  permissions: ['device.enroll'],
  locationId: null,
} satisfies MerchantAccess;

describe('DevicesController branch scope', () => {
  it('filters enrollment requests by the selected branch', async () => {
    const devices = { list: vi.fn().mockResolvedValue({ requests: [] }) };
    const controller = new DevicesController(devices as never);
    const locationId = '00000000-0000-4000-8000-000000000003';

    await controller.list(
      { ...merchant, permissions: ['device.enroll', 'location.switch'] },
      locationId,
    );

    expect(devices.list).toHaveBeenCalledWith(merchant.merchantId, [locationId]);
  });

  it('rejects another branch for a location-scoped user', async () => {
    const devices = { list: vi.fn().mockResolvedValue({ requests: [] }) };
    const controller = new DevicesController(devices as never);
    const assignedLocationId = '00000000-0000-4000-8000-000000000004';

    expect(() =>
      controller.list(
        { ...merchant, locationId: assignedLocationId },
        '00000000-0000-4000-8000-000000000005',
      ),
    ).toThrow('Forbidden');
    expect(devices.list).not.toHaveBeenCalled();
  });

  it('rejects a contaminated enrollment location before the service call', () => {
    const devices = { begin: vi.fn() };
    const controller = new DevicesController(devices as never);
    const assignedLocationId = '00000000-0000-4000-8000-000000000004';

    expect(() =>
      controller.begin({ ...merchant, locationId: assignedLocationId }, { id: 'user' } as never, {
        locationId: '00000000-0000-4000-8000-000000000005',
        displayName: 'Caja',
        type: 'pos_terminal',
        platform: 'web',
        mobility: 'static',
        idempotencyKey: '00000000-0000-4000-8000-000000000006',
      }),
    ).toThrow('Forbidden');
    expect(devices.begin).not.toHaveBeenCalled();
  });
});
