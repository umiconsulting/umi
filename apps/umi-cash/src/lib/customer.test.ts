import { describe, it, expect } from 'vitest';
import { buildCustomerProfileData } from './customer';

describe('buildCustomerProfileData', () => {
  it('denormalizes normalized_phone onto the people row (the Fix A change)', () => {
    const data = buildCustomerProfileData({
      name: 'Oscar Astorga',
      birthDate: '1990-05-01',
      device: 'iPhone',
      os: 'iOS 26.5',
      normalizedPhone: '+525512345678',
    });
    expect(data.normalized_phone).toBe('+525512345678');
  });

  it('carries name, birth date and device/os metadata', () => {
    const data = buildCustomerProfileData({
      name: 'Ana',
      birthDate: '1988-12-31',
      device: 'iPhone',
      os: 'iOS 18.7',
      normalizedPhone: '+521111111111',
    });
    expect(data.display_name).toBe('Ana');
    // Parsed as local time; assert components (timezone-robust).
    expect(data.birth_date.getFullYear()).toBe(1988);
    expect(data.birth_date.getMonth()).toBe(11); // December
    expect(data.birth_date.getDate()).toBe(31);
    expect(data.metadata).toEqual({ device: 'iPhone', os: 'iOS 18.7' });
  });

  it('omits normalized_phone when unparseable — never writes null over an existing value', () => {
    const data = buildCustomerProfileData({
      name: 'X',
      birthDate: '2000-01-01',
      device: 'Android',
      os: 'Android 14',
      normalizedPhone: null,
    });
    expect('normalized_phone' in data).toBe(false);
  });
});
