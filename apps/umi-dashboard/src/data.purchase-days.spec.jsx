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
import { saveMerchantSettings } from './data.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  auth.headers = Promise.resolve({});
});

describe('purchase-day settings scope', () => {
  function setup() {
    let selected = 'merchant-a';
    vi.stubGlobal('window', { localStorage: { getItem: () => selected } });
    vi.stubGlobal('document', { cookie: '' });
    const request = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', request);
    return {
      request,
      switchMerchant: () => {
        selected = 'merchant-b';
      },
    };
  }

  it('captures the source merchant before authentication waits', async () => {
    const { request, switchMerchant } = setup();
    let resolveHeaders;
    auth.headers = new Promise((resolve) => {
      resolveHeaders = resolve;
    });
    const pending = saveMerchantSettings({ purchaseDays: [1, 4] });
    switchMerchant();
    resolveHeaders({});
    await pending;
    expect(new URL(request.mock.calls[0][0], 'http://localhost').pathname).toBe(
      '/api/merchants/merchant-a/settings',
    );
  });

  it('sends only the day patch to the explicitly supplied merchant', async () => {
    const { request, switchMerchant } = setup();
    switchMerchant();
    await saveMerchantSettings({ purchaseDays: [] }, 'merchant-a');
    expect(new URL(request.mock.calls[0][0], 'http://localhost').pathname).toBe(
      '/api/merchants/merchant-a/settings',
    );
    expect(request.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ purchaseDays: [] });
  });
});
