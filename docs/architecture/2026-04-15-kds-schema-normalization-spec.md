# KDS Schema And Normalization Spec — 2026-04-15

## Objective

Populate schema `kds` with kitchen-facing data that already exists in the shared database, define the normalization layer required for the KDS board, and decide where that logic should live.

This spec is intentionally pragmatic:

- keep `conversaflow` as the operational source of truth
- keep `apps/umi-kds` as a thin normalized consumer
- build `kds` as a read model/projection surface
- avoid adding another repo or service unless the current boundaries fail on measured criteria

## Current verified state

- `conversaflow` is the active backend schema for shared runtime access.
- `kds` exists but is empty.
- `apps/umi-kds` already expects a normalized snapshot plus ordered realtime events, but its API and realtime clients are still placeholders.
- The live order source is still the ConversaFlow transaction model plus its related customer and status event data.

Relevant local sources:

- [2026-04-15-supabase-multischema-state.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/migration/2026-04-15-supabase-multischema-state.md:16)
- [2026-04-15-umi-platform-cutover-plan.md](/Users/juanlopez1/Documents/Repositories/Umi/docs/migration/2026-04-15-umi-platform-cutover-plan.md:1)
- [apps/umi-kds/Sources/Docs/KDSArchitecture.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Docs/KDSArchitecture.md:26)
- [apps/umi-kds/Sources/Data/OrderRepository.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/OrderRepository.swift:47)
- [apps/umi-conversaflow/supabase/functions/_shared/supabase.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/supabase.ts:3)

## Requirements

### Functional requirements

1. `kds` must contain enough data to render a ticket board without the iPad app decoding raw ConversaFlow order payloads.
2. The first population pass must reuse data already present in the shared database, including customer names, phone numbers, ticket state, notes, totals, and item lines.
3. The KDS contract must support both snapshot reads and ordered incremental updates.
4. KDS status changes must flow back to the operational backend, not remain local to the app.
5. The app must stay channel-agnostic even if WhatsApp remains the first source.

### Non-functional requirements

1. Reads for KDS should be simpler and cheaper than reading raw operational tables directly.
2. Realtime ordering must be preserved across reconnects.
3. The design should minimize operational complexity and extra deployments.
4. The design should preserve schema boundaries: write model in `conversaflow`, read model in `kds`.

## Decision summary

### 1. Should `kds` be populated with names, phones, and ticket data already in the DB?

Yes.

The first `kds` population should backfill from existing ConversaFlow data:

- `transactions`
- `customers`
- `transaction_status_events`
- `businesses`

The KDS board needs identity and contact context already available in the operational model, especially:

- `transaction_id`
- `business_id`
- customer display name
- customer phone number
- pickup person
- ticket status
- timestamps
- item lines
- customer notes
- total amount
- station assignment or derived station

### 2. Do we need a normalization layer?

Yes.

The app model in `apps/umi-kds` is already normalized around `KitchenOrder`, `KitchenItem`, and ordered `KitchenEvent`. The current operational data is not in that app-facing shape. A normalization layer is therefore required.

### 3. Where should the normalization layer live?

It should live in `apps/umi-conversaflow` plus schema-qualified SQL under `kds`.

Reason:

- the write model already lives in ConversaFlow
- the existing backend already owns jobs, outbox, idempotency, and shared Supabase access
- the KDS app is explicitly documented as a thin client
- introducing another repo now would add deploy and ownership cost without solving a demonstrated bottleneck

### 4. Should this be only in the KDS app?

No.

App-side normalization would duplicate backend knowledge, leak channel-specific structure into the iPad client, complicate reconnect safety, and make future consumers harder.

### 5. Should this move to another repo now?

No, not in the first implementation.

A separate repo is only justified if later metrics show one of these failure modes:

- projection logic deploy cadence conflicts with ConversaFlow backend cadence
- the team needs separate ownership and release control
- projection workload exceeds what the current backend can handle cleanly
- security or runtime isolation requirements appear

None of those is currently demonstrated in the repo state.

## Recommended `kds` model

Use projection tables, not materialized views, for the KDS runtime surface.

### Recommended tables

- `kds.tickets`
  - one row per active or recent kitchen ticket
  - denormalized, query-friendly board surface
- `kds.ticket_items`
  - one row per normalized kitchen item
- `kds.ticket_events`
  - ordered change log with monotonic sequence for realtime reconciliation
- `kds.device_sessions` or `kds.kitchen_devices`
  - optional later phase for device-scoped auth and station binding

### Minimum `kds.tickets` fields

