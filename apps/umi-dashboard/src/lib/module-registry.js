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
    label: 'Devices',
    icon: 'Tablet',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['device.enroll'],
    locationScoped: true,
  },
  staff: {
    id: 'staff',
    label: 'Staff & Access',
    icon: 'Users',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['merchant.manage'],
  },
  customers: {
    id: 'customers',
    label: 'Customers',
    icon: 'Users2',
    section: 'OPERATIONS',
    product: 'dashboard',
    permissions: ['customer.read'],
  },
  members: {
    id: 'members',
    label: 'Loyalty',
    icon: 'CreditCard',
    section: 'GROWTH',
    product: 'cash',
    permissions: ['loyalty.read'],
  },
  'gift-cards': {
    id: 'gift-cards',
    label: 'Gift Cards',
    icon: 'Gift',
    section: 'GROWTH',
    product: 'cash',
    permissions: ['gift_card.read'],
  },
  hours: {
    id: 'hours',
    label: 'Hours & Availability',
    icon: 'Clock',
    section: 'CONFIGURATION',
    product: 'conversaflow',
    permissions: ['merchant.manage'],
    locationScoped: true,
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    icon: 'Settings',
    section: 'CONFIGURATION',
    product: 'dashboard',
    permissions: ['merchant.manage'],
  },
  'products-billing': {
    id: 'products-billing',
    label: 'Products & Billing',
    icon: 'Sparkles',
    section: 'CONFIGURATION',
    product: 'dashboard',
    permissions: ['merchant.manage'],
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
];

export function isProductActive(productKey, capabilities) {
  const status = capabilities?.products?.[productKey]?.status;
  return PRODUCT_ACTIVE_STATUSES.has(status);
}

export function hasRequiredPermission(moduleConfig, capabilities) {
  if (!moduleConfig?.permissions?.length) return true;
  const permissions = capabilities?.membership?.permissions || [];
  return (
    permissions.includes('*') || moduleConfig.permissions.some((key) => permissions.includes(key))
  );
}

export function getModuleAvailability(moduleKey, capabilities) {
  const moduleConfig = MODULES[moduleKey];
  if (!moduleConfig) {
    return { available: false, reason: 'unknown_module' };
  }
  if (!isProductActive(moduleConfig.product, capabilities)) {
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

export function canShowModule(moduleKey, capabilities) {
  return getModuleAvailability(moduleKey, capabilities).available;
}

export function getVisibleModules(capabilities) {
  return MODULE_ORDER.filter((moduleKey) => canShowModule(moduleKey, capabilities)).map(
    (moduleKey) => MODULES[moduleKey],
  );
}
