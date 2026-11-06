# Cash Repo Context

Cash preserves the public loyalty pages, business panels, and internal UMI admin interface.
All data access and wallet operations belong to `umi-api`.

## Load first

1. `AGENTS.md`
2. `package.json`
3. `wrangler.jsonc`
4. Relevant `src/` route, library, or component

## Runtime boundary

`src/lib/tenant.ts` reads the public merchant projection from the API.
`src/lib/backend-proxy.ts` forwards browser requests, cookies, and binary responses.
The proxy maps internal admin login to canonical identity authentication, including MFA.
`umi-api/src/modules/cash` owns the compatibility contracts for the old interfaces.
The backend uses the canonical `merchant`, `umi`, and `runtime` schemas.
The retained `prisma/migrations` directory is historical. No Prisma runtime or generation step remains.

## Configuration

Cash requires `CASH_API_ORIGIN` and `NEXT_PUBLIC_APP_URL`.
Backend keys and database credentials stay in the API environment.
See [the staging runbook](../../docs/deployment/cash-cloudflare-staging.md).
Provider tools now belong to `apps/umi-api/scripts`.

## Avoid by default

- Build output and generated artifacts.
- Local secret files and recovered Vercel exports.
- Historical migrations, except for data recovery research.
