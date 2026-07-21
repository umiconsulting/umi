# Partial Cancellation — Completion Plan

> Author: pair-programmed with Claude · Date: 2026-04-19
> Scope: ConversaFlow backend (`apps/umi-conversaflow`) + 375 KDS iPad app (`apps/umi-kds`)
> Status: **Draft for approval** — supersedes ad-hoc fixes once landed.

---

## 1. Why this exists

We shipped partial cancellation in two passes (`20260422010000_kds_partial_cancellation.sql`,
`20260422200000_kds_partial_cancellation_functions.sql`, `20260423000000_fix_partial_cancel_outbox_item_lookup.sql`,
`PartialCancellationSheet.swift`), but the loop is incomplete. Live trace from
ticket `ecab9cb5-2236-4c7a-85b5-b6b828c45d28` (customer `+5216671518408`, 2026-04-19) shows
the failure mode in production:

| t (UTC)  | Actor         | Action                                                  | Outcome / Twilio body                              |
| -------- | ------------- | ------------------------------------------------------- | -------------------------------------------------- |
| 01:20:21 | trigger       | order_upserted ×3 then status_changed `cancelled`       | (no message — ignored, see §3.4)                   |
| 01:28:39 | Kitchen iPad  | partial_cancel_items, reason "No hay leche"             | Outbox queued (delivered 01:35:43)                 |
| 01:35:43 | outbox→Twilio | "Se modificó tu pedido… ¿Deseas aceptar…?"              | Customer reads, **never replies**                  |
| 18:24:38 | Kitchen iPad  | transition_ticket → `accepted` (from partial_cancelled) | "Tu pedido fue aceptado y está en cola en cocina." |
| 18:24:50 | Kitchen iPad  | transition_ticket → `cancelled`, reason "Niggga"        | "Tu pedido fue cancelado. Motivo: Niggga"          |

In 12 seconds the customer received contradictory "accepted" then "cancelled" notifications,
the cancellation reason was an unfiltered slur from operator free-text, and the ticket had
already been auto-cancelled by the trigger 17 hours earlier — yet the KDS app let the operator
keep transitioning it. That single timeline contains every defect we need to fix.

> **Steve Jobs lens.** A KDS is a back-of-house safety-critical surface: high tempo, gloved
> hands, oblique angles, distractions. Each interaction must be _unambiguous, reversible-for-30s,
> then irreversible_, and the customer-facing surface must never contradict itself. Anything
> else is friction the operator pays for in mistakes and the customer pays for in trust.

---

## 2. User stories (the contract we are designing to)

We organise the work around six personas/situations. Each story is the acceptance test.

### 2.1 Operator — "Pending confirmation" should not be mutable

> _As a barista, when an order has just landed and I haven't accepted it yet, I should not be
> able to mark it Preparing or Ready. The only verbs available are **Accept** or **Reject**._

**Why it matters.** Today the KDS lets the operator skip from `new` → `preparing` (or even
`ready`) because `kds.transition_ticket` has no source-state guard. The customer is told
"Tu pedido se está preparando" before any human acknowledged it.

### 2.2 Operator — A Ready order is irrevocable

> _Once I tap Ready, the only follow-up is Completed. There is no "cancel" button on a ready
> order, because the food already exists and the customer is on their way to pick it up._

**Why it matters.** Trace #1 above shows a `ready→cancelled` path that should be impossible.
Cancelling a Ready order destroys inventory, mis-bills the till, and confuses the customer.

### 2.3 Operator — Partial cancellation is a _proposal_, not a commit

> _When I cancel some items I am proposing a change. The ticket waits in **Awaiting customer
> confirmation** until the customer says yes / counter-proposes / cancels. I cannot prepare
> these items and I cannot accept on the customer's behalf without a written override._

**Why it matters.** The 18:24 events on ticket `ecab9cb5` were the operator pressing buttons
on a ticket the customer had not responded to. The system silently committed.

### 2.4 Operator — Cancellation reasons come from a controlled vocabulary

> _When I cancel or partially cancel I pick from a short list (out-of-stock, kitchen overload,
> closing soon, customer no-show, other). "Other" requires a typed reason ≥ 3 chars and is
> redacted before the customer sees it._

