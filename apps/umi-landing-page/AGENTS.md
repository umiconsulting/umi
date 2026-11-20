# Umi Landing Page

Read root `AGENTS.md` first. This contract applies to `apps/umi-landing-page`.

## Ownership

- Owns the public Next.js static export (`out/`), editorial layout rules (`DESIGN.md`), and the Cloudflare Pages Function (`functions/api/contact.ts`).
- Does not own backend lead storage, email dispatch, or CRM records; `apps/umi-api` owns those.

## Rules

- Keep output compatible with `next build` static export (`output: 'export'`).
- Forward form submissions through `functions/api/contact.ts` to `apps/umi-api`.
- Preserve verified ONCA, Kalala Café, and El Gran Ribera assets; do not invent stock customer photos.

## Commands

```sh
pnpm --filter @umi/landing build
pnpm --filter @umi/landing lint
pnpm --filter @umi/landing test
```
