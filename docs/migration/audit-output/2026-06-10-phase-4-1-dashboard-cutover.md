# Phase 4 / S4.1 — Dashboard Schema Cutover (2026-06-10)

Program driver: `2026-06-09-workspace-integration-implementation-plan.md` S4.1.
Checklist: 05-23 checklist Phase 4 — all boxes checked except the deliberate
`@prisma/client` retention (see below).

## Constraint honored

Owner directive: the umi-cash Supabase project (`rrkzhisnadfrgnhntkiz`) is the only real
production database and stays untouched until S4.3. Verified before starting: the dashboard
repo contains **zero** references to that project; its env pointed at the platform project's
stale `umi_cash` schema copy (legacy mode) and the local platform DB (transition mode). No
command in this step contacted the Cash production project.

## Staging replay gaps found and scripted (additive)

1. `dashboard_compat` schema (13 Prisma-model-named views over `platform`/`cash`/`conversaflow`
   - 2 local-auth tables) existed only ad hoc in the transition DB → captured as
     `docs/migration/local-postgres/008_dashboard_compat_core.sql`. The credential seed now keys
     on `platform.users.auth_subject = 'local-owner-1'` because backfill 030 regenerates user ids
     per environment — the copied uuid orphaned the credential in staging (found live).
2. `kds.device_pairing_requests` (2026-05-22 pin-pairing work) was absent from
   `005_kds_core.sql` → DDL appended; `admin/devices/pairing` 500 → 200 after apply.

## Cutover

- All 41 `PLATFORM_TRANSITION_SCHEMA` references deleted (guards, ternaries, if/else arms,
  and the constant). Dead legacy helpers removed (`loadLegacyCustomers`, `mergeLegacyCustomer`).
- `server.js`: 3,570 → 2,952 lines. umi-dashboard commits: `4aba926` (Phase 3 deployability,
  previously uncommitted), `5e49777` (cutover).
- `prisma/schema.prisma` is no longer the Cash duplicate: header documents the
  `dashboard_compat` view mapping; models trimmed to the 9 actually queried
  (removed Session, OtpVerification, BirthdayReward, ApplePushToken). `npx prisma validate` ✓.
- `UMI_DASHBOARD_SCHEMA` removed from `.env.example` / `docs/deployment.md`.
- `@prisma/client` retained deliberately: it is the live client for `$queryRaw` (platform/
  conversaflow/kds reads) and the compat-view models (cash-product admin routes).

## Verification (three lenses)

**Code:** `node --check`, `npm run api:check`, `npm run build`, `prisma validate` all pass.
28-endpoint API matrix green post-cutover, including intentional 403
`product_not_active` for cash-gated routes on `kalalacafe` and 200s for the same routes on
cash-active `full-stack-cafe`. Writes: login pos(200)/neg(401), staff create/patch/delete
(201/200/200), hours and tenant-settings PATCH (200), pairing PIN request (201) + list,
order-transition guard (controlled 400 on invalid target).

**Customer (= tenant owner):** browser walkthrough against staging on the single path —
login screen, owner overview, tenant switch, Customers (90 contacts, `platform.contacts`
source tag), Customer 360 profile (timeline, memory facts, product chips), Pedidos WhatsApp
(50 `kds.tickets`, branch selector). Module registry correctly adapts per tenant entitlements
(Kalala shows Pedidos/Devices/Hours, hides Loyalty/Gift Cards).

**Brand:** the owner console now reads live platform truth only; the stale `umi_cash` copy
is unreferenced by dashboard code. Residue noted for S4.5: synthetic SIGNOFF/+1555 contacts
are still visible in the Customers list (retention policy schedules their deletion).

## Notes / follow-ups

- Staging test credential `cutover-test@local` exists only in the staging DB (known scrypt
  test password; not in any script's seed). Harmless; staging is disposable.
- The "deployed backend pointed at staging" aspect of S4.1 remains gated by S3.2's open
  infrastructure item (no Vercel project, no remote staging DB) — cutover executed and
  verified locally against the staging replay.
