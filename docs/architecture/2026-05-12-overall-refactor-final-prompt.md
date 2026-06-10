# Overall Refactor — Final Prompt

Purpose:

- give the next implementation pass one authoritative execution brief
- keep the mini-harness, memory, and KDS work aligned under one product-first architecture
- prevent drift back into overengineered planner/router behavior or unsafe KDS shortcuts

## Locked decisions

1. The conversational core stays mini-harness first.
   - The LLM owns conversational flow and tool selection.
   - Deterministic code exists to guard high-risk transitions, not to over-script the dialogue.
   - We do not revive the old planner/router architecture.

2. Memory is contextual, not operational truth.
   - Voyage embeddings remain the semantic recall mechanism.
   - Customer memory must follow the customer across conversations when relevant.
   - Memory can inform tone, preferences, and likely intent, but it must not override live cart/order/backend truth.

3. KDS must be backend-authoritative.
   - No anonymous mutation surface.
   - No fake or projection-invented lifecycle semantics presented as operator intent.
   - Customer notifications must be pushed from the real execution path, not left to cron luck.

4. The current repo boundaries stay.
   - `apps/umi-conversaflow` owns backend truth, orchestration, memory, KDS SQL, jobs, and outbox.
   - `apps/umi-kds` stays a thin KDS client over normalized contracts.
   - No new repo or service unless a measured constraint forces it.

## Current branch state

1. Mini-harness sign-off passed.
   - Local regression passed.
   - Online sign-off passed.
   - Live Twilio/KDS Plan C passed with operational findings.
   - Source: [mini-harness sign-off review](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/reports/mini-harness-signoff/signoff-review.md:1)

2. Semantic conversation patterns were audited and realistic regression conversations were produced.
   - Source: [semantic patterns and conversations](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/reports/mini-harness-message-audit/semantic-patterns-and-conversations.md:1)

3. Customer-scoped semantic recall exists at the database contract level.
   - Source: [20260511120000_customer_scoped_memory_search.sql](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260511120000_customer_scoped_memory_search.sql:1)

4. Turn memory shaping already preserves the correct guardrail.
   - Source: [turn-memory.ts](/Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/job-worker/processors/turn-memory.ts:1)

5. KDS has now been fully audited.
   - Source: [KDS system audit](/Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/2026-05-11-kds-system-audit.md:1)

## Finalized implementation order

### Phase 1 — Secure and normalize the KDS control plane ✓ complete (2026-05-12)

Deliverables:

- ~~rotate the exposed cron credential~~ — deferred; vault secret not yet set (user must rotate key in dashboard then `SELECT vault.create_secret(...)`)
- replace hardcoded cron auth with a Vault or named-secret pattern — done (`20260512220000`)
- remove `anon` mutation access from KDS RPCs — done (`20260512210000`)
- define the authenticated command surface for KDS actions — done (`kds-command` edge function, anon JWT)

Exit criteria:

- no public anonymous path can transition tickets or partially cancel items ✓
- no privileged credential is stored in repo SQL history going forward ✓ (vault-backed going forward; old token still needs rotation)

### Phase 2 — Make kitchen lifecycle truth canonical ✓ complete (2026-05-12)

Deliverables:

- define one backend-owned kitchen lifecycle ledger — `kds.tickets` is canonical; `transition_ticket` is the only writer
- all six statuses (`accepted`, `preparing`, `partial_cancelled`, `ready`, `completed`, `cancelled`) represented explicitly in `kds.tickets` and `kds.ticket_events`
- stop relying on projection heuristics to preserve kitchen-only states — `transition_ticket` writes directly to `kds.tickets` for KDS-only states; projection only upserts

Exit criteria:

- operator-visible lifecycle state is derived from canonical backend truth ✓
- projection no longer invents lifecycle semantics ✓

### Phase 3 — Repair KDS event semantics ✓ complete (2026-05-12)

Deliverables:

- make `kds.ticket_events` a coherent ordered stream — done
- reserve `status_changed` for real lifecycle transitions — done (`20260512230000`, `20260512240000`)
- move projection maintenance rows to `order_upserted` — done (trigger always emits `order_upserted`)
- remove ambiguous `from_status = null` status transitions — done (all `status_changed` events carry `from_status` + `to_status`)

Exit criteria:

- event consumers can trust `status_changed` ✓
- ticket history reads as one coherent narrative ✓

