import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

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

  // Build/config files run in Node, not the browser.
  {
    files: ['vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
];
