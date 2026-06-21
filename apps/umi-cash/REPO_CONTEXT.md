# Cash Repo Context

## Purpose

Umi Cash loyalty, wallet, pass, tenant/user/session behavior, and Cash-specific web runtime.

## Load first

1. `AGENTS.md`
2. `package.json`
3. `prisma/schema.prisma`
4. `vercel.json`
5. Relevant `src/` route, library, or component

## High-authority files

- `prisma/schema.prisma`
- `src/`
- `vercel.json`
- `package.json`
- `AGENTS.md`

## Runtime boundary

Cash owns loyalty and wallet behavior. It does not own ConversaFlow operational orders, KDS projections, or Logs trace schema.

## Sensitive surfaces

- `.env*`
- wallet/pass certificates
- private keys
- service credentials

Do not print secret values. Certificate cleanup or rotation needs human review.

## Avoid by default

- Build output.
- Generated Prisma artifacts.
- Local env files.
- Historical deleted artifacts unless needed for recovery.
