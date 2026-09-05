import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MerchantAccess } from '../auth/auth.types';
import { RolesService } from './roles.service';

const OWNER: MerchantAccess = {
  merchantId: 'merchant-1',
  handle: 'kalala',
  name: 'Kalala',
  timezone: 'America/Mazatlan',
  membershipId: 'staff-1',
  role: 'owner',
  roles: ['owner'],
  permissions: ['cash.register.use', 'sale.refund.full'],
  locationId: null,
};

const ROLE = {
  id: 'role-1',
  key: 'barista',
  name: 'Barista',
  description: null,
  status: 'active' as const,
  revision: 2,
  isSystem: false,
  sourceTemplateKey: 'staff',
  sourceTemplateVersion: 1,
  permissionKeys: ['cash.register.use'],
  assignedCount: 0,
  updatedAt: new Date(),
};

function make() {
  const repo = {
    accessModel: vi.fn().mockResolvedValue({
      roles: [ROLE],
      permissions: [
        {
          id: 'permission-1',
          key: 'cash.register.use',
          description: null,
          productKey: 'pos',
          groupKey: 'cash',
          riskLevel: 'low',
          delegable: true,
        },
        {
          id: 'permission-2',
          key: 'sale.refund.full',
          description: null,
          productKey: 'pos',
          groupKey: 'sale',
          riskLevel: 'high',
          delegable: true,
        },
      ],
    }),
    find: vi.fn().mockResolvedValue(ROLE),
    create: vi.fn().mockResolvedValue('role-1'),
    update: vi.fn().mockResolvedValue(true),
    archive: vi.fn().mockResolvedValue('archived'),
  };
  return { service: new RolesService(repo as never), repo };
}

describe('RolesService', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('creates a merchant role from delegable permissions owned by the actor', async () => {
    await h.service.create(
      'merchant-1',
      'user-1',
      { name: 'Caja tarde', permissionKeys: ['cash.register.use'] },
      OWNER,
    );
    expect(h.repo.create).toHaveBeenCalledWith(
      'merchant-1',
      'user-1',
      expect.objectContaining({ name: 'Caja tarde', permissionKeys: ['cash.register.use'] }),
    );
  });

  it('rejects role management by an administrator', async () => {
    await expect(
      h.service.create(
        'merchant-1',
        'user-1',
        { name: 'Caja tarde', permissionKeys: [] },
        { ...OWNER, role: 'admin', roles: ['admin'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a permission that the actor does not own', async () => {
    await expect(
      h.service.create(
        'merchant-1',
        'user-1',
        { name: 'Caja tarde', permissionKeys: ['sale.refund.full'] },
        { ...OWNER, permissions: ['cash.register.use'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an optimistic revision for updates', async () => {
    await expect(
      h.service.update(
        'merchant-1',
        'role-1',
        'user-1',
        { name: 'Barista', permissionKeys: [] },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a concurrent update as a conflict', async () => {
    h.repo.update.mockResolvedValue(false);
    await expect(
      h.service.update(
        'merchant-1',
        'role-1',
        'user-1',
        { name: 'Barista', permissionKeys: [], expectedRevision: 2 },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('protects the Owner role', async () => {
    h.repo.find.mockResolvedValue({ ...ROLE, isSystem: true, key: 'owner' });
    await expect(
      h.service.update(
        'merchant-1',
        'role-1',
        'user-1',
        { name: 'Owner', permissionKeys: [], expectedRevision: 2 },
        OWNER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires staff reassignment before archive', async () => {
    h.repo.archive.mockResolvedValue('assigned');
    await expect(
      h.service.archive('merchant-1', 'role-1', 'user-1', 2, OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
