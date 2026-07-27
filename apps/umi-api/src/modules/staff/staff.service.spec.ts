import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { StaffService } from './staff.service';

function make() {
  const repo = {
    list: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    updateAuthorization: vi.fn().mockResolvedValue(true),
    findById: vi.fn(),
    softDelete: vi.fn(),
  };
  const tenants = { resolveLocationId: vi.fn().mockResolvedValue('loc-1') };
  const auth = { writeSecurityAudit: vi.fn().mockResolvedValue(undefined) };
  return {
    svc: new StaffService(repo as never, tenants as never, auth as never),
    repo,
    tenants,
    auth,
  };
}

const ROW = {
  id: '00000000-0000-4000-8000-000000000010',
  userId: '00000000-0000-4000-8000-000000000011',
  name: 'Ana',
  phone: null,
  email: 'ana@example.com',
  role: 'staff',
  status: 'active',
  permissions: { 'customer.read': true },
  invitedAt: new Date('2026-01-01T00:00:00Z'),
  disabledAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

const CREATE = {
  name: 'Ana',
  email: 'ana@example.com',
  role: 'staff',
};

describe('StaffService', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('creates a canonical invited identity and audits the assignment', async () => {
    h.repo.insert.mockResolvedValue(ROW);
    const dto = await h.svc.create('t1', null, CREATE, 'actor-1', 'session-1');
    expect(dto.permissions).toEqual({ 'customer.read': true });
    expect(h.repo.insert).toHaveBeenCalledWith('t1', 'loc-1', {
      name: 'Ana',
      email: 'ana@example.com',
      role: 'staff',
      position: null,
      actorUserId: 'actor-1',
    });
    expect(h.auth.writeSecurityAudit).toHaveBeenCalledOnce();
  });

  it('maps a duplicate identity or membership to conflict', async () => {
    h.repo.insert.mockRejectedValue({ code: '23505' });
    await expect(h.svc.create('t1', null, CREATE, 'actor-1', 'session-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('updates only supplied fields and writes an audit event', async () => {
    h.repo.update.mockResolvedValue(ROW);
    await h.svc.update('t1', ROW.id, { status: 'inactive' }, 'actor-1', 'session-1');
    expect(h.repo.update.mock.calls[0][2]).toEqual({ status: 'inactive' });
    expect(h.auth.writeSecurityAudit).toHaveBeenCalledOnce();
  });

  it('updates role and branch through the canonical authorization store', async () => {
    h.repo.update.mockResolvedValue(ROW);
    h.repo.findById.mockResolvedValue({ ...ROW, role: 'manager' });
    await h.svc.update(
      't1',
      ROW.id,
      { role: 'manager', branchId: '00000000-0000-4000-8000-000000000020' },
      'actor-1',
      'session-1',
    );
    expect(h.repo.updateAuthorization).toHaveBeenCalledWith(
      't1',
      ROW.id,
      expect.objectContaining({ role: 'manager', branchId: 'loc-1' }),
    );
  });

  it('fails closed for a missing staff record', async () => {
    h.repo.softDelete.mockResolvedValue(false);
    await expect(h.svc.remove('t1', ROW.id, 'actor-1', 'session-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