**Why it matters.** "Niggga" reached the customer's phone verbatim. There is no validation,
no profanity filter, and no template.

### 2.5 Customer — The conversation never contradicts itself

> _As a customer on WhatsApp, the messages I receive form one coherent narrative. If I am
> told the order is being prepared, I will not subsequently be told it was cancelled by the
> kitchen 12 seconds later. If a partial cancel is pending my answer, the bot does not start
> a new order with me until I respond._

**Why it matters.** Trace #1: the customer received "aceptado" + "cancelado" within 12 s.
This is not just embarrassing — it is the kind of incident that ends a business relationship.

### 2.6 Customer — Pending change has a deadline

> _If I do not reply to a "¿Deseas aceptar estos cambios?" prompt within N minutes, the
> kitchen is told and the ticket auto-resolves to a deterministic state (default: full
> cancellation with refund), and I receive one final "no recibimos respuesta" message._

**Why it matters.** Today an unanswered partial cancel sits forever; the operator eventually
decides for the customer. Either side is unhappy.

---

## 3. Current vs. target state — evidence-based

### 3.1 Backend has no transition guard

`kds.transition_ticket` (in `20260422200000_kds_partial_cancellation_functions.sql:117-220`)
short-circuits when `target == current`, but never validates that `current → target` is a
legal edge. Anything goes from anywhere. The Swift `KitchenStatus.nextActionStatuses` in
`apps/umi-kds/Sources/Domain/KitchenModels.swift:30-43` is the only enforcement.

| From \ To                 |        accepted        | preparing | ready | completed |       cancelled       | partial_cancelled |
| ------------------------- | :--------------------: | :-------: | :---: | :-------: | :-------------------: | :---------------: |
| **new**                   |           ✅           |    ❌     |  ❌   |    ❌     |          ✅           |  ✅ (sheet only)  |
| **accepted**              |           —            |    ✅     |  ❌   |    ❌     |          ✅           |        ✅         |
| **preparing**             |           ❌           |     —     |  ✅   |    ❌     |          ✅           |        ✅         |
| **ready**                 |           ❌           |    ❌     |   —   |    ✅     |        **❌**         |        ❌         |
| **partial_cancelled**     | ✅ (= confirm changes) |    ❌     |  ❌   |    ❌     | ✅ (escalate to full) |         —         |
| **completed / cancelled** |   ❌ all (terminal)    |           |       |           |                       |                   |

Where the table disagrees with `nextActionStatuses` today: the **backend permits everything**.

### 3.2 Partial cancel is allowed from states it shouldn't be

`kds.partial_cancel_items` only blocks `completed` / `cancelled`. It silently accepts
`partial_cancelled` (re-partial — nondeterministic merge), `ready` (ingredients already
consumed), and even `new` (skips the accept step entirely).

### 3.3 KDS app omits "ready" guard for partial cancel button

`TicketDetailView.swift` exposes the partial-cancel sheet whenever status is not in
`{completed, cancelled, partialCancelled}`. `ready` is missing from that block list.

### 3.4 Multiple `order_upserted` events per insert

Trace shows three `order_upserted` events at the same `occurred_at` for ticket `ecab9cb5`
(sequences 74, 75, 78). The trigger fires once per UPDATE, but the projection re-projects
items even when nothing material changed. Outbox dedup saves us today; the sequencing is
still noisy and breaks subscribers that key off `(ticket_id, sequence)`.

### 3.5 Outbox copy is generic

`twilio.status_notification` for status `accepted` always sends _"Tu pedido fue aceptado y
está en cola en cocina"_ — even when the prior message was a partial-cancel proposal. The
context (we are accepting _the modified order_) is lost.

### 3.6 LLM context for "awaiting confirmation"

`getActivePartialCancelledOrder` + `effectiveCurrentState = 'awaiting_order_changes_confirmation'`
in `turn-process.ts` are wired correctly, and `prompts.ts` adds the _CAMBIOS PENDIENTES_ block.
But the bot still relies on the LLM to honour the instruction; we have no programmatic gate
preventing a fresh draft cart while a partial cancel is pending. `confirmOrderChanges`
exists (`tools.ts:1683`) but the model can avoid calling it.

---

## 4. Target architecture

