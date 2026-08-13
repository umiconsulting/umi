import { describe, expect, it } from 'vitest';
import { getModuleAvailability, getVisibleModules } from './module-registry.js';

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
    const labels = getVisibleModules(capabilities(['customer.read'])).map((item) => item.label);
    expect(labels).toContain('Clientes');
    expect(labels).not.toContain('Customers');
  });
});
