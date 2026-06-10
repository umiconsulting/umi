# Supabase Dump Local Restore and Translation Notes - 2026-05-14

## Supersession Note - 2026-05-15

This audit describes the Umi Platform dump and its copied `umi_cash` schema. Later verification found that active Umi Cash production is a separate Supabase project, `rrkzhisnadfrgnhntkiz`, copied locally as `umi_cash_production_local_20260515`.

Use this file for Umi Platform, ConversaFlow, KDS, public compatibility, and historical copied-Cash evidence. Do not use the `umi_cash` counts in this file as active Cash production counts.

Also treat the `conversaflow.customers` count in this file as a raw source count. Some ConversaFlow rows are now known to come from tests, mini-harnesses, and v2 synthetic eval workflows, so production contact import requires classification before using these rows as canonical contacts.

## Restore Source

- Encrypted source archive: `prod-db-handoff-2026-05-13/umi-production-db-dumps-2026-05-13.tar.gz.enc`
- Passphrase source: Desktop text file, used only through OpenSSL `-pass file`; passphrase not printed or copied.
- Decrypted working directory: `/tmp/umi-supabase-dump-restore`
- Local database: `umi_supabase_dump_local`
- Local PostgreSQL: Homebrew PostgreSQL 18.3

The decrypted dump copy that was briefly staged under `docs/migration/audit-output/` was removed. Only schema/count inventories remain in docs.

## Restore Status

The dump restored locally with application schemas and data present.

Required local setup:

