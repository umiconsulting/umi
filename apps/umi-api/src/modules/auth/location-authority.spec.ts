import { describe, expect, it } from 'vitest';
import type { MerchantAccess } from './auth.types';
import { resolveLocationAuthority } from './location-authority';

const access = {
  merchantId: 'merchant',
  handle: 'cafe',
  name: 'Café',
  timezone: 'America/Mazatlan',
  membershipId: 'staff',
  role: 'manager',
  roles: ['manager'],
  permissions: [],
  locationId: 'branch-a',
} satisfies MerchantAccess;

describe('location authority', () => {
  it('uses the assigned branch for a location-scoped role', () => {
    expect(resolveLocationAuthority(access, 'branch-a')).toBe('branch-a');
  });

  it('rejects a client branch override without location.switch', () => {
    expect(() => resolveLocationAuthority(access, 'branch-b')).toThrow('Forbidden');
  });

  it('accepts a selected branch with location.switch', () => {
    expect(
      resolveLocationAuthority(
        { ...access, permissions: ['location.switch'], locationId: null },
        'branch-b',
      ),
    ).toBe('branch-b');
  });
});
