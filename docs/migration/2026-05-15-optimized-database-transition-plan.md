# Optimized Database Transition Plan - 2026-05-15

## Purpose

Plan the transition from the current Supabase-centered, product-separated database state into a PostgreSQL-first Umi platform database.

This plan is intentionally a transition plan, not a greenfield rewrite. It preserves the facts that exist today:

- ConversaFlow started as a single-business Supabase backend and still uses `business_id`.
- Umi Cash started in a separate database and still has its active production source there. The copied `umi_cash` schema inside Umi Platform is a stale migration copy, not the Cash source of truth.
- KDS is a backend-owned kitchen projection from ConversaFlow orders.
- Logs is an operational developer/ops UI and does not own tenant truth.
- Dashboard is new and currently integrates product data through slug-based routes.
- `public.*` ConversaFlow tables are compatibility leftovers from the earlier migration into `conversaflow`.

The target remains PostgreSQL-first and host-agnostic. Supabase can remain temporary infrastructure during the transition, but no new canonical design should depend on Supabase Auth, Edge Functions, PostgREST, or Realtime as permanent architecture.

## 2026-05-23 Implementation Correction

The production cutover should be stricter than the local transition database:

- `public.*` is legacy ConversaFlow compatibility data. It should be audited, not migrated into production-facing schemas.
- `legacy.*` is transition scaffolding only. Use it for mapping, validation, and replay safety during migration, then remove it before the production schema is considered stable.
- Do not add permanent `legacy_*` fields to product schemas. Durable old-id references should use explicit external-reference records or exported audit artifacts.
- Synthetic/evaluation data should be deleted only when its full row family is identifiable end-to-end: customer/contact, conversation, messages, turns, jobs, attempts, outbox, traces, eval traces, and external refs.
- If a synthetic/evaluation trace cannot be identified end-to-end, do not partially delete it. Preserve it as excluded/archive evidence until a safer cleanup query exists.
- Production observability should keep real runtime traces needed by operations, incident review, or audit. Evaluation observability is optional migration evidence, not required production data.
- Supabase Realtime and Edge Functions are secondary support infrastructure. The durable target is the PostgreSQL schema and stable app/backend contracts.

## Sources Read

Workspace and ownership:

- `AGENTS.md`
- `WORKSPACE.md`
- `docs/architecture/agent-operating-system.md`
- `docs/architecture/maps/retrieval-map.md`
- `docs/architecture/maps/workspace-map.md`
- `docs/architecture/maps/runtime-map.md`
- `docs/governance/ownership.md`

Migration and audit:

- `docs/migration/2026-04-15-supabase-multischema-state.md`
- `docs/migration/2026-04-15-umi-platform-cutover-plan.md`
- `docs/migration/2026-05-14-postgresql-platform-integration-plan.md`
- all files in `docs/migration/audit-output/`
- `docs/migration/local-postgres/*.sql`
- `docs/migration/audit-output/2026-05-15-cash-visit-source-comparison-partial.md`
- `docs/migration/audit-output/2026-05-15-umi-cash-production-local-copy.md`

Codebase surfaces:

- `apps/umi-dashboard/server.js`
- `apps/umi-dashboard/src/lib/config.js`
- `apps/umi-dashboard/src/data.jsx`
- `apps/umi-cash/prisma/schema.prisma`
- `apps/umi-conversaflow/supabase/functions/_shared/supabase.ts`
- `apps/umi-conversaflow/supabase/functions/_shared/cors.ts`
- `apps/umi-conversaflow/supabase/functions/whatsapp-handler/index.ts`
- `apps/umi-conversaflow/supabase/functions/whatsapp-handler/context.ts`
- `apps/umi-conversaflow/supabase/functions/job-worker/processors/index.ts`
- `apps/umi-kds/Sources/Docs/KDSArchitecture.md`
- `apps/umi-kds/Sources/Data/KDSAPIClient.swift`
- `apps/umi-logs/lib/supabase.ts`
- `apps/umi-logs/lib/parsers/traceAssembler.ts`

Primary technical references:

- PostgreSQL schemas: https://www.postgresql.org/docs/current/ddl-schemas.html
- PostgreSQL row security policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL UUID functions: https://www.postgresql.org/docs/current/functions-uuid.html
- PostgreSQL logical replication: https://www.postgresql.org/docs/current/logical-replication.html
- PostgreSQL `CREATE SCHEMA`: https://www.postgresql.org/docs/current/sql-createschema.html
- Supabase RLS guidance, as a temporary-hosting concern: https://supabase.com/docs/guides/database/postgres/row-level-security

## Current State

### Verified source inventory

There are two active source databases for this transition:

1. **Umi Platform Supabase project** `xbudknbimkgjjgohnjgp`
   - Owns active ConversaFlow, KDS, and legacy/public compatibility data.
   - Local faithful restore for structure and historical data: `umi_platform_and_cash_full_local`.
   - Contains a copied `umi_cash` schema, but that schema is not the active Cash production source.
2. **Umi Cash Supabase project** `rrkzhisnadfrgnhntkiz`
   - Owns active Cash production loyalty, wallet, pass, tenant, user, and session data.
   - Local faithful restore: `umi_cash_production_local_20260515`.

