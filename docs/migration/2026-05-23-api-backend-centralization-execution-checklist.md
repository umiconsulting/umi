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

- [ ] Execute Phase 4F as an audit/no-import gate.
- [ ] Use `2026-05-16-public-compatibility-legacy-audit.md` as the Phase 4F source checklist.
- [ ] Confirm public-only rows remain excluded from production-facing product tables.
- [ ] Mark public-only pending jobs as `do_not_replay` if preserving audit evidence is still needed.
- [ ] Run `docs/migration/validation/001_core_validation.sql`.
- [ ] Confirm zero blocking validation violations.
- [ ] Record final local row counts after Phase 4F; expected production row counts should not increase from `public.*`.

**Exit criterion:** local transition database passes validation and is ready to reproduce in staging.

---

## Phase 2 — Stage 7-Schema PostgreSQL

- [ ] Create a staging PostgreSQL database, either Supabase staging or standalone PostgreSQL.
- [ ] Apply schema scripts `001_platform_core.sql` through `007_legacy_migration_core.sql`.
- [ ] Apply backfill scripts `010` through `044` in order.
- [ ] Apply the Phase 4F exclusion decision; do not load `public.*` into production-facing schemas.
- [ ] Run validation queries against staging.
- [ ] Compare staging row counts against the local transition database.

**Exit criterion:** staging matches the local transition target and passes validation.

---

## Phase 3 — Dashboard Deployability Track

This work can start in parallel with staging. It must not switch production traffic before schema validation.

- [ ] Choose deployment shape for `umi-dashboard` backend:
  - standalone Express service,
  - API routes inside `umi-dashboard`,
  - or another explicitly hosted Node runtime.
- [ ] Add the required deployment config for the chosen shape.
- [ ] Verify environment variables and secret handling outside local development.
- [ ] Run a syntax/build check for the backend entrypoint.
- [ ] Update the dashboard frontend API base URL configuration for deployed environments.

**Exit criterion:** dashboard backend can be deployed and reached in a non-local environment.

---

## Phase 4 — Dashboard Schema Cutover

The `PLATFORM_TRANSITION_SCHEMA=true` branches are the target path.

- [ ] Point `server.js` or its replacement API layer at the staging PostgreSQL database.
- [ ] Run dashboard flows in `PLATFORM_TRANSITION_SCHEMA=true` mode.
- [ ] Verify auth, tenant routing, capabilities, staff, business hours, conversations, KDS views, Cash analytics, customers, rewards, gift cards, and notifications.
- [ ] Delete `PLATFORM_TRANSITION_SCHEMA=false` branches route group by route group after verification.
- [ ] Remove the dashboard duplicate Cash Prisma schema once dashboard no longer queries the legacy Cash project.
- [ ] Remove `@prisma/client` from `umi-dashboard` if the final dashboard backend no longer uses Prisma directly.

**Exit criterion:** dashboard has one schema path and no dependency on the stale copied `umi_cash` schema or legacy Cash project for platform-owned reads.

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
