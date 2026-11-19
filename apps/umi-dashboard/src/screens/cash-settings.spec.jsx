import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withI18n } from '@/test/i18n.jsx';
import CashSettingsScreen from './cash-settings.jsx';

const merchant = {
  primaryColor: '#1A5632',
  secondaryColor: '#E8C9A3',
  promoMessage: 'Doble sello',
  promoStartsAt: '2026-11-01T00:00:00.000Z',
  promoEndsAt: '2026-11-30T23:59:59.000Z',
  promoDays: '1,2',
  birthdayRewardEnabled: true,
  birthdayRewardName: 'Pastel',
  selfRegistration: true,
  topupEnabled: false,
  multiSealEnabled: true,
  passStyle: 'grid',
};

describe('CashSettingsScreen', () => {
  it('renders the Cash-owned fields without a pass-style control', () => {
    const markup = renderToStaticMarkup(withI18n(<CashSettingsScreen merchant={merchant} />));
    expect(markup).toContain('data-cash-settings');
    expect(markup).toContain('Ajustes de Cash');
    expect(markup).toContain('Color principal');
    expect(markup).toContain('Promoción');
    expect(markup).toContain('Cumpleaños');
    expect(markup).toContain('Autorregistro');
    expect(markup).toContain('Recargas del monedero');
    expect(markup).toContain('Sellos múltiples');
    expect(markup).toContain('Guardar cambios');
    expect(markup).not.toContain('passStyle');
  });

  it('shows a loading state before the merchant data resolves', () => {
    const markup = renderToStaticMarkup(withI18n(<CashSettingsScreen merchant={null} loading />));
    expect(markup).toContain('Cargando ajustes de Cash');
  });
});