- Supabase-style roles: `anon`, `authenticated`, `service_role`, `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `dashboard_user`
- `extensions` schema
- `pgvector` extension installed locally and created as `extensions.vector`

Remaining restore errors are local environment gaps:

- `pg_cron` extension unavailable
- `pg_net` extension unavailable
- `supabase_vault` extension unavailable
- dependent `cron.*` and `vault.secrets` objects unavailable

These are not blockers for data translation. They matter later only if local job scheduling, network extension calls, or Supabase Vault secrets need to be exercised.

## Inventory Artifacts

- `docs/migration/audit-output/supabase-local-schema.sql`
- `docs/migration/audit-output/supabase-local-tables.csv`
- `docs/migration/audit-output/supabase-local-columns.csv`
- `docs/migration/audit-output/supabase-local-foreign-keys.csv`
- `docs/migration/audit-output/supabase-local-row-counts.csv`

## Schema Summary

```txt
auth: 23 tables, 225 rows
conversaflow: 23 tables, 24,535 rows
kds: 4 tables, 269 rows
public: 22 tables, 4,343 rows
realtime: 8 tables, 69 rows
storage: 8 tables, 61 rows
supabase_migrations: 1 table, 49 rows
umi_cash: 12 tables, 372 rows
```

Important product row counts:

```txt
conversaflow.businesses: 1
conversaflow.customers: 536
conversaflow.conversations: 535
conversaflow.conversation_turns: 1,594
conversaflow.messages: 3,948
conversaflow.products: 136
conversaflow.transactions: 48
conversaflow.jobs: 3,332
conversaflow.job_attempts: 3,337
conversaflow.pipeline_traces: 5,177
kds.tickets: 48
kds.ticket_items: 70
kds.ticket_events: 151
umi_cash.Tenant: 3
umi_cash.User: 64
umi_cash.LoyaltyCard: 59
umi_cash.Visit: 31
umi_cash.Transaction: 3
umi_cash.RewardConfig: 14
umi_cash.GiftCard: 1
umi_cash.Session: 132
```

## Tenant and Identity Findings

Current tenant sources:

- `conversaflow.businesses`: 1 row
- `public.businesses`: 1 row
- `umi_cash.Tenant`: 3 rows
- `kds.tickets`: 1 distinct `business_id`
- `conversaflow.transactions`: 1 distinct `business_id`
- `conversaflow.customers`: 1 distinct `business_id`

Contact identity shape:

- Cash users: 64 rows; 59 with phone; 5 with email
- ConversaFlow customers: 536 rows; 536 with phone; no email column
- Exact normalized phone overlap: 0
- Last-10-digits normalized phone overlap: 2

Interpretation:

- Cash and ConversaFlow have mostly disjoint customer/contact populations.
- Migration should not assume a large automatic customer merge.
- Contact reconciliation should create separate `platform.contacts` first, then merge only high-confidence matches such as tenant + normalized phone equality after country-code normalization rules are explicit.

## Translation Direction

### `platform.tenants`

Create canonical tenants from all product-local tenant sources:

1. Start with every `umi_cash."Tenant"` row.
2. Add every `conversaflow.businesses` row that is not confidently mapped to an existing Cash tenant.
3. Store source ids in `platform.external_refs`, not as canonical ids.

External refs:

- `cash / umi_cash / Tenant / id`
- `cash / umi_cash / Tenant / slug`
- `conversaflow / conversaflow / businesses / id`
- `conversaflow / public / businesses / id` for compatibility

### `platform.locations`

Create from `umi_cash."Location"` first.

For ConversaFlow, create a default location only if operational behavior requires branch scope. Current ConversaFlow data has one business id and no first-class location table in the inspected core tables.

### `platform.product_instances`

Seed by observed product data:

- Every Cash tenant gets `cash=active`.
- The ConversaFlow business tenant gets `conversaflow=active`.
- The tenant with KDS tickets gets `kds=active`.
- Dashboard should be `active` for tenants intended to appear in owner UI.
- Missing products should be explicit `missing`, not absent.

### `platform.contacts` and `platform.contact_identities`

Cash source:

- `umi_cash."User"` rows with `role='CUSTOMER'` become contacts.
- Phone/email become `platform.contact_identities`.
- Cash `User.id` becomes `platform.external_refs`.

ConversaFlow source:

- `conversaflow.customers` become contacts unless they match an existing tenant-scoped normalized phone.
- `phone` becomes a `phone` identity and likely a `whatsapp` identity when channel provenance confirms it.
- ConversaFlow `customers.id` becomes `platform.external_refs`.

Do not merge on display name. Do not merge on last-10 phone alone until country-code normalization is documented.

### `platform.staff_members`

Initial staff candidates come from Cash users with `role in ('STAFF', 'ADMIN')`.

Do not migrate dashboard staff into `conversaflow.staff_members`; the May 14 platform plan supersedes the pending dashboard staff/external-ref migration. Staff should land in `platform.staff_members` with product permissions derived later.

### `commerce.orders`

Migrate `conversaflow.transactions` where `transaction_type='order'`.

Mapping:

- `business_id` -> canonical `tenant_id` through `platform.external_refs`
- `customer_id` -> canonical `contact_id` through external refs
- `status` -> `commerce.orders.status`
- `total_amount` -> `total_cents` after currency/scale confirmation
- `details` -> source metadata plus item extraction input
- `created_at` -> `created_at` / `placed_at`

`public.transactions` should be treated as compatibility/historical duplication and only migrated if a row is absent from `conversaflow.transactions`.

### `commerce.order_items`

Extract from `conversaflow.transactions.details` after inspecting JSON shape. Do not invent parsing rules from code assumptions; build a sample-driven extractor and validate item count against KDS `ticket_items`.

### `kds`

KDS should be rebuilt from canonical `commerce.orders` plus item rows where possible.

Preserve existing KDS state only as projection state:

- `kds.tickets.source_transaction_id` maps to `commerce.orders` through migrated transaction refs.
- `kds.ticket_events` can be migrated as projection event history if operationally useful.
- `kds.device_sessions` is empty in this dump.

### `cash`

Cash product tables should map from `umi_cash`:

- `Tenant` -> `platform.tenants` plus `cash.wallet_programs`
- `User` customers -> `platform.contacts` plus `cash.loyalty_accounts`
- `LoyaltyCard` -> `cash.loyalty_cards`
- `Visit` -> cash visit/reward event model or `cash.wallet_transactions` depending on final schema refinement
- `Transaction` -> `cash.wallet_transactions`
- `RewardConfig` -> `cash.reward_configs`
- `RewardRedemption` -> `cash.reward_redemptions`
- `GiftCard` -> `cash.gift_cards`
- `ApplePushToken` -> `cash.pass_devices` once pass rows are modeled
- `Session` should not migrate as durable product state
- `OtpVerification` should not migrate unless needed for a short compatibility window

### `conversaflow`

Keep conversational runtime data in `conversaflow`, but switch tenant/contact/order references:

- `business_id` -> `tenant_id`
- `customer_id` -> `contact_id`
- order references -> `commerce.orders`
- `messages.embedding` and `products.name_embedding` require `pgvector`
- `jobs`, `job_attempts`, `outbox`, and traces are operational history; migrate only if local replay/debug value justifies it

### `observability`

Move append-only operational diagnostics into `observability`:

- `pipeline_traces`
- `edge_function_logs`
- `security_logs`
- selected job/outbox attempt history if retained as diagnostics rather than runtime queues

## Proposed Migration Phases

1. Build mapping tables in `legacy`:
   - old schema/table/id -> canonical id
   - tenant mapping
   - contact mapping
   - order mapping
2. Populate `platform.tenants`, `platform.locations`, and `platform.product_instances`.
3. Populate `platform.contacts` and `platform.contact_identities` with conservative dedupe.
4. Populate `commerce.orders` from ConversaFlow transactions.
5. Populate `commerce.order_items` from transaction JSON and validate against KDS items.
6. Superseded: this audit originally proposed populating `cash` product tables from copied `umi_cash`; use active Cash production instead.
7. Rebuild or migrate `kds` projections from `commerce`.
8. Migrate ConversaFlow conversations/messages/memory with canonical tenant/contact ids.
9. Move diagnostics to `observability`.
10. Add compatibility views only where application cutover needs them.

## Validation Gates Before Writing Import SQL

- Superseded: confirm tenant mapping for the 1 ConversaFlow business against the 4 active Cash production tenants.
- Inspect representative `transactions.details` JSON samples locally without committing PII.
- Decide phone normalization policy for Mexico numbers before deduping contacts.
- Decide whether Cash staff users become only `platform.staff_members` or also `platform.users`.
- Decide whether Auth `auth.users` is carried forward or replaced by application-neutral `platform.users.auth_subject`.
- Confirm whether `Session`, `OtpVerification`, `cron`, `vault`, and realtime internals are excluded from the durable migration.
