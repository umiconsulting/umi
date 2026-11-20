import { afterEach, describe, expect, jest, test } from '@jest/globals';

describe('apiUrl', () => {
  const originalBase = process.env.NEXT_PUBLIC_UMI_API_BASE;

  afterEach(() => {
    if (originalBase === undefined) {
      delete process.env.NEXT_PUBLIC_UMI_API_BASE;
    } else {
      process.env.NEXT_PUBLIC_UMI_API_BASE = originalBase;
    }
    jest.resetModules();
  });

  test('returns same-origin path when NEXT_PUBLIC_UMI_API_BASE is unset', async () => {
    delete process.env.NEXT_PUBLIC_UMI_API_BASE;
    jest.resetModules();
    const { apiUrl } = await import('../api');
    expect(apiUrl('/api/contact')).toBe('/api/contact');
  });

  test('prefixes path and strips trailing slashes when NEXT_PUBLIC_UMI_API_BASE is set', async () => {
    process.env.NEXT_PUBLIC_UMI_API_BASE = 'https://api.umiconsulting.co///';
    jest.resetModules();
    const { apiUrl } = await import('../api');
    expect(apiUrl('/api/contact')).toBe('https://api.umiconsulting.co/api/contact');
  });
});
