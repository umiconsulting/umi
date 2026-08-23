// Single source of the entitlement vocabulary — @umi/contract/entitlements
// (zero-dep, so no zod enters this browser bundle; resolved via the Vite source
// alias). Re-exported to keep this module's public surface unchanged.
import { PRODUCT_ACTIVE_STATUSES } from '@umi/contract/entitlements';
export { PRODUCT_ACTIVE_STATUSES };

export const MODULES = {
  overview: {
    id: 'overview',
    label: 'Resumen',
    icon: 'Home',
    section: 'OPERATIONS',
    product: 'dashboard',
  },
  operations: {
    id: 'operations',
    label: 'Centro operativo',
    icon: 'Activity',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: [
      'merchant.manage',
      'audit.read',
      'hardware.read',
      'hardware.diagnostics',
      'inventory.read',
      'sale.lifecycle',
      'sale.exception.read',
      'cash.shift.read',
      'customer.read',
      'loyalty.read',
      'wallet.read',
      'gift_card.read',
      'kitchen.read',
      'device.enroll',
      'catalog.read',
    ],
    locationScoped: true,
  },
  orders: {
    id: 'orders',
    label: 'Pedidos',
    icon: 'Receipt',
    section: 'OPERATIONS',
    product: 'kds',
    permissions: ['kitchen.read'],
    locationScoped: true,
  },
  devices: {
    id: 'devices',
    label: 'Dispositivos',
    icon: 'Tablet',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['device.enroll'],
    locationScoped: true,
  },
  staff: {
    id: 'staff',
    label: 'Equipo y accesos',
    icon: 'Users',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['merchant.manage'],
  },
  customers: {
    id: 'customers',
    label: 'Clientes',
    icon: 'Users2',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['customer.read'],
  },
  members: {
    id: 'members',
    label: 'Lealtad',
    icon: 'CreditCard',
    section: 'GROWTH',
    product: 'cash',
    permissions: ['loyalty.read'],
  },
  'gift-cards': {
    id: 'gift-cards',
    label: 'Tarjetas de regalo',
    icon: 'Gift',
    section: 'GROWTH',
    product: 'cash',
    permissions: ['gift_card.read'],
  },
  hours: {
    id: 'hours',
    label: 'Horarios',
    icon: 'Clock',
    section: 'CONFIGURATION',
    product: 'conversaflow',
    permissions: ['merchant.manage'],
    locationScoped: true,
  },
  settings: {
    id: 'settings',
    label: 'Ajustes',
    icon: 'Settings',
    section: 'CONFIGURATION',
    product: 'dashboard',
    permissions: ['merchant.manage'],
  },
  'products-billing': {
    id: 'products-billing',
    label: 'Productos y facturación',
    icon: 'Sparkles',
    section: 'CONFIGURATION',
    product: 'dashboard',
    // PLATFORM, not café. This said `role: 'super_admin'`, which asks
    // `hasRequiredRole` — and that reads `capabilities.membership.role`, a CAFÉ role
    // of owner/admin/staff/viewer. `umi.role` marks super_admin `is_platform` and no
    // membership carries it, so the check could only ever pass through the
    // `permissions.includes('*')` escape hatch, and nothing produces '*' any more.
    //
    // REACHABLE, and today MASKED — worth stating both ways round. The one platform
    // operator is also `staff` at Umi Cafe, and `findMembershipAccess` COALESCEs, so a
    // café grant REPLACES the platform role in `roles`: selecting that café left her
    // normalized role as `staff` and this screen refused her. It did not SHOW as this
    // bug only because Umi Cafe holds no entitlements, so the product gate above
    // refused her first. Give that café a subscription — or give any operator a job at
    // an entitled one — and the screen starts appearing and disappearing with the
    // switcher.
    platform: 'super_admin',
  },
  cafes: {
    id: 'cafes',
    label: 'Cafés',
    // Its own section because it is the one screen NOT scoped to the café in the
    // switcher — it opens new ones. Filing it under CONFIGURATION would say it
    // configures the selected café, which is the opposite of what it does.
    section: 'PLATFORM',
    icon: 'Store',
    // No `product`: a platform screen is not entitled per café. `platform` is a
    // different axis from `role`, which reads the CAFÉ membership.
    platform: 'super_admin',
  },
};

