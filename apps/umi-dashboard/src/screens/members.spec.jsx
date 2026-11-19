import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';

const state = vi.hoisted(() => ({ merchant: null, members: null }));

vi.mock('@/lib/merchant-context.jsx', () => ({
  useMerchant: () => state.merchant,
}));

vi.mock('@/data.jsx', () => ({
  useMembersData: () => state.members,
  registerMember: vi.fn(),
}));

import MembersScreen from './members.jsx';

const roleGrants = JSON.parse(
  readFileSync(new URL('../../../../config/umipos-pilot-role-grants.json', import.meta.url)),
);

function capabilitiesFor(role) {
  const profile = roleGrants.profiles.find((item) => item.role === role);
  return {
    products: { cash: { status: 'active' } },
    membership: { role, permissions: profile.permissions },
  };
}

const loadedMembers = {
  data: {
    customers: [
      {
        id: 'member-1',
        name: 'Ana Torres',
        phone: '+52 55 1234 5678',
        email: 'ana@example.mx',
        cardNumber: 'UMI-0042',
        balanceCentavos: 12345,
        totalVisits: 4,
        visitsThisCycle: 3,
        visitsRequired: 10,
        pendingRewards: 1,
        lastVisit: '2026-11-10T18:00:00.000Z',
        createdAt: '2026-01-10T18:00:00.000Z',
        ltvMXN: '$1,200',
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  },
  loading: false,
  error: null,
  errorStatus: null,
};

beforeEach(() => {
  state.members = loadedMembers;
});

describe('MembersScreen permission surface', () => {
  it('lets the owner register and shows the contact phone', () => {
    state.merchant = { capabilities: capabilitiesFor('owner') };
    const markup = renderToStaticMarkup(withI18n(<MembersScreen />));
    expect(markup).toContain('Miembros activos');
    expect(markup).toContain('Registrar miembro');
    expect(markup).toContain('+52 55 1234 5678');
    expect(markup).toContain('3/10');
    expect(markup).not.toContain('Contacto restringido');
  });

  it('lets the cashier register but masks the contact data', () => {
    state.merchant = { capabilities: capabilitiesFor('cashier') };
    const markup = renderToStaticMarkup(withI18n(<MembersScreen />));
    expect(markup).toContain('Registrar miembro');
    expect(markup).toContain('Contacto restringido');
    expect(markup).not.toContain('+52 55 1234 5678');
  });

  it('keeps the viewer read-only and masks the contact data', () => {
    state.merchant = { capabilities: capabilitiesFor('viewer') };
    const markup = renderToStaticMarkup(withI18n(<MembersScreen />));
    expect(markup).toContain('Solo consulta');
    expect(markup).not.toContain('Registrar miembro');
    expect(markup).toContain('Contacto restringido');
    expect(markup).toContain('Ana Torres');
    expect(markup).toContain('3/10');
  });

  it('trusts the server contactRestricted flag even when the capability allows contact', () => {
    state.merchant = { capabilities: capabilitiesFor('owner') };
    state.members = {
      ...loadedMembers,
      data: {
        ...loadedMembers.data,
        customers: [
          {
            ...loadedMembers.data.customers[0],
            phone: null,
            email: null,
            contactRestricted: true,
          },
        ],
      },
    };
    const markup = renderToStaticMarkup(withI18n(<MembersScreen />));
    expect(markup).toContain('Contacto restringido');
    expect(markup).not.toContain('+52 55 1234 5678');
  });

  it('turns a 403 into a refusal instead of an empty member list', () => {
    state.merchant = { capabilities: capabilitiesFor('viewer') };
    state.members = {
      data: { customers: [], total: 0, page: 1, totalPages: 1 },
      loading: false,
      error: 'Permiso denegado',
      errorStatus: 403,
    };
    const markup = renderToStaticMarkup(withI18n(<MembersScreen />));
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).not.toContain('Sin miembros en este filtro');
  });
});
