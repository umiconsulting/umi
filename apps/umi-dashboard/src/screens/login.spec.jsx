import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LoginScreen from './login.jsx';
import { withI18n } from '@/test/i18n.jsx';

const render = () =>
  renderToStaticMarkup(
    withI18n(
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>,
    ),
  );

describe('login screen — liquid glass + ASCII scene', () => {
  it('renders the goldfish scene and the glass control inside the login shell', () => {
    const markup = render();
    expect(markup).toContain('login-wrap login-wrap--goldfish');
    expect(markup).toContain('login-goldfish');
    expect(markup).toContain('login-glass-settings');
    expect(markup).toContain('Vidrio');
  });

  it('keeps the credential form and its native fields', () => {
    const markup = render();
    expect(markup).toContain('id="login-email"');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('id="login-pw"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('Hola de nuevo');
  });

  it('has dropped the old brand description that the goldfish scene replaced', () => {
    expect(render()).not.toContain('Supervisa la operación de tu negocio al momento');
  });
});
