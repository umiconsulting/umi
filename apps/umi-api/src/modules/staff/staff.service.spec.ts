import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';

function make() {
  const repo = {
    list: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const tenants = { resolveLocationId: vi.fn().mockResolvedValue('loc-1') };
  return { svc: new StaffService(repo as never, tenants as never), repo, tenants };
}

const ROW = {
  id: 's1',
  name: 'Ana',
  phone: '+52',
  email: null,
  role: 'STAFF' as const,
  status: 'active',
  permissions: null,
  invitedAt: null,
  disabledAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('StaffService.create', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('synthesizes STAFF default permissions and ISO timestamps', async () => {
    h.repo.insert.mockResolvedValue(ROW);
    const dto = await h.svc.create('t1', null, { name: 'Ana', phone: '+52' });
    expect(dto.permissions).toEqual({
      scan: true,
      topup: true,
      analytics: false,
      settings: false,
      staff: false,
      giftcards: false,
      kds: true,
    });
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(h.tenants.resolveLocationId).toHaveBeenCalledWith('t1', null);
  });

  it('requires a name', async () => {
    await expect(h.svc.create('t1', null, { phone: '+52' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('requires phone or email', async () => {
    await expect(h.svc.create('t1', null, { name: 'Ana' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps a unique violation to 409', async () => {
    h.repo.insert.mockRejectedValue({ code: '23505' });
    await expect(h.svc.create('t1', null, { name: 'Ana', email: 'a@b.co' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('StaffService.update / remove', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('only sends fields present in the body (partial patch)', async () => {
    h.repo.update.mockResolvedValue(ROW);
    await h.svc.update('t1', 's1', { status: 'disabled' });
    const patch = h.repo.update.mock.calls[0][2];
    expect(patch).toEqual({ status: 'disabled' });
    expect('name' in patch).toBe(false);
  });

  it('404s when updating a missing staff member', async () => {
    h.repo.update.mockResolvedValue(null);
    await expect(h.svc.update('t1', 'sX', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when removing a missing staff member', async () => {
    h.repo.softDelete.mockResolvedValue(false);
    await expect(h.svc.remove('t1', 'sX')).rejects.toBeInstanceOf(NotFoundException);
  });
});
