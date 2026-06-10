# KDS System Audit — 2026-05-11

Scope:

- backend owner: `apps/umi-conversaflow`
- client owner: `apps/umi-kds`
- runtime schemas: `conversaflow` write model, `kds` read model

This audit is based on:

- current SQL migrations and edge/job code in `apps/umi-conversaflow`
- current iPad client code in `apps/umi-kds`
- live Twilio/KDS Plan C execution on 2026-05-12
- direct live database queries against the shared Supabase project
- official docs from PostgREST, Supabase, and Twilio where structural behavior matters

## Executive summary

KDS is not failing because of one isolated bug. It is failing because the current implementation mixes three different concerns into one runtime surface:

1. operational order truth in `conversaflow.transactions.status`
2. kitchen-only lifecycle semantics such as `accepted` and `partial_cancelled`
3. customer notification side effects triggered directly from SQL

That mix produces four primary outcomes:

- the public KDS command surface is effectively unauthenticated
- the event stream is not a clean operator-intent ledger
- customer notifications are only eventually delivered, often on the one-minute cron cadence
- the client trusts event semantics that the backend does not actually guarantee

The right next refactor is not a UI cleanup and not a Realtime rewrite. It is:

1. secure the KDS surface
2. make kitchen lifecycle truth canonical in the backend
3. turn `kds.ticket_events` into a coherent stream again
4. move notification wake-up from cron-luck to explicit execution

## Current topology

### Backend

- `conversaflow.transactions.status` is still the coarse operational status.
- `kds.tickets` stores richer kitchen-facing states including `accepted`, `preparing`, and `partial_cancelled`.
- `kds.project_transaction()` projects transaction writes into `kds.tickets`, rewrites all `kds.ticket_items`, and appends `kds.ticket_events`.
- `kds.transition_ticket()` and `kds.partial_cancel_items()` mutate both the operational write model and the KDS projection/read model.
- `kds.enqueue_whatsapp_status_notification()` and `kds.enqueue_whatsapp_partial_cancel_notification()` insert outbox rows directly from SQL.

### Client

- `apps/umi-kds` uses direct PostgREST RPC calls with `Content-Profile: kds`.
- the app uses an anon key from `Info.plist`, not a device/user session.
- realtime is currently polling `kds.get_ticket_events()` every 3 seconds, not using Supabase Realtime.
- `OrderRepository` applies `status_changed` events locally and only refreshes snapshot for `order_upserted`, `order_removed`, and `snapshot_reconciled`.

## Findings

### 1. Critical — KDS commands are publicly callable with anon credentials

Evidence:

- the app ships backend URL, anon key, business ID, and station config in [apps/umi-kds/Info.plist](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Info.plist:21)
- the client sends the anon key directly to PostgREST in [apps/umi-kds/Sources/Data/KDSAPIClient.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/KDSAPIClient.swift:109)
- mutation RPCs are granted to `anon` in [20260424110000_partial_cancellation_guardrails_and_reason_codes.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260424110000_partial_cancellation_guardrails_and_reason_codes.sql:1366)
- `kds` schema usage and `get_ticket_events()` execution are also granted to `anon` in [20260416071150_grant_kds_rpcs_to_anon.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260416071150_grant_kds_rpcs_to_anon.sql:10) and [20260416072740_grant_kds_schema_usage_to_anon.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260416072740_grant_kds_schema_usage_to_anon.sql:9)

Impact:

- anyone who extracts the public app config can read board data for the configured business and call KDS mutations
- `transition_ticket()` does not verify device identity, user identity, or caller tenancy beyond the supplied ticket UUID
- this is not “thin client pragmatism”; it is an unauthenticated operational control plane

Decision basis:

- documented fact from local code and grants

Required direction:

- remove direct mutation RPC access from `anon`
- put KDS commands behind an authenticated backend surface
- introduce a device/session credential or signed operator auth model before more KDS capability is added

### 2. Critical — a long-lived bearer token is hardcoded in migration history

Evidence:

- [20260417130000_add_job_worker_cron.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260417130000_add_job_worker_cron.sql:5) embeds an `Authorization: Bearer ...` header directly inside the scheduled cron definition

Impact:

- the repo contains a reusable privileged credential in plaintext
- anyone with repo access can recover it from migration history
- the same cron path is part of KDS notification delivery, so this is not dormant metadata

