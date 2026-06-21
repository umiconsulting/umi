# Mini-Harness Implementation Plan

**Date:** 2026-05-11  
**Owner:** `apps/umi-conversaflow`  
**Status:** Canonical implementation plan  
**Architecture:** [mini-harness-architecture.md](./mini-harness-architecture.md)

---

## 1. Goal

Build the new WhatsApp assistant runtime as a complete replacement.

The new runtime must:

- be natural in Spanish customer-service conversations
- use customer memory every turn
- call backend tools freely when operational truth is needed
- keep orders, prices, carts, and side effects backend-owned
- avoid broad dialogue-manager state
- be simple enough to debug under production pressure
- be tested heavily before deployment

There is no parallel rollout path in this plan. The branch should converge on one clean architecture.

---

## 2. Main Problems

### P1 - The current turn runtime is over-controlled

The model should not be boxed into a rigid pre-classification layer before it can use context and tools. The replacement runtime uses one conversational tool loop with deterministic safety checks after tool execution.

### P2 - The assistant needs memory to feel human

The assistant must remember preferences, dislikes, allergies, typical orders, and service history. Memory must be injected as useful context, not treated as operational truth.

### P3 - Tools must be deep enough for natural language

The LLM should be able to say "search for something cold and sweet" or "add what she usually gets" and let tools resolve products, variants, and ambiguity.

### P4 - State must be minimal

Persist draft cart and one pending clarification. Do not persist broad inferred fields as live truth.

### P5 - Testing must prove UX quality

Passing unit tests is not enough. We need replay, synthetic conversations, tool safety tests, memory tests, and manual transcript review.

---

## 3. Target File Structure

```text
supabase/functions/job-worker/processors/
  turn-process.ts              # new canonical runtime
  turn-context.ts              # loads turn/customer/business/context
  turn-tool-loop.ts            # small tool loop and caps
  turn-safety.ts               # irreversible-action guards
  turn-memory.ts               # memory shaping/pruning for prompt
  turn-observability.ts        # trace and ai_turn_logs helpers

supabase/functions/whatsapp-handler/
  prompts.ts                   # slim harness prompt
  tools.ts                     # deep tools

supabase/functions/_shared/
  memory.ts                    # Voyage + facts + semantic recall
  voyage.ts                    # Voyage adapter
```

Files that exist only to support the obsolete runtime should be removed during cleanup once the replacement runtime compiles and tests pass.

---

## 4. Implementation Phases

### Phase 1 - Runtime Foundation

Deliverables:

- Create the canonical `turn-process.ts`.
- Extract shared context loading from the current processor.
- Build the small tool loop:
  - max model calls
  - max tool calls
  - repeated same tool/input breaker
  - compact tool observations
- Write final assistant message and Twilio outbox once.
- Enqueue memory jobs after the reply.

Tests:

- no-tool greeting
- business info question
- menu search
- add item
- ambiguous add item
- tool error
- loop cap reached

Exit criteria:

- a synthetic turn can complete end-to-end with no obsolete runtime dependency
- one assistant message and one Twilio outbox row are produced
- tool chain is logged

### Phase 2 - Memory First-Class Integration

Deliverables:

- Use `buildWorkingMemory()` on every turn.
- Add `turn-memory.ts` to shape prompt memory:
  - recent thread
  - customer facts
  - semantic recall
  - summary
  - draft cart
  - pending clarification
- Add `memory_context` to logs:
  - facts present
  - semantic count
  - source scope
  - top similarity
  - memory omitted reason
- Add prompt rules for remembered preferences.

Tests:

- facts present, semantic absent
- semantic present, facts absent
- Voyage unavailable
- changed preference
- allergy/intolerance
- "lo de siempre"
- remembered preference should not silently mutate a cart

Exit criteria:

- memory context is present when available
- memory absence never blocks a turn
- remembered preferences personalize but do not create hidden order changes

### Phase 3 - Deep Tool Hardening

Deliverables:

- Make `search_menu` strong for:
  - typos
  - vague categories
  - mood-based requests
  - synonym queries
  - product follow-ups
- Make `add_to_cart` strong for:
  - product search
  - variant resolution
  - quantity
  - size/temp/milk
  - customer notes
  - `needs_clarification` with `resume_input`
- Complete typed tool errors and `auto_recovery`.
- Make tool summaries factual but voice-friendly.

Tests:

