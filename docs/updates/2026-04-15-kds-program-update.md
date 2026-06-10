# KDS Program Update — 2026-04-15

## Status

Completed in this pass:

- mapped the current ownership boundaries across `apps/umi-kds`, `apps/umi-conversaflow`, and root docs
- confirmed `kds` exists but is still empty
- confirmed `apps/umi-kds` is still a scaffold expecting normalized snapshot + realtime events
- decided that `kds` should be populated from existing ConversaFlow data, including names, phone numbers, and ticket details already in the DB
- decided that normalization should live in the shared backend, not in the iPad app and not in a new repo for now
- created root Umi Anthropic-style architecture artifacts
- wrote a source-backed KDS schema and normalization spec
- implemented an additive Supabase migration for `kds` projection tables, helper functions, RLS, and initial backfill logic in the repo
- implemented app-side KDS HTTP clients for snapshot reads, event catch-up polling, and ticket transitions against the new backend RPC contracts

## Open implementation work

_All items below were completed in the 2026-04-16 execution pass. See update section below._

---

## 2026-04-16 Execution pass

### Completed

- applied migration `20260415150000_add_kds_projection_tables` to the live shared Supabase database (`xbudknbimkgjjgohnjgp`)
- confirmed all three `kds` schema objects created: `tickets`, `ticket_items`, `ticket_events`
- backfill ran successfully: 23 source orders → 23 projected tickets (1:1, no duplicates)
- validated data quality: no duplicate `source_transaction_id`, no orphan items for active tickets, no null `business_id`
- validated all three RPC contracts against live data:
  - `get_board_snapshot` returns correct shape matching Swift DTOs with items as embedded JSONB
  - `get_ticket_events` returns monotonically increasing sequences (1 through 23)
  - `transition_ticket` executes cleanly and returns a full ticket row
- added grant of `EXECUTE` on the three public RPCs to the `anon` Postgres role (migration: `grant_kds_rpcs_to_anon`)
- added grant of `USAGE ON SCHEMA kds` to the `anon` Postgres role (migration: `grant_kds_schema_usage_to_anon`)
- exposed `kds` schema in Supabase PostgREST config (`db_schema` and `db_extra_search_path`) so the REST API routes requests to the correct schema
- wired `apps/umi-kds` to the live backend:
  - `KDSBackendURL` and `KDSAnonKey` set in `apps/umi-kds/Info.plist` (at project root, not generated — `INFOPLIST_KEY_*` prefix only works for Apple-defined keys with `GENERATE_INFOPLIST_FILE`; `PBXFileSystemSynchronizedRootGroup` auto-includes all files under `Sources/` as resources so the plist had to live outside that tree)
  - `DeviceSession.businessID` updated from placeholder `"demo-business"` to the live business UUID
- added `Content-Profile: kds` header to all RPC requests in `KDSAPIClient.rpcData()` — PostgREST requires this to route calls to a non-public schema
- app verified against live backend on iPad Pro 13-inch (M5) simulator: board loads from real data, preview orders gone
- decided to keep polling: 23 total events, 0 in the past 24h; no basis for native realtime at current scale

### Anomaly noted

One early order has a UUID as the item `name` because its `details.items[].product_name` field was not populated. The projection fallback to `product_id` works as intended. No action required unless operators report the UUID displaying in the UI.

### Transport decision

Polling kept at 3-second interval. Re-evaluate if event volume exceeds ~1000/hour or operators report latency complaints on live order boards.

### Remaining open questions (carry forward)

- whether `station_id` and `station_name` need stronger upstream ownership instead of opportunistic extraction from `details`
- whether KDS transition permissions should later distinguish kitchen roles more explicitly than current anon-accessible RPCs

## Implementation artifacts

- [kds projection migration](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260415150000_add_kds_projection_tables.sql:1) — applied to live DB 2026-04-16
- `grant_kds_rpcs_to_anon` — applied to live DB 2026-04-16 via MCP
- `grant_kds_schema_usage_to_anon` — applied to live DB 2026-04-16 via MCP
- [KDSAPIClient.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/KDSAPIClient.swift:1) — `Content-Profile: kds` header added
- [Info.plist](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Info.plist:1) — explicit plist at project root with `KDSBackendURL`, `KDSAnonKey`, and all CFBundle keys

## Current recommendation

Build KDS as a CQRS-style read model over ConversaFlow:

- `conversaflow` remains the source of truth
- `kds` becomes the kitchen read surface
- `apps/umi-kds` remains a thin consumer

## Documents added

- [CLAUDE.md](/Users/juanlopez1/Documents/Repositories/Umi/CLAUDE.md:1)
- [KDS schema spec](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/2026-04-15-kds-schema-normalization-spec.md:1)