The older audit database `umi_supabase_dump_local` and the Desktop dump remain useful for Umi Platform structure and migration history, but they must not be used as the Cash production source.

Active Umi Platform live inventory as of 2026-05-15:

- `conversaflow`: 23 base tables.
- `kds`: 4 base tables.
- `public`: 22 base tables, mostly legacy ConversaFlow compatibility rows.
- `umi_cash`: 13 base tables, stale copied Cash data.
- `platform`: schema exists, no active base tables.
- `auth`, `realtime`, `storage`, and `supabase_migrations` are Supabase platform/internal schemas.

Important active Umi Platform raw counts:

- `conversaflow.businesses`: 1
- `conversaflow.customers`: 536 raw rows, now classified as 93 production-verified contacts and 443 synthetic/evaluation contacts
- `conversaflow.conversations`: 535
- `conversaflow.conversation_turns`: 1,599
- `conversaflow.messages`: 3,958
- `conversaflow.transactions`: 50
- `conversaflow.jobs`: 3,357
- `conversaflow.job_attempts`: 3,362
- `conversaflow.pipeline_traces`: 5,213
- `kds.tickets`: 50
- `kds.ticket_items`: 73
- `kds.ticket_events`: 164

Stale copied Cash counts inside Umi Platform:

- `umi_cash."Tenant"`: 3
- `umi_cash."User"`: 64
- `umi_cash."LoyaltyCard"`: 59
- `umi_cash."Visit"`: 31
- `umi_cash."Transaction"`: 3
- `umi_cash."RewardConfig"`: 14
- `umi_cash."Session"`: 132

These copied `umi_cash` rows should be used only as migration history and comparison evidence. They should not seed the canonical target if active Cash production has the same entities with newer state.

Active Umi Cash production inventory from `umi_cash_production_local_20260515`:

- `public`: 14 base tables, including `_prisma_migrations`.
- `Tenant`: 4
- `Location`: 3
- `User`: 214
- `LoyaltyCard`: 208
- `Visit`: 174
- `Transaction`: 5
- `RewardConfig`: 15
- `RewardRedemption`: 6
- `GiftCard`: 1
- `Session`: 255
- `OtpVerification`: 167
- `ApplePushToken`: 188
- `BirthdayReward`: 0

### Codebase coupling

Dashboard:

- `apps/umi-dashboard/src/lib/config.js` reads `VITE_BUSINESS_ID` and `VITE_BUSINESS_SLUG`.
- `apps/umi-dashboard/src/data.jsx` throws when `VITE_BUSINESS_SLUG` is missing.
- `apps/umi-dashboard/server.js` exposes many `/api/:slug/...` routes and resolves Cash `Tenant` first.
- `apps/umi-dashboard/server.js` currently tries to map Cash tenants to ConversaFlow businesses through `conversaflow.business_external_refs`.

Cash:

- `apps/umi-cash/prisma/schema.prisma` currently has product-local `Tenant`, `Location`, `User`, `Session`, loyalty cards, visits, wallet transactions, reward config, gift cards, and wallet pass tables.
- Cash `User` mixes customers, staff, admins, password auth, phone/email identity, and staff attribution.
- Local Cash repo env files currently point at the Umi Platform copied `umi_cash` schema, while Vercel production points at the separate active Cash project `rrkzhisnadfrgnhntkiz`.
- Migration work must source Cash data from active production or `umi_cash_production_local_20260515`, not from the stale Umi Platform copy.

ConversaFlow:

- `apps/umi-conversaflow/supabase/functions/_shared/cors.ts` requires one `DEFAULT_BUSINESS_ID`.
- `whatsapp-handler` writes inbound events, customers, conversations, messages, jobs, and traces using that `BUSINESS_ID`.
- `context.ts` dedupes customers by `(phone, business_id)`.
- `job-worker` claims `jobs`, writes `job_attempts`, and drains `outbox`.
- KDS functions and migrations still project from `conversaflow.transactions`.

KDS:

- The iPad client reads `kds.get_board_snapshot(p_business_id, p_station_id)` and `kds.get_ticket_events(p_business_id, ...)`.
- KDS commands go through `kds-command`, which invokes backend RPCs and wakes the job worker.
- KDS explicitly must not become the order source of truth.

Logs:

- Logs reads a configured ConversaFlow schema.
- Its parser expects trace/log shapes from current ConversaFlow tables.
- Logs should move to read `observability` later, but it should not own trace writes.

## Decision Basis

### Documented facts

- PostgreSQL schemas are namespaces inside one database.
- PostgreSQL RLS is native database policy enforcement and can use session settings such as `current_setting(...)`.
- PostgreSQL logical replication supports publisher/subscriber replication of data changes, which can support backfill plus short final cutover.
- Supabase RLS remains relevant while any tables are exposed through Supabase APIs.
- Current Umi docs assign shared backend, schema contracts, KDS projections, workflow jobs, outbox, and normalization to `apps/umi-conversaflow`.

### Source-backed tradeoffs

- A single PostgreSQL database with multiple schemas is the right next step because it centralizes canonical identity while preserving product ownership boundaries.
- Logical replication and backfill are better than a pure offline migration if the goal is low downtime, but they require stricter idempotent import scripts, stable primary keys or external refs, and a final write freeze.
- RLS should use Umi-owned session variables or claims instead of Supabase-specific `auth.uid()` in the target so the database can move away from Supabase later.
- Queue tables should not be imported as automatically claimable live work. Preserving them is valuable, but replay should be explicit.