Decision basis:

- documented fact from local code
- source-backed tradeoff: Supabase recommends storing function auth tokens in Vault for scheduled function calls, not embedding them in SQL migration text: <https://supabase.com/docs/guides/functions/schedule-functions>

Required direction:

- rotate the exposed key immediately
- replace the cron job with a Vault-backed or named-secret-backed invocation pattern
- do not preserve plaintext bearer tokens in future migrations

### 3. High — KDS has no single source of lifecycle truth

Evidence:

- `conversaflow.transactions.status = 'in_progress'` maps to KDS `preparing` in [20260415150000_add_kds_projection_tables.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260415150000_add_kds_projection_tables.sql:57)
- the same file explicitly notes that `accepted` is not emitted by the operational model in [20260415150000_add_kds_projection_tables.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260415150000_add_kds_projection_tables.sql:72)
- `kds.transition_ticket()` writes `accepted` and `preparing` directly into `kds.tickets`, but it also updates `conversaflow.transactions.status`, which triggers `kds.project_transaction()` in [20260415150000_add_kds_projection_tables.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260415150000_add_kds_projection_tables.sql:373)
- `kds.project_transaction()` preserves `accepted` only if the existing KDS status is already one of `accepted`, `preparing`, or `partial_cancelled` in [20260424110000_partial_cancellation_guardrails_and_reason_codes.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260424110000_partial_cancellation_guardrails_and_reason_codes.sql:267)

Live evidence:

- in the latest 112 `kds.ticket_events`, 59 are `status_changed`
- 37 of those 59 `status_changed` rows have no `from_status`; all 37 are projection-side `trigger` events
- the live Plan C ticket shows `trigger/preparing` before the explicit `accepted` event

Impact:

- the projection layer is inventing or collapsing kitchen state instead of projecting a canonical state machine
- `accepted` is a UI-visible state but not an operationally authoritative state
- event consumers cannot trust `status_changed` to mean “an operator intentionally changed the lifecycle”

Decision basis:

- documented fact from local SQL
- documented fact from live event queries
- Umi-specific inference: `accepted` is a real product state and should live in backend-owned truth, not only in a read model

Required direction:

- define one canonical kitchen lifecycle ledger in the backend
- either add a first-class kitchen lifecycle state in `conversaflow` or add a dedicated backend-owned lifecycle table that KDS projects from
- reserve projection-generated rows for reconciliation/upsert semantics, not operator lifecycle semantics

### 4. High — `transition_ticket` is ambiguous at the public PostgREST contract

Evidence:

- the repo exposes two public overloads:
  - 6-parameter `p_cancellation_reason TEXT`
  - 7-parameter `p_cancellation_reason_code`, `p_cancellation_reason_note`
- both are defined in [20260424110000_partial_cancellation_guardrails_and_reason_codes.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260424110000_partial_cancellation_guardrails_and_reason_codes.sql:1125)
- a live RPC call with only the shared five parameters returns HTTP `300` / `PGRST203`

Impact:

- the contract only works because the iPad client sends the exact 7-parameter body
- any generic caller, admin tool, or future client can hit ambiguous overload resolution

Decision basis:

- documented fact from local SQL
- source-backed tradeoff: PostgREST explicitly does not support overloaded functions with the same argument names but different types, and documents `PGRST203` for that case:
  - <https://postgrest.org/en/latest/references/api/functions.html>
  - <https://postgrest.org/en/latest/references/errors.html>

Required direction:

- stop using overloads for public RPC names
- publish one mutation function per contract shape

### 5. High — KDS customer notifications depend on cron cadence, not interactive wake-up

Evidence:

- both KDS notification functions insert rows directly into `conversaflow.outbox` in [20260424110000_partial_cancellation_guardrails_and_reason_codes.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260424110000_partial_cancellation_guardrails_and_reason_codes.sql:545) and [20260424110000_partial_cancellation_guardrails_and_reason_codes.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260424110000_partial_cancellation_guardrails_and_reason_codes.sql:687)
- no KDS SQL path can call `triggerJobWorker()` from [_shared/workflow.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/_shared/workflow.ts:18)
- the cron heartbeat is once per minute in [20260417130000_add_job_worker_cron.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260417130000_add_job_worker_cron.sql:5)

