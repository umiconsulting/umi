import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ headers: Promise.resolve({}) }));

vi.mock('@/lib/auth.jsx', () => ({
  getAuthHeaders: () => auth.headers,
  refreshSession: vi.fn(),
  handleSessionExpired: vi.fn(),
  REFRESH_OK: 'ok',
  REFRESH_DEAD: 'dead',
  getStoredSession: () => null,
}));

import { cashSettingsPath, registerMember, saveCashSettings } from './data.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  auth.headers = Promise.resolve({});
});

function setup(response = {}) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key) => (key === 'umi-dashboard-selected-merchant' ? 'merchant-a' : null),
      setItem: () => {},
      removeItem: () => {},
    },
  });
  vi.stubGlobal('document', { cookie: '' });
  const request = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', request);
  return request;
}

describe('Cash API alignment', () => {
  it('registers a member on the authenticated merchant-id route', async () => {
    const request = setup({
      alreadyRegistered: false,
      customerId: 'customer-1',
      cardId: 'card-1',
      cardNumber: 'UMI-1001',
      name: 'Ana',
      message: 'Bienvenida',
    });
    const result = await registerMember(
      { name: 'Ana', phone: '+525512345678', birthDate: '1990-01-01' },
      'merchant-a',
    );

    const [url, init] = request.mock.calls[0];
    expect(url).toBe('/api/merchants/merchant-a/cash/customers');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ana',
      phone: '+525512345678',
      birthDate: '1990-01-01',
    });
    expect(result.cardNumber).toBe('UMI-1001');
  });

  it('writes Cash settings on the merchant-id Cash route', async () => {
    const request = setup({ ok: true });
    await saveCashSettings(
      {
        passStyle: 'stamps',
        selfRegistration: true,
        topupEnabled: false,
        multiSealEnabled: true,
      },
      'merchant-a',
    );

    const [url, init] = request.mock.calls[0];
    expect(url).toBe('/api/merchants/merchant-a/cash/settings');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({
      passStyle: 'stamps',
      selfRegistration: true,
      topupEnabled: false,
      multiSealEnabled: true,
    });
  });

  it('builds one encoded path for the Cash settings read and write', () => {
    expect(cashSettingsPath('merchant a')).toBe('/api/merchants/merchant%20a/cash/settings');
  });

  it('refuses a write with no selected merchant', async () => {
    const request = setup();
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    await expect(saveCashSettings({ passStyle: 'stamps' })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