- "algo dulce"
- "algo frío"
- "algo de comer"
- typo product
- partial product name
- variant-only follow-up
- cart edit
- cancellation
- order confirmation
- tool retryable error

Exit criteria:

- no product/cart mutation depends on model-authored exact DB strings
- common ambiguity returns one useful clarification
- known retryable errors recover deterministically

### Phase 4 - Safety And Observability

Deliverables:

- `turn-safety.ts`
- hallucinated order confirmation blocker
- cancellation confirmation guard
- payment/status truth guard
- memory-as-truth guard
- tool-loop dead-end fallback
- structured `ai_turn_logs.metadata`
- pipeline traces for each major stage

Tests:

- model claims order without tool success
- model claims cancellation without tool success
- model uses old preference as current order instruction
- tool loop repeats same call
- final reply mentions internals

Exit criteria:

- irreversible actions require backend success
- unsafe final text is replaced with a safe response
- logs explain what happened without reading raw customer text

### Phase 5 - Cleanup Old Control Plane

Deliverables:

- Remove obsolete runtime files from live imports.
- Remove broad `conversation_state` writes from the new runtime.
- Remove obsolete env vars and references.
- Replace stale runbooks with a new mini-harness runbook.
- Keep only code that is used by the new runtime or by tests.

Delete candidates after replacement compiles:

- strict routing processor files
- obsolete runtime files
- old synthetic reports
- old branch metrics docs
- broad state helpers that no live code uses

Exit criteria:

- `rg` shows no live references to obsolete runtime names
- docs point only to the canonical architecture and plan
- tests pass

### Phase 6 - Full Test Campaign

Deliverables:

- replay fixture builder from `conversation_turns`
- synthetic conversation suite
- memory behavior suite
- tool safety suite
- manual transcript review packet
- deployment checklist

Required test buckets:

- natural browse
- item add
- variant clarification
- cart edit
- confirm order
- cancel order
- repeat order
- customer preference
- allergy/intolerance
- complaint continuity
- Voyage outage
- model/tool error

Exit criteria:

- zero hallucinated order confirmations
- zero silent memory-based cart mutations
- no stuck turn in replay suite
- repeated question rate under 2%
- manual naturalness score at least 85%
- deployment checklist approved

---

## 5. Test Strategy

### Unit Tests

- memory shaping
- prompt context construction
- tool loop caps
- duplicate tool/input breaker
- safety guards
- tool result normalization
- pending clarification resume

### Integration Tests With Stubbed Dependencies

- fake LLM responses
- fake tool outcomes
- fake Voyage outage
- fake Supabase rows
- outbox write verification
- memory job enqueue verification

### Replay Tests

Use real turn data with side effects disabled.

Replay output:

- final assistant response
- tool chain
- memory context metadata
- safety decisions
- latency and token estimate
- evaluator labels

### Synthetic UX Tests

Required cases:

- "qué tienes frío?"
- "algo dulce pero no tan pesado"
- "lo de la vez pasada"
- "sin leche como siempre"
- "mejor quítale el dirty chai"
- "sí, ese"
- "no, mejor otro"
- "me cayó mal la vez pasada"
- "acuérdate que soy intolerante a la lactosa"
- "ordename un latte grande con avena y una galleta"

### Manual Review

Rubric:

- natural and brief
- no internal-process leak
- no repeated known question
- memory is helpful but not creepy
- order/cart truth is correct
- one clear next step
- no dead-end response

---

## 6. Deployment Standard

Do not deploy the replacement runtime because it compiles. Deploy only after the test campaign passes.

Minimum deployment gate:

- focused unit and integration suite green
- replay suite green
- manual transcript review accepted
- Voyage outage fallback verified
- memory safety verified
- irreversible-action guards verified
- rollback command documented

---

## 7. Immediate Work Order

1. Create `turn-process.ts` as the new canonical runtime.
2. Extract context loading and outbox/log writing from the current processor.
3. Build the small tool loop with caps and compact observations.
4. Wire mandatory memory shaping.
5. Add safety checks.
6. Add tests before deleting live old runtime imports.
7. Delete old runtime files and references after the new runtime passes.

No more heuristic patches to the obsolete runtime.

---

## 8. Iteration Log

### Step 1 - Runtime Foundation Slice

**Status:** implemented locally, not deployed.

Changed files:

