# Umi API & Backend Centralization Audit
**Date:** 2026-05-23  
**Scope:** `umi-dashboard`, `umi-cash`, `umi-conversaflow`, `umi-logs`, `umi-kds`, `umi-landing-page`  
**Goal:** Decide how backend/API ownership should consolidate around the active PostgreSQL-first platform migration.

---

## Executive Decision

Umi should not create a new permanent Supabase Edge Functions admin API. Backend consolidation should follow the active database consolidation: a host-agnostic PostgreSQL platform with seven domain schemas.

The previous version of this audit recommended centralizing API work in new Supabase Edge Functions. That was wrong. The database migration plan (`2026-05-15-optimized-database-transition-plan.md`) explicitly says:

> "No new canonical design should depend on Supabase Auth, Edge Functions, PostgREST, or Realtime as permanent architecture. The target design is plain PostgreSQL... that can run anywhere PostgreSQL runs."

Edge functions remain appropriate for event ingress, asynchronous job processing, and KDS device commands. They should not become the general-purpose admin API layer.

**Current state:** the two human data-mapping decisions that previously blocked migration work were resolved on 2026-05-23. The next database gate is Phase 4F plus validation. The execution checklist now lives in `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md`.

---

## 1. Migration State

### 1.1 Target Schema

The target is one PostgreSQL database with seven schemas:

| Schema | Domain |
|---|---|
| `platform` | Canonical identity: tenants, locations, users, memberships, staff, contacts, product activation |
| `commerce` | Normalized orders, order items, events, payments, business hours |
| `cash` | Loyalty accounts, cards, wallet programs, passes, gift cards, rewards |
| `conversaflow` | Channels, conversations, messages, turns, workflow jobs, outbox, memory, products |
| `kds` | Kitchen tickets, ticket items, events, stations, device sessions |
| `observability` | Production pipeline traces, audit events, data quality findings, and retained evaluation evidence only when explicitly needed |
| `legacy` | Transition-only mapping/replay staging; not part of the stable production target |

Supabase is the current host. The design is intentionally PostgreSQL-first so the platform can run anywhere PostgreSQL runs.

### 1.2 Local Database Status

The local execution target `umi_platform_transition_exec_v2_20260515` on port 5233 has been populated through Phase 4E.

High-signal imported counts:

| Domain | Imported evidence |
|---|---|
| Platform | 6 tenants, 5 locations, 8 users, 15 memberships, 302 contacts, 395 contact identities, 12,507 external refs |
| Cash | 208 loyalty accounts, 208 loyalty cards, 193 passes, 188 pass devices, 15 reward configs |
| Commerce | 50 orders, 73 order items, 57 order events |
| ConversaFlow | 93 production-verified conversations, 2,146 messages, 813 turns, 3,357 historical workflow jobs, 136 products |
| KDS | 50 tickets, 73 ticket items, 164 ticket events |
| Observability | 2,646 production/business runtime pipeline traces, 2,584 evaluation traces imported locally for classification/audit, 980 data quality findings |

The active Cash production source is still Supabase project `rrkzhisnadfrgnhntkiz`. The copied `umi_cash` schema inside Umi Platform is stale and must not be treated as the live Cash source.

### 1.3 Resolved Data Decisions

Both production-blocking human decisions were resolved by the business owner on 2026-05-23.

| Decision | Resolution | Migration effect |
|---|---|---|
| ConversaFlow business "Café Kalala Chapule" | Confirmed as `kalalacafe` | 93 conversations, 3,357 workflow jobs, and all KDS history belong to `kalalacafe`; `legacy.tenant_mappings.mapping_confidence` promoted from `candidate` to `manual` |
| 50 orders with missing location | Confirmed as Chapultepec (`kalalacafe-sucursal-centro`) | All 50 `commerce.orders` rows updated with `location_id = '440a02ca-3243-55d3-fd75-cb686dd667b8'` |

All warning findings are now resolved or acknowledged in `observability.data_quality_findings`. Phase 4F no longer waits on tenant confirmation.

### 1.4 Retention Stance

The production target should be cleaner than the local transition database:

