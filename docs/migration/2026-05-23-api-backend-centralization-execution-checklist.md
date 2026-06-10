# API & Backend Centralization Execution Checklist
**Date:** 2026-05-23  
**Source audit:** `docs/architecture/2026-05-23-api-backend-centralization-audit.md`  
**Goal:** Track the mutable execution work that follows from the API/backend centralization audit.

---

## Current Completed Decisions

- [x] ConversaFlow business "Café Kalala Chapule" confirmed as `kalalacafe`.
- [x] `legacy.tenant_mappings.mapping_confidence` promoted from `candidate` to `manual`.
- [x] All 50 historical orders assigned to Chapultepec (`kalalacafe-sucursal-centro`).
- [x] All warning findings resolved or acknowledged in `observability.data_quality_findings`.
- [x] `public.*` confirmed as legacy ConversaFlow compatibility data, not a production migration source.

**Current database gate:** Phase 4F becomes an audit/no-import gate. It no longer waits on tenant confirmation, and it must not promote `public.*` rows into production product tables.

---

## Data Retention Policy

- `public.*` is not part of the production target. Do not migrate it into production-facing schemas.
- `legacy.*` is transition-only staging. Keep it only long enough to validate mappings, replay decisions, and cutover safety; delete it before declaring the production schema stable.
- Avoid permanent `legacy_*` fields in product schemas. Durable old-id references should live in explicit external-reference records or exported audit artifacts, not in product tables.
- Synthetic/evaluation rows should be deleted when the full row family is cleanly identifiable: contact/customer, conversation, messages, turns, jobs, attempts, outbox, traces, eval traces, and external refs.
- If a synthetic/evaluation row family cannot be identified end-to-end, do not partially delete it. Mark it as excluded or archive-only until a safer cleanup query exists.
- Production observability should retain only real runtime traces needed by `umi-logs`, debugging, audit, or incident review.
- Supabase Realtime and Edge Functions are supporting infrastructure during the transition. The durable target is a stable PostgreSQL-first schema.

---

## Phase 1 — Complete Local Migration

- [x] Execute Phase 4F as an audit/no-import gate. *(2026-06-10: no import; 78 public-only runtime rows recorded `archived_only` in `legacy.public_compat_imports`, batch `phase-4f-public-compat-no-import-gate`)*
- [x] Use `2026-05-16-public-compatibility-legacy-audit.md` as the Phase 4F source checklist. *(deltas re-verified identical: 12 messages / 30 jobs / 30 job_attempts / 6 outbox; 0 canonical)*
- [x] Confirm public-only rows remain excluded from production-facing product tables. *(anti-join recheck: all 78 absent from `conversaflow.*`)*
- [x] Mark public-only pending jobs as `do_not_replay` if preserving audit evidence is still needed. *(2 pending jobs flagged via `metadata.replay`)*
- [x] Run `docs/migration/validation/001_core_validation.sql`. *(2026-06-10, against `umi_platform_transition_exec_v2_20260515`)*
- [x] Confirm zero blocking validation violations. *(only finding: 1 unverified duplicate phone candidate — pre-existing, non-blocking per 05-15 phase review)*
- [x] Record final local row counts after Phase 4F; expected production row counts should not increase from `public.*`. *(`audit-output/2026-06-10-phase-4f-final-local-row-counts.csv`; narrative in `audit-output/2026-06-10-phase-4f-execution.md`)*

**Exit criterion:** local transition database passes validation and is ready to reproduce in staging. **Met 2026-06-10.**

---

## Phase 2 — Stage 7-Schema PostgreSQL

- [x] Create a staging PostgreSQL database, either Supabase staging or standalone PostgreSQL. *(2026-06-10: standalone local staging rehearsal `umi_platform_staging_phase3_20260610`; remote Supabase staging project still not provisioned.)*
- [x] Apply schema scripts `001_platform_core.sql` through `007_legacy_migration_core.sql`. *(2026-06-10: applied cleanly.)*
- [x] Apply backfill scripts `010` through `044` in order. *(2026-06-10: applied cleanly after fixing the `010` placeholder Kalala seed and adding local-owner Kalala membership in `030`.)*
- [x] Apply the Phase 4F exclusion decision; do not load `public.*` into production-facing schemas. *(78 public-only rows recorded `archived_only`; 0 imported into production-facing tables.)*
- [x] Run validation queries against staging. *(zero blocking findings; output in `audit-output/2026-06-10-phase-3-staging-validation.txt`.)*
- [x] Compare staging row counts against the local transition database. *(diff recorded in `audit-output/2026-06-10-phase-3-row-count-diff.csv`; staging intentionally excludes five synthetic `+1555` conversation families that the older local transition DB still contains.)*

