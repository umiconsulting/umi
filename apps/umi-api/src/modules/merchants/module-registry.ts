/**
 * Dashboard module availability — ported verbatim from
 * `apps/umi-dashboard/src/lib/module-registry.js`. The frontend uses the
 * `modules` map in the capabilities response to decide what to render, so the
 * keys/sections/reasons must match exactly.
 */
import { isProductStatusActive } from '@umi/contract';

export interface ModuleConfig {
  id: string;
  label: string;
  icon: string;
  section: 'OPERATIONS' | 'GROWTH' | 'CONFIGURATION';
  product: string;
  locationScoped?: boolean;
  /** The CAFÉ-role gate (owner/admin/staff/viewer). See `hasRequiredRole`. */
  role?: string;
  /** The permission-key gate the POS/operations modules use. See `hasRequiredPermission`. */
  permissions?: string[];
}

export interface CapabilitiesShape {
  products?: Record<string, { status?: string } | undefined>;
  membership?: { role?: string | null; permissions?: string[] };
}

export const MODULES: Record<string, ModuleConfig> = {
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
    // NO `role` HERE, deliberately. This screen is for a PLATFORM operator, and a
    // platform grant is not a café role — `umi.role` marks super_admin `is_platform`
    // and no membership carries it. Gating it here read the café axis for a value
    // that only appears on the platform one, so the screen hid from the person it is
    // for. The client decides it, from `SessionEnvelope.platformRole`; this map has
    // no platform-role input and must not pretend to answer.
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
] as const;

export type ModuleAvailability =
  | { available: true; locationScoped: boolean }
  | { available: false; reason: string; product?: string; locationScoped?: boolean };

function isProductActive(productKey: string, cap: CapabilitiesShape): boolean {
  const status = cap.products?.[productKey]?.status;
  return isProductStatusActive(status);
}

/**
 * The CAFÉ-role gate. Correct, and currently unused — `products-billing` was its only
 * caller and named a PLATFORM grant, which is a different axis (see that entry).
 *
 * Kept rather than deleted because a café-role gate is a real thing a module may want
 * (only an owner sees payroll, say). ⚠️ If you reach for it, the value belongs to
 * owner/admin/staff/viewer. A platform grant does not go here, however much the word
 * "role" invites it.
 */
function hasRequiredRole(moduleConfig: ModuleConfig, cap: CapabilitiesShape): boolean {
  if (!moduleConfig.role) return true;
  const membership = cap.membership;
  return membership?.role === moduleConfig.role || !!membership?.permissions?.includes('*');
}

/**
 * The PERMISSION gate, and the one the POS/operations modules use: a module names
 * the `umi.permission` keys that open it, and the café membership must hold one.
 * A third axis beside `role` (café role) and `platform` (platform grant).
 */
function hasRequiredPermission(moduleConfig: ModuleConfig, cap: CapabilitiesShape): boolean {
  if (!moduleConfig.permissions?.length) return true;
  const permissions = cap.membership?.permissions ?? [];
  return (
    permissions.includes('*') || moduleConfig.permissions.some((key) => permissions.includes(key))
  );
}

export function getModuleAvailability(
  moduleKey: string,
  cap: CapabilitiesShape,
): ModuleAvailability {
  const moduleConfig = MODULES[moduleKey];
  if (!moduleConfig) return { available: false, reason: 'unknown_module' };
  if (!isProductActive(moduleConfig.product, cap)) {
    return {
      available: false,
      reason: 'product_missing',
      product: moduleConfig.product,
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  // Three gates, three axes. The café role (build-v3; unused by any module today,
  // kept for the one that will want it), then the permission keys (the POS and
  // operations modules). The PLATFORM grant is not decided here — the client reads
  // it off `SessionEnvelope.platformRole`; see the products-billing entry.
  if (!hasRequiredRole(moduleConfig, cap)) {
    return {
      available: false,
      reason: 'role_required',
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  if (!hasRequiredPermission(moduleConfig, cap)) {
    return {
      available: false,
      reason: 'permission_required',
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  return { available: true, locationScoped: !!moduleConfig.locationScoped };
}

export function buildModuleAvailability(
  cap: CapabilitiesShape,
): Record<string, ModuleAvailability> {
  return Object.fromEntries(MODULE_ORDER.map((key) => [key, getModuleAvailability(key, cap)]));
}