- `supabase/functions/job-worker/processors/turn-process.ts`
- `supabase/functions/job-worker/processors/turn-tool-loop.ts`
- `supabase/functions/job-worker/processors/turn-safety.ts`
- `supabase/functions/job-worker/processors/index.ts`
- `supabase/functions/job-worker/processors/turn-tool-loop.test.ts`
- `supabase/functions/job-worker/processors/turn-safety.test.ts`

What changed:

- `turn.process` now points to the canonical mini-harness processor.
- The processor loads turn, conversation, customer, business voice config, working memory, and partial-cancellation context directly.
- The LLM receives one conversational tool loop with the existing deep tools, not the strict pre-classification runtime.
- Tool observations are compacted before being returned to the model.
- The loop stops on tool clarification and persists resume context in `pending_clarification`.
- One assistant message and one Twilio outbox row are written after the final response.
- Memory jobs are still enqueued after each reply: `message.embed`, `conversation.summarize`, and `customer.extract_facts`.
- Order-confirmation language is blocked unless an order-confirming tool succeeded.

Mini-review:

- Documented fact: the current job/outbox contracts already support the mini-harness without a new service boundary.
- Source-backed tradeoff: keeping side effects in existing tools preserves backend ownership of orders, carts, prices, KDS projection, and retries while giving the model freedom to decide when to call tools.
- Umi-specific inference: the safest first replacement step is the worker processor boundary, because ingress and outbox delivery can stay unchanged.
- Risk: direct tool-loop behavior now depends more on prompt/tool descriptions than on pre-classification heuristics; this is intentional but needs transcript replay before deployment.
- Next best course: add integration tests around full processor persistence with fake Supabase rows, then move memory shaping into `turn-memory.ts` so logs can prove which memory was used or omitted.

Verification:

- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno check supabase/functions/job-worker/index.ts`
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts`
- Result: 39 passed, 0 failed.

### Step 2 - Memory As A First-Class Runtime Artifact

**Status:** implemented locally, not deployed.

Changed files:

- `supabase/functions/job-worker/processors/turn-memory.ts`
- `supabase/functions/job-worker/processors/turn-memory.test.ts`
- `supabase/functions/job-worker/processors/turn-process.ts`

What changed:

- Added `shapeTurnMemory()` as the canonical mini-harness memory boundary.
- Recent messages and semantic recall are pruned in one place before prompting.
- Each turn now logs `memory_context` with:
  - recent message count
  - summary presence
  - customer fact fields present
  - semantic recall count
  - semantic source scope
  - top similarity
  - omitted reasons
  - explicit guardrail that memory is context, not operational truth
- `turn-process.ts` now consumes shaped memory and logs the memory metadata inside `ai_turn_logs.metadata`.

Mini-review:

- Documented fact: Voyage-backed semantic recall and structured customer facts already exist in `_shared/memory.ts`; the runtime problem was not absence of memory, but lack of an explicit prompt/log boundary.
- Source-backed tradeoff: memory is useful for personalization, but it must not replace fresh tool calls for products, prices, carts, orders, payments, or status.
- Umi-specific inference: memory logging should be mandatory before replay testing, because transcript review needs to explain whether the bot used facts, semantic recall, both, or neither.
- Risk: `turn-memory.ts` currently shapes metadata and pruning only; it does not yet score contradictions such as a changed preference. That belongs in the memory behavior suite before deployment.
- Next best course: add full processor integration tests with fake Supabase to verify one assistant message, one outbox row, memory jobs, state transitions, and memory metadata in logs.

Verification:

- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno check supabase/functions/job-worker/index.ts`
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-memory.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts`
- Result: 42 passed, 0 failed.

### Step 3 - Processor Contract Test

**Status:** implemented locally, not deployed.

Changed files:

- `supabase/functions/job-worker/processors/turn-process.ts`
- `supabase/functions/job-worker/processors/turn-process.test.ts`

What changed:

- Added dependency injection to `processTurnProcess()` for tests while preserving the production two-argument worker call path.
- Added a processor-level integration test with fake Supabase rows and fake runtime dependencies.
- The test verifies:
  - turn status moves through `processing` and `completed`
  - conversation state updates from tool outcome
  - one assistant message is written
  - one Twilio outbox row is inserted with the turn idempotency key
  - `message.embed`, `conversation.summarize`, and `customer.extract_facts` jobs are enqueued
  - `ai_turn_logs.metadata.memory_context` is present
  - pipeline trace reaches `completed`

