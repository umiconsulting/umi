import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

/**
 * Lingui catalog layout for the dashboard.
 *
 * Spanish is the source locale: the message text lives in the JSX, in Spanish,
 * and the extractor writes it to `src/locales/es/messages.po` as the reference.
 * English is the first translated locale. Add a locale by adding its tag here,
 * then run `pnpm i18n:extract` and translate the new `.po` file.
 *
 * The compiled `messages.mjs` files are build artifacts. `pnpm i18n:compile`
 * writes them, and the `pre*` scripts run it before dev, build, and test.
 */
export default defineConfig({
  sourceLocale: 'es',
  locales: ['es', 'en'],
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}/messages',
      include: ['<rootDir>/src'],
      exclude: ['**/*.spec.*', '**/node_modules/**'],
    },
  ],
  format: formatter({ lineNumbers: false }),
  compileNamespace: 'es',
  orderBy: 'origin',
});