**Exit criterion:** staging matches the local transition target and passes validation. **Partially met 2026-06-10:** validation passed; exact row-count equality is intentionally not met because the replayed staging target is cleaner than the older local transition DB for synthetic conversation families. A real remote Supabase staging project is still required before production cutover.

---

## Phase 3 — Dashboard Deployability Track

This work can start in parallel with staging. It must not switch production traffic before schema validation.

- [x] Choose deployment shape for `umi-dashboard` backend:
  - standalone Express service,
  - API routes inside `umi-dashboard`,
  - or another explicitly hosted Node runtime.
- [x] Add the required deployment config for the chosen shape. *(Vite static frontend + Express API through Vercel Functions; see `apps/umi-dashboard/vercel.json` and `api/index.js`.)*
- [x] Verify environment variables and secret handling outside local development. *(required variables documented in `apps/umi-dashboard/docs/deployment.md` and `.env.example`; actual Vercel envs not set because no project exists yet.)*
- [x] Run a syntax/build check for the backend entrypoint. *(`npm run api:check` and `npm run build` passed.)*
- [x] Update the dashboard frontend API base URL configuration for deployed environments. *(production uses same-origin relative `/api/*`; Vite proxy remains local-only.)*

**Exit criterion:** dashboard backend can be deployed and reached in a non-local environment. **Not yet met:** deploy config/build are ready, but no Vercel project exists under the authenticated account/team and no remote staging DB secrets are configured.

---

## Phase 4 — Dashboard Schema Cutover

The `PLATFORM_TRANSITION_SCHEMA=true` branches are the target path.

- [x] Point `server.js` or its replacement API layer at the staging PostgreSQL database. *(2026-06-10: ran against `umi_platform_staging_phase3_20260610`; two replay gaps found and scripted — `008_dashboard_compat_core.sql` (new) and `kds.device_pairing_requests` appended to `005_kds_core.sql`.)*
- [x] Run dashboard flows in `PLATFORM_TRANSITION_SCHEMA=true` mode. *(28 API checks green incl. entitlement 403s; login pos/neg; staff CRUD; hours/settings patches; pairing PIN+list; order-transition guard.)*
- [x] Verify auth, tenant routing, capabilities, staff, business hours, conversations, KDS views, Cash analytics, customers, rewards, gift cards, and notifications. *(Cash analytics/rewards/gift cards verified 200 on cash-active `full-stack-cafe`; correctly 403 `product_not_active` on `kalalacafe`. Browser walkthrough: login, overview, customers, customer 360, orders.)*
- [x] Delete `PLATFORM_TRANSITION_SCHEMA=false` branches route group by route group after verification. *(All 41 references removed including the gate constant; dead legacy helpers deleted; `server.js` 3,570 → 2,952 lines; umi-dashboard commit `5e49777`.)*
- [x] Remove the dashboard duplicate Cash Prisma schema once dashboard no longer queries the legacy Cash project. *(Schema is no longer a Cash duplicate: trimmed to the 9 models the dashboard queries, all resolving to `dashboard_compat.*` views over the platform DB; unused Session/OtpVerification/BirthdayReward/ApplePushToken removed.)*
- [ ] Remove `@prisma/client` from `umi-dashboard` if the final dashboard backend no longer uses Prisma directly. *(Deliberately retained: Prisma is the active client for both `$queryRaw` and the compat-view models; removal would be a rewrite with no consolidation gain at this stage.)*

**Exit criterion:** dashboard has one schema path and no dependency on the stale copied `umi_cash` schema or legacy Cash project for platform-owned reads. **Met 2026-06-10** (single path; the stale `umi_cash` schema copy and the legacy Cash project are unreferenced by dashboard code; `@prisma/client` retained as the query client by design).

---

## Phase 5 — KDS Pairing Deduplication

The canonical implementation is `umi-conversaflow/supabase/functions/kds-pairing/`.

- [ ] Remove `callKdsPairingLocal` from `umi-dashboard/server.js` or its successor API layer.
- [ ] Route dashboard pairing actions to the canonical `kds-pairing` function.
- [ ] Support local development through `supabase functions serve` or an explicit local mock.
- [ ] Verify PIN hashing, request approval, token creation, and session insertion through the canonical path.