### Umi-specific inferences

- `platform.tenants` should represent canonical business accounts.
- One owner/admin user can have memberships in multiple tenants.
- One tenant can have multiple `platform.locations`.
- If one owner has multiple brands or separate businesses with separate customer bases, product availability, settings, or accounting, model those as separate tenants with shared user memberships.
- Do not add a parent `platform.organizations` or account-group table in phase 1 unless consolidated billing, consolidated reporting, or cross-tenant policy becomes an immediate requirement.
- `platform.contacts` should remain tenant-scoped first. This avoids privacy risk and prevents accidental cross-business customer merging.
- Landing-page leads are pre-tenant acquisition records. They should be durable PostgreSQL data, but they should not become tenant-scoped `platform.contacts` until a conversion/onboarding workflow exists.
- First-contact attribution is part of the lead record: channel, campaign, UTM fields, referrer, landing path, submitted form, source app, and timestamp.
- `commerce.orders` should become canonical order truth, but it should start as a validated projection/read model before it is allowed to be the only write model.
- Cash import source of truth is the active `umi-cash` production database. The copied `umi_cash` schema in Umi Platform is legacy comparison data and should only supply rows if a deliberate source-by-source conflict review proves they are absent from active Cash production.

## Recommended Target Model

### Schemas

```txt
platform      canonical identity, tenancy, memberships, roles, staff, contacts, pre-tenant leads, product activation
commerce      canonical commercial/order facts, payments, refunds, service windows, business hours
cash          loyalty, wallet, rewards, gift cards, passes, Cash-specific auth compatibility
conversaflow  conversations, messages, workflow jobs, outbox, memory, channels, tool calls
kds           kitchen projections, ticket state, device sessions, station state
observability append-only logs, traces, audit events, data quality findings
legacy        old-to-new mappings, compatibility views, replay staging, import audit tables
```

### Tenant and business terminology

Use these terms consistently:

- `platform.users`: people who can log into Umi systems.
- `platform.tenants`: business accounts/workspaces.
- `platform.locations`: branches or physical/service locations under one tenant.
- `platform.tenant_memberships`: which users can access which tenants.
- `platform.staff_members`: staff profiles for a tenant, optionally linked to a `platform.users` login.
- `platform.contacts`: customer/guest records scoped to one tenant.
- `platform.leads`: pre-tenant acquisition records from the landing page and other sales channels.
- `platform.lead_events`: attribution, diagnostic, email-sequence, unsubscribe, reply, and conversion events for leads.

This answers the "single tenant has multiple businesses" concern:

- One owner with multiple businesses should be one `platform.user` with memberships to multiple `platform.tenants`.
- One business with multiple stores should be one `platform.tenant` with multiple `platform.locations`.
- One business with multiple product modules should be one `platform.tenant` with multiple `platform.product_instances`.
- A parent organization/group is a future extension, not a prerequisite for this migration.

### Auth recommendation

Do not make `auth.users` canonical.

Use `platform.users` as the canonical Umi user profile and store auth-provider linkage in:

- `platform.users.auth_subject`, for example `supabase:<uuid>`, `auth0:<sub>`, `clerk:<id>`, or `keycloak:<sub>`.
- `platform.external_refs`, when more than one auth provider or old auth id must be preserved.

Short-term:

- Supabase Auth can remain a temporary provider if it reduces migration risk.
- It should only issue identity, not define tenants, staff, roles, or product permissions.

Medium-term:

- Prefer an OIDC-capable provider so the database and apps are not locked to Supabase.
- If managed auth is acceptable, Clerk/Auth0-like providers are fast.
- If host independence matters more, Keycloak or another OIDC-compatible self-hostable provider fits the PostgreSQL-first direction.

Authorization belongs in Umi:

- `platform.tenant_memberships` controls tenant access.
- `platform.roles`, `platform.permissions`, and `platform.membership_roles` control dashboard and product permissions.
- `platform.staff_members` models tenant staff, including owners/admins/operators.
- A staff member can exist without a login. A login user can exist without being operational staff.

### ConversaFlow synthetic and eval data caveat

The raw `conversaflow.customers` count is not a clean production-customer count. Some ConversaFlow data was created by tests, mini-harness runs, and v2 synthetic eval workflows.

Current aggregate signals as of 2026-05-15:

- `conversaflow.customers`: 536 raw rows.
- Customers with any user message carrying a Twilio SID: 100.
- Customers without a user Twilio SID: 436.
- Customers attached to `conversaflow.eval_traces`: 7.
- Customers matching the recent mini-harness/no-Twilio/voyage user-message signal in the refreshed local Platform source: 0.
- Corrected local execution classification after operator review: 443 `synthetic_eval`, 93 `production_verified`, 0 `unknown`.

These signals are not yet a final exclusion rule. Some legitimate historical rows may lack a Twilio SID because of earlier migrations or incomplete provider metadata. The migration must classify ConversaFlow contacts before canonical import:

