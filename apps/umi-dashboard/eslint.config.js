import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import lingui from 'eslint-plugin-lingui';

/**
 * ESLint 10 flat config for @umi/dashboard.
 *
 * WHY THIS APP FIRST: it is plain JSX with no TypeScript, no `typecheck` script and
 * no tests — 21 .jsx + 3 .js files with ZERO static analysis of any kind. Everywhere
 * else in the monorepo `tsc --noEmit` is the safety net, so linting only adds value
 * where it is type-aware; here there is no net at all, so even non-type-aware rules
 * (undefined variables, unused bindings, broken hook dependencies) have high marginal
 * value. No type-aware rules are configured, because there are no types to read.
 *
 * ESLint 10 (not 9): v9 reaches EOL 2026-08-06, and the plugin set here already
 * declares `eslint ^10` in its peers.
 */
export default [
  // Mirrors .prettierignore. `.vercel/` matters most: the deploy output contains a
  // minified bundle and a generated server.js which together produced 200 of 244
  // findings on the first run — linting build artifacts would leave `pnpm lint`
  // permanently red on code nobody wrote, which is how a gate gets ignored.
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      '.vercel/**',
      '.turbo/**',
      'coverage/**',
      'src/locales/**/*.mjs', // compiled Lingui catalogs
    ],
  },

  js.configs.recommended,

  // Application source — browser runtime, JSX syntax, ES modules.
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // React hook correctness — the rules that catch real runtime bugs (stale closures,
  // conditional hooks) which no compiler or type checker would report.
  // NOTE: `configs['recommended-latest']` is the legacy eslintrc export (its `plugins`
  // is an array of strings, which flat config rejects). The flat variants live under
  // `configs.flat.*`.
  { files: ['**/*.{js,jsx}'], ...reactHooks.configs.flat['recommended-latest'] },

  // Vite fast-refresh only works when a module exports components consistently.
  {
    files: ['**/*.jsx'],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Every string an owner can read must go through Lingui. The rule ignores the
  // attributes and shapes that are code, not copy (class names, ids, keys, colours,
  // ALL-CAPS constants, single tokens), and it stays off the specs and the dev-only
  // tweaks panel. `lingui/recommended` adds the macro-usage rules.
  { files: ['src/**/*.{js,jsx}'], ...lingui.configs['flat/recommended'] },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: [
      '**/*.spec.*',
      'src/tweaks-panel.jsx',
      'src/test/**',
      'src/locales/**',
      'src/lib/build-config.js', // build-time validation, read by a developer in a terminal
    ],
    plugins: { lingui },
    rules: {
      // Positional placeholders ({0}) are accepted here: the source text stays readable
      // in the JSX and the extractor writes the expression as a comment for translators.
      'lingui/no-expression-in-message': 'off',
      'lingui/no-unlocalized-strings': [
        'error',
        {
          ignore: [
            '^(?![A-Z])\\S+$', // one token that does not start with a capital: keys, urls, css
            '^[A-Z0-9_\\-–—·•.…/ ]+$', // ALL-CAPS constants and punctuation-only strings
            '^[^a-zA-Z]*$', // no letters at all: numbers, symbols, whitespace
            '^\\$', // currency glyphs and similar
            '^(Umi|UmiPOS|UmiKDS|Umi Cash|Umi Dash|Umi Dashboard|ConversaFlow|KDS|POS|WhatsApp|Wallet|Apple Wallet|Google Wallet|iPad|iOS|macOS|Linux|Windows|Android|Web|Owner Console|UMI DASH|MXN|SKU|OW|UC|UN|X|UMI)$',
            '^(America|Europe|Asia)/',
            '^\\+52',
            '^oklch|^rgba|^var\\(|^linear-gradient|^#|^\\d',
            '^Error$',
            '^T\\d{2}:\\d{2}', // ISO time suffixes
            '^\\(prefers-color-scheme',
            '^America / ', // IANA zone names shown as-is
            '^\\s*(umi|· dash|Umi|Midnight)\\s*$', // brand and theme names
          ],
          ignoreNames: [
            { regex: { pattern: 'className', flags: 'i' } },
            {
              regex: {
                pattern:
                  '^(id|key|type|role|href|src|srcSet|name|value|htmlFor|autoComplete|inputMode|pattern|viewBox|d|fill|stroke|strokeWidth|strokeLinecap|strokeLinejoin|x|y|x1|x2|y1|y2|cx|cy|r|rx|width|height|opacity|transform|preserveAspectRatio|method|mode|section|icon|product|platform|domain|status|kind|cls|tone|accent|color|background|border|borderColor|style|dial|status|state|position|display|alignItems|justifyContent|flexDirection|textAlign|fontFamily|fontWeight|textTransform|whiteSpace|overflow|textOverflow|cursor|transition|flexWrap|alignSelf|letterSpacing|gridTemplateColumns|gridColumn|borderRadius|padding|margin|boxShadow|appearance|accentColor|placeholder_never|lang|dir|target|rel|to|path|from|reason|action|op|sort|filter|channel|direction|exceptionType|operation|routeType|assignmentPolicy|posPlatform|posMobility|mobility|deviceProduct|scope|priority|passStyle|tag|bcp47|label_never|STORAGE_KEY|REMEMBER_KEY|DEFAULT_LOCALE|LOCAL_SESSION_KEY|SELECTED_MERCHANT_KEY|SELECTED_LOCATION_KEY)$',
              },
            },
            { regex: { pattern: '^[A-Z0-9_]+$' } },
            {
              regex: {
                pattern:
                  '^(aria-hidden|aria-modal|aria-current|aria-selected|aria-pressed|aria-describedby|aria-labelledby|data-.*)$',
              },
            },
          ],
          ignoreFunctions: [
            'console.*',
            '*.addEventListener',
            '*.removeEventListener',
            '*.setProperty',
            '*.getItem',
            '*.setItem',
            '*.removeItem',
            '*.querySelector',
            '*.includes',
            '*.startsWith',
            '*.endsWith',
            '*.split',
            '*.join',
            '*.replace',
            '*.replaceAll',
            '*.padStart',
            '*.dispatchEvent',
            '*.postMessage',
            'apiUrl',
            'fetch',
            'navigate',
            'useState',
            'useStateD',
            'useTranslation',
            'msg',
            't',
            'i18n._',
            'defineMessage',
            'Error',
            'new Error',
            'Set',
            'Map',
            'Symbol',
            'Intl.*',
            'Object.*',
            'Array.*',
            'JSON.*',
            'String',
            'Number',
            'RegExp',
            'test',
            'exec',
            'match',
            'require',
            'import',
            'setTweak',
            'setProperty',
            'assetPath',
            'normalizeAssetUrl',
            'command.execute',
            'command.requestApproval',
            'command.recover',
            'execute',
            'requestApproval',
            'formatNumber',
            'formatMoney',
            'formatMoneyUnits',
            'formatDate',
            'formatTime',
            'formatDateTime',
            'localeTag',
            'toSupportedLocale',
            'activateLocale',
          ],
        },
      ],
    },
  },

  // Build/config files run in Node, not the browser.
  {
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
