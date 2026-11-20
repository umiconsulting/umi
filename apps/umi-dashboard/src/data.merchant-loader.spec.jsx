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

import { loadMerchantData } from './data.jsx';

const capabilities = (products = { cash: { status: 'active' } }) => ({
  merchant: {
    id: 'cash-owner',
    name: 'Café Cash Centro',
    handle: 'cash-centro',
  },
  products,
  locations: [{ id: 'loc-centro', name: 'Centro', status: 'active' }],
  membership: {
    role: 'owner',
    permissions: ['merchant.manage', 'loyalty.read'],
  },
});

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup({ dashboardActive = false } = {}) {
  const paths = [];
  const request = vi.fn(async (url) => {
    const path = String(url);
    paths.push(path);
    if (path.endsWith('/cash/settings')) {
      return response(200, {
        name: 'Café Cash Centro',
        city: 'Mérida',
        handle: 'cash-centro',
        primaryColor: '#1A5632',
        secondaryColor: '#E8C9A3',
        passStyle: 'grid',
        promoMessage: 'Doble sello',
        promoStartsAt: '2026-11-01T00:00:00.000Z',
        promoEndsAt: '2026-11-30T23:59:59.000Z',
        promoDays: '1,2',
        selfRegistration: true,
        topupEnabled: false,
        multiSealEnabled: true,
        birthdayRewardEnabled: true,
        birthdayRewardName: 'Pastel',
      });
    }
    if (path.endsWith('/cash/reward-config')) {
      return response(200, {
        active: {
          visitsRequired: 10,
          rewardName: 'Café gratis',
          rewardDescription: 'Un café de la casa',
          rewardCostCentavos: 0,
          isActive: true,
        },
        upgrade: null,
      });
    }
    if (path.endsWith('/settings')) {
      return dashboardActive
        ? response(403, { error: 'dashboard product required' })
        : response(500, { error: 'must not be called' });
    }
    return response(404, {});
  });
  vi.stubGlobal('fetch', request);
  return { request, paths };
}

describe('Cash-only merchant loader', () => {
  it('skips the dashboard settings route and hydrates from capabilities and Cash settings', async () => {
    const { paths } = setup();
    const merchant = await loadMerchantData({ capabilities: capabilities() });

    expect(paths).toContain('/api/merchants/cash-owner/cash/settings');
    expect(paths).not.toContain('/api/merchants/cash-owner/settings');
    expect(merchant).toMatchObject({
      name: 'Café Cash Centro',
      city: 'Mérida',
      passStyle: 'grid',
      primaryColor: '#1A5632',
      promoMessage: 'Doble sello',
      topupEnabled: false,
      multiSealEnabled: true,
      products: { cash: { status: 'active' } },
    });
    expect(merchant.locations).toHaveLength(1);
    expect(merchant.rewardConfig?.rewardName).toBe('Café gratis');
  });

  it('keeps a 403 from the dashboard route contained when the product is active', async () => {
    setup({ dashboardActive: true });
    const merchant = await loadMerchantData({
      capabilities: capabilities({ cash: { status: 'active' }, dashboard: { status: 'active' } }),
    });
    expect(merchant?.name).toBe('Café Cash Centro');
    expect(merchant?.passStyle).toBe('grid');
  });
});