### Phase 4 — Fix notification execution and delivery truth ✓ partial (2026-05-12)

Deliverables:

- ensure KDS command execution explicitly wakes side-effect delivery — done (`kds-command` calls `triggerJobWorker()`)
- keep cron only as a recovery path — done
- add Twilio status callback handling — **not done** (deferred; out of scope for this wave)

Exit criteria:

- KDS customer notifications are near-immediate on the normal path ✓
- final provider delivery state is observable in backend truth — not yet (Twilio callback not wired)

### Phase 5 — Tighten the app client to match the backend contract ✓ complete (2026-05-12)

Deliverables:

- stop trusting backend event shapes that are not guaranteed — done (event semantics now guaranteed by backend)
- expose honest connection health — done (`pollingError`, `connectionState` advances only on first successful poll)
- keep the app thin and deterministic over backend-normalized contracts — done

Exit criteria:

- the app reflects backend truth instead of smoothing over backend ambiguity ✓

### Phase 6 — Expand regression coverage and sign-off ✓ partial (2026-05-12)

Deliverables:

- conversation sign-off suite — rerun, all 5 suites passed (10/10 turns each)
- live KDS/Twilio lifecycle verification — E2E tested: new→accepted→preparing→ready→completed, cancel, all `status_changed` events correct, outbox enqueued for customers with phone
- targeted unit tests for KDS lifecycle — not added (deferred)

Exit criteria:

- local tests green — N/A (no unit tests added)
- online sign-off green ✓
- live controlled flow green ✓

## Final prompt

Use this as the next execution prompt:

```text
You are continuing the Umi branch-wide refactor. Work as a software architect and implementation lead, not as a planner that stops at analysis.

Your job is to further the overall plan from the current branch state and execute it in the correct order.

Read these artifacts first:

1. /Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/2026-05-12-overall-refactor-final-prompt.md
2. /Users/juanlopez1/Documents/Repositories/Umi/docs/architecture/2026-05-11-kds-system-audit.md
3. /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/reports/mini-harness-signoff/signoff-review.md
4. /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/reports/mini-harness-message-audit/semantic-patterns-and-conversations.md
5. /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/migrations/20260511120000_customer_scoped_memory_search.sql
6. /Users/juanlopez1/Documents/Repositories/Umi/apps/umi-conversaflow/supabase/functions/job-worker/processors/turn-memory.ts

Non-negotiable architecture decisions:

- The mini-harness stays. Do not reintroduce the old restrictive planner/router architecture.
- The LLM owns conversation flow and tool choice. Deterministic code only guards high-risk transitions.
- Voyage embeddings remain the semantic memory mechanism.
- Memory is context, not operational truth.
- KDS must become authenticated, backend-authoritative, and event-coherent.
- Do not create a new repo or service unless you can prove the current boundary fails on measured criteria.

Priority order:

Phase 1. Secure and normalize the KDS control plane.
Phase 2. Make kitchen lifecycle truth canonical in the backend.
Phase 3. Repair KDS event semantics.
Phase 4. Fix notification wake-up and provider-final delivery truth.
Phase 5. Tighten the iPad client to match the backend contract.
Phase 6. Expand tests and rerun sign-off.

Implementation requirements:

- Prefer additive migrations and narrow refactors.
- Keep apps thin; backend owns truth.
- Do not leave anonymous KDS mutation paths in place.
- Do not preserve hardcoded privileged credentials.
- Do not let projection-generated rows masquerade as operator lifecycle intent.
- Keep memory customer-scoped where relevant, but never let recalled memory override live cart/order state.

Execution style:

- At each phase, briefly restate the goal, implement it, run the relevant tests, then do a mini-review before moving on.
- Document findings and tradeoffs as you go.
- Be extremely critical about contract quality, auth, event semantics, and operational truth.
- Do not stop at a plan unless blocked; implement the next highest-priority safe phase.

Definition of done for this refactor wave:

- KDS mutation/auth surface is hardened.
- Kitchen lifecycle truth is canonical and projection no longer invents operator semantics.
- KDS notifications are pushed on the real path and delivery truth is observable.
- App behavior matches the backend contract.
- Regression and live sign-off are green again.
```

## Final note

This is the locked branch direction. The next work should execute from this prompt and this phase order unless new live evidence forces a correction.