- `production_verified`: inbound provider evidence, order/KDS evidence, or human-approved production source.
- `synthetic_eval`: explicit eval trace, mini-harness, known test phone/name, known test conversation, no-Twilio synthetic workflow/pipeline provenance, or other confirmed synthetic marker.
- `unknown`: no current rows after operator review. If this bucket appears in future backfills, preserve in `observability.data_quality_findings` or `legacy` staging until reviewed.

Do not automatically import all 536 raw ConversaFlow customer rows into canonical `platform.contacts`.

### Contact identity and phone policy

Use tenant-scoped contacts first.

ConversaFlow and Cash contacts appear mostly disjoint in the raw active-source audit, but ConversaFlow rows need production/synthetic classification before contact import. The raw audit found:

- Cash customer users with phone: 208.
- ConversaFlow raw customers with phone: 536.
- Exact normalized phone overlap: 0.
- Last-10-digits overlap: 3.

Migration policy:

- Create separate `platform.contacts` from Cash and production-eligible ConversaFlow rows first.
- Exclude synthetic/eval ConversaFlow contacts from production contacts.
- Delete synthetic/eval traces when their full row family is identifiable; otherwise keep them as excluded/archive evidence until a safe cleanup exists.
- Add `phone` and `whatsapp` identities for ConversaFlow WhatsApp customers.
- Add `phone`, `email`, and wallet/pass identities from Cash where present.
- Do not merge on display name.
- Do not merge automatically on last-10 digits.
- Treat last-10 matches as candidate `observability.data_quality_findings`, not automatic merges.

Phone verification should be non-blocking:

- Normalize phone values as much as possible.
- Store unverified phone identities.
- Track verification state separately from existence.
- Allow low-confidence contact creation when Twilio SMS is too expensive or unavailable.
- Block high-risk actions with step-up verification later, not basic customer/contact creation.

Recommended refinement to `platform.contact_identities` before import:

```sql
-- suggested additive columns
normalized_value text;
verification_status text not null default 'unverified'
  check (verification_status in ('unverified', 'verified', 'failed', 'expired'));
verified_at timestamptz;
confidence text not null default 'source_asserted'
  check (confidence in ('source_asserted', 'otp_verified', 'staff_verified', 'candidate'));
metadata jsonb not null default '{}'::jsonb;
```

### Orders and commerce

`commerce.orders` should become the canonical order table for every source that can provide readable order facts:

- WhatsApp orders from ConversaFlow.
- Future Zettle/POS orders if API access, export, webhook, or manual import becomes available.
- Future Cash-originated purchases if Cash starts creating commercial orders.
- Manual/admin/dashboard orders if added later.

Initial migration:

- Import `conversaflow.transactions` where `transaction_type = 'order'` into `commerce.orders`.
- Preserve old ids in `platform.external_refs` or a `legacy.order_mappings` table.
- Keep `commerce.orders.source_product = 'conversaflow'`.
- Keep `commerce.orders.source_ref = conversaflow.transactions.id`.
- Preserve selected non-PII source fields from transaction `details` in `commerce.orders.metadata`; do not copy the full raw payload wholesale because some keys can contain customer data.
- Extract `commerce.order_items` from `transactions.details` only after sample-driven JSON inspection.
- Validate order item counts against `kds.ticket_items`.

Amount policy:

- Cash stores money as integer centavos.
- ConversaFlow `transactions.total_amount` is numeric and should be treated as pesos with centavos until sample validation proves otherwise.
- Convert to `total_cents = round(total_amount * 100)`.
- Preserve `source_total_amount` and `source_total_cents` in metadata during the first import so errors can be audited.

Do not wait for Zettle to create `commerce.orders`.

Zettle can be integrated later through:

- API sync if economically justified.
- Export/import if API cost is not justified.
- Manual reconciliation/import if volume is low.
- `platform.external_refs` for provider ids.

### KDS

KDS should stay a read model/projection and command surface.

Migration policy:

- Preserve KDS history because it is useful future operational data.
- Map `kds.tickets.source_transaction_id` to `commerce.orders.id`.
- Map ticket items to `commerce.order_items` where possible.
- Preserve `kds.ticket_events` as kitchen event history.
- Keep KDS transitions and operator events in `kds.ticket_events` and also mirror order lifecycle effects to `commerce.order_events`.
- Do not let KDS create orders.

During cutover:

- Keep the existing `p_business_id` RPCs as compatibility wrappers.
- Add new tenant-first RPCs such as `kds.get_board_snapshot_v2(p_tenant_id, p_station_id)`.
- Dashboard and future clients should use tenant-first contracts.
- The iPad app can migrate after backend compatibility is stable.

### ConversaFlow

ConversaFlow history is durable product history and should be migrated.

Migrate:

- businesses to platform tenant external refs.
- customers to `platform.contacts` and `platform.contact_identities`.
- conversations, messages, turns, outcomes, customer preferences, products, memory, and transaction status history.
- current workflow jobs, attempts, and outbox rows as historical runtime records.
- pipeline traces, edge logs, security logs, AI turn logs, and eval traces to `observability` or product-specific history depending on query needs.

Refactor over time:

- `business_id` becomes `tenant_id`.
- `customer_id` becomes `contact_id`.
- `transactions` order facts move to `commerce.orders`.
- products can initially remain in `conversaflow.products`, but if they become shared menu/catalog facts they should move to a future `commerce.catalog_*` slice.

Ingress improvement:

