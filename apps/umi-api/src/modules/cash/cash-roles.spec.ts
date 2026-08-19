import { describe, expect, it } from 'vitest';
import { legacyRole } from './cash-roles';

/**
 * The register reads `role` and shows or hides the money screens by its value.
 * build-v3 stores canonical role keys; the frozen umi-cash client understands
 * only ADMIN and STAFF, so this mapping is part of the wire contract.
 */
describe('legacy role derivation', () => {
  it('reads owner and admin as ADMIN', () => {
    expect(legacyRole(['owner'])).toBe('ADMIN');
    expect(legacyRole(['admin'])).toBe('ADMIN');
  });

  it('reads staff and cashier as STAFF', () => {
    expect(legacyRole(['staff'])).toBe('STAFF');
    expect(legacyRole(['cashier'])).toBe('STAFF');
  });

  it('gives ADMIN precedence when someone holds both', () => {
    // Order of the keys must not decide the answer. A café owner who is also
    // listed as staff is an owner, and the register must not hide the money
    // screens from her because the array happened to arrive staff-first.
    expect(legacyRole(['staff', 'owner'])).toBe('ADMIN');
    expect(legacyRole(['owner', 'staff'])).toBe('ADMIN');
  });

  it('refuses a role that does not operate the register', () => {
    // super_admin is deliberately absent: it is a platform grant, not a café
    // role, and it must not silently become a till login.
    expect(legacyRole(['viewer'])).toBeNull();
    expect(legacyRole(['super_admin'])).toBeNull();
    expect(legacyRole([])).toBeNull();
  });
});
