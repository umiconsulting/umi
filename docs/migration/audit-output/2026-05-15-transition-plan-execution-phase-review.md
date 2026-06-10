# Optimized Database Transition Execution Phase Review - 2026-05-15

## Scope

Executed the local portions of `docs/migration/2026-05-15-optimized-database-transition-plan.md` through Phase 4E.

No production migration was applied. Production Supabase was used only for read-only source refresh of Umi Platform app schemas.

## Local Databases

Source copies:

- `umi_cash_production_local_20260515`
- `umi_platform_production_local_20260515`
- `umi_platform_and_cash_full_local` retained as older Desktop dump evidence
- `umi_supabase_dump_local` retained as earlier audit evidence

Execution targets:

- `umi_platform_transition_exec_20260515`: first execution attempt, retained for comparison
- `umi_platform_transition_exec_v2_20260515`: corrected execution target after synthetic/eval classification review

No existing local database was dropped or overwritten.

## Scripts Added

- `docs/migration/local-postgres/020_local_source_fdw.sql`
- `docs/migration/local-postgres/030_platform_identity_backfill.sql`
- `docs/migration/local-postgres/040_cash_product_backfill.sql`
- `docs/migration/local-postgres/041_commerce_order_backfill.sql`
- `docs/migration/local-postgres/042_kds_projection_backfill.sql`
- `docs/migration/local-postgres/043_conversaflow_runtime_backfill.sql`
- `docs/migration/local-postgres/044_observability_history_backfill.sql`

## Phase 0 Review - Safety and Source Inventory

Completed:

- Confirmed active Cash production is separate from Umi Platform.
- Confirmed Umi Platform copied `umi_cash` is stale.
- Refreshed Umi Platform app schemas into `umi_platform_production_local_20260515`.
- Kept the previous local databases intact.

Restore caveats for `umi_platform_production_local_20260515`:

- `public` already exists locally.
- One `pg_trgm` index did not restore because the local extension/opclass was not pre-created.
- Supabase `auth` FK/policy references did not restore because this app-schema copy excludes `auth`.

These caveats do not block source-data profiling or platform identity backfill.

## Phase 1 Review - Target Schema

Created a fresh target database:

```txt
umi_platform_transition_exec_20260515
```

Applied:

- `001_platform_core.sql`
- `002_commerce_core.sql`
- `003_cash_core.sql`
- `004_conversaflow_core.sql`
- `005_kds_core.sql`
- `006_observability_core.sql`
- `007_legacy_migration_core.sql`
- `010_seed_product_matrix.sql`

Validation passed:

- Product tables missing `tenant_id`: `0`
- Product `tenant_id` columns missing FK to `platform.tenants(id)`: `0`
- Verified duplicate contact identities: `0`
- Replay rows requiring operator approval: `0`
- RLS with no user context returned `0` tenants

## Phase 2 Review - Mapping and Source Access

Added local FDW source schemas in the execution target:

```txt
src_cash_public: 14 foreign tables
src_platform_conversaflow: 14 foreign tables
src_platform_kds: 4 foreign tables
src_platform_public: 8 foreign tables
```

Iteration:

- First FDW import failed on `extensions.vector`; added local `extensions` schema and `vector` extension.
- Second FDW import failed on source KDS enum types; added local KDS enum compatibility types for foreign table reading.

## Phase 3 Review - Platform Identity Backfill

The first backfill attempt imported `100` ConversaFlow contacts with Twilio evidence and staged `436` contacts as unknown.

Review finding:

- Synthetic/eval evidence must take precedence over Twilio evidence for migration safety.
- The script was patched and rerun into a fresh target:

```txt
umi_platform_transition_exec_v2_20260515
```

Final v2 source-to-target coverage:

```txt
cash_tenants: 4
mapped_cash_tenants: 4
cash_locations: 3
mapped_cash_locations: 3
cash_customers: 208
mapped_cash_customers: 208
cash_staff_users: 6
mapped_cash_staff: 6
cf_raw_customers: 536
mapped_cf_customers: 93
staged_cf_customers: 443
```

Final v2 table counts:

```txt
platform.tenants: 6
platform.locations: 5
platform.users: 7
platform.staff_members: 6
platform.contacts: 302
platform.contact_identities: 395
legacy.tenant_mappings: 5
legacy.location_mappings: 4
legacy.user_mappings: 6
legacy.staff_mappings: 6
legacy.contact_mappings: 301
observability.data_quality_findings: 444
```

Notes:

- `platform.tenants` includes the two local seed tenants plus four active Cash production tenants.
- `platform.contacts` includes one local seed contact, 208 active Cash customer contacts, and 93 production-eligible ConversaFlow contacts.
- `kalalacafe` is marked active for `cash`, `dashboard`, `conversaflow`, `kds`, and `observability`.
- Other active Cash tenants are marked active for `cash` and `dashboard`, with missing `conversaflow`, `kds`, and `observability`.
- The ConversaFlow business to Cash tenant/location mapping is recorded as `candidate`, not final.

