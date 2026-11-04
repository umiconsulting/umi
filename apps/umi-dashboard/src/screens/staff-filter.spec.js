import { describe, expect, it } from 'vitest';
import { staffRowAccess, visibleStaffForRoster } from './staff-roster.js';

const people = [
  { id: 'cashier', roleId: 'cashier', status: 'active' },
  { id: 'former', roleId: 'cashier', status: 'disabled' },
  { id: 'cook', roleId: 'kds', status: 'active' },
];

describe('visibleStaffForRoster', () => {
  it('keeps disabled people visible so their access can be restored', () => {
    expect(visibleStaffForRoster(people, 'ALL').map((person) => person.id)).toEqual([
      'cashier',
      'former',
      'cook',
    ]);
  });

  it('still filters by the selected role', () => {
    expect(visibleStaffForRoster(people, 'cashier').map((person) => person.id)).toEqual([
      'cashier',
      'former',
    ]);
  });
});

describe('staffRowAccess', () => {
  it('lets an administrator edit their own POS access and PIN while keeping disable locked', () => {
    const selfAdmin = { id: 'admin-1', role: 'ADMIN', roleKey: 'admin' };
    expect(staffRowAccess(selfAdmin, { canAssignAdmin: false, membershipId: 'admin-1' })).toEqual({
      isAdmin: true,
      isSelf: true,
      locked: true,
      canEditAccess: true,
    });
  });

  it('keeps another administrator locked for a non-owner administrator', () => {
    const otherAdmin = { id: 'admin-2', role: 'ADMIN', roleKey: 'admin' };
    expect(staffRowAccess(otherAdmin, { canAssignAdmin: false, membershipId: 'admin-1' })).toEqual({
      isAdmin: true,
      isSelf: false,
      locked: true,
      canEditAccess: false,
    });
  });
});