### 4.1 Authoritative state machine (single source of truth)

Define one Postgres function `kds.assert_transition(from kds.ticket_status, to kds.ticket_status)
RETURNS VOID` that raises on any illegal edge. `transition_ticket` and `partial_cancel_items`
both call it before mutating. The Swift client mirrors the same table for affordance hiding,
but the backend is canonical.

Edges (target — see §3.1 table for the matrix):

```
new            → accepted | cancelled | partial_cancelled
accepted       → preparing | cancelled | partial_cancelled
preparing      → ready | cancelled | partial_cancelled
ready          → completed                          -- IRREVERSIBLE
partial_cancelled → accepted (== confirm) | cancelled (== escalate to full)
completed      → ø                                  -- TERMINAL
cancelled      → ø                                  -- TERMINAL
```

Rationale: the IRREVERSIBLE edge from `ready` matches industry KDS norms and reflects the
physical reality that food has been produced. Aging-color cues are the right escalation,
not a backwards button.

### 4.2 Cancellation reason — typed enum + free-text fallback

```sql
CREATE TYPE kds.cancel_reason_code AS ENUM (
  'out_of_stock',
  'kitchen_overload',
  'closing_soon',
  'customer_no_show',
  'duplicate_order',
  'other'
);
```

`partial_cancel_items` and the cancel branch of `transition_ticket` accept
`(reason_code kds.cancel_reason_code, reason_note TEXT)`. When `reason_code = 'other'`,
`reason_note` is required, length-limited, and runs through a profanity scrub before being
embedded in customer-facing copy. Internal logs keep the raw note.

### 4.3 Partial cancellation as a _pending proposal_

Today `partial_cancelled` is a leaf state the operator can leave however they want. Target:

- Add `kds.tickets.pending_change_id UUID` referencing a new `kds.ticket_change_proposals`
  row that holds `{cancelled_display_orders, reason_code, reason_note, proposed_at,
proposed_by, expires_at, decision, decided_at}`.
- `partial_cancel_items` creates the proposal and locks the ticket: while a proposal exists,
  `transition_ticket` only accepts `accepted` (= confirm) or `cancelled` (= escalate full
  cancel). Both clear `pending_change_id` and write `decision`.
- Add `kds.expire_pending_changes()` cron (every minute via pg_cron). When `expires_at <
now()`, decision defaults to the business policy in `conversaflow.business_settings.
partial_cancel_expiry_action` (default `escalate_full_cancel`). Cron emits the appropriate
  event and outbox message.
- Customer reply path (`confirmOrderChanges`, `cancelOrder` partial branch in `tools.ts`)
  also writes the decision via the same RPC — single ledger.

### 4.4 Customer copy & narrative coherence

Replace the static "Tu pedido fue aceptado..." string with a context-aware template chosen
inside `kds.enqueue_whatsapp_status_notification`:

| From → To                         | Template                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| new → accepted                    | "Tu pedido fue aceptado y está en cola en cocina."                                                    |
| partial_cancelled → accepted      | "Confirmamos los cambios en tu pedido. Total actualizado: $X. Lo estamos preparando."                 |
| partial_cancelled → cancelled     | "Cancelamos por completo tu pedido. Si quieres, podemos empezar uno nuevo."                           |
| (cron) partial expiry → cancelled | "No recibimos respuesta a la propuesta de cambio. Cancelamos el pedido. Cuando gustes, lo retomamos." |
| ready → completed                 | "Tu pedido fue completado. ¡Gracias!"                                                                 |

Every status email/whatsapp message must be deterministic from `(from_status, to_status,
reason_code)`. The operator never types into the customer-facing field.

### 4.5 Bot programmatic gate

In `turn-process.ts`, after reading `effectiveCurrentState`, if state ==
`awaiting_order_changes_confirmation`:

- Strip `add_to_cart` / `create_order` from the available tool list before invoking the LLM
  for that turn.
- Force-include `confirmOrderChanges`, `cancelOrder`, `requestModification` in the tool list.
- Append a hard system instruction: "Do not start a new order until the customer has
  responded to the pending changes."

This makes the LLM physically unable to side-step the proposal.

### 4.6 KDS app changes