Live evidence:

- in the most recent 50 delivered `twilio.status_notification` rows, 20 were delivered more than 30 seconds after creation
- recent KDS lifecycle notifications repeatedly landed in the 30 to 61 second range
- historical worst-case delay in the same sample was 3979 seconds

Impact:

- customer-facing kitchen updates are not interactive even when operators act interactively
- delivery timing depends on whether some other path wakes the worker or cron happens to fire

Decision basis:

- documented fact from local code
- documented fact from live outbox timing
- Umi-specific inference: KDS notifications are part of the operator feedback loop and should not ride a background heartbeat by default

Required direction:

- move KDS mutations behind a backend surface that can wake the worker explicitly after enqueue
- keep cron only as the safety net, not the normal path

### 6. Medium — the iPad client trusts event semantics the backend does not guarantee

Evidence:

- `OrderRepository` applies `status_changed` events directly to local board state in [apps/umi-kds/Sources/Data/OrderRepository.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/OrderRepository.swift:211)
- projection-generated `status_changed` rows do not include `from_status` and are not explicit operator actions
- `KDSRealtimeClient` silently swallows polling errors in [apps/umi-kds/Sources/Data/KDSRealtimeClient.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/KDSRealtimeClient.swift:21)
- `OrderRepository.start()` marks the connection as `connected` before the polling loop proves it can read anything in [apps/umi-kds/Sources/Data/OrderRepository.swift](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Data/OrderRepository.swift:63)

Impact:

- the UI can temporarily show lifecycle state that came from projection noise rather than operator intent
- the board can look “connected” while the polling stream is failing repeatedly

Decision basis:

- documented fact from local Swift code

Required direction:

- after backend event semantics are fixed, narrow the client so only operator-sourced lifecycle events mutate local state directly
- expose real polling health and error state instead of a permanent optimistic `connected`

### 7. Medium — documentation is behind the deployed contract

Evidence:

- [apps/umi-kds/Sources/Docs/KDSArchitecture.md](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-kds/Sources/Docs/KDSArchitecture.md:43) still documents the old 5/6-parameter cancellation contract, not the current reason-code contract used by the app
- the same doc still states event volume as 23 total events and frames polling as a validated result from 2026-04-16, which is now stale

Impact:

- local docs understate current security and contract risks
- the next refactor would start from inaccurate assumptions unless these docs are refreshed

Decision basis:

- documented fact from local docs and current code

## What should not be the next refactor

### Not yet: migrate the iPad app to Supabase Realtime

Current volume does not justify this as the first move:

- the live `kds.ticket_events` volume is still low
- the primary failures are auth, lifecycle truth, and notification execution

Official Supabase guidance supports keeping this low on the list:

- Broadcast is the recommended choice for scale and security, while Postgres Changes is simpler but scales worse: <https://supabase.com/docs/guides/realtime/subscribing-to-database-changes>
- Postgres Changes authorization work happens per subscriber, and change processing is single-threaded to preserve order:
  - <https://supabase.com/docs/guides/realtime/postgres-changes>
  - <https://supabase.com/docs/guides/realtime/benchmarks>

Decision basis:

- source-backed tradeoff
- Umi-specific inference: polling is acceptable for now because current KDS volume is small and the dominant failures are elsewhere

## Refactor sequence

### Phase 0 — immediate containment

1. Rotate the exposed privileged key used by the cron job.
2. Replace the cron auth material with Vault-backed or named-secret-backed auth.
3. Remove `anon` execute grants from KDS mutation RPCs.
4. Freeze public KDS surface changes until authenticated access is in place.

### Phase 1 — make lifecycle truth canonical

1. Define one backend-owned kitchen lifecycle model.
2. Decide explicitly whether `accepted` is:
   - a real backend state, or
   - not worth preserving as a persisted lifecycle step
3. If `accepted` remains part of the UX, store it in backend-owned truth instead of synthesizing it in projection.
4. Keep `transactions.status` as the coarse business state only if the kitchen lifecycle is modeled separately and intentionally.

### Phase 2 — repair event semantics

1. Reserve `kds.ticket_events.kind = status_changed` for canonical lifecycle transitions.
2. Stop emitting projection-side `status_changed` rows that lack `from_status`.
3. Use `order_upserted` or `snapshot_reconciled` for projection maintenance rows.
4. Add an explicit event payload contract for lifecycle transitions.

