import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StaffService } from './staff.service';

function make() {
  const repo = {
    list: vi.fn(),
    findRoleKey: vi.fn(),
    findMerchantRole: vi.fn(),
    findMerchantRoleByKey: vi.fn((merchantId: string, key: string) =>
      Promise.resolve({ id: `${key}-id`, key, name: key, isSystem: key === 'owner' }),
    ),
    insert: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const merchants = { resolveLocationId: vi.fn().mockResolvedValue('loc-1') };
  const passwords = {
    hash: vi.fn().mockReturnValue({ salt: 'a'.repeat(32), hash: 'b'.repeat(128) }),
  };
  const config = { get: vi.fn().mockReturnValue('secret') };
  return {
    svc: new StaffService(repo as never, merchants as never, passwords as never, config as never),
    repo,
    merchants,
  };
}

const ROW = {
  id: 's1',
  name: 'Ana',
  phone: '+52',
  email: null,
  role: 'STAFF' as const,
  roleId: 'staff-id',
  roleKey: 'staff',
  roleName: 'Barista',
  roleIsSystem: false,
  status: 'active',
  permissions: null,
  invitedAt: null,
  disabledAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  hasOperatorPin: false,
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
    expect(dto.hasOperatorPin).toBe(false);
    expect(h.merchants.resolveLocationId).toHaveBeenCalledWith('t1', null);
    expect(h.repo.insert.mock.calls[0][2].roleKey).toBe('staff');
  });

  it('lets an owner create an administrator', async () => {
    h.repo.insert.mockResolvedValue({ ...ROW, role: 'ADMIN' });
    await h.svc.create(
      't1',
      null,
      { name: 'Ana', phone: '+52', role: 'ADMIN' },
      { roles: ['owner'], permissions: ['merchant.manage'] },
    );
    expect(h.repo.insert.mock.calls[0][2].roleKey).toBe('admin');
  });

  it('assigns an active merchant role by id', async () => {
    h.repo.findMerchantRole.mockResolvedValue({
      id: 'barista-id',
      key: 'barista-kalala',
      name: 'Barista',
      isSystem: false,
    });
    h.repo.insert.mockResolvedValue({
      ...ROW,
      roleId: 'barista-id',
      roleKey: 'barista-kalala',
      roleName: 'Barista',
    });
    await h.svc.create('t1', null, { name: 'Ana', phone: '+52', roleId: 'barista-id' });
    expect(h.repo.insert.mock.calls[0][2]).toMatchObject({
      roleId: 'barista-id',
      roleKey: 'staff',
    });
  });

  it('stops an administrator from assigning another administrator', async () => {
    await expect(
      h.svc.create(
        't1',
        null,
        { name: 'Ana', phone: '+52', role: 'ADMIN' },
        { roles: ['admin'], permissions: ['merchant.manage'] },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('identifies a duplicate PIN without exposing its value', async () => {
    h.repo.insert.mockRejectedValue({
      code: '23505',
      constraint: 'staff_merchant_operator_pin_lookup_key',
    });
    await expect(
      h.svc.create('t1', null, { name: 'Ana', email: 'a@b.co', operatorPin: '2468' }),
    ).rejects.toThrow('Operator PIN is already assigned to another staff member');
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

  it('hashes a replacement PIN without sending its clear value to the repository', async () => {
    h.repo.update.mockResolvedValue({ ...ROW, hasOperatorPin: true });
    await h.svc.update('t1', 's1', { operatorPin: '2468' });
    const patch = h.repo.update.mock.calls[0][2];
    expect(patch.pinMaterial).toEqual({
      salt: 'a'.repeat(32),
      hash: 'b'.repeat(128),
      lookupHash: expect.any(String),
    });
    expect(JSON.stringify(patch)).not.toContain('2468');
  });

  it('clears a PIN only after an explicit null value', async () => {
    h.repo.update.mockResolvedValue({ ...ROW, hasOperatorPin: false });
    await h.svc.update('t1', 's1', { operatorPin: null });
    expect(h.repo.update).toHaveBeenCalledWith('t1', 's1', { pinMaterial: null });
  });

  it('maps a duplicate replacement PIN to 409', async () => {
    h.repo.update.mockRejectedValue({ code: '23505' });
    await expect(h.svc.update('t1', 's1', { operatorPin: '2468' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('stops an administrator from changing another administrator', async () => {
    h.repo.findRoleKey.mockResolvedValue('admin');
    await expect(
      h.svc.update(
        't1',
        's1',
        { operatorPin: '2468' },
        { roles: ['admin'], permissions: ['merchant.manage'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.repo.update).not.toHaveBeenCalled();
  });
});

describe('StaffService.update presence', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  /**
   * DISABLING SOMEONE MUST NOT ERASE THEM.
   *
   * The service decided "was this field sent?" with hasOwnProperty. The controller
   * hands it an UpdateStaffDto, and at ES2023 `useDefineForClassFields` gives a
   * class instance every DECLARED field as an own property — so a request carrying
   * only `{status}` looked like it carried name, phone and email as well. The
   * coercion below them turns undefined into '' and null, and the repository writes
   * exactly what it is given: the person's name blanked and their contact details
   * dropped, from a click that only meant to disable an account.
   *
   * The patch the repository receives is the assertion. Anything absent from it is
   * a column the UPDATE leaves alone.
   */
  it('a status-only patch built from a DTO touches nothing else', async () => {
    h.repo.update.mockResolvedValue({ ...ROW, status: 'disabled' });
    // What the controller actually passes: a class instance, not an object literal.
    class UpdateStaffDtoLike {
      name?: string;
      phone?: string;
      email?: string;
      role?: string;
      status?: string;
    }
    const dto = new UpdateStaffDtoLike();
    dto.status = 'disabled';

    await h.svc.update('t1', 's1', dto);

    expect(h.repo.update).toHaveBeenCalledWith('t1', 's1', { status: 'disabled' });
  });

  it('still applies the fields a patch does carry, including clearing a phone', async () => {
    h.repo.update.mockResolvedValue(ROW);
    await h.svc.update('t1', 's1', { name: '  Ana  ', phone: '' });
    expect(h.repo.update).toHaveBeenCalledWith('t1', 's1', { name: 'Ana', phone: null });
  });
});
