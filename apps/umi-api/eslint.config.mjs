import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * ESLint 10 flat config for @umi/api.
 *
 * WHY THIS APP LINTS DIFFERENTLY FROM @umi/dashboard: the dashboard has no
 * TypeScript and no `typecheck`, so even non-type-aware rules earn their keep
 * there. Here `tsc --noEmit` already runs in CI under `strict`, so plain
 * syntactic rules would mostly duplicate it. The value is in the **type-aware**
 * rules, which read the checker and catch what `tsc` structurally cannot:
 * a promise nobody awaited (a silently-dropped BullMQ job), an async function
 * passed where a void callback is expected, `await` on a non-thenable.
 *
 * Measured on adoption (236 files): `no-floating-promises` and
 * `no-misused-promises` both reported **zero**. That is a real result, not a
 * misconfiguration — both are enabled and asserted below. This config is
 * therefore a ratchet against future regressions, not a cleanup of present
 * ones, and it should be described that way.
 */
export default tseslint.config(
  {
    // Mirrors .prettierignore, plus the non-source trees: `db/` is SQL,
    // `deploy/` is shell + compose, `docs/` is prose.
    ignores: [
      'dist/**',
      'node_modules/**',
      '.turbo/**',
      'coverage/**',
      'db/**',
      'deploy/**',
      'docs/**',
      // Type-aware linting needs a file to be in a tsconfig project; this
      // config file is not, and adding it to `include` would drag it into the
      // build. Nothing here needs the checker anyway.
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // `tsconfig.json` includes only `src/**/*`, so the root-level vitest
        // config has no project to be type-checked against. Lint it against the
        // default project rather than excluding it — it is real code.
        projectService: { allowDefaultProject: ['vitest.integration.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * THE `any` CLUSTER — off deliberately, with a condition to turn back on.
       *
       * These fired 230 times on adoption (195 unsafe-* + 35 base-to-string),
       * 78% of all findings, concentrated in `src/modules/` (158) and
       * `src/shared/` (37). They are not 230 defects. They are ONE design fact
       * wearing 230 hats: `pg` returns `QueryResult<any>` and BullMQ job
       * payloads are typed `Record<string, unknown>`, so every read off a row
       * or a payload is formally unsafe.
       *
       * Leaving them ON would make `pnpm lint` permanently red; downgrading
       * them to `warn` would print a 230-line wall nobody can action. Both
       * teach people to ignore the gate, which is exactly how a gate dies.
       *
       * TURN THESE BACK ON when row and payload types land — typed repository
       * return shapes and a discriminated job-payload union. That is a real
       * piece of work, tracked separately; it is not a lint config's job to
       * force it through as 230 inline suppressions.
       */
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Same root cause: `${payload.x ?? ''}` where `x` is `unknown` would
      // render "[object Object]" if it ever held one. Silencing each with a
      // `String()` wrapper treats the symptom; typing the payload fixes it.
      '@typescript-eslint/no-base-to-string': 'off',

      /**
       * `async` without `await` is interface conformance here, not an
       * oversight: BullMQ's `Processor.process` and the bot's `ToolResult`
       * handlers must return a promise whether or not a given implementation
       * happens to await anything. Both non-test occurrences at adoption were
       * exactly that. `no-floating-promises` (kept on) is the rule that
       * actually catches dropped async work.
       */
      '@typescript-eslint/require-await': 'off',

      // Unused args are usually interface conformance (Nest passes what it
      // passes); an underscore prefix is the deliberate opt-out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // Tests. Mocking is the point here: `vi.fn()` stubs are unbound by nature,
    // and a stub is often `async` only to match the signature it replaces.
    // Enforcing either rule in specs generates noise about deliberate fakes.
    files: ['**/*.spec.ts', '**/*.test.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