**Exit criterion:** KDS pairing logic exists in one implementation only.

---

## Phase 6 — Cash Schema Cutover

This is the highest-risk phase because it changes customer-facing loyalty data access.

- [ ] Update `umi-cash/prisma/schema.prisma` for the new `cash.*` table names and relationships.
- [ ] Map legacy Cash concepts to platform schema equivalents:
  - `Tenant` to `cash.wallet_programs` plus `platform.tenants`,
  - `User` to `platform.contacts` and `platform.users`,
  - `LoyaltyCard` to `cash.loyalty_cards`,
  - `Visit` to `cash.visit_events`,
  - `Transaction` to `cash.wallet_transactions`.
- [ ] Update `umi-cash/src/lib/prisma.ts` to point at the platform database.
- [ ] Run all Next.js API routes against staging.
- [ ] Verify card lookup, points updates, reward redemption, gift cards, QR generation, Apple Wallet, Google Wallet, push registration, and auth/session behavior.
- [ ] Run a soak comparison between old and new database responses.
- [ ] Deprecate `rrkzhisnadfrgnhntkiz` only after row counts and core operations match.

**Exit criterion:** `umi-cash` serves customer traffic from `cash.*`; the old Cash Supabase project is read-only.

---

## Phase 7 — Cron Jobs To Observable Worker Path

- [ ] Add `job-worker` processors for `birthday_rewards`, `expire_birthday_rewards`, and `goal_proximity`.
- [ ] Register `pg_cron` schedules that insert workflow jobs into `conversaflow.workflow_jobs`.
- [ ] Handle per-tenant timezone with stored tenant timezone and `AT TIME ZONE`.
- [ ] Register `cleanup_sessions` as a direct `pg_cron` SQL function if it does not need worker orchestration.
- [ ] Verify scheduled jobs appear in `umi-logs`.
- [ ] Delete the four Vercel Cron route files from `umi-cash/src/app/api/cron/`.
- [ ] Remove Vercel Cron entries.

**Exit criterion:** scheduled business work is visible, retryable, and no longer implemented as Vercel route invocations.

---

## Phase 8 — Adapter Cleanup And Legacy Removal

- [ ] Add a canonical email adapter in `umi-conversaflow` if workflow-owned email sending is confirmed.
- [ ] Merge `umi-cash/src/lib/whatsapp.ts` gift card delivery behavior into the canonical Twilio adapter or keep it app-local if ownership remains customer-wallet specific.
- [ ] Remove duplicate Twilio write-path code after ownership is decided.
- [ ] Remove Brevo/nodemailer password reset handling from the dashboard backend if auth moves to the shared platform path.
- [ ] Delete synthetic/evaluation row families that are cleanly identifiable end-to-end.
- [ ] Preserve ambiguous trace/log rows until they can be classified without partial deletion risk.
- [ ] Delete `legacy.*` tables after the production soak period and after required old-id mapping evidence has moved to durable `platform.external_refs` or exported audit artifacts.
- [ ] Delete `public.*` compatibility views/tables after confirming no app reads them.
- [ ] Remove `dashboard_compat.*` after dashboard auth and password reset flows are confirmed on the platform schema.

**Exit criterion:** active runtime code no longer depends on temporary compatibility schemas or duplicate write adapters.

---

## Phase 9 — Landing Page Storage Decision

`umi-landing-page` uses `better-sqlite3` for leads and email-sequence state. That is local-development storage only. Production leads are real potential clients, and first-contact attribution must be durable.

- [ ] Design PostgreSQL tables for pre-tenant acquisition records.
- [ ] Store lead identity fields: name, email, phone, company, role/title if collected, consent state, and lifecycle status.
- [ ] Store first-contact attribution: channel, campaign, UTM source/medium/campaign/content/term, referrer, landing path, submitted form, source app, and first-contact timestamp.
- [ ] Store diagnostic submissions and score snapshots.
- [ ] Store email sequence state, email logs, pauses, unsubscribes, replies, and conversion events.
- [ ] Migrate the landing app from SQLite to PostgreSQL before production launch.
- [ ] Keep leads separate from tenant-scoped `platform.contacts` until a conversion/onboarding workflow creates a tenant, user, or customer/contact record.
- [ ] Do not deploy writable SQLite as durable state on Vercel/serverless functions.

**Exit criterion:** all production lead, attribution, diagnostic, and email-sequence state lives in PostgreSQL; SQLite is only local/test storage.