Data quality findings:

```txt
conversaflow_business_cash_tenant_candidate_match: 1
conversaflow_contact_synthetic_eval: 443
conversaflow_contact_unknown: 0
```

Validation:

- Target schema validation still passes.
- Verified duplicate contact identities: `0`.
- One unverified duplicate phone candidate remains, as expected by the non-blocking phone policy.
- A sampled imported Cash admin user can see only their tenant through RLS.
- No user context returns zero tenants through RLS.

## Phase 4 Split

Phase 4 was split into reviewable slices:

1. **4A Cash product data**: wallet programs, loyalty accounts/cards, visits, wallet transactions, rewards, gift cards, passes, and pass devices.
2. **4B ConversaFlow commerce orders**: transaction-to-order import, item extraction, status history, and order data-quality findings.
3. **4C KDS projection history**: ticket, ticket item, and event mapping to canonical orders/items.
4. **4D ConversaFlow runtime history**: conversations, messages, turns, memory, products, jobs, attempts, and outbox.
5. **4E Observability history**: traces, logs, eval evidence, integration checks, and audit history.
6. **4F Public compatibility delta**: compare `public.*` compatibility tables against `conversaflow.*` and import only source-only rows.

Each slice must be idempotent, preserve source ids in mappings or refs, and record unresolved cases as `observability.data_quality_findings`.

## Phase 4A Review - Cash Product Backfill

Applied to:

```txt
umi_platform_transition_exec_v2_20260515
```

Imported:

```txt
cash.wallet_programs: 4
cash.loyalty_accounts: 208
cash.loyalty_cards: 208
cash.visit_events: 174
cash.wallet_transactions: 5
cash.reward_configs: 15
cash.reward_redemptions: 6
cash.gift_cards: 1
cash.passes: 193
cash.pass_devices: 188
platform.external_refs for Cash LoyaltyCard/RewardConfig: 223
```

Archived/not imported:

```txt
cash_otp_verification_archived_not_imported: 1 tenant-level finding
cash_session_archived_not_imported: 3 tenant-level findings
```

Validation:

- No missing contacts for loyalty accounts.
- No missing loyalty accounts for cards.
- No missing cards for visits, wallet transactions, reward redemptions, pass devices, or redeemed gift cards.
- No duplicate Apple pass serials or Google pass object ids in the source.
- Core tenant/FK/RLS validation still passes.

## Phase 4B Review - ConversaFlow Commerce Orders

Profile findings before import:

```txt
conversaflow.transactions: 50
transaction_type: order
status split: 25 completed, 25 cancelled
total_amount range: 0.00 to 381.00 pesos
details.items rows: 73
item keys: product_name, quantity, unit_price, product_id, variant_name, cancelled
transaction_status_events: 57
```

Mapping findings:

```txt
missing business mappings: 0
missing customer contact mappings: 34 orders
missing service/location mappings: 50 orders
orders where source total differs from item sum: 2
```

Imported:

```txt
commerce.orders: 50
commerce.order_items: 73
commerce.order_events: 57
legacy.order_mappings: 50
platform.external_refs for ConversaFlow transactions: 50
```

Implementation notes:

- Order totals use `round(total_amount * 100)` and currency `MXN`.
- Source totals are preserved as `source_total_amount` and `source_total_cents` in metadata.
- Full raw `transactions.details` payloads were not copied wholesale because some keys can contain customer data.
- Source service ids are preserved in metadata until the missing service/location mapping source is recovered or replaced.
- Missing contact/location mappings are explicit data-quality findings rather than silent import loss.

Validation:

- No orders missing a tenant.
- No order items missing an order.
- No order events missing an order.
- No imported order missing a `legacy.order_mappings` row.
- Core tenant/FK/RLS validation still passes.

## Phase 4C Review - KDS Projection History

Profile findings before import:

```txt
kds.tickets: 50
kds.ticket_items: 73
kds.ticket_events: 164
kds.device_sessions: 0
ticket statuses: 25 completed, 25 cancelled
ticket station ids: 49 null, 1 expo
ticket events with null source_event_key: 138
```

Mapping findings:

```txt
tickets missing commerce order mapping: 0
ticket items missing commerce order item by transaction/display_order: 0
tickets missing tenant mapping: 0
```

Imported:

```txt
kds.stations: 1
kds.tickets: 50
kds.ticket_items: 73
kds.ticket_events: 164
legacy.kds_ticket_mappings: 50
platform.external_refs for KDS tickets: 50
```

Implementation notes:

