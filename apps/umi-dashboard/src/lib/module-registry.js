export const PRODUCT_ACTIVE_STATUSES = new Set(['active', 'trialing'])

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
}

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
]

export function isProductActive(productKey, capabilities) {
  const status = capabilities?.products?.[productKey]?.status
  return PRODUCT_ACTIVE_STATUSES.has(status)
}

export function hasRequiredRole(moduleConfig, capabilities) {
  if (!moduleConfig?.role) return true
  const membership = capabilities?.membership
  return membership?.role === moduleConfig.role || membership?.permissions?.includes?.('*')
}

export function getModuleAvailability(moduleKey, capabilities) {
  const moduleConfig = MODULES[moduleKey]
  if (!moduleConfig) {
    return { available: false, reason: 'unknown_module' }
  }
  if (!isProductActive(moduleConfig.product, capabilities)) {
    return {
      available: false,
      reason: 'product_missing',
      product: moduleConfig.product,
      locationScoped: !!moduleConfig.locationScoped,
    }
  }
  if (!hasRequiredRole(moduleConfig, capabilities)) {
    return {
      available: false,
      reason: 'role_required',
      role: moduleConfig.role,
      locationScoped: !!moduleConfig.locationScoped,
    }
  }
  return { available: true, locationScoped: !!moduleConfig.locationScoped }
}

export function buildModuleAvailability(capabilities) {
  return Object.fromEntries(
    MODULE_ORDER.map((moduleKey) => [moduleKey, getModuleAvailability(moduleKey, capabilities)])
  )
}

export function canShowModule(moduleKey, capabilities) {
  return getModuleAvailability(moduleKey, capabilities).available
}

export function getVisibleModules(capabilities) {
  return MODULE_ORDER
    .filter((moduleKey) => canShowModule(moduleKey, capabilities))
    .map((moduleKey) => MODULES[moduleKey])
}