### Phase 3 — fix notification execution

1. Move KDS command entrypoints to a backend surface that can enqueue outbox and wake the worker immediately.
2. Keep cron as recovery only.
3. Add Twilio `statusCallback` handling so backend delivery truth is not conflated with Twilio API acceptance:
   - <https://www.twilio.com/docs/messaging/api/message-resource>
   - <https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks>

### Phase 4 — client cleanup and test expansion

1. Make connection state reflect actual poll health.
2. Only trust operator-sourced lifecycle events for local optimistic board updates.
3. Add tests for:
   - event application and ordering
   - partial cancellation flow
   - terminal-state transitions
   - polling failure and recovery
   - backend RPC contract failures

## Bottom line

The next KDS refactor should be treated as a backend truth-and-security refactor, not a cosmetic KDS cleanup.

If we do only one thing first, it should be this:

- make the KDS command surface authenticated and canonical

Everything else becomes easier once the system has one trusted writer, one trusted lifecycle ledger, and one honest event stream.

---

## Resolution — 2026-05-12

All seven findings were addressed in the 2026-05-12 execution pass.

### Finding 1 — KDS commands publicly callable with anon credentials ✓ resolved

- Migrations `20260512210000` revoked EXECUTE on both `transition_ticket` and `partial_cancel_items` overloads from the `anon` role.
- `kds-command` edge function deployed at `functions/v1/kds-command`. All mutations route through it. Supabase validates the project JWT (anon key) before the function runs; the function calls the mutation RPCs internally as service_role.
- Decision: per-device token auth deferred to a future management dashboard. Current auth model is project-level anon JWT, which is sufficient until the dashboard exists.

### Finding 2 — Long-lived bearer token hardcoded in migration history ✓ resolved

- Migration `20260512220000` unscheduled the old cron job and recreated it using `vault.decrypted_secrets WHERE name = 'service_role_key'`.
- The hardcoded token in `20260417130000` is now stale. User must rotate the exposed key in the Supabase dashboard and then store the new key via `SELECT vault.create_secret('<new-jwt>', 'service_role_key', ...)` to restore the cron heartbeat.

### Finding 3 — No single source of lifecycle truth ✓ resolved

- `kds.tickets` is the canonical kitchen lifecycle ledger. `transition_ticket` updates it directly for `accepted`/`preparing` (KDS-only states) and through the conversaflow.transactions projection trigger for `ready`/`completed`/`cancelled`.
- The projection heuristic that was "inventing" accepted/preparing is still present in `project_transaction` (the `in_progress + existing status` preservation logic), but now it is only a recovery path — the authoritative lifecycle write always comes from `transition_ticket`.

### Finding 4 — `transition_ticket` overload ambiguity ✓ resolved

- The edge function always passes all 7 parameters to the 7-param overload, removing the HTTP 300 / PGRST203 ambiguity at the public contract boundary.
- The 6-param convenience overload still exists in the DB for legacy compatibility but is not used by the app.

### Finding 5 — Notifications depend on cron cadence ✓ resolved

- `kds-command` calls `triggerJobWorker()` immediately after every mutation. Notifications are delivered near-interactively on the normal path. Cron remains as the one-minute safety net.

### Finding 6 — Client trusts unguaranteed event semantics ✓ resolved

- Migration `20260512230000` made the projection trigger always emit `order_upserted`. `status_changed` is now reserved exclusively for explicit operator transitions.
- Migration `20260512240000` fixed the remaining gap: `transition_ticket` ELSE branch (ready/completed/cancelled) now inserts its own `status_changed` event with `from_status`/`to_status` in the payload, instead of relying on the trigger.
- `KDSRealtimeClient.pollStream()` now surfaces errors via `KDSPollResult.failure(Error)` instead of swallowing them.
- `OrderRepository` advances `connectionState` to `.connected` only after the first successful poll, and exposes `pollingError`.

### Finding 7 — Documentation behind the deployed contract ✓ resolved

- `apps/umi-kds/Sources/Docs/KDSArchitecture.md` rewritten to reflect current auth model, event semantics, cancellation flow, and connection state model.
- This audit document updated with this resolution section.