- Replace global `DEFAULT_BUSINESS_ID` with channel/account resolution.
- `conversaflow.channel_accounts` should map inbound Twilio/WhatsApp numbers to `tenant_id` and optional `location_id`.
- Keep a single-tenant fallback only during compatibility.

### Jobs and outbox

Preserve jobs and outbox, but do not import them as live work by default.

Senior migration policy:

- Completed/failed/dead historical jobs and outbox rows become imported runtime history.
- Pending/claimed rows are classified during cutover.
- Rows older than the cutover freeze become historical, not claimable.
- Rows that must be executed after cutover are copied into a deliberate `legacy.replay_queue` or equivalent staging table and re-enqueued by an operator-approved replay process.
- `job_attempts` are preserved for future debugging and analytics.
- `outbox` delivery history is preserved, including idempotency keys.

This preserves future analysis value without accidentally replaying old Twilio messages, Slack notifications, KDS notifications, or failed side effects.

### Public compatibility tables

`public.*` ConversaFlow tables are leftovers from the earlier migration.

Migration policy:

- Treat `conversaflow.*` as authoritative.
- Compare `public.*` to `conversaflow.*` by primary key where possible.
- Do not import `public.*` rows into production-facing schemas.
- If audit evidence must be retained, record public-only row ids in local/staging artifacts only; do not make `legacy.public_compat_imports` part of the stable production target.
- After cutover and soak, remove public tables/views during a manual cleanup window once no app reads them.

## Transition Phases

### Phase 0 - Freeze destructive work

- Keep the pending dashboard `conversaflow.business_external_refs` / `conversaflow.staff_members` migration on hold.
- Do not add new product authority to Dashboard.
- Do not add new product logic to `public`.
- Keep app changes additive.

### Phase 1 - Refine the platform draft

Use the existing local PostgreSQL draft as the base, then add the refinements needed by this plan:

- `platform.contact_identities` verification/confidence fields.
- tenant-first RLS functions that do not rely on Supabase `auth.uid()`.
- explicit role/permission keys for owner, admin, staff, developer, and tech assist roles.
- optional transition-only tables under `legacy` for mapping and replay.
- indexes on all mapping keys used during backfill.

Do not add `platform.organizations` yet unless the product requirement is confirmed.

### Phase 2 - Build mapping layer

Create transition-only mapping tables:

- `legacy.tenant_mappings`
- `legacy.location_mappings`
- `legacy.user_mappings`
- `legacy.staff_mappings`
- `legacy.contact_mappings`
- `legacy.order_mappings`
- `legacy.kds_ticket_mappings`
- `legacy.replay_queue`

Do not create `legacy.public_compat_imports` in the stable production target. If public compatibility evidence must be retained, keep it as local/staging audit output or export it outside the production schema.

Tenant mapping policy:

- Start with all 4 active Cash production tenants as canonical `platform.tenants`.
- Add the 1 ConversaFlow business as either:
  - a match to one Cash tenant if confirmed by name, config, phone/channel, order/KDS data, or human review, or
  - a separate tenant if not confidently matched.
- Treat the 3 copied `umi_cash."Tenant"` rows in Umi Platform as stale migration evidence, not as the complete Cash tenant list.
- Attach KDS to the same tenant as its source ConversaFlow business.
- Seed explicit `platform.product_instances` for every tenant/product pair with `active`, `missing`, `disabled`, or `archived`.

### Phase 3 - Backfill platform identity

Backfill in this order:

1. `platform.users` from auth/admin/staff sources.
2. `platform.tenants` from Cash tenants and ConversaFlow businesses.
3. `platform.locations` from Cash locations, plus default ConversaFlow location only if required.
4. `platform.product_instances` from observed product data.
5. `platform.staff_members` from Cash `User` rows with `STAFF` or `ADMIN`.
6. `platform.contacts` from Cash customer users and ConversaFlow customers.
7. `platform.contact_identities` from phone/email/WhatsApp/pass identities.
8. `platform.external_refs` for every old id and slug.

### Phase 4 - Backfill Product Data

Split Phase 4 into reviewable, idempotent slices with validation gates between slices.

Order:

1. **4A Cash product data**: `cash.wallet_programs`, loyalty accounts/cards, visit events, wallet transactions, reward configs/redemptions, gift cards, passes, and pass devices. Exclude short-window auth/session artifacts from durable product tables and record them as findings.
2. **4B ConversaFlow commerce orders**: `commerce.orders`, `commerce.order_items`, `commerce.order_events`, `legacy.order_mappings`, and external refs. Preserve source ids and selected non-PII source metadata.
3. **4C KDS projection history**: tickets, ticket items, ticket events, stations, device sessions, and device events using canonical `tenant_id`, `commerce.orders`, and `commerce.order_items`.
4. **4D ConversaFlow runtime history**: conversations, messages, turns, memory/preferences, products, workflow jobs, outbox, and outcomes using canonical ids. Preserve old jobs/outbox as historical by default, not automatically claimable work.
5. **4E Observability history**: traces, runtime logs, audit events, integration checks, eval evidence, and data quality findings.
6. **4F Public compatibility no-import gate**: compare `public.*` to `conversaflow.*`, confirm public-only rows remain excluded, and retain only local/staging audit evidence if needed.

Current local execution status:

- 4A is executed locally in `umi_platform_transition_exec_v2_20260515`.
- 4B is executed locally in `umi_platform_transition_exec_v2_20260515`.
- 4C is executed locally in `umi_platform_transition_exec_v2_20260515`.
- 4D is executed locally in `umi_platform_transition_exec_v2_20260515`.
- 4E is executed locally in `umi_platform_transition_exec_v2_20260515`.
- 4F is the next executable slice.

Known 4B caveats:

- 34 imported orders have nullable `contact_id` because their customers were not imported as verified production contacts.
- 50 imported orders have nullable `location_id` because `transactions.service_id` has no copied source table to map into `platform.locations`.
- 2 imported orders have source totals that differ from summed item totals; source order totals are preserved and the mismatches are recorded as findings.

Known 4C caveats:

- 34 imported KDS tickets have nullable `contact_id`, matching the order/customer mapping gap from 4B.
- 138 imported KDS ticket events have null source event keys; source sequence is preserved for idempotence and the gap is recorded as a finding.
- KDS ticket locations use the candidate ConversaFlow business default location mapping and still require human confirmation before production cutover.

#### Phase 4D Detailed Plan - ConversaFlow Runtime History

Source facts for this execution target:

```txt
conversaflow.conversations: 535
conversaflow.messages: 3,958
conversaflow.conversation_turns: 1,599
conversaflow.customer_preferences: 9
conversaflow.products: 136
conversaflow.jobs: 3,357, all completed
conversaflow.job_attempts: 3,362
conversaflow.outbox: 401, only delivered or dead
conversaflow.pipeline_traces: 5,213
conversaflow.eval_traces: 17
```

Planning loop conclusion:

- Runtime import must prioritize security and data integrity over maximum row movement.
- Verified production customer history can enter production-facing `conversaflow` tables.
- Synthetic/eval customer history should not silently become production customer history.
- Jobs and outbox can be preserved safely only as inert history because no source jobs are currently pending/claimed/running and no source outbox rows are pending/delivering.
- Product/menu history needs a target table decision because the current local target schema does not yet include `conversaflow.products`.
- Pipeline and eval traces belong to Phase 4E observability unless they are needed as metadata for a 4D row.

Execute 4D in these substeps:

1. **4D0 - Runtime Policy Gate**
   - Confirm the retention stance for synthetic conversation history.
   - Default for local execution: import only mapped production-verified conversations into production-facing `conversaflow.conversations`, `messages`, and `conversation_turns`.
   - Preserve excluded conversation ids as data-quality findings or archive rows, not as active customer history.
   - Gate: zero pending/claimable jobs and zero pending/deliverable outbox rows before any runtime import.

2. **4D1 - Channel Bootstrap**
   - Create tenant-scoped `conversaflow.channels` rows for `whatsapp` and `slack`.
   - Create inferred `conversaflow.channel_accounts` from business config keys only, without copying secrets.
   - Use provider account ids such as `whatsapp:<business_id>` and `slack:<business_id>` if no stable provider id is available.
   - Gate: every imported production conversation can resolve a channel account or deliberately remain null with a finding.

3. **4D2 - Production Conversation Import**
   - Import conversations whose customer has a `legacy.contact_mappings` row.
   - Map `business_id -> tenant_id`.
   - Map `customer_id -> contact_id`.
   - Map `status = active` to target `open`.
   - Preserve state fields in metadata: `current_state`, `state_data`, `summary`, `history_migrated`, `draft_cart`, versions, pending clarification, and source ids.
   - Gate: no imported conversation missing tenant; nullable contact count should be zero for this production subset.

4. **4D3 - Message Import**
   - Import messages only for imported conversations.
   - Map source `content` to target `body`.
   - Map `twilio_message_sid` to `provider_message_id`.
   - Preserve intent/entities/message index/embedding model presence in metadata, but do not copy vector embeddings into message payloads.
   - Gate: no imported message missing conversation; role values must fit target role constraint.

5. **4D4 - Conversation Turn Import**
   - Import turns only for imported conversations.
   - Map source statuses:
     - `completed -> completed`
     - `processing -> processing`
     - `superseded -> superseded`
     - `cancelled -> failed` with source status preserved in metadata
   - Preserve extracted intent, reconciled action, source message ids, integrity decision/reason, and timing fields in metadata.
   - Gate: no imported turn missing conversation; all source statuses must map explicitly.

6. **4D5 - Memory and Preferences Import**
   - Import `customer_preferences` for mapped contacts as `conversaflow.memory_items`.
   - Store facts/preferences in structured `attributes`, with compact human-readable `content`.
   - Leave unmapped customer preferences out of production memory and record findings.
   - Gate: no memory row without tenant; unmapped preference count is recorded.

7. **4D6 - Product/Menu Decision**
   - Add a minimal `conversaflow.products` target table if menu/product search must remain ConversaFlow-owned during transition.
   - Otherwise defer products to a future commerce catalog slice.
   - Local recommendation: add `conversaflow.products` for now because source has 136 Zettle-backed products and embeddings, while Zettle integration is not yet the canonical order source.
   - Gate: target table exists before import; vector extension support is explicit if embeddings are copied.

