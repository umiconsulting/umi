import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import type { MerchantAccess } from '../auth/auth.types';
import { PasswordService } from '../../shared/auth/password.service';

function make() {
  const repo = {
    merchantsForUser: vi.fn(),
    loadProducts: vi.fn(),
    loadLocations: vi.fn(),
    loadBranding: vi.fn().mockResolvedValue({ brandColor: null, secondaryColor: null }),
    findActiveLocation: vi.fn(),
    updateMerchantSettings: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn(),
  };
  // Real hashing, not a stub: these cases never provision, and a real
  // PasswordService needs no configuration.
  return { svc: new MerchantsService(repo as never, new PasswordService()), repo };
}

const ACCESS: MerchantAccess = {
  merchantId: 't1',
  handle: 'kala',
  name: 'Kala',
  timezone: 'America/Mexico_City',
  membershipId: 'm1',
  role: 'owner',
  roles: ['owner'],
  permissions: ['*'],
};

const LOCS = [
  { id: 'l1', name: 'Centro', timezone: 'tz', status: 'inactive' },
  { id: 'l2', name: 'Chapultepec', timezone: 'tz', status: 'active' },
];

describe('MerchantsService.buildCapabilities', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => {
    h = make();
    h.repo.loadLocations.mockResolvedValue(LOCS);
  });

  it('marks dashboard modules available and cash modules missing by entitlement', async () => {
    h.repo.loadProducts.mockResolvedValue({
      dashboard: { status: 'active', locationId: null, config: {} },
      // no cash product → loyalty/gift-cards must be product_missing
    });
    const caps = await h.svc.buildCapabilities(ACCESS, null);

    expect(caps.modules.overview).toEqual({
      available: true,
      locationScoped: false,
    });
    expect(caps.modules.members).toMatchObject({
      available: false,
      reason: 'product_missing',
      product: 'cash',
    });
    // super_admin-only module: owner with ['*'] permissions passes the role gate
    // only when dashboard is active AND role matches; owner != super_admin, but
    // permissions includes '*' → available.
    expect(caps.modules['products-billing'].available).toBe(true);
  });

  it('selects the first active location when none requested', async () => {
    h.repo.loadProducts.mockResolvedValue({
      dashboard: { status: 'active', locationId: null, config: {} },
    });
    const caps = await h.svc.buildCapabilities(ACCESS, null);
    expect(caps.selectedLocation?.id).toBe('l2'); // the active one
  });

  it('honours an explicitly requested location', async () => {
    h.repo.loadProducts.mockResolvedValue({});
    const caps = await h.svc.buildCapabilities(ACCESS, 'l1');
    expect(caps.selectedLocation?.id).toBe('l1');
  });
});

describe('MerchantsService.buildSettings', () => {
  it('defaults branding colors when the café has set none', async () => {
    const h = make();
    h.repo.loadLocations.mockResolvedValue([]);
    h.repo.loadProducts.mockResolvedValue({
      dashboard: { status: 'trialing', locationId: null, config: {} },
    });
    h.repo.loadBranding.mockResolvedValue({
      brandColor: null,
      secondaryColor: null,
    });
    const caps = await h.svc.buildCapabilities(ACCESS, null);
    const settings = h.svc.buildSettings(caps);
    expect(settings.subscriptionStatus).toBe('TRIALING');
    expect(settings.primaryColor).toBe('#B5605A');
    expect(settings.secondaryColor).toBe('#E8C9A3');
  });

  it('sources both colors from the typed merchant.merchant columns', async () => {
    const h = make();
    h.repo.loadLocations.mockResolvedValue([]);
    h.repo.loadProducts.mockResolvedValue({
      dashboard: { status: 'active', locationId: null, config: {} },
    });
    h.repo.loadBranding.mockResolvedValue({
      brandColor: '#123456',
      secondaryColor: '#abcdef',
    });
    const caps = await h.svc.buildCapabilities(ACCESS, null);
    const settings = h.svc.buildSettings(caps);
    expect(settings.primaryColor).toBe('#123456');
    expect(settings.secondaryColor).toBe('#abcdef');
  });
});

describe('MerchantsService.updateLocation', () => {
  it('404s when the location does not exist (repo returns null)', async () => {
    const h = make();
    // No active-status pre-check: 404 comes from updateLocation returning null,
    // which lets inactive locations be patched/reactivated.
    h.repo.updateLocation.mockResolvedValue(null);
    await expect(h.svc.updateLocation('t1', 'lX', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates and returns the location when valid', async () => {
    const h = make();
    h.repo.updateLocation.mockResolvedValue({ ...LOCS[1], name: 'New' });
    const r = await h.svc.updateLocation('t1', 'l2', { name: 'New' });
    expect(r.name).toBe('New');
  });
});
