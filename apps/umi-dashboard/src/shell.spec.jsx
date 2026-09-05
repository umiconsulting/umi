import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar, ProfileButton } from './shell.jsx';
import { withI18n } from '@/test/i18n.jsx';
import { msg } from '@lingui/core/macro';

describe('Dashboard shell accessibility', () => {
  it('uses native navigation buttons with the active page state', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        <Sidebar
          active="operations"
          onChange={() => {}}
          collapsed={false}
          onToggleCollapse={() => {}}
          merchantName="Café Piloto"
          navItems={[
            {
              id: 'operations',
              label: msg`Centro operativo`,
              icon: 'Activity',
              section: 'OPERACIONES',
            },
          ]}
        />,
      ),
    );
    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).not.toContain('role="button"');
  });
});

describe('Topbar profile button', () => {
  it('wears the operator initials and labels itself for a screen reader', () => {
    const markup = renderToStaticMarkup(
      withI18n(<ProfileButton name="Lucio Martínez" email="lucio@umi.mx" onClick={() => {}} />),
    );
    expect(markup).toContain('>LM<');
    expect(markup).toContain('aria-label="Tu perfil"');
  });

  it('marks the current page when the profile screen is active', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        <ProfileButton name="Lucio Martínez" email="lucio@umi.mx" active onClick={() => {}} />,
      ),
    );
    expect(markup).toContain('aria-current="page"');
  });
});
