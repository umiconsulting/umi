import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';

const state = vi.hoisted(() => ({ capabilities: null }));

vi.mock('@/lib/merchant-context.jsx', () => ({
  useMerchant: () => ({ capabilities: state.capabilities }),
}));

vi.mock('@/data.jsx', () => ({
  useMerchantData: () => ({
    data: {
      rewardConfig: {
        rewardName: 'Café gratis',
        visitsRequired: 10,
        rewardDescription: 'Un café de la casa',
        upgrade: null,
      },
    },
  }),
}));

vi.mock('./cash-home.jsx', () => ({ default: () => 'Cash home body' }));
vi.mock('./cash-scan.jsx', () => ({ default: () => 'Cash scan body' }));
vi.mock('./members.jsx', () => ({ default: () => 'Members body' }));
vi.mock('./gift-cards.jsx', () => ({ default: () => 'Gift body' }));
vi.mock('./cash-settings.jsx', () => ({ default: () => 'Cash settings body' }));
vi.mock('./operations-workspace.jsx', () => ({ DomainWorkspace: () => null }));

import LoyaltyValueScreen from './loyalty-value.jsx';

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

function renderAt(path) {
  return renderToStaticMarkup(
    withI18n(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/loyalty-value/:tab?" element={<LoyaltyValueScreen />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

beforeEach(() => {
  state.capabilities = capabilitiesFor('owner');
});

describe('LoyaltyValueScreen routed tabs', () => {
  it('renders the tab the URL names for an allowed membership', () => {
    const markup = renderAt('/loyalty-value/gift-cards');
    expect(markup).toContain('Gift body');
    expect(markup).toContain('Tarjetas de regalo');
    expect(markup).toContain('Recompensa');
    expect(markup).toContain('10 visitas');
    expect(markup).not.toContain('data-permission-unavailable');
  });

  it('renders the member tab for the cashier', () => {
    state.capabilities = capabilitiesFor('cashier');
    const markup = renderAt('/loyalty-value/members');
    expect(markup).toContain('Members body');
    expect(markup).toContain('Lealtad');
  });

  it('refuses a direct gift-card URL for the viewer before the screen mounts', () => {
    state.capabilities = capabilitiesFor('viewer');
    const markup = renderAt('/loyalty-value/gift-cards');
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).toContain('No tienes acceso a');
    expect(markup).toContain('Tarjetas de regalo');
    expect(markup).not.toContain('Gift body');
  });

  it('does not offer the gift-card tab to the viewer', () => {
    state.capabilities = capabilitiesFor('viewer');
    const markup = renderAt('/loyalty-value/members');
    expect(markup).toContain('Members body');
    expect(markup).not.toContain('>Tarjetas de regalo<');
  });

  it('renders the Cash settings tab for a merchant.manage owner', () => {
    const markup = renderAt('/loyalty-value/settings');
    expect(markup).toContain('Cash settings body');
    expect(markup).toContain('Ajustes');
    expect(markup).not.toContain('data-permission-unavailable');
  });

  it('refuses the Cash settings tab before mount for a cashier', () => {
    state.capabilities = capabilitiesFor('cashier');
    const markup = renderAt('/loyalty-value/settings');
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).toContain('No tienes acceso a');
    expect(markup).not.toContain('Cash settings body');
  });

  it('renders the Cash home cockpit and QR scanner for allowed memberships', () => {
    const homeMarkup = renderAt('/loyalty-value/home');
    expect(homeMarkup).toContain('Cash home body');

    state.capabilities = capabilitiesFor('cashier');
    const scanMarkup = renderAt('/loyalty-value/scan');
    expect(scanMarkup).toContain('Cash scan body');
  });

  it('refuses the QR scanner tab before mount for a read-only viewer', () => {
    state.capabilities = capabilitiesFor('viewer');
    const markup = renderAt('/loyalty-value/scan');
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).not.toContain('Cash scan body');
  });

  it('shows only the summary its permissions support', () => {
    state.capabilities = {
      products: { cash: { status: 'active' } },
      membership: { role: 'wallet-reader', permissions: ['wallet.read'] },
    };
    const markup = renderAt('/loyalty-value/wallet');
    expect(markup).toContain('Secciones disponibles');
    expect(markup).toContain('Monedero');
    expect(markup).not.toContain('Recompensa');
  });
});