- `public.*` is legacy ConversaFlow compatibility data and should not be migrated into production-facing schemas.
- `legacy.*` exists only to get through migration safely. Required source references should end up in durable places such as `platform.external_refs`; temporary mapping/replay tables should be removed before the production schema is considered stable.
- Product schemas should not keep permanent `legacy_*` fields. If old ids matter after cutover, model them as external references or export them as audit artifacts.
- Synthetic/evaluation data should be deleted when the entire trace is identifiable end-to-end. That includes customer/contact, conversation, messages, turns, jobs, attempts, outbox, traces, eval traces, and external refs.
- If a trace cannot be identified cleanly, do not partially delete it. A partial cleanup would create more ambiguity than it removes.
- Supabase Realtime and Edge Functions are secondary support infrastructure. They can remain useful, but the durable architecture is the PostgreSQL schema and the app/backend contracts on top of it.

---

## 2. Fragmentation Evidence

Backend logic is split across five runtimes because Umi historically had product-separated database ownership. The platform migration fixes the schema root cause; API/backend cleanup should follow that migration instead of creating another platform boundary.

| Runtime | Current role | Main issue |
|---|---|---|
| `umi-dashboard/server.js` | Local Express backend for owner dashboard | Not deployed; 2,483-line server; duplicate Prisma schema; duplicated KDS pairing; migration dual paths |
| `umi-cash/src/app/api/` | Customer-facing loyalty and wallet API | Still points at active legacy Cash project `rrkzhisnadfrgnhntkiz`; cron jobs are Vercel routes outside the job queue |
| `umi-conversaflow/supabase/functions/` | Event ingress, job worker, KDS commands, POS OAuth | Correct production runtime, but should not grow into admin CRUD |
| `umi-logs/app/(dashboard)/api/` | Read-only ops views and job retry | Appropriate local ownership; should move trace queries to `observability.*` after migration |
| `umi-kds` | SwiftUI thin client | Correctly thin; only needs host/project retargeting if the PostgreSQL host changes |

Highest-priority fragmentation problems:

1. `umi-dashboard` has no production backend deployment target.
2. Cash data has multiple surfaces: live `rrkzhisnadfrgnhntkiz`, stale copied `umi_cash`, and dashboard's duplicate Prisma model.
3. `umi-dashboard/server.js` reimplements `kds-pairing` logic that already exists in `umi-conversaflow/supabase/functions/kds-pairing/`.
4. Cash admin APIs are split between `server.js` and `umi-cash/src/app/api/[slug]/admin/`.
5. Scheduled Cash jobs run as Vercel Cron routes instead of observable workflow jobs.
6. Twilio and email integrations are duplicated across apps without one canonical write-path adapter.
7. `PLATFORM_TRANSITION_SCHEMA` dual paths remain in `server.js`; the `true` path is the migration target and the `false` path should be removed route by route after verification.

---

## 3. Target Ownership Model

### 3.1 Canonical Ownership

| Domain | Target owner |
|---|---|
| Tenant, user, staff, contact identity | `platform.*` |
| Customer loyalty and wallet state | `cash.*`, served by `umi-cash` for customer-facing flows |
| Dashboard admin API | Deployed `umi-dashboard` backend/API layer over `platform.*`, `cash.*`, `conversaflow.*`, and `kds.*` |
| Conversational ingress and workflow jobs | `umi-conversaflow` edge functions |
| KDS commands and pairing | `umi-conversaflow` edge functions |
| KDS read model | `kds.*` projection |
| Operational logs and traces | `observability.*`, surfaced by `umi-logs` |
| Scheduled business jobs | `pg_cron` inserts into `conversaflow.workflow_jobs`; `job-worker` processes |

### 3.2 Edge Function Boundary

Keep edge functions for:

- Event ingress: `whatsapp-handler`
- Durable asynchronous processing: `job-worker`
- Device commands: `kds-command`, `kds-pairing`
- Existing POS OAuth exchange: `zettle-oauth-setup`

Do not add permanent edge functions for:

- Paginated admin CRUD
- Dashboard auth and password reset flows
- Scheduled business jobs
- Long-term platform-domain logic

### 3.3 Dashboard Backend Direction

`server.js` is not conceptually wrong: the dashboard needs a backend that queries the platform schema directly. The structural problems are deployment, duplication, and unfinished migration branches.

The target is:

1. Make the dashboard backend deployable, either as a standalone service or as API routes inside `umi-dashboard`.
2. Keep dashboard-specific admin behavior in the dashboard backend.
3. Remove the KDS pairing duplicate and call the canonical `kds-pairing` function.
4. Remove the dashboard's duplicate Cash Prisma schema once Cash has cut over to `cash.*`.
5. Delete `PLATFORM_TRANSITION_SCHEMA=false` branches after each route group is verified on the platform schema.

Dashboard deployability can begin in parallel with database staging work. It should not wait until every schema cutover is complete, as long as production traffic is not switched before validation.

