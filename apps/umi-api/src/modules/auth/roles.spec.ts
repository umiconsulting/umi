import { describe, expect, it } from 'vitest';
import {
  effectivePermissions,
  hasPermission,
  normalizeRoleKey,
} from './roles';

describe('roles', () => {
  it('picks the highest-precedence role', () => {
    expect(normalizeRoleKey(['staff', 'owner', 'admin'])).toBe('owner');
    expect(normalizeRoleKey(['staff', 'admin'])).toBe('admin');
    expect(normalizeRoleKey(['super_admin', 'owner'])).toBe('super_admin');
  });

  it('falls back to the first unknown role, null on empty', () => {
    expect(normalizeRoleKey(['custom_role'])).toBe('custom_role');
    expect(normalizeRoleKey([])).toBeNull();
    expect(normalizeRoleKey(null)).toBeNull();
  });

  it('grants the wildcard to super_admin only', () => {
    expect(effectivePermissions('super_admin', ['a'])).toEqual(['*']);
    expect(effectivePermissions('owner', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('honours the wildcard in permission checks', () => {
    expect(hasPermission(['*'], 'anything')).toBe(true);
    expect(hasPermission(['staff.read'], 'staff.read')).toBe(true);
    expect(hasPermission(['staff.read'], 'staff.write')).toBe(false);
  });
});