Mini-review:

- Documented fact: the worker registry only needs a function matching `(supabase, payload) => Promise<void>`, so injected dependencies do not affect production routing.
- Source-backed tradeoff: processor contract tests with fakes are cheaper and safer than live Supabase/Anthropic calls for basic persistence guarantees; live replay should come later for model/tool quality.
- Umi-specific inference: this test is the right gate before deleting old runtime files, because it proves the new processor owns the durable side effects expected by the job architecture.
- Risk: the current processor test covers the success path only. We still need conflict/supersede, tool clarification, hallucinated confirmation, and loop-cap processor tests.
- Next best course: add those failure-path processor tests, then remove live references to obsolete runtime code and begin deleting unused files.

Verification:

- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno check supabase/functions/job-worker/index.ts`
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-memory.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts supabase/functions/job-worker/processors/turn-process.test.ts`
- Result: 43 passed, 0 failed.

### Step 4 - Processor Failure-Path Tests

**Status:** implemented locally, not deployed.

Changed files:

- `supabase/functions/job-worker/processors/turn-process.test.ts`

What changed:

- Added processor tests for:
  - tool clarification persisted as `pending_clarification`
  - hallucinated order confirmation blocked before assistant message and outbox
  - conversation state conflict supersedes the turn and requeues `turn.integrity`

Mini-review:

- Documented fact: the new processor commits conversation state before assistant message and outbox side effects.
- Source-backed tradeoff: optimistic `state_version` conflict handling avoids replying from stale context, at the cost of one extra integrity job when a newer user turn changed the conversation.
- Umi-specific inference: this is the correct behavior for WhatsApp UX because replying late with stale cart/order context is worse than requeueing the turn.
- Risk: tests still stub the tool loop; real model/tool transcript quality remains unverified until replay and synthetic UX suites run.
- Next best course: clean live imports and old docs/runtime traces now that the new processor contract is covered, then start deep tool hardening and replay fixtures.

Verification:

- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno check supabase/functions/job-worker/index.ts`
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-memory.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts supabase/functions/job-worker/processors/turn-process.test.ts`
- Result: 46 passed, 0 failed.

### Step 5 - Old Runtime Cleanup

**Status:** implemented locally, not deployed.

Deleted files:

- obsolete strict planning modules and tests
- obsolete broad state helper
- obsolete previous turn processor and tests
- obsolete synthetic evaluation entrypoint and scripts

Changed files:

- `.env.example`
- `supabase/functions/_shared/inbound.ts`
- `supabase/functions/whatsapp-handler/index.ts`
- `supabase/functions/job-worker/processors/turn-process.ts`
- historical broad-state migration file
- `supabase/migrations/20260512100000_drop_legacy_conversation_state.sql`

What changed:

- Removed obsolete strict planning and previous processor code and tests from the branch.
- Removed the obsolete synthetic eval entrypoint and scripts.
- Removed the obsolete harness mode env var from `.env.example`.
- Renamed inbound comments to audit terminology.
- Added a migration to drop the legacy `conversaflow.conversation_state` table.
- Added an `EdgeRuntime` declaration so direct Deno checks work for `whatsapp-handler`.

Mini-review:

- Documented fact: `turn.process` now resolves only to `turn-process.ts` through the job-worker registry.
- Source-backed tradeoff: deleting obsolete runtime code reduces confusion and prevents accidental re-import, while keeping the applied historical migration file avoids breaking migration ledger expectations.
- Umi-specific inference: the only acceptable remaining broad-state reference is the historical migration plus the new drop migration; no live code imports or writes it.
- Risk: `supabase/migrations/20260512100000_drop_legacy_conversation_state.sql` has not been applied in this step. Apply only after confirming no external dashboards or diagnostics read that table.
- Next best course: build the replay/synthetic mini-harness suite against the new processor and then run live transcript review before deployment.

Verification:

