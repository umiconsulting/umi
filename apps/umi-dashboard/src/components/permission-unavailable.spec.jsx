import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PermissionUnavailable from './permission-unavailable.jsx';
import { withI18n } from '@/test/i18n.jsx';

describe('PermissionUnavailable', () => {
  it('names the section and the missing authority instead of saying the product is off', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        <PermissionUnavailable
          title="Tarjetas de regalo"
          permissions={['gift_card.read']}
          backLabel="Lealtad"
          onBack={() => {}}
        />,
      ),
    );
    expect(markup).toContain('data-permission-unavailable');
    expect(markup).toContain('No tienes acceso a');
    expect(markup).toContain('Tarjetas de regalo');
    expect(markup).toContain('Consultar tarjetas de regalo');
    expect(markup).toContain('Ir a Lealtad');
    expect(markup).not.toContain('no está activo en este café');
  });

  it('does not draw a back command when there is no safe route', () => {
    const markup = renderToStaticMarkup(
      withI18n(<PermissionUnavailable title="Lealtad y valor" permissions={[]} />),
    );
    expect(markup).toContain('No tienes acceso a');
    expect(markup).not.toContain('<button');
  });

  it('leaves the refusal inert: no data and no callback on render', () => {
    const onBack = vi.fn();
    const markup = renderToStaticMarkup(
      withI18n(
        <PermissionUnavailable
          title="Lealtad"
          permissions={['loyalty.read']}
          backLabel="Monedero"
          onBack={onBack}
        />,
      ),
    );
    expect(onBack).not.toHaveBeenCalled();
    expect(markup).not.toContain('Teléfono');
  });
});
