// Single source of the entitlement vocabulary — @umi/contract/entitlements
// (zero-dep, so no zod enters this browser bundle; resolved via the Vite source
// alias). Re-exported to keep this module's public surface unchanged.
import { PRODUCT_ACTIVE_STATUSES } from '@umi/contract/entitlements';
export { PRODUCT_ACTIVE_STATUSES };

export const MODULES = {
  overview: {
    id: 'overview',
    label: 'Overview',
    icon: 'Home',
    section: 'OPERATIONS',
    product: 'dashboard',
  },
  orders: {
    id: 'orders',
    label: 'Pedidos',
    icon: 'Receipt',
    section: 'OPERATIONS',
    product: 'kds',
    locationScoped: true,
  },
  devices: {
    id: 'devices',
    label: 'Devices',
    icon: 'Tablet',
    section: 'OPERATIONS',
    product: 'kds',
    locationScoped: true,
  },
  staff: {
    id: 'staff',
    label: 'Staff & Access',
    icon: 'Users',
    section: 'OPERATIONS',
    product: 'dashboard',
  },
  customers: {
    id: 'customers',
    label: 'Customers',
    icon: 'Users2',
    section: 'OPERATIONS',
    product: 'dashboard',
  },
  members: {
    id: 'members',
    label: 'Loyalty',
    icon: 'CreditCard',
    section: 'GROWTH',
    product: 'cash',
  },
  'gift-cards': {
    id: 'gift-cards',
    label: 'Gift Cards',
    icon: 'Gift',
    section: 'GROWTH',
    product: 'cash',
  },
  hours: {
    id: 'hours',
    label: 'Hours & Availability',
    icon: 'Clock',
    section: 'CONFIGURATION',
    product: 'conversaflow',
    locationScoped: true,
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    icon: 'Settings',
    section: 'CONFIGURATION',
    product: 'dashboard',
  },
  'products-billing': {
    id: 'products-billing',
    label: 'Products & Billing',
    icon: 'Sparkles',
    section: 'CONFIGURATION',
    product: 'dashboard',
    role: 'super_admin',
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

export function hasRequiredRole(moduleConfig, capabilities) {
  if (!moduleConfig?.role) return true;
  const membership = capabilities?.membership;
  return membership?.role === moduleConfig.role || membership?.permissions?.includes?.('*');
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
  if (!hasRequiredRole(moduleConfig, capabilities)) {
    return {
      available: false,
      reason: 'role_required',
      role: moduleConfig.role,
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