8. **4D7 - Workflow Jobs as Inert History**
   - Import jobs into `conversaflow.workflow_jobs` with their original terminal state.
   - Never import old jobs as `pending`, `claimed`, or `running` unless a separate replay decision puts them into `legacy.replay_queue`.
   - Map aggregate conversation/order ids when possible.
   - Preserve inbound event id and original aggregate ids in metadata.
   - Gate: `conversaflow.workflow_jobs` has zero rows where `state in ('pending','claimed','running')` after import.

9. **4D8 - Job Attempts**
   - Import attempts for imported jobs.
   - Preserve outcome/error/timing/metadata.
   - Source has one `running` attempt even though all jobs are completed; import it only as historical evidence and record a finding.
   - Gate: no attempt missing job; `(job_id, attempt)` remains unique.

10. **4D9 - Outbox as Inert Delivery History**
    - Import delivered/dead outbox rows with original terminal state.
    - Map related job, conversation, and order ids where possible.
    - Preserve payload and idempotency keys for audit, but do not make any row deliverable.
    - Gate: zero imported outbox rows where `state in ('pending','delivering')`.

11. **4D10 - Excluded Runtime Archive and Findings**
    - Record synthetic/eval conversation exclusions.
    - Record unmapped memories or runtime rows.
    - If content retention is required for synthetic conversations, add an explicit archive table or observability import path before copying bodies.
    - Gate: excluded row counts equal profiled synthetic counts and are visible in `observability.data_quality_findings`.

12. **4D11 - 4D Validation Review**
    - Re-run core validation.
    - Validate imported row counts by substep.
    - Validate no production-facing conversation/message/turn rows reference synthetic/eval customers.
    - Validate no workflow/outbox row is claimable/deliverable.
    - Update the checklist and phase review before moving to 4E.

Current local 4D result:

- Imported 93 production-verified conversations, 2,146 messages, and 813 conversation turns.
- Excluded 442 synthetic/eval conversations from production-facing conversation tables.
- Imported 136 product/menu rows without vector embeddings.
- Imported 3,357 completed workflow jobs, 3,362 job attempts, and 401 delivered/dead outbox rows as inert history.
- Validation found zero claimable jobs and zero deliverable outbox rows after import.

#### Phase 4E Policy Decisions - Observability History

Confirmed decisions:

- ConversaFlow business `Café Kalala Chapule` maps to tenant `kalalacafe`.
- ConversaFlow default location maps to Kalala branch location `Chapultepec`.
- Synthetic/eval history must have a clearly separated path from real production history.

Terminology:

- Use **production observability** for traces/logs generated by real customer/runtime flows.
- Use **evaluation observability** for traces generated by synthetic eval, shadow comparison, harness, or test workflows.
- No current `unknown_customer` observability class is needed after operator review; the previous unknown bucket is synthetic workflow/evaluation data.

Current evidence rule:

```txt
conversaflow.customers total: 536
synthetic_eval: 443 customers, has eval_traces evidence, synthetic name markers, or operator-confirmed workflow/pipeline test provenance
production_verified: 93 customers, has Twilio message SID evidence
unknown: 0 customers after operator review
```

Important clarification:

- The prior unknown bucket did **not** mean no phone; all 436 rows had phone values.
- Operator review confirmed those rows are synthetic workflow/evaluation data, with markers such as `V2 Synthetic Eval ...`, `smoke-*`, and `KDS E2E Test`.
- The reclassified synthetic/eval bucket contributes 442 excluded conversations, 2,453 excluded messages, and 2,437 excluded turns in the source.

4E execution stance:

1. Add a clear observability classification field in imported trace metadata:
   - `observability_class = 'production'`
   - `observability_class = 'evaluation'`
2. Keep evaluation traces separate from production traces in local/staging classification work. Preferred local target shape:
   - production runtime traces can go to `observability.pipeline_traces` with classification.
   - eval traces should go to a dedicated `observability.evaluation_traces` table or an equivalently explicit target.
3. Do not attach eval traces to production-facing `conversaflow.conversations` unless those conversations were imported in 4D.
4. Use source ids in metadata for excluded eval traces during local/staging review so the history is recoverable without promoting it to production customer history.
5. Treat raw trace `detail` payloads as potentially sensitive. Preserve locally for audit if needed, but for production cutover prefer deleting clearly identified evaluation trace families over importing/redacting them.

Current local 4E result:

- Imported 2,646 production/business runtime pipeline traces into `observability.pipeline_traces`.
- Imported 2,567 synthetic/evaluation pipeline traces into `observability.evaluation_traces`.
- Imported 17 source `eval_traces` into `observability.evaluation_traces`.
- Recorded 5,213 pipeline trace external refs and 17 eval trace external refs.
- Recorded one `phase_4e_observability_import` integration check.
- Validation found zero evaluation rows in production traces, zero production rows in evaluation traces, zero missing trace external refs, and zero trace rows missing tenant ids after backfill.

#### Phase 4F Public Compatibility Audit

Confirmed context:

- `public` is the legacy ConversaFlow schema.
- `conversaflow` is the current source of truth.
- `public.*` should not be imported blindly.

Audit result:

- No public-only customers.
- No public-only conversations.
- No public-only transactions.
- No public-only businesses.
- Public-only rows exist only in runtime/history tables:
  - `messages`: 12
  - `jobs`: 30
  - `job_attempts`: 30
  - `outbox`: 6

