# Mini-Harness Sign-Off Review

Date: 2026-05-12  
Owner: `apps/umi-conversaflow`  
Status: **Approved for Plan B and Plan C sign-off, with live-operation findings**

## Scope

This review covers the mini-harness branch after replacing the over-restricted planner/router approach with a smaller model-led tool loop plus narrow deterministic guards.

Documents reviewed:

- `../docs/architecture/reviews/mini-harness-architecture.md`
- `../docs/architecture/reviews/mini-harness-implementation-plan.md`
- `../docs/architecture/memory/MEMORY_ARCHITECTURE.md`
- `reports/mini-harness-message-audit/semantic-patterns-and-conversations.md`
- `reports/mini-harness-signoff/summary.json`

## Three Plans Compared

| Plan | What it proves | What it cannot prove | Result |
|---|---|---|---|
| Plan A: local deterministic regression | Processor contracts, tool-loop guards, memory shaping, safety helpers, tool behavior under controlled inputs | Real Anthropic behavior, real deployed Edge env | Passed: `64` tests, `0` failures (updated 2026-05-13) |
| Plan B: online non-destructive sign-off | Deployed Supabase Edge env, Anthropic calls, menu/cart tools, memory context, outbox path with irreversible tools intercepted | Real Twilio delivery and real irreversible order/cancel side effects | Passed after API credits were restored |
| Plan C: full live Twilio/KDS end-to-end | Real WhatsApp ingress, job worker, outbox dispatch, order side effects, KDS/read-model impact | Long-tail production variance across Twilio/Meta/provider timing | Executed on live test thread |

Plan B is the branch sign-off gate. Plan C was then executed on a controlled test phone to prove the full live path.

## Final Execution

Local regression:

```sh
DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env \
  supabase/functions/_shared/pending-clarification.test.ts \
  supabase/functions/job-worker/processors/tool-outcomes.test.ts \
  supabase/functions/job-worker/processors/turn-memory.test.ts \
  supabase/functions/job-worker/processors/turn-safety.test.ts \
  supabase/functions/job-worker/processors/turn-tool-loop.test.ts \
  supabase/functions/job-worker/processors/turn-process.test.ts \
  supabase/functions/whatsapp-handler/tools.test.ts
```

Result: `64 passed`, `0 failed` (updated 2026-05-13 after cart-editing fix).

Type checks:

```sh
deno check supabase/functions/job-worker/index.ts \
  supabase/functions/whatsapp-handler/index.ts \
  supabase/functions/mini-harness-signoff/index.ts
```

Result: passed.

Online run after Anthropic credits were restored:

- Run ID: `signoff-20260511230208-fullaftercredits`
- Artifacts: `reports/mini-harness-signoff/signoff-20260511230208-fullaftercredits/`
- HTTP result: `200` for suites 1 through 5
- Model errors: `0`
- Missing expected tools: `0` in every suite
- Deployed `mini-harness-signoff` test function was deleted after the run

## Suite Results

| Suite | Expected tools | Missing expected tools | Intercepted irreversible tools | Verdict |
|---|---|---:|---:|---|
| 1. Vague browse, cart build, revision, confirmation | `search_menu`, `add_to_cart`, `edit_cart`, `confirm_order` | 0 | 1 | Pass |
| 2. Memory, preferences, repeat order, safe confirmation | `get_recent_customer_orders`, `search_menu`, `add_to_cart`, `reorder_last_order`, `confirm_order` | 0 | 3 | Pass |
| 3. Frustration, contact, cancellation, recovery | `get_business_info`, `cancel_order`, `get_business_hours`, `search_menu` | 0 | 1 | Pass |
| 4. Hours, payment, complex cart corrections | `get_business_hours`, `get_business_info`, `add_to_cart`, `edit_cart`, `search_menu`, `confirm_order` | 0 | 1 | Pass |
| 5. Ambiguous product, category confusion, typo recovery | `search_menu`, `add_to_cart`, `edit_cart`, `confirm_order` | 0 | 1 | Pass |
| 6. Cart editing — pronoun reference, compound edit+add, swap, clear and restart | `add_to_cart`, `edit_cart`, `confirm_order` | 0 | 1 | Pass (2026-05-13) |

