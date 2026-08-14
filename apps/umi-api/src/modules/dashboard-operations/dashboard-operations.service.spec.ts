import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DashboardOperationsService } from './dashboard-operations.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: null,
};
const access = {
  merchantId: '00000000-0000-4000-8000-000000000003',
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: '00000000-0000-4000-8000-000000000004',
  role: 'owner',
  roles: ['owner'],
  permissions: ['merchant.manage', 'audit.read', 'hardware.read'],
  locationId: null,
};
const query = { domain: 'organization' as const, cursor: 0, limit: 20 };

describe('DashboardOperationsService', () => {
  it('returns exactly 21 permission-filtered domains', async () => {
    const repository = { list: vi.fn().mockResolvedValue([]) };
    const service = new DashboardOperationsService(repository as never);
    const result = await service.snapshot(user, access, query);
    expect(result.domains).toHaveLength(21);
    expect(result.domains.find((item) => item.domain === 'organization')?.available).toBe(true);
    expect(result.domains.find((item) => item.domain === 'inventory')?.available).toBe(false);
  });

  it('denies an unavailable deep link', async () => {
    const service = new DashboardOperationsService({ list: vi.fn() } as never);
    await expect(
      service.snapshot(user, access, { ...query, domain: 'inventory' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a location outside the membership assignment', async () => {
    const service = new DashboardOperationsService({ list: vi.fn() } as never);
    await expect(
      service.snapshot(
        user,
        { ...access, locationId: '00000000-0000-4000-8000-000000000005' },
        { ...query, locationId: '00000000-0000-4000-8000-000000000006' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses bounded cursor pagination', async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: String(index) }));
    const service = new DashboardOperationsService({
      list: vi.fn().mockResolvedValue(rows),
    } as never);
    const result = await service.snapshot(user, access, query);
    expect(result.items).toHaveLength(20);
    expect(result.page).toMatchObject({ hasMore: true, nextCursor: '20' });
  });
});
