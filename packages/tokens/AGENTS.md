# Umi Design Tokens Package

Read root `AGENTS.md` first. This contract applies to `packages/tokens`.

## Ownership

- Owns canonical DTCG design tokens under `tokens/` and the generator script `build/build.mjs`.
- Generates committed `dist/` outputs (`dashboard.css`, `landing.mjs`, `landing.cjs`, `tokens.json`) consumed by `apps/umi-dashboard` and `apps/umi-landing-page`.

## Rules

- Edit source files under `tokens/` or `build/`, then run the token build so committed `dist/` stays current.
- Never edit generated files under `dist/` directly without updating the source tokens.

## Commands

```sh
pnpm --filter @umi/tokens build
pnpm --filter @umi/tokens test
```