## Suite 6 — Cart Editing Fix (2026-05-13)

Suite 6 was added to address three production bugs confirmed via `messages.tsv` audit:

**Bug 1 — Pronoun "ese" not resolved to a product name.**
Root cause: `edit_cart` was called with `remove_query: "ese"` and the backend tool performed string matching, found nothing, and returned an error. Fix: added `resolveCartPronoun(query, draftCart)` that substitutes Spanish demonstratives to the last cart item's product name before any `edit_cart` call.

**Bug 2 — Revision intent with no-tool LLM response hallucinated a reply.**
Root cause: when the LLM returned no tools for a message like "quita la horchata", the code fell through to `final_text` without executing anything. Fix: added a `forced_edit_cart` no-tool path (analogous to the existing `forced_add_to_cart` path) that extracts and executes `edit_cart` deterministically.

**Bug 3 — Option correction ("mejor con coco, no de avena") was blocked from resuming pending clarification.**
Root causes:
- `isOptionCorrectionIntent` didn't match "mejor con X" / "no de X" patterns.
- `shouldIncludePendingClarification` blocked on `isRevisionIntent` before the option-correction check.
- Even when included, the pending clarification's `resume_input` still held the old milk value.
Fixes: extended `isOptionCorrectionIntent` pattern; added early `return true` for option corrections in `shouldIncludePendingClarification`; added `mergeOptionCorrectionIntoPending` that patches the `resume_input` with extracted variant corrections before passing the pending clarification to the LLM.

**Compound edit+add ("quita ese y ponme horchata") — deferred add after edit.**
After a successful `edit_cart`, the code now checks `extractAddQueryAfterEdit` to detect a "y ponme/agrega X" or "por un X" suffix in the user message and immediately executes a chained `add_to_cart` before returning. This handles both the case where the LLM natively calls `edit_cart` and the case where `add_to_cart` was converted to `edit_cart` via the revision-intent guard.

Additional hardening bundled with the fix:
- `isGenericResetWithoutProduct` now catches "olvida todo [eso]" patterns and triggers a `forced_reset_acknowledged` path that clears the cart (if non-empty) and returns a clean re-order prompt.
- `extractAddQuery` strips "de nuevo / otra vez / nuevamente" and leading articles (la/el/los/las) so follow-up adds like "agrégame la galleta de nuevo" resolve cleanly.
- `isConcreteOrderIntent` excludes `isGenericResetWithoutProduct` cases so generic resets never misfire as product adds.
- `extractAddQueryAfterEdit` handles the "por [un/una] X" swap pattern in addition to "y ponme/agrega X".

Local regression after fix: `64 passed`, `0 failed` (3 new tests added for pronoun resolution, forced edit_cart, and option correction merge).

Online run:
- Run ID: `signoff-20260513014719-suite6-v6`
- Artifact: `reports/mini-harness-signoff/signoff-20260513014719-suite6-v6/suite_6.json`
- All 6 suites re-verified: `missing_expected_tools = 0` in every suite.

## Fixes Validated

- Stale pending clarifications no longer dominate unrelated add, revise, info, reset, or confirmation turns.
- Payment/contact/location questions are forced through `get_business_info`.
- Repeat-order creation requires same-flow recent-order proof.
- Status questions such as "Ya quedo?" are blocked from confirming an order.
- Strong confirmations can proceed only when the backend cart/current state supports confirmation.
- Common Spanish variant language now resolves more naturally, including `chico frio`, `en las rocas`, `con leche de coco`, and mineral-water default variants.
- Cart revision flows now support clear, replace-cart, remove/keep-only, and option updates without duplicating lines.

## Current Review

The architecture direction is now coherent: the LLM owns conversation flow, backend tools own state mutation, memory is context rather than order truth, and deterministic code only gates known high-risk transitions. This is the right replacement for the previous restrictive planner/router design.

## Plan C Execution

