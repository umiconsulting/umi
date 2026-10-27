import { describe, expect, it } from 'vitest';
import { visibleStaffForRoster } from './staff-roster.js';

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