- `ticket_id`
- `source_transaction_id`
- `business_id`
- `source_channel`
- `customer_name`
- `customer_phone`
- `pickup_person`
- `status`
- `station_id`
- `station_name`
- `customer_note`
- `total_amount`
- `created_at`
- `updated_at`
- `last_event_sequence`
- `raw_details_hash` or equivalent idempotency helper

### Minimum `kds.ticket_items` fields

- `ticket_item_id`
- `ticket_id`
- `name`
- `quantity`
- `variant_name`
- `notes`
- `is_cancelled`
- display ordering field

### Minimum `kds.ticket_events` fields

- `sequence`
- `ticket_id`
- `business_id`
- `kind`
- `status`
- `occurred_at`
- `source`
- optional payload JSON for reconciliation

## Population strategy

### Phase A — Initial backfill

Run a one-time backfill that:

1. Reads existing `conversaflow.transactions`
2. Joins or resolves customer names and phone numbers from `customers`
3. Extracts kitchen item lines from `details.items`
4. Computes current KDS ticket state
5. Inserts or upserts into `kds.tickets` and `kds.ticket_items`
6. Seeds `kds.ticket_events` with an initial `snapshot_reconciled` or `order_upserted` event sequence

### Phase B — Incremental maintenance

After backfill, keep `kds` updated through backend-owned projection logic:

- on transaction insert/update
- on status change
- on item cancellation or correction
- on order completion/cancellation

The projection writer should upsert `kds.tickets`, rewrite or diff `kds.ticket_items` as needed, and append a new ordered row into `kds.ticket_events`.

## Why projection tables instead of materialized views

PostgreSQL materialized views are persisted query results that are refreshed with `REFRESH MATERIALIZED VIEW`; the refresh replaces contents rather than incrementally updating a row-level operational projection. That is a poor fit for an always-on kitchen board with ordered events and reconnect semantics.

For this reason:

- use projection tables for runtime KDS reads
- keep materialized views only for secondary analytics if needed later

## Why a narrow KDS projection is better than subscribing the app to raw operational tables

Supabase documents that Postgres Changes authorization work scales per subscribed user and that change processing is single-threaded to preserve order. That pushes the design toward smaller, purpose-built tables for realtime consumers instead of wide operational tables with extra fields and joins.

For Umi that means:

- KDS should subscribe to `kds.ticket_events` or similar narrow projection
- the iPad app should fetch `kds.tickets` snapshot, not raw `transactions`
- the operational backend should keep the projection current

## Benchmarked design choice

### Chosen design

Use CQRS-style separation:

- commands and operational truth in `conversaflow`
- query/read model in `kds`
- normalization and projection maintenance in `apps/umi-conversaflow`

### Why this is the best current choice

- lowest operational complexity: no new repo or service
- lowest consumer complexity: thin iPad client
- better realtime scalability than exposing raw operational tables
- better reconnect semantics through explicit event sequencing
- cleaner schema ownership

### What would disprove this choice later

- measurable projection lag that current workers cannot absorb
- deployment coupling that blocks safe releases
- multi-consumer projection complexity that justifies a dedicated service

## Execution order

1. Define the `kds` SQL contract in migrations.
2. Backfill `kds` from existing `conversaflow` data.
3. Add incremental projection maintenance in the shared backend.
4. Expose snapshot and command contracts for KDS.
5. Wire `apps/umi-kds` to the new snapshot + realtime event surface.
6. Add auth/RLS for device- and business-scoped reads.
7. Measure projection lag, realtime throughput, and reconnect correctness before considering any repo split.

## Source-backed rationale

Primary sources used for the architecture choice:

- Supabase Realtime architecture and Postgres Changes guidance: <https://supabase.com/docs/guides/realtime/architecture>, <https://supabase.com/docs/guides/realtime/postgres-changes>
- Supabase Edge Functions and background tasks: <https://supabase.com/docs/guides/functions>, <https://supabase.com/docs/guides/functions/background-tasks>
- PostgreSQL materialized view behavior: <https://www.postgresql.org/docs/current/rules-materializedviews.html>, <https://www.postgresql.org/docs/15/sql-refreshmaterializedview.html>
- CQRS tradeoffs: Martin Fowler, <https://martinfowler.com/articles/201701-event-driven.html>
- Event-time and correctness/latency/cost tradeoffs for incremental processing: Google Research, “The Dataflow Model”, <https://research.google/pubs/pub43864>

Inference:

The exact table names and final `kds` projection shape are Umi-specific design choices inferred from the current codebase and these sources; they are not stated verbatim in the external references.