---

## 4. Consolidation Decisions

| Decision | Basis | Type |
|---|---|---|
| Do not create a new permanent admin API in Supabase Edge Functions | Migration plan rejects Supabase-specific canonical design; admin CRUD is not the natural edge-function workload | Documented project decision + Umi-specific inference |
| Treat `PLATFORM_TRANSITION_SCHEMA=true` as the target path | It points at `platform.*`, `cash.*`, and preserved domain schemas | Local migration evidence |
| Deploy or port `server.js` instead of replacing it with edge functions | Dashboard query shape needs Prisma/multi-table admin reads better suited to a Node backend | Umi-specific inference |
| Keep wallet pass logic in `umi-cash` | Apple passkit, googleapis, APNs, and certificate handling are Node-oriented app concerns | Umi-specific inference |
| Move scheduled jobs to `pg_cron` plus `job-worker` | Jobs become visible, retryable, and tied to the PostgreSQL platform instead of Vercel route execution | Documented PostgreSQL extension capability + existing Umi worker pattern |
| Keep `umi-logs` API routes read-only | They serve internal SSR ops views and do not duplicate product write logic | Umi-specific inference |
| Consolidate Twilio/email write adapters | Existing `_shared/` pattern in `umi-conversaflow` is already the canonical adapter layer for workflow code | Existing codebase pattern |
| Move landing-page lead/email state to PostgreSQL before production | Landing-page leads are real potential clients and first-contact attribution is business data; SQLite is fine only for local/single-host use, while Vercel/serverless functions have ephemeral writable storage and multiple instances do not share a local database file | Documented platform/runtime constraint + SQLite documented tradeoff + Umi-specific product decision |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cash schema cutover breaks customer loyalty behavior | Medium | High | Run `umi-cash` in parallel against old and new databases during a soak window; compare API responses and key row counts before switching traffic |
| `PLATFORM_TRANSITION_SCHEMA=false` branches contain undocumented business rules | Low | High | Audit each false branch before deletion; verify route groups against staging first |
| Dashboard deployability work uncovers Node/ESM or environment assumptions | Low | Medium | Add a build/check step for the selected deployment shape before committing to hosting |
| `pg_cron` timezone handling drifts for birthday rewards | Low | Medium | Use stored tenant timezone with `AT TIME ZONE` in cron SQL |
| Wallet pass updates fail after Cash cutover | Medium | High | Test Apple/Google pass creation, update, and device registration on staging before production cutover |
| Edge functions retain stale schema references after migration | Medium | Medium | Audit hardcoded schema names; `conversaflow.*` and `kds.*` should remain stable in the target design |
| Landing page lead/email state remains in local SQLite for production | Medium | High | Move durable lead, attribution, diagnostic, consent, and email-sequence state to PostgreSQL before treating the landing app as production-deployed |

---

## 6. Landing Page Storage

`umi-landing-page` currently uses `better-sqlite3` for leads and email-sequence state. That is acceptable for local development or a single long-lived server with persistent disk. It is not acceptable as production durable state because these leads are real potential clients and the first-contact channel is part of the business record.

Production decision:

1. Move landing-page lead, diagnostic, consent, attribution, and email-sequence state to PostgreSQL before production use.
2. Model leads as pre-tenant acquisition records, not as tenant-scoped `platform.contacts`.
3. Capture first-contact attribution explicitly: channel, campaign, UTM fields, referrer, landing path, submitted form, source app, and timestamp.
4. Track email sequence sends, pauses, unsubscribes, replies, and conversions as lead events.
5. Promote a lead into `platform.tenants`, `platform.users`, and tenant-scoped contacts only after a real onboarding/conversion workflow.

This keeps customer/contact identity clean while making acquisition data durable and queryable.

---

## 7. Out of Scope

| Item | Reason |
|---|---|
| `umi-kds` SwiftUI app behavior | Already a thin client; only host/project configuration may change |
| Zettle OAuth | Already lives in edge functions; schemas are stable |
| Voyage AI embeddings | Blocked by missing `VOYAGE_API_KEY` secret in Supabase dashboard; 136 products have local embeddings only |
| Supabase exit timeline | The migration enables host agnosticism but does not set a date to leave Supabase |
| Multi-tenant billing | Billing tables come after subscription activation, per `2026-05-17-dashboard-tenant-membership-implementation-plan.md` |

---

## 8. Execution Checklist

The mutable execution plan has moved to `docs/migration/2026-05-23-api-backend-centralization-execution-checklist.md`.