Date: 2026-05-12  
Live test phone: masked as `+521***8408`  
Conversation: `762559f0-5112-4040-9166-3fdd38d177ea`

Execution path:

- Real WhatsApp inbound `join quarter-push` from the Juan test phone opened the Twilio/WhatsApp session.
- `whatsapp-handler` had already been redeployed with `--no-verify-jwt` after the earlier probe exposed the JWT misconfiguration.
- The sandbox `join` message did not create a backend conversation turn, so the live end-to-end test continued by sending Twilio-signed webhook messages against the now-open real WhatsApp session.
- User turn 1: `Quiero una galleta chocolatechip.`
- Assistant reply delivered to the real phone: cart summary with confirmation request.
- User turn 2: `Si confirmo.`
- Assistant reply delivered to the real phone: confirmed order `73fa0051-ebd6-41a4-b421-50850cd7fd47`.
- ConversaFlow created a real transaction in `pending`, then KDS projected ticket `db694244-2ff7-4d5d-b470-7aa70f756cb7`.
- Live KDS transitions executed through `kds.transition_ticket(...)`: `accepted`, `preparing`, `ready`, `completed`.
- WhatsApp status notifications for `accepted`, `preparing`, `ready`, and `completed` all reached final Twilio status `delivered`.

Live findings:

1. The full customer path works.
   Real WhatsApp session, webhook ingress, turn integrity, mini-harness processing, outbox delivery, transaction creation, KDS projection, KDS transitions, and Twilio status notifications all succeeded.

2. Twilio sandbox join is not equivalent to a normal customer turn.
   The real `join quarter-push` message opened the WhatsApp session but did not appear as a backend conversation message. That is acceptable operationally, but it means sandbox/session-opening traffic should not be used as a semantic test turn.

3. KDS-driven customer notifications are eventual, not immediate.
   The `twilio.status_notification` rows for the KDS lifecycle were enqueued correctly, but they were delivered on a later worker tick instead of immediately when the RPC completed. Example: the `completed` outbox row was created at `2026-05-12T06:44:01.541374+00:00` and delivered at `2026-05-12T06:45:02.333+00:00`.

4. KDS ticket event history needs review.
   The event stream for ticket `db694244-2ff7-4d5d-b470-7aa70f756cb7` contains projection-generated `status_changed` entries from `trigger`, including an early `preparing` event before the explicit manual `accepted` transition. Customer-facing notifications still arrived in the expected order, but the internal event semantics are harder to reason about than they should be.

Remaining risks:

- The sign-off runner is intentionally synthetic. It should remain a regression gate, not a substitute for production observation.
- Memory quality depends on the freshness and scope of stored facts. The current guard prevents memory from inventing cart truth, but preferences still need ongoing trace review.
- Outbox `delivered` still means dispatcher success, not provider-final delivery truth, unless a matching Twilio status trace is also present.
- KDS notification latency depends on later worker ticks because the KDS RPC path does not wake the worker explicitly.

## Refactor Plan After Sign-Off

1. Promote the five sign-off suites into versioned fixtures so every harness change replays the same customer journeys.
2. Add a structured scorer for repeated-question loops, unsupported business claims, invented cart lines, and premature confirmation.
3. Keep irreversible-tool interception in the sign-off runner and add cleanup SQL for sign-off customers, conversations, jobs, messages, and trace rows.
4. Review `edit_cart` and `add_to_cart` for smaller internal helpers now that behavior is green; avoid changing semantics during cleanup.
5. Add an explicit worker wake-up after KDS outbox enqueue so status notifications do not wait for the next tick.
6. Add Twilio status callbacks so `queued`/API acceptance and final `delivered`/`undelivered` are not conflated.
7. Review KDS projection/event semantics so internal status events do not appear to jump ahead of operator intent.
8. Keep a template-based WhatsApp reactivation path if the business needs bot-initiated conversations outside the 24-hour window.

## Decision

This version passes local regression, online sign-off, and a controlled live Twilio/KDS run. It is ready for code review and targeted hardening. The remaining work is not “does it work at all”; it is tightening the live operational edges uncovered by Plan C.