- KDS remains a projection/read model. Imported tickets point at canonical `commerce.orders`.
- Imported ticket items point at canonical `commerce.order_items`.
- Source ticket event `sequence` is preserved for idempotence because most source events have null `source_event_key`.
- KDS ticket `location_id` uses the candidate ConversaFlow business default location mapping.

Validation:

- No KDS tickets missing an order.
- No KDS ticket items missing a ticket.
- No KDS ticket items missing an order item.
- No KDS ticket events missing a ticket or order.
- No KDS tickets missing a `legacy.kds_ticket_mappings` row.
- 34 KDS tickets have null `contact_id`, matching the already-recorded ConversaFlow order contact mapping gap.
- Core tenant/FK/RLS validation still passes.

## Phase 4D Review - ConversaFlow Runtime History

Safety gate before import:

```txt
source jobs in pending/claimed/running: 0
source outbox in pending/delivering: 0
source job attempts still marked running: 1
```

Production-facing conversation subset:

```txt
importable production-verified conversations: 93
importable messages: 2,146
importable conversation turns: 813
mapped customer preferences: 8
excluded conversations: 442
excluded synthetic/eval conversations: 442
excluded unknown-customer conversations: 0
```

Imported:

```txt
conversaflow.channels: 2
conversaflow.channel_accounts: 2
conversaflow.conversations: 93
conversaflow.messages: 2,146
conversaflow.conversation_turns: 813
conversaflow.memory_items: 8
conversaflow.products: 136
conversaflow.workflow_jobs: 3,357
conversaflow.job_attempts: 3,362
conversaflow.outbox: 401
```

Runtime state after import:

```txt
workflow_jobs.completed: 3,357
outbox.delivered: 394
outbox.dead: 7
job_attempts.success: 3,354
job_attempts.error: 7
job_attempts.running: 1
```

Implementation notes:

- Production-facing `conversaflow.conversations`, `messages`, and `conversation_turns` include only rows whose customer has a production contact mapping.
- Synthetic/eval conversation histories were not copied into production-facing conversation tables.
- Completed jobs and delivered/dead outbox rows were imported as inert terminal history.
- Product/menu facts were imported into a new local `conversaflow.products` table; source vector embeddings were not copied.
- One source job attempt remained `running` even though the parent job was terminal; it was imported as historical evidence and recorded as a finding.

Data quality findings:

```txt
conversaflow_conversation_synthetic_eval_excluded: 442
conversaflow_conversation_unknown_contact_excluded: 0
conversaflow_customer_preferences_unmapped_contact_excluded: 1
conversaflow_job_attempt_running_source_archived: 1
conversaflow_product_embeddings_not_copied: 1
```

Validation:

- No messages missing a conversation.
- No turns missing a conversation.
- No memory items missing a contact.
- No job attempts missing a job.
- No outbox rows missing a referenced job.
- No claimable jobs after import.
- No deliverable outbox rows after import.
- No synthetic/eval conversations were imported into production-facing conversation tables.
- External refs exist for imported conversations, messages, turns, products, jobs, and outbox rows.
- Core tenant/FK/RLS validation still passes.

## Phase 4E Review - Observability History

Profile findings before import:

```txt
production pipeline traces: 2,603
production business-runtime traces without conversation id: 43
synthetic/evaluation pipeline traces: 2,567
source eval_traces: 17
```

Imported:

```txt
observability.pipeline_traces: 2,646
observability.evaluation_traces from pipeline_traces: 2,567
observability.evaluation_traces from eval_traces: 17
platform.external_refs for pipeline_traces: 5,213
platform.external_refs for eval_traces: 17
observability.integration_checks phase_4e_observability_import: 1
```

Implementation notes:

- Production and business-runtime traces are in `observability.pipeline_traces`.
- Synthetic/evaluation traces are in dedicated `observability.evaluation_traces`.
- Some source trace rows did not carry `business_id`; tenant ids were resolved through target conversations, source conversations, or mapped orders.
- Raw trace detail was preserved locally with explicit `observability_class` metadata. Production cutover still needs a final redaction policy if this data leaves the local/staging environment.

Validation:

- No evaluation rows in `observability.pipeline_traces`.
- No production rows in `observability.evaluation_traces`.
- No missing trace external refs.
- No production trace rows missing tenant ids.
- No evaluation trace rows missing tenant ids.
- Core tenant/FK/RLS validation still passes.

## Current Stop Point

Stop before Phase 4F public compatibility delta.

Reasons:

- ConversaFlow business to Cash tenant/location mapping still requires human confirmation before production use.
- The previous ConversaFlow unknown bucket was reviewed and confirmed as synthetic workflow/evaluation data.
- `conversaflow.transactions.service_id` has no copied source table, so all 50 imported orders currently have null `location_id` and an explicit finding.
- Phase 4F should compare `src_platform_public.*` compatibility tables against `src_platform_conversaflow.*` and import only public-only rows that are still needed.
