import { describe, expect, it } from 'vitest';
import { effectivePermissions, hasPermission, normalizeRoleKey } from './roles';

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

  it('grants NO role a wildcard — the catalog is the only source', () => {
    // This test asserted the opposite until 2026-08-01: super_admin resolved to ['*'].
    // A wildcard grants permission keys written after it, and Umi paid for that — eight
    // POS keys reached super_admin in July 2026 the moment they were seeded, unreviewed.
    // seed_rbac.sql now names super_admin's permissions one by one.
    expect(effectivePermissions('super_admin', ['a'])).toEqual(['a']);
    expect(effectivePermissions('owner', ['a', 'b'])).toEqual(['a', 'b']);
    expect(effectivePermissions('super_admin', [])).toEqual([]);
  });

  it('still honours a wildcard if one is ever granted (the break-glass seam)', () => {
    // Nothing produces '*' today. The branch is kept so a future time-boxed elevation
    // grant has one place to plug into, rather than needing this changed under pressure.
    expect(hasPermission(['*'], 'anything')).toBe(true);
    expect(hasPermission(['staff.read'], 'staff.read')).toBe(true);
    expect(hasPermission(['staff.read'], 'staff.write')).toBe(false);
  });
});
