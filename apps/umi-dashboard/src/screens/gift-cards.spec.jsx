import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';

const state = vi.hoisted(() => ({ merchant: null, giftCards: null }));

vi.mock('@/lib/merchant-context.jsx', () => ({
  useMerchant: () => state.merchant,
}));

vi.mock('@/data.jsx', () => ({
  useGiftCardsData: () => state.giftCards,
  issueGiftCard: vi.fn(),
  redeemGiftCardByCode: vi.fn(),
}));

import GiftCardsScreen from './gift-cards.jsx';

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

const loadedCards = {
  data: {
    giftCards: [
      {
        id: 'card-1',
        code: 'UMI-GIFT-0001',
        recipientName: 'Ana Torres',
        recipientEmail: 'ana@example.mx',
        amountCentavos: 50000,
        amountMXN: '$500.00',
        isRedeemed: false,
        createdAt: '2026-11-01T18:00:00.000Z',
      },
      {
        id: 'card-2',
        code: 'UMI-GIFT-0002',
        recipientName: 'Luis Paz',
        amountCentavos: 25000,
        amountMXN: '$250.00',
        isRedeemed: true,
        createdAt: '2026-10-20T18:00:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    totalPages: 1,
  },
  loading: false,
  error: null,
  errorStatus: null,
};

beforeEach(() => {
  state.giftCards = loadedCards;
});

describe('GiftCardsScreen permission surface', () => {
  it('lets the owner issue and redeem', () => {
    state.merchant = { capabilities: capabilitiesFor('owner') };
    const markup = renderToStaticMarkup(withI18n(<GiftCardsScreen />));
    expect(markup).toContain('Emitir tarjeta');
    expect(markup).toContain('Canjear');
    expect(markup).toContain('UMI-GIFT-0001');
    expect(markup).toContain('$500.00');
    expect(markup).not.toContain('Solo consulta');
  });

  it('right-aligns the amount header and the amount cells', () => {
    state.merchant = { capabilities: capabilitiesFor('owner') };
    const markup = renderToStaticMarkup(withI18n(<GiftCardsScreen />));
    expect(markup).toMatch(/<th class="cash-num">Monto<\/th>/);
    expect(markup).toMatch(/<td data-label="Monto" class="cash-num">/);
  });

  it('lets the cashier redeem but not issue', () => {
    state.merchant = { capabilities: capabilitiesFor('cashier') };
    const markup = renderToStaticMarkup(withI18n(<GiftCardsScreen />));
    expect(markup).toContain('Canjear');
    expect(markup).not.toContain('Emitir tarjeta');
    expect(markup).not.toContain('Solo consulta');
  });

  it('keeps the viewer read-only with a quiet hint', () => {
    state.merchant = { capabilities: capabilitiesFor('viewer') };
    const markup = renderToStaticMarkup(withI18n(<GiftCardsScreen />));
    expect(markup).toContain('Solo consulta');
    expect(markup).not.toContain('Emitir tarjeta');
    expect(markup).not.toContain('Canjear');
    expect(markup).toContain('UMI-GIFT-0001');
  });

  it('turns a 403 into a refusal instead of an empty table', () => {
    state.merchant = { capabilities: capabilitiesFor('viewer') };
    state.giftCards = {
      data: { giftCards: [], total: 0, page: 1, totalPages: 1 },
      loading: false,
      error: 'Permiso denegado',
      errorStatus: 403,
    };
    const markup = renderToStaticMarkup(withI18n(<GiftCardsScreen />));
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).not.toContain('No hay tarjetas de regalo emitidas');
  });
});
