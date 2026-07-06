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
  role?: string;
}

export interface CapabilitiesShape {
  products?: Record<string, { status?: string } | undefined>;
  membership?: { role?: string | null; permissions?: string[] };
}

export const MODULES: Record<string, ModuleConfig> = {
  overview: { id: 'overview', label: 'Overview', icon: 'Home', section: 'OPERATIONS', product: 'dashboard' },
  orders: { id: 'orders', label: 'Pedidos', icon: 'Receipt', section: 'OPERATIONS', product: 'kds', locationScoped: true },
  devices: { id: 'devices', label: 'Devices', icon: 'Tablet', section: 'OPERATIONS', product: 'kds', locationScoped: true },
  staff: { id: 'staff', label: 'Staff & Access', icon: 'Users', section: 'OPERATIONS', product: 'dashboard' },
  customers: { id: 'customers', label: 'Customers', icon: 'Users2', section: 'OPERATIONS', product: 'dashboard' },
  members: { id: 'members', label: 'Loyalty', icon: 'CreditCard', section: 'GROWTH', product: 'cash' },
  'gift-cards': { id: 'gift-cards', label: 'Gift Cards', icon: 'Gift', section: 'GROWTH', product: 'cash' },
  hours: { id: 'hours', label: 'Hours & Availability', icon: 'Clock', section: 'CONFIGURATION', product: 'conversaflow', locationScoped: true },
  settings: { id: 'settings', label: 'Settings', icon: 'Settings', section: 'CONFIGURATION', product: 'dashboard' },
  'products-billing': { id: 'products-billing', label: 'Products & Billing', icon: 'Sparkles', section: 'CONFIGURATION', product: 'dashboard', role: 'super_admin' },
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
] as const;

export type ModuleAvailability =
  | { available: true; locationScoped: boolean }
  | { available: false; reason: string; product?: string; role?: string; locationScoped?: boolean };

function isProductActive(productKey: string, cap: CapabilitiesShape): boolean {
  const status = cap.products?.[productKey]?.status;
  return isProductStatusActive(status);
}

function hasRequiredRole(moduleConfig: ModuleConfig, cap: CapabilitiesShape): boolean {
  if (!moduleConfig.role) return true;
  const membership = cap.membership;
  return (
    membership?.role === moduleConfig.role ||
    !!membership?.permissions?.includes('*')
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
  if (!hasRequiredRole(moduleConfig, cap)) {
    return {
      available: false,
      reason: 'role_required',
      role: moduleConfig.role,
      locationScoped: !!moduleConfig.locationScoped,
    };
  }
  return { available: true, locationScoped: !!moduleConfig.locationScoped };
}

export function buildModuleAvailability(
  cap: CapabilitiesShape,
): Record<string, ModuleAvailability> {
  return Object.fromEntries(
    MODULE_ORDER.map((key) => [key, getModuleAvailability(key, cap)]),
  );
}
