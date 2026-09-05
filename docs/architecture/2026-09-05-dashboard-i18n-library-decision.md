# Dashboard internationalization: library decision

Date: 2026-09-05
Scope: `apps/umi-dashboard`
Status: accepted and implemented

## Decision

Use **Lingui** (`@lingui/core`, `@lingui/react`, `@lingui/cli`, `@lingui/babel-plugin-lingui-macro`)
for the owner dashboard. Spanish is the source locale. English is the first translated locale.

## Constraints that shaped the decision

- The dashboard is plain React 18 + Vite 5.4 JSX. It has no TypeScript.
- About 870 owner-facing strings lived inline, in Spanish, across 21 screen files.
- UmiPOS already localizes with Flutter `gen-l10n` and ARB files. ARB uses ICU MessageFormat.
- The merchant record carries a `locale` column (`es-MX` by default).
- The repo lint gate (`check:lint-warnings`) rejects new warning categories.

## Candidates and facts

| Library                       | Message syntax                                                                                  | Runtime size                            | Build step                              | Plain JS                        | Source                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| Lingui 6.6                    | ICU                                                                                             | about 2 kB, no parser at runtime        | Babel macro plugin, `lingui compile`    | Yes                             | lingui.dev/introduction, lingui.dev/tutorials/setup-vite   |
| react-i18next 17 / i18next 26 | Own JSON format; ICU only through `i18next-icu`, which removes native plurals and interpolation | about 8 kB core, 20 kB+ with plugins    | None required                           | Yes                             | i18next.com/overview/plugins-and-utils                     |
| react-intl 10                 | ICU                                                                                             | Ships the ICU parser unless precompiled | Babel plugin required for generated ids | Yes                             | formatjs.github.io/docs/getting-started/message-extraction |
| Paraglide JS 2.25             | Pluggable                                                                                       | Tree-shaken per message                 | Vite plugin                             | Peer requires TypeScript >= 5.6 | npm registry peerDependencies, paraglidejs.com/comparison  |

Decision basis:

- **Documented fact:** Lingui macros keep the source text in the JSX and extract it with generated
  ids. This is the smallest diff for a codebase that already contains all the Spanish copy.
- **Documented fact:** Lingui uses ICU MessageFormat. The POS ARB catalogs use ICU too. One message
  syntax for all Umi products keeps translator tooling and review the same.
- **Documented fact:** Lingui compiles catalogs ahead of time. The runtime carries no parser.
- **Documented fact:** `eslint-plugin-lingui` ships `no-unlocalized-strings`. It is the gate that
  keeps the dashboard fully localized as screens change.
- **Documented fact:** `@lingui/vite-plugin` 6 requires Vite >= 6.3. The dashboard is on Vite 5.
  The plugin is optional. `lingui compile` writes plain ES modules that Vite 5 imports normally.
- **Source-backed tradeoff:** react-i18next has the largest ecosystem, but its native format is not
  ICU, and the ICU plugin disables its native features. Keys would replace the readable Spanish
  text at every call site.
- **Source-backed tradeoff:** react-intl matches ICU but ships a runtime parser unless every message
  is precompiled, and generated ids need the Babel plugin anyway.
- **Umi-specific inference:** Paraglide is TypeScript-first and has no first-party React binding.
  The dashboard is plain JS with a tiny team; the fit is poor.

## Consequences

- `pnpm i18n:extract` updates `src/locales/{es,en}/messages.po`. `pnpm i18n:compile` writes
  `messages.mjs` (gitignored). `predev`, `prebuild`, and `pretest` compile automatically.
- `prebuild` runs `lingui compile --strict`, so a missing English translation fails the build.
- `lingui/no-unlocalized-strings` runs as an error in `pnpm lint` for `src/**`.
- A new locale is one entry in `lingui.config.js` and `src/lib/i18n.js`, plus one `.po` file.