export const MODULE_ORDER = [
  'overview',
  'operations',
  'orders',
  'devices',
  'staff',
  'customers',
  'members',
  'gift-cards',
  'hours',
  'settings',
  'products-billing',
  // Last, and in its own section: the platform sits outside the café hierarchy.
  'cafes',
];

export function isProductActive(productKey, capabilities) {
  const status = capabilities?.products?.[productKey]?.status;
  return PRODUCT_ACTIVE_STATUSES.has(status);
}

/**
 * Does this login hold the PLATFORM grant the module asks for?
 *
 * ⚠️ A DIFFERENT AXIS FROM `hasRequiredRole`, which reads the café membership
 * (`capabilities.membership.role`). A platform operator who also works at one
 * café carries her CAFÉ role there, so the membership check hides a platform
 * screen from exactly the person it is for. The session says the grant outright
 * (`SessionEnvelope.platformRole`); this reads that.
 */
export function hasPlatformGrant(moduleConfig, platformRole) {
  if (!moduleConfig?.platform) return true;
  return platformRole === moduleConfig.platform;
}

/**
 * The CAFÉ-role gate. Correct, and currently unused — `products-billing` was its only
 * caller and named a PLATFORM grant, which `hasPlatformGrant` above answers instead.
 *
 * Kept because a café-role gate is a real thing a module may want. ⚠️ The value
 * belongs to owner/admin/staff/viewer. A platform grant does not go here, however much
 * the word "role" invites it.
 */
export function hasRequiredRole(moduleConfig, capabilities) {
  if (!moduleConfig?.role) return true;
  const membership = capabilities?.membership;
  return membership?.role === moduleConfig.role || membership?.permissions?.includes?.('*');
}

/**
 * The PERMISSION gate, and the one the POS/operations modules use: a module names
 * the `umi.permission` keys that open it, and the café membership must hold one.
 * A third axis beside `role` (café role) and `platform` (platform grant).
 */
export function hasRequiredPermission(moduleConfig, capabilities) {
  if (!moduleConfig?.permissions?.length) return true;
  const permissions = capabilities?.membership?.permissions || [];
  return (
    permissions.includes('*') || moduleConfig.permissions.some((key) => permissions.includes(key))
  );
}

export function getModuleAvailability(moduleKey, capabilities, platformRole = null) {
  const moduleConfig = MODULES[moduleKey];
  if (!moduleConfig) {
    return { available: false, reason: 'unknown_module' };
  }
  if (!hasPlatformGrant(moduleConfig, platformRole)) {
    return { available: false, reason: 'platform_grant_required', platform: moduleConfig.platform };
  }
  // A platform module names no product; it is not entitled per café.
  if (moduleConfig.product && !isProductActive(moduleConfig.product, capabilities)) {
    return {
      available: false,
      reason: 'product_missing',
      product: moduleConfig.product,
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  if (!hasRequiredPermission(moduleConfig, capabilities)) {
    return {
      available: false,
      reason: 'permission_required',
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  return { available: true, locationScoped: !!moduleConfig.locationScoped };
}

export function buildModuleAvailability(capabilities) {
  return Object.fromEntries(
    MODULE_ORDER.map((moduleKey) => [moduleKey, getModuleAvailability(moduleKey, capabilities)]),
  );
}

export function canShowModule(moduleKey, capabilities, platformRole = null) {
  return getModuleAvailability(moduleKey, capabilities, platformRole).available;
}

export function getVisibleModules(capabilities, platformRole = null) {
  return MODULE_ORDER.filter((moduleKey) =>
    canShowModule(moduleKey, capabilities, platformRole),
  ).map((moduleKey) => MODULES[moduleKey]);
}
