import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Sidebar, ProfileMenu } from './shell.jsx';
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

describe('Topbar account menu', () => {
  it('wears the operator initials and opens an account menu for a screen reader', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        <ProfileMenu
          name="Lucio Martínez"
          email="lucio@umi.mx"
          onProfile={() => {}}
          onSignOut={() => {}}
        />,
      ),
    );
    expect(markup).toContain('>LM<');
    expect(markup).toContain('aria-label="Cuenta"');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('keeps the pill lit while the profile screen is active', () => {
    const markup = renderToStaticMarkup(
      withI18n(
        <ProfileMenu
          name="Lucio Martínez"
          email="lucio@umi.mx"
          active
          onProfile={() => {}}
          onSignOut={() => {}}
        />,
      ),
    );
    expect(markup).toContain('profile-toggle');
    expect(markup).toContain('active');
  });
});
