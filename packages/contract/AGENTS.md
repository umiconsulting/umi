# Umi Contract Package

Read root `AGENTS.md` first. This contract applies to `packages/contract`.

## Ownership

- Owns canonical typed HTTP routes, Zod schemas, inferred TypeScript types, and generated Dart contract artifacts shared by `apps/umi-api`, `apps/umi-dashboard`, and `apps/umi-pos`.
- Does not own business logic, database queries, or UI state.

## Rules

- Keep changes additive and backwards-compatible across API, dashboard, and POS consumers.
- Never edit `dist/`, `generated/contract.json`, `generated/contract.sha256`, or `generated/dart/` by hand.
- Regenerate and verify checksums after every edit under `src/`.

## Commands

```sh
pnpm --filter @umi/contract generate
pnpm --filter @umi/contract generate:check
pnpm --filter @umi/contract typecheck
pnpm --filter @umi/contract test
```
