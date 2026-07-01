# KDS Architecture

## What was created

- A minimal native SwiftUI iPad scaffold organized into `App`, `Features`, `Domain`, `Data`, `DesignSystem`, and `Docs`.
- A small app shell with `Board`, `TicketDetail`, and `Settings`.
- Normalized kitchen models for orders, items, statuses, channels, stations, and ordered kitchen events.
- Thin data layer: snapshot fetch, event polling, device session scope, single order repository.

## Why this shape

- The app stays feature-first and small: one root shell, three slices, one domain model set, one repository.
- UI code renders normalized `KitchenOrder` values only. It does not know about Twilio payloads, workflow jobs, or outbox mechanics.
- The repository fetches snapshot, consumes ordered events, and reconciles after reconnect.
- The UI is iPad-first: landscape board layouts, persistent context, large targets, readable status signaling for shared kitchen use.

## ConversaFlow relationship

ConversaFlow owns:

- channel ingestion through inbound events like `whatsapp_message`
- normalization and durable processing through `jobs` and `outbox`
- order persistence in `conversaflow.transactions`
- order lifecycle instrumentation in `conversaflow.transaction_status_events`

The KDS schema is a kitchen read model projected from `conversaflow`. The app consumes it via normalized contracts, never raw operational tables.

## Current backend contract (verified 2026-05-12)

### Read RPCs (anon-accessible via PostgREST with `Content-Profile: kds`)

- `kds.get_board_snapshot(p_business_id, p_station_id)` — snapshot with embedded items JSONB
- `kds.get_ticket_events(p_business_id, p_after_sequence, p_limit)` — monotonically sequenced event log

### Mutation commands (via `kds-command` edge function, anon key)

All mutations route through the `kds-command` Supabase edge function. The function is authenticated
via Supabase's built-in JWT validation — the app sends its anon key as a Bearer token and Supabase
verifies it as a valid project JWT before the function runs. The anon role has no direct execute
grants on any KDS mutation RPC; the edge function runs as service_role internally.

After every successful mutation the edge function wakes the job-worker immediately so customer
notifications do not wait for the cron heartbeat.

- `action: "transition_ticket"` — advance or cancel a ticket lifecycle
- `action: "partial_cancel_items"` — cancel individual line items with a controlled reason code

Both actions accept a reason code from `kds.cancel_reason_code`:
`out_of_stock | kitchen_overload | closing_soon | customer_no_show | duplicate_order | other`

The `other` code requires a non-empty reason note (≥ 3 characters). The backend enforces this.

### Device provisioning and revocation

`kds.device_sessions` stores the durable per-iPad token hash. Runtime KDS reads and commands send
the plaintext token in `X-KDS-Device-Token`; backend endpoints verify that the matching session is
still active before returning board data or mutating tickets. Dashboard revocation sets
`is_active = false`, records audit fields, and the iPad clears its Keychain credential after the next
explicit `device_revoked` response.

### Info.plist keys

- `KDSBackendURL` — backend base URL (production: `https://api.umiconsulting.co`)
- `KDSLocalBaseURL` — optional local dashboard API base URL for development. For local device
  testing, point this at the Mac's LAN address on port `4011`, the dashboard API server connected to
  the local transition database. The dashboard browser UI runs on `4010`, but KDS runtime calls
  should use the API/source-of-truth port. Simulator-only testing may use `http://127.0.0.1:4011`.
- `KDSPairingURL`, `KDSCommandURL`, `KDSBoardURL`, `KDSHeartbeatURL` — optional per-endpoint
  overrides. Production should omit local overrides and use the HTTPS Supabase function URLs derived
  from `KDSBackendURL`.
- `KDSPollingIntervalSeconds` — optional override, defaults to 3
- `KDSHeartbeatIntervalSeconds` — optional override, defaults to 5 so the dashboard's 15-second
  offline threshold does not flap between heartbeat posts

### Event semantics (as of 2026-05-12)

`kds.ticket_events.kind` carries:

| Kind | Source | Meaning |
|------|--------|---------|
| `status_changed` | operator | An explicit lifecycle transition was executed via `transition_ticket()` or `partial_cancel_items()`. Payload always contains `from_status` and `to_status`. |
| `order_upserted` | trigger | A projection maintenance update — transaction details changed, items rewritten, or a new order arrived. Not an operator lifecycle action. |
| `order_removed` | trigger | Ticket was deleted or cascaded from an operational delete. |
| `snapshot_reconciled` | projection | A manual or backfill reconciliation pass ran. |

