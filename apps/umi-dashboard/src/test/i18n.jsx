import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { messages as es } from '@/locales/es/messages.mjs';
import { messages as en } from '@/locales/en/messages.mjs';

/**
 * Test-side locale setup. `pretest` compiles the catalogs, so the specs read the
 * same messages the app ships. Call `activateTestLocale('en')` to assert English.
 */
i18n.load({ es, en });
i18n.activate('es');

export function activateTestLocale(locale = 'es') {
  i18n.activate(locale);
}

export function withI18n(element) {
  return <I18nProvider i18n={i18n}>{element}</I18nProvider>;
}

export { i18n };
