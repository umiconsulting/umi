# Umi Cash Agent Contract

Read [../../AGENTS.md](../../AGENTS.md) and [REPO_CONTEXT.md](REPO_CONTEXT.md).

## Ownership

- Cash owns the existing public, business admin, and internal UMI admin interfaces.
- `umi-api` owns authentication, merchant data, loyalty rules, and wallet providers.
- `db/` owns the canonical PostgreSQL schema and migrations.
- Cash forwards API requests through its same-origin proxy.
- Cash runs on Cloudflare Workers with OpenNext. Production stays on Vercel until an approved cutover.

## Engineering rules

- Keep database drivers, Prisma, signing keys, and provider credentials out of Cash.
- Preserve frozen wallet URLs through the backend proxy.
- Use canonical identity accounts for internal UMI admin access.
- Validate origin checks, cookie refresh, and binary wallet responses after proxy changes.
- Run `npm test`, `npx tsc --noEmit`, and `npm run build:cloudflare` from this directory.
- Run backend integration checks when you change API contracts or data access.
- Never print or commit secret values.
