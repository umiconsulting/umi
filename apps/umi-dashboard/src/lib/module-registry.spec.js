import { describe, expect, it } from 'vitest';
import {
  getModuleAvailability,
  getVisibleModules,
  missingLocationFor,
} from './module-registry.js';
import { i18n, activateTestLocale } from '@/test/i18n.jsx';

const capabilities = (permissions) => ({
  products: {
    dashboard: { status: 'active' },
    cash: { status: 'active' },
    kds: { status: 'active' },
    conversaflow: { status: 'active' },
  },
  membership: { role: 'viewer', permissions },
});

describe('Dashboard permission navigation', () => {
  it('lists the floor-plan editor for a merchant manager', () => {
    const ids = getVisibleModules(capabilities(['merchant.manage'])).map((item) => item.id);
    expect(ids).toContain('floor-plan');
    expect(getVisibleModules(capabilities(['catalog.read'])).map((item) => item.id)).not.toContain(
      'floor-plan',
    );
  });

  it('shows the operations center through an exact permission', () => {
    expect(getModuleAvailability('operations', capabilities(['inventory.read']))).toEqual({
      available: true,
      locationScoped: true,
    });
  });

  it('does not use a role name as authority', () => {
    const result = getModuleAvailability('staff', capabilities([]));
    expect(result).toMatchObject({ available: false, reason: 'permission_required' });
  });

  it('hides modules without an effective permission', () => {
    const ids = getVisibleModules(capabilities(['customer.read'])).map((item) => item.id);
    expect(ids).toContain('customers');
    expect(ids).not.toContain('staff');
    expect(ids).not.toContain('gift-cards');
  });

  it('uses operator language in visible navigation', () => {
    activateTestLocale('es');
    const labels = getVisibleModules(capabilities(['customer.read'])).map((item) =>
      i18n._(item.label),
    );
    expect(labels).toContain('Clientes');
    expect(labels).not.toContain('Customers');
    activateTestLocale('en');
    const english = getVisibleModules(capabilities(['customer.read'])).map((item) =>
      i18n._(item.label),
    );
    expect(english).toContain('Customers');
    activateTestLocale('es');
  });
});

describe('a café with no locations', () => {
  // Umi Cafe on the staging database is exactly this: a live, entitled merchant
  // whose locations never came across in the backfill. The screen it opened
  // rendered empty under a working shell, which read as a broken console.
  const entitled = {
    ...capabilities(['merchant.manage', 'kitchen.read', 'catalog.read']),
    locations: [],
  };

  it('has nothing to read on a location-scoped screen', () => {
    expect(missingLocationFor('floor-plan', entitled)).toBe(true);
    expect(missingLocationFor('products', entitled)).toBe(true);
    expect(missingLocationFor('orders', entitled)).toBe(true);
  });

  it('still renders the screens that are not scoped to a branch', () => {
    expect(missingLocationFor('overview', entitled)).toBe(false);
    expect(missingLocationFor('staff', entitled)).toBe(false);
  });

  it('says nothing when the café does have a location', () => {
    const withLocation = { ...entitled, locations: [{ id: 'loc', status: 'active' }] };
    expect(missingLocationFor('floor-plan', withLocation)).toBe(false);
  });

  it('leaves the no-café case to the guard that owns it', () => {
    // No capabilities at all is "no café selected", not "no locations".
    expect(missingLocationFor('floor-plan', undefined)).toBe(false);
    expect(missingLocationFor('floor-plan', {})).toBe(false);
  });
});