All public-only runtime rows trace back to synthetic/evaluation context.

4F recommendation:

- Do not import public-only rows into production-facing product tables.
- Preserve the row set only as local/staging evaluation/archive compatibility evidence if needed.
- Mark public-only pending jobs as `do_not_replay`.
- Keep `conversaflow.*` as the source of truth for common rows.

### Phase 5 - Dashboard tenant switching first

This should be the first application-visible milestone.

Add tenant-first APIs:

```txt
GET /api/me/tenants
GET /api/tenants/:tenantId/capabilities
GET /api/tenants/:tenantId/cash/...
GET /api/tenants/:tenantId/conversaflow/...
GET /api/tenants/:tenantId/kds/...
```

Keep slug routes temporarily:

```txt
/api/:slug/...
```

but implement them as compatibility adapters through `platform.external_refs` and `platform.tenants.slug`.

Dashboard behavior:

- Login resolves accessible tenants from `platform.tenant_memberships`.
- Tenant switching changes selected `tenant_id`, not build-time env.
- Modules gate from `platform.product_instances`.
- Missing products show explicit unavailable states.
- A Cash-only tenant does not fail because ConversaFlow/KDS rows are missing.

### Phase 6 - Logical replication and backfill

Target migration shape:

1. Create target PostgreSQL database with the refined schema.
2. Backfill immutable and low-churn tables first.
3. Backfill large product histories in repeatable batches.
4. Enable logical replication or an equivalent CDC path for source tables that keep changing.
5. Run idempotent catch-up jobs using `legacy.*_mappings`.
6. Freeze writes for a short final cutover.
7. Run final delta import.
8. Run validation gates.
9. Switch app reads/writes product by product.

If Supabase-hosted source limitations block logical replication, use timestamp/id-based incremental backfill per table as fallback, with a longer write freeze for the final delta.

### Phase 7 - Product cutover order

Recommended order:

1. Dashboard tenant switching and capabilities.
2. Cash read paths through canonical `tenant_id`.
3. Cash write paths through canonical staff/contact/tenant ids.
4. KDS tenant-first read RPCs and compatibility wrappers.
5. `commerce.orders` as validated projection from ConversaFlow transactions.
6. ConversaFlow customer/contact resolution against `platform.contacts`.
7. ConversaFlow order creation writes `commerce.orders` first, then projects to KDS.
8. Logs reads `observability`.
9. Supabase Edge Functions are replaced by a host-agnostic backend/job worker.

### Phase 8 - Supabase exit

Do not try to remove Supabase and normalize the schema in the same step.

Exit sequence:

1. Make schema and app contracts PostgreSQL-first while still runnable on Supabase.
2. Replace Supabase-specific auth assumptions with auth-provider-neutral `platform.users`.
3. Replace Supabase Edge Functions with a backend service that owns webhook ingress and job workers.
4. Replace PostgREST-specific RPC dependencies with service APIs or direct internal database functions.
5. Move runtime secrets and scheduled jobs out of Supabase-specific systems.
6. Migrate database hosting after application contracts are already platform-owned.

## Validation Gates

### Data gates

- Every tenant-scoped product table has `tenant_id`.
- Every old tenant/business id has exactly one canonical mapping or one explicit unresolved finding.
- Every old contact/customer id has a mapping or an unresolved finding.
- Cash customer count equals source count unless dedupe is explicitly recorded.
- ConversaFlow customer count equals source count minus approved merges.
- `commerce.orders` count matches eligible `conversaflow.transactions` rows.
- `commerce.order_items` item counts reconcile against `kds.ticket_items` for migrated orders.
- KDS ticket/event counts match source history after mapping.
- Public-only rows are absent from production-facing schemas; any retained evidence is local/staging audit material only.

### Behavior gates

- Owner/admin can access multiple tenants.
- Staff can access only permitted modules/actions.
- Developer/tech assist role can access operational support surfaces without becoming business staff.
- Cash-only tenant sees real Cash data and unavailable ConversaFlow/KDS states.
- Full-stack tenant sees Cash, ConversaFlow, KDS, Dashboard, and Observability capabilities.
- Dashboard no longer requires `VITE_BUSINESS_SLUG`.
- KDS cannot create orders.
- ConversaFlow can create/update orders through `commerce`.
- Logs can read imported traces from `observability`.

### Operational gates

- Backfill scripts are idempotent.
- Logical replication or delta import has no unmapped rows.
- Queue/outbox rows are not accidentally replayed.
- Compatibility views/adapters are documented.
- Rollback path is defined per product cutover.

## Open Decisions

- Confirm which Cash tenant, if any, is the same business as the existing ConversaFlow business and KDS tickets.
- Choose the first non-Supabase auth provider direction: managed OIDC provider or self-hostable OIDC provider.
- Decide whether a parent `platform.organizations` layer is needed soon for consolidated reporting/billing.
- Confirm exact `conversaflow.transactions.details` JSON shape for order item extraction.
- Confirm money conversion using source samples before importing `total_cents`.
- Decide retention policy for imported logs/traces/jobs/outbox after they are preserved.

## Immediate Next Step

Implement the checklist in `docs/migration/2026-05-15-optimized-database-transition-checklist.md`, starting with target schema refinements and tenant mapping confirmation.
