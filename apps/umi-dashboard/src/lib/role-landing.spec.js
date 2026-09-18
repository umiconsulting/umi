import { describe, expect, it } from 'vitest';
import { MODULES } from './module-registry.js';
import {
  FALLBACK_ORDER,
  ROLE_LANDING,
  landingRouteFor,
  moduleForRoute,
  routeForModule,
} from './role-landing.js';

/*
 * The permission lists are the SEEDED café roles' own keys, narrowed to the ones
 * `MODULES` names — that is the whole set the registry can read, so the fixtures
 * are the real roles and not a hypothetical permission set. Read them out of
 * `umi.role` joined to `umi.role_permission` if they ever move.
 */
const OWNER = [
  'audit.read',
  'cash.shift.read',
  'catalog.read',
  'customer.read',
  'device.enroll',
  'gift_card.read',
  'hardware.diagnostics',
  'inventory.read',
  'kitchen.read',
  'loyalty.read',
  'merchant.manage',
  'sale.exception.read',
  'sale.lifecycle',
  'wallet.read',
];
const MANAGER = [
  'cash.shift.read',
  'catalog.read',
  'customer.read',
  'gift_card.read',
  'hardware.diagnostics',
  'inventory.read',
  'kitchen.read',
  'loyalty.read',
  'sale.exception.read',
  'sale.lifecycle',
  'wallet.read',
];
const SUPERVISOR = [
  'cash.shift.read',
  'catalog.read',
  'customer.read',
  'gift_card.read',
  'inventory.read',
  'kitchen.read',
  'loyalty.read',
  'sale.exception.read',
  'sale.lifecycle',
  'wallet.read',
];
const CASHIER = [
  'catalog.read',
  'cash.shift.read',
  'customer.read',
  'gift_card.read',
  'inventory.read',
  'kitchen.read',
  'loyalty.read',
  'sale.exception.read',
  'sale.lifecycle',
  'wallet.read',
];
const VIEWER = [
  'catalog.read',
  'customer.read',
  'inventory.read',
  'kitchen.read',
  'loyalty.read',
  'wallet.read',
];

/** Every permission any module in the registry asks for. */
const EVERY_MODULE_PERMISSION = [
  ...new Set(Object.values(MODULES).flatMap((module) => module.permissions || [])),
];

describe('role landing', () => {
  it('sends each cited role to the screen the research cites', () => {
    expect(landingRouteFor({ roleKey: 'owner', permissions: OWNER })).toBe('/');
    expect(landingRouteFor({ roleKey: 'admin', permissions: OWNER })).toBe('/');
    expect(landingRouteFor({ roleKey: 'manager', permissions: MANAGER })).toBe('/operations');
    expect(landingRouteFor({ roleKey: 'supervisor', permissions: SUPERVISOR })).toBe('/operations');
    expect(landingRouteFor({ roleKey: 'cashier', permissions: CASHIER })).toBe('/cash-shifts');
  });

  it('reads the role key the way the API normalizes it', () => {
    expect(landingRouteFor({ roleKey: 'owner', permissions: OWNER })).toBe(ROLE_LANDING.owner);
    // Case and padding are the only normalization this file does.
    expect(landingRouteFor({ roleKey: ' Owner ', permissions: OWNER })).toBe('/');
  });

  it('falls back when the cited module is not visible to the role', () => {
    // A cashier with no `cash.shift.read` cannot open /cash-shifts, so the
    // resolver must not send one there.
    const permissions = ['customer.read'];
    const route = landingRouteFor({ roleKey: 'cashier', permissions });
    expect(route).toBe('/customers');
    expect(route).not.toBe(ROLE_LANDING.cashier);
  });

  it('places an unknown or custom role on a module it may actually open', () => {
    expect(landingRouteFor({ roleKey: 'barista-kalala', permissions: ['loyalty.read'] })).toBe(
      '/loyalty-value',
    );
    expect(landingRouteFor({ roleKey: 'barista-kalala', permissions: ['kitchen.read'] })).toBe(
      '/orders',
    );
    expect(landingRouteFor({ roleKey: null, permissions: ['catalog.read'] })).toBe(
      '/catalog-inventory',
    );
  });

  it('never parks the read-only role on the dashboard home', () => {
    const route = landingRouteFor({ roleKey: 'viewer', permissions: VIEWER });
    expect(route).not.toBe('/');
    expect(route).toBe('/customers');
  });

  it('never returns a route the permission list excludes, for any role', () => {
    const roles = ['owner', 'admin', 'manager', 'supervisor', 'cashier', 'viewer', 'staff'];
    const lists = [OWNER, MANAGER, SUPERVISOR, CASHIER, VIEWER, [], ['audit.read']];
    for (const roleKey of roles) {
      for (const permissions of lists) {
        const route = landingRouteFor({ roleKey, permissions });
        if (route === null) continue;
        const module = MODULES[moduleForRoute(route)];
        // A module with no declared permissions (the home) is open by design;
        // every other answer has to name a permission the role holds.
        if (!module.permissions?.length) continue;
        const allowed = module.permissions.some((key) => permissions.includes(key));
        expect(allowed, `${roleKey} → ${route}`).toBe(true);
      }
    }
  });

  it('gives the widest role the narrowest admissible screen, not the home', () => {
    // No cited row for `staff` or for a platform grant: both fall through.
    expect(landingRouteFor({ roleKey: 'staff', permissions: EVERY_MODULE_PERMISSION })).toBe(
      '/customers',
    );
    expect(landingRouteFor({ roleKey: 'super_admin', permissions: EVERY_MODULE_PERMISSION })).toBe(
      '/customers',
    );
  });

  it('answers null when no screen is admissible, rather than inventing one', () => {
    expect(landingRouteFor({ roleKey: 'mystery', permissions: [] })).toBeNull();
    expect(landingRouteFor({})).toBeNull();
    expect(landingRouteFor()).toBeNull();
  });

  it('defers to the registry gate the caller hands in', () => {
    // The shell passes `canShowModule`, which also reads product entitlement and
    // the platform grant. A route that gate refuses is not returned even when
    // the permissions alone would admit it.
    const admitsOnlyKitchen = (moduleKey) => moduleKey === 'kitchen';
    expect(
      landingRouteFor({ roleKey: 'cashier', permissions: CASHIER, canShow: admitsOnlyKitchen }),
    ).toBe('/kitchen');
    expect(
      landingRouteFor({ roleKey: 'owner', permissions: OWNER, canShow: () => false }),
    ).toBeNull();
  });

  it('keeps the fallback chain to modules that are permission-gated', () => {
    // The home, `cafes` and `products-billing` are not permission-gated, so they
    // must never appear in the chain: an unplaced role would be sent to a screen
    // the registry admits for reasons other than a permission it holds.
    for (const moduleKey of FALLBACK_ORDER) {
      expect(MODULES[moduleKey], moduleKey).toBeTruthy();
      expect(MODULES[moduleKey].permissions?.length, moduleKey).toBeGreaterThan(0);
    }
  });

  it('cites only routes the registry has a module behind', () => {
    for (const [roleKey, route] of Object.entries(ROLE_LANDING)) {
      expect(MODULES[moduleForRoute(route)], `${roleKey} → ${route}`).toBeTruthy();
      expect(routeForModule(moduleForRoute(route))).toBe(route);
    }
  });
});