The projection trigger (`trg_kds_project_transaction`) always emits `order_upserted`. It never
emits `status_changed`. `status_changed` is reserved exclusively for explicit operator actions in
`transition_ticket()` and `partial_cancel_items()`, and always carries `from_status` and `to_status`
in its payload.

Every lifecycle transition (accepted, preparing, ready, completed, cancelled, partial_cancelled)
produces exactly one `status_changed` event from the mutation function, plus one `order_upserted`
from the trigger. Consumers should use `status_changed` for optimistic state updates and event-
sourced history; `order_upserted` means the full snapshot of the ticket changed and a refresh is
safe but not required.

## Connection state model

`OrderRepository` exposes:

- `connectionState: RealtimeConnectionState` — `.idle` → `.connecting` → `.connected`
  - Advances to `.connected` only after the first successful poll cycle proves the event stream is reachable.
- `snapshotError: String?` — set if the initial snapshot fetch fails; board stays empty but polling may recover.
- `pollingError: String?` — set when a poll cycle fails; cleared on the next success. Non-nil does not mean disconnected — polling retries continuously. The board connection pill turns orange when either error is present.

Polling is implemented via `KDSRealtimeClient.pollStream()`, which yields `KDSPollResult.events([KitchenEvent])` on success and `KDSPollResult.failure(Error)` on failure. Errors are surfaced rather than swallowed.

## Cancellation flow

**Full cancellation** — `action: "transition_ticket"` with `target_status: "cancelled"`:

- Requires `cancellation_reason_code` (any valid code except `other`, which also needs `cancellation_reason_note` ≥ 3 chars)
- If the ticket is already `partial_cancelled`, the prior partial reason is inherited automatically — no need to re-specify
- Updates `conversaflow.transactions.status = 'cancelled'` and writes the reason into `details`
- Strips any `partial_cancellation_*` fields from `details`
- Sends WhatsApp: *"Tu pedido fue cancelado. [Motivo if present]"*

**Partial cancellation** — `action: "partial_cancel_items"`:

- Cancels specific line items by UUID; order stays alive at `partial_cancelled` status
- Requires `reason_code` and optionally `reason_note`
- Sends a WhatsApp message listing cancelled items and the reason
- Ticket can later be re-accepted (moves to `accepted`, clearing partial reason) or fully cancelled

## iPad product constraints

- Treat the board as the primary surface; operators spend most of their time there.
- Avoid phone-derived flows that hide order context behind deep stacks or full-screen drills.
- Keep ticket actions immediate and visible so operators can move orders with minimal taps.
- Prefer side-by-side context when reviewing a ticket from the board.
- Design visual hierarchy for quick scanning under real kitchen conditions.

## Keep backend-only

- raw WhatsApp/Twilio payload parsing
- inbound event idempotency
- workflow jobs and retries
- outbox delivery and delivery truth
- tenant resolution from phone numbers or channel metadata

## Customer status notifications (WhatsApp)

When an operator transitions a ticket, the customer receives a WhatsApp message. The `kds-command`
edge function wakes the job-worker immediately after enqueueing the outbox row, so notifications
arrive near-interactively rather than waiting for the one-minute cron heartbeat.

| KDS status | Message sent |
|---|---|
| accepted | Tu pedido fue aceptado y está en cola en cocina. |
| preparing | Tu pedido se está preparando. |
| ready | Tu pedido está listo para recoger. |
| completed | Tu pedido fue completado. ¡Gracias! |
| cancelled | Tu pedido fue cancelado. [Motivo if present] |

Partial cancellations send a separate message listing the cancelled items and the reason.

Notifications are skipped silently when the customer has no phone number on file.

## What is explicitly out of scope for the app

- Supabase Realtime (Postgres Changes or Broadcast) — polling is appropriate at current event volume.
  Re-evaluate when events exceed ~1,000/hour or operators report board latency issues.
- Multi-tenant board views — one business per device.
- Order creation from the KDS — order ingestion happens through ConversaFlow channel handlers.

## Implementation history

- 2026-04-16: Initial KDS schema, projection, snapshot + event RPCs live.
- 2026-04-21: Cancellation reason field, enriched customer WhatsApp messages.
- 2026-04-22: Partial cancellation — item-level cancellation with reason codes.
- 2026-04-24: Backend transition guards, controlled reason code vocabulary, deterministic notification copy.
- 2026-05-12: Security hardening — revoke anon mutation grants, all mutations through `kds-command` edge function (anon JWT, service_role internally), vault-backed cron auth, event semantics repaired (trigger always emits `order_upserted`; `status_changed` reserved for explicit operator transitions with `from_status`/`to_status` in payload).