- `rg` for obsolete runtime terms now returns no content matches in docs or live function code.
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno check supabase/functions/job-worker/index.ts supabase/functions/whatsapp-handler/index.ts`
- `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-memory.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts supabase/functions/job-worker/processors/turn-process.test.ts supabase/functions/whatsapp-handler/tools.test.ts`
- Result: 48 passed, 0 failed.

### Step 6 - Online Function Deployment

**Status:** deployed to Supabase project `xbudknbimkgjjgohnjgp`.

Deployed functions:

- `job-worker`
- `whatsapp-handler`

What changed operationally:

- Twilio ingress now runs the branch version of `whatsapp-handler`.
- The online `turn.process` job path now runs the mini-harness `job-worker` processor.
- The previous local-only validation gate is no longer the only evidence; the deployed function was reached after deploy.

Mini-review:

- Documented fact: Twilio, Anthropic, Supabase jobs, and outbox delivery require deployed Edge Functions for real integration validation.
- Source-backed tradeoff: local tests protect the processor contract, but online smoke checks are required before calling the runtime operationally usable.
- Umi-specific inference: deployment should happen before transcript replay if replay depends on actual Edge Function behavior and hosted secrets.
- Risk: the legacy broad-state drop migration was not applied in this step. That is deliberate until dashboards and diagnostics are checked.
- Next best course: run a real WhatsApp test turn, inspect `pipeline_traces`, `ai_turn_logs`, `messages`, `jobs`, and `outbox`, then start replay fixtures.

Verification:

- Deployed `job-worker` with Supabase CLI.
- Deployed `whatsapp-handler` with Supabase CLI.
- Online smoke call to `job-worker` returned:
  - `processedJobs: 0`
  - `failedJobs: 0`
  - `deliveredOutbox: 0`
  - `failedOutbox: 0`

### Step 7 - Online Sign-Off Conversation Suite

**Status:** executed; sign-off not approved.

Artifacts:

- `reports/mini-harness-signoff/summary.json`
- `reports/mini-harness-signoff/signoff-review.md`
- `reports/mini-harness-signoff/suite_1.pretty.json`
- `reports/mini-harness-signoff/suite_2.pretty.json`
- `reports/mini-harness-signoff/suite_3.pretty.json`
- `reports/mini-harness-signoff/suite_4.pretty.json`
- `reports/mini-harness-signoff/suite_5.pretty.json`

What changed:

- Added an auth-gated `mini-harness-signoff` Edge Function locally for online, non-destructive transcript runs.
- Deployed it temporarily to run five realistic suites through Supabase, Anthropic, memory context, menu/cart tools, and outbox insertion.
- Captured outbox rows without sending Twilio replies.
- Intercepted irreversible tools such as `confirm_order`, `cancel_order`, `confirm_order_changes`, and `reorder_last_order` so no real operational side effects were created.
- Deleted the deployed sign-off function after the run; the local function now requires `SIGNOFF_RUNNER_TOKEN`.

Mini-review:

- Documented fact: local regression tests still pass with `48` passed and `0` failed.
- Source-backed tradeoff: online non-destructive replay is the right gate before full Twilio/KDS live testing because it exercises the hosted model/tool path without customer-facing side effects.
- Umi-specific inference: this version should not be signed off because realistic conversations exposed failures in ordering, revision, repeat-order, and confirmation paths.
- Risk: tool coverage alone is not enough. Suite 5 reached expected tool coverage but still confirmed too aggressively and mutated cart state incorrectly.
- Next best course: implement pre-tool safety gates for confirmation/repeat/stale clarification/payment truth, repair variant resolution for failed Spanish phrases, add reset/replace cart semantics, then rerun the local and online sign-off plans.

Verification:

- Online suites executed:
  - Suite 1 failed: missing `edit_cart` and `confirm_order`; stale latte clarification persisted across unrelated turns.
  - Suite 2 failed: missing `reorder_last_order`; synthesized and confirmed a repeat cart despite no prior order.
  - Suite 3 reached tool coverage but still introduced an unrelated item after cancellation recovery.
  - Suite 4 failed: missing `get_business_info`, `edit_cart`, and `confirm_order`; payment truth and cart correction were weak.
  - Suite 5 reached tool coverage but confirmed on a status question and mishandled milk replacement.
- Local tests:
  - `DEFAULT_BUSINESS_ID=00000000-0000-0000-0000-000000000000 deno test --allow-env --env-file=.env supabase/functions/_shared/pending-clarification.test.ts supabase/functions/job-worker/processors/tool-outcomes.test.ts supabase/functions/job-worker/processors/turn-memory.test.ts supabase/functions/job-worker/processors/turn-safety.test.ts supabase/functions/job-worker/processors/turn-tool-loop.test.ts supabase/functions/job-worker/processors/turn-process.test.ts supabase/functions/whatsapp-handler/tools.test.ts`
  - Result: 48 passed, 0 failed.