| File                                                           | Change                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Sources/Domain/KitchenModels.swift`                           | Match `nextActionStatuses` to backend table; add `.partialCancelled.cancel` ⇒ "Escalar a cancelación total". Reject `.ready.cancelled`.                                                          |
| `Sources/Features/TicketDetail/TicketDetailView.swift`         | Block partial-cancel sheet when status ∈ `{completed, cancelled, partialCancelled, ready}`. Add a banner _"Esperando confirmación del cliente · expira en mm:ss"_ when `pendingChangeId` is set. |
| `Sources/Features/TicketDetail/PartialCancellationSheet.swift` | Replace free-text reason with `Picker<CancelReasonCode>` + `TextField` that's only enabled when "Otro". Validate ≥ 3 chars.                                                                      |
| `Sources/Data/OrderRepository.swift`                           | New `confirmPendingChange(orderID:)` and `escalatePendingChange(orderID:)` methods that call dedicated RPCs (not generic `transition_ticket`).                                                   |
| `Sources/Data/KDSAPIClient.swift`                              | Add the two RPCs; accept `cancelReasonCode` everywhere we currently take `reason`.                                                                                                               |
| `Sources/Features/Tickets/TicketsListView.swift`               | Render an "Esperando cliente" pill on tickets with `pendingChangeId`; sort them at top under the new-orders bucket.                                                                              |

### 4.7 Aging & visual hierarchy (HCI investment)

Adopt the published KDS norm of color-coded aging tiers on every ticket (green ≤ N₁s,
yellow ≤ N₂s, red > N₂s, configurable per business). For `partial_cancelled` tickets, age
the _pending change_ (time since proposal) instead of the ticket itself — this is the actual
SLA the operator and customer are racing.

---

## 5. Implementation phases

We split into four independently shippable phases. Each ends with a deploy + a
verifiable acceptance check.

### Phase 1 — Hard guardrails (ship in 1-2 days)

Backend-only, zero UI changes. Stops the bleeding immediately.

1. Add `kds.assert_transition(from, to)`.
2. Wire it into `transition_ticket` and `partial_cancel_items`.
3. Block `ready → cancelled` and `new → preparing|ready` in `transition_ticket`.
4. Block `partial_cancel_items` from `ready`, `new`, and re-entry from `partial_cancelled`.
5. Update the KDS app `nextActionStatuses` and `availablePartialCancellationItems` so the
   buttons disappear (defence in depth — backend already rejects).

**Acceptance**: Re-run the trace scenario from §1; the 18:24 cancel call returns 403/422
instead of mutating state. Snapshot tests of `KitchenStatus.nextActionStatuses` updated.

### Phase 2 — Reason vocabulary + scrubbed customer copy (1-2 days)

1. Add `kds.cancel_reason_code` enum + columns on `tickets`, `ticket_change_proposals`.
2. Migrate existing free-text reasons to `code='other', note=<old text>`.
3. Refactor outbox templates by `(from_status, to_status, reason_code)` lookup table.
4. KDS app: replace text field with picker.
5. Add `redact_customer_text(TEXT) RETURNS TEXT` Postgres function (basic word list +
   length cap) — used wherever operator notes leak to the customer.

**Acceptance**: A test that submits "Niggga" as reason produces "[motivo retirado]" in the
outbound payload. The reason picker is the only path in the iPad UI.

### Phase 3 — Pending change proposal + expiry (3-4 days)

1. New `kds.ticket_change_proposals` table + `pending_change_id` FK on tickets.
2. Refactor `partial_cancel_items` to create the proposal row.
3. New RPCs `kds.confirm_pending_change`, `kds.escalate_pending_change` (the only two
   verbs allowed when a pending change exists).
4. Cron `kds.expire_pending_changes()` + `business_settings.partial_cancel_expiry_action`
   - matching outbox template.
5. KDS app: pending-change banner with countdown, list pill, blocked status menu.
6. WhatsApp turn-process: tool gating per §4.5.

**Acceptance**: simulate (a) operator confirm, (b) customer confirm via WA, (c) customer
counter via WA, (d) expiry. Each path produces exactly one customer message and a coherent
ticket history.

### Phase 4 — Visual hierarchy & aging tiers (2-3 days)

1. Per-business `kds_aging_thresholds` settings.
2. SwiftUI ticket cell aging colour binding.
3. Pending-change cells age against `proposed_at`, not `created_at`.
4. Sound + haptic when entering red tier (already wired for new orders — extend).

**Acceptance**: Eng demo on the iPad — tickets visibly migrate green→yellow→red, pending
proposals age independently.

---

## 6. Risks & mitigations

| Risk                                                      | Mitigation                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Phase 1 guardrail rejects an in-flight legacy call        | Deploy migration + edge fn + iPad bundle in lockstep; keep one release of soft-warn logging before hard-reject. |
| Existing tickets stuck in invalid states                  | One-shot script normalises to nearest legal state; documented in migration.                                     |
| Cron drift on expiry creates "almost expired" UX glitches | UI shows server-time countdown; cron runs at 60s but UI re-fetches every 15s.                                   |
| Free-text reason removal breaks existing CSV exports      | Export pipeline reads `reason_code` + `reason_note` separately; legacy column kept (deprecated).                |
| LLM ignores the gating prompt                             | Tool list is gated _programmatically_ in `turn-process.ts` — the model cannot call what it isn't given.         |

---

## 7. Open questions for product / Juan

1. **Default expiry policy**: 15 min then auto-cancel? Or 60 min then notify operator?
2. **Reason vocabulary**: the five codes proposed cover Café Kalala Chapule. Validate with
   real ops before locking the enum.
3. **"Ready → cancelled" override**: any business case (food allergy report) where a
   manager-level override should still be allowed? If yes, design a separate verb
   `force_cancel_ready_with_audit` instead of weakening the state machine.
4. **Re-partial**: do we ever need to partial-cancel twice on the same ticket? Current
   plan blocks it; if needed we should allow only after a confirm cycle.

---

## 8. References (engineering & HCI)

- [Microsoft Learn — Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [microservices.io — Event sourcing](https://microservices.io/patterns/data/event-sourcing.html)
- [event-driven.io — Idempotent Command Handling](https://event-driven.io/en/idempotent_command_handling/)
- [DEV — Idempotency in CQRS and Event Sourcing (commands, projections, outbox)](https://dev.to/ohugonnot/idempotency-in-cqrs-and-event-sourcing-part-2-commands-projections-and-outbox-4ei)
- [Cockroach Labs — Idempotency and ordering in event-driven systems](https://www.cockroachlabs.com/blog/idempotency-and-ordering-in-event-driven-systems/)
- [domaincentric — Projection deduplication strategies](https://domaincentric.net/blog/event-sourcing-projection-patterns-deduplication-strategies)
- [commercetools — State machines for business modelling](https://docs.commercetools.com/learning-model-your-business-structure/state-machines/state-machines-page)
- [Oracle — Kitchen Display Systems for Restaurants](https://www.oracle.com/food-beverage/restaurant-pos-systems/kds-kitchen-display-systems/)
- [Rezku — How Restaurants Use a KDS](https://rezku.com/blog/restaurant-kitchen-display-system/)
- [Restaurant365 — KDS guide](https://www.restaurant365.com/blog/kitchen-display-system/)
- [Ordering Stack — KDS guide](https://orderingstack.com/blog/a-guide-to-kitchen-display-system-kds-in-restaurant)
- [MDPI — UI/UX & Visual Ergonomics for Reducing Human Error in Industrial Settings](https://www.mdpi.com/2411-9660/10/1/8)
- [ILO Encyclopedia — Ergonomic Aspects of Human-Computer Interaction](https://www.iloencyclopaedia.org/part-vi-16255/visual-display-units/item/784-ergonomic-aspects-of-human-computer-interaction)
- [SAGE — Touchscreens for Aircraft Navigation: Fitts' Law (transferable to gloved iPad use)](https://journals.sagepub.com/doi/10.1177/0018720819862146)
- [iMotions — Human Factors guide](https://imotions.com/blog/insights/what-is-human-factors/)

---

## 9. Tracking

- Linear / GitHub issue: _(create — link here)_
- Owner: Juan + Claude pairing
- Review: Café Kalala Chapule ops walkthrough before Phase 3 deploy
- Rollback: each phase is gated behind `business_settings.partial_cancel_v2_enabled`
  for the first 7 days post-deploy.
