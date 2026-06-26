import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import type { TenantAccess } from '../auth/auth.types';

function make() {
  const repo = {
    tenantsForUser: vi.fn(),
    loadProducts: vi.fn(),
    loadLocations: vi.fn(),
    findActiveLocation: vi.fn(),
    updateTenantSettings: vi.fn().mockResolvedValue(undefined),
    updateLocation: vi.fn(),
  };
  return { svc: new TenantsService(repo as never), repo };
}

const ACCESS: TenantAccess = {
  tenantId: 't1',
  slug: 'kala',
  name: 'Kala',
  timezone: 'America/Mexico_City',
  membershipId: 'm1',
  role: 'owner',
  roles: ['owner'],
  permissions: ['*'],
};

const LOCS = [
  { id: 'l1', slug: 'centro', name: 'Centro', timezone: 'tz', status: 'inactive' },
  { id: 'l2', slug: 'chapultepec', name: 'Chapultepec', timezone: 'tz', status: 'active' },
];

describe('TenantsService.buildCapabilities', () => {
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

describe('TenantsService.buildSettings', () => {
  it('falls back to brand-color defaults when dashboard config is empty', async () => {
    const h = make();
    h.repo.loadLocations.mockResolvedValue([]);
    h.repo.loadProducts.mockResolvedValue({
      dashboard: { status: 'trialing', locationId: null, config: {} },
    });
    const caps = await h.svc.buildCapabilities(ACCESS, null);
    const settings = h.svc.buildSettings(caps);
    expect(settings.subscriptionStatus).toBe('TRIALING');
    expect(settings.primaryColor).toBe('#B5605A');
    expect(settings.secondaryColor).toBe('#E8C9A3');
  });
});

describe('TenantsService.updateLocation', () => {
  it('404s when the location does not exist (repo returns null)', async () => {
    const h = make();
    // No active-status pre-check: 404 comes from updateLocation returning null,
    // which lets inactive locations be patched/reactivated.
    h.repo.updateLocation.mockResolvedValue(null);
    await expect(
      h.svc.updateLocation('t1', 'lX', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates and returns the location when valid', async () => {
    const h = make();
    h.repo.updateLocation.mockResolvedValue({ ...LOCS[1], name: 'New' });
    const r = await h.svc.updateLocation('t1', 'l2', { name: 'New' });
    expect(r.name).toBe('New');
  });
});
