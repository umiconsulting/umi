# Mini-Harness Architecture Audit

**Date:** 2026-05-11  
**Owner:** `apps/umi-conversaflow`  
**Status:** Steering decision for the next architecture pass  
**Supersedes:** the live V2-only posture in `apps/umi-conversaflow/V2_ARCHITECTURE_RUNBOOK.md`  
**Related:**
- [responsibility-split-llm-vs-backend.md](./responsibility-split-llm-vs-backend.md)
- [natural-conversation-tool-routing-spec.md](./natural-conversation-tool-routing-spec.md)
- [tool-loop-failure-modes.md](./tool-loop-failure-modes.md)
- [conversation-and-session-layers.md](../conversation-and-session-layers.md)
- [memory/MEMORY_ARCHITECTURE.md](../memory/MEMORY_ARCHITECTURE.md)
- [EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md](../../research/EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md)
- [mini-harness-implementation-plan.md](./mini-harness-implementation-plan.md)
- [`apps/umi-conversaflow/AGENTS.md`](../../../AGENTS.md)

---

## 1. Decision

ConversaFlow should not continue moving toward a strict router / planner / dialogue-manager architecture for WhatsApp ordering.

The next architecture should be a **mini harness**:

- one conversational LLM pass with deep backend tools attached
- a small tool loop with hard operational guardrails
- backend-owned truth for orders, prices, carts, retries, and idempotency
- customer-scoped memory using structured facts plus Voyage/pgvector semantic recall
- minimal persisted dialogue state
- freedom for the LLM to choose wording and ordinary tool use
- deterministic blocking only for irreversible side effects and known failure classes

The prior split was directionally right: product catalog resolution, cart truth, pricing, confirmation, and retries belong in backend tools. The mistake was turning that into a second conversational brain that tries to pre-classify, sanitize, carry, gate, and override the user's intent before the model gets to respond.

The product goal is not "make the LLM unable to do the wrong thing." The product goal is "make the customer feel understood while the backend prevents expensive wrong things."

Memory is part of that product goal. A warm assistant must remember stable customer preferences, prior friction, and repeat-order patterns without confusing historical preference with current transactional truth. The mini harness therefore includes customer memory as a first-class input to the conversation, not as an optional RAG add-on.

---

## 2. Audit Summary

The current live code is no longer the simple tool loop reviewed on 2026-03-31. It is V2-only:

- `PROCESSORS["turn.process"]` points directly to `processTurnProcessV2`.
- The runbook says rollback is a branch deploy, not runtime sampling or a flag.
- Each turn runs a strict LLM router, conservative extraction, state merging, deterministic routing, readiness checks, optional tool execution, and optional voice generation.
- `conversation_state`, `conversations.current_state`, `conversations.pending_clarification`, `conversation_turns.extracted_intent`, and `conversation_turns.reconciled_action` now all carry overlapping task state.

This architecture solves some earlier classes of failure, but it creates a new failure mode: **the harness can get stuck even when the LLM could have recovered conversationally.**

That is exactly the product regression being reported: fewer natural conversations, more brittle stalls, more manual bug fixes.

---

## 3. What Changed From The Original Review

The original review identified the real problem:

- `search_products` and `create_order` were too shallow.
- The LLM had to copy exact product/variant strings.
- The prompt acted like a workflow engine.
- Tool errors were untyped strings.
- State was inferred from assistant text.

The intended remedy was:

- deeper tools
- structured errors
- draft cart owned by backend
- deterministic retry for known tool failures
- thinner prompt

The implemented V2 added those ideas, but also added a much larger control plane:

```text
strict router LLM
  -> local intent extraction object
  -> conservative field filter
  -> persisted conversation_state merge
  -> pending clarification invalidation
  -> deterministic planner
  -> readiness gate
  -> tool execution
  -> response bypass or voice LLM
  -> hallucination guard
```

That is no longer a mini harness. It is a dialogue manager with an LLM-shaped front door.

---

## 4. Findings

### F1 - V2 is the only live path

`job-worker/processors/index.ts` imports `processTurnProcessV2 as processTurnProcess`, and `V2_ARCHITECTURE_RUNBOOK.md` states that rollback is a branch/deploy rollback.

This means architecture risk is handled operationally, not product-safely. If V2 traps a live customer in a brittle state, the system has no runtime escape hatch to a simpler conversational path.

**Steer:** restore runtime mode selection before the next refactor:

```env
CONVERSAFLOW_TURN_PROCESSOR_MODE=mini_harness | v2 | shadow
```

Default should become `mini_harness` only after replay and live shadow checks pass.

### F2 - The router is a second LLM task, not a lightweight harness

`router.ts` forces a strict `route_conversation` tool with many fields: intent, confidence, completeness, ambiguity, revision flags, tool hint, plan kind, plan tools, entity slots, clarification target, and draft response.

Then `turn-process-v2.ts` converts the router result into `SemanticExtraction`, applies local regex/heuristic overrides, merges with persisted state, and calls `routeV2`.

This duplicates the work the final model/tool loop used to do naturally. It also means a router mistake can become a persisted state bug.

**Steer:** remove the strict router from the live path. If we keep it, use it offline for evaluation and diagnostics, not as the customer-facing control plane.

### F3 - The state model is carrying too much conversational truth

V2 persists `conversation_state.known_fields`, `missing_fields`, `constraints`, `last_user_goal`, `last_bot_action`, `task_stage`, and `confidence`. It also reads/writes `conversations.current_state`, `draft_cart`, and `pending_clarification`.

This creates state that can be stale, over-carried, or over-cleared. The code already has defenses for this: conservative field dropping, pending clarification invalidation, changed-intent detection, anti-repeat blocking. Those defenses are signals that the state model is too heavy.

**Steer:** keep only state that the product actually owns:

- L1 thread: `conversations`
- L3 task handle: active draft cart plus one pending clarification
- L4 transactional truth: `transactions`
- logs/traces: `conversation_turns`, `ai_turn_logs`

Do not persist a broad slot-filling belief state unless a specific product workflow proves it needs one.

### F4 - Tool readiness gates block useful ambiguity

`checkToolReadiness` blocks `search_menu` and `add_to_cart` without a query, and `routeV2` turns missing fields into `ask_missing_field`.

For a cafe customer, "tienes algo dulce?", "qué hay frío?", "algo de comer", "lo de ayer", and "ese" can be useful inputs. Some are vague browsing turns, not missing-field failures. Some should trigger `search_menu`; some should let the LLM ask a natural question; some should use recent context.

V2 tries to handle several of these with special functions such as `applyContextualMenuQuery` and `applyContextualVariantSelection`. That is an overfit patch pattern.

**Steer:** tool schemas and tool implementations should accept natural ambiguity. The harness should not require every action to be slot-complete before calling a tool. Let `search_menu` and `add_to_cart` return structured `needs_clarification` when ambiguity is real.

### F5 - Router failure can become a stuck job

`processTurnProcessV2` throws if `routeIntent` returns nothing:

```ts
if (!routerDecision) {
  throw new Error(`router failed for turn ${payload.turn_id}`);
}
```

A failed classification should not be a failed customer conversation. It should fall back to a normal conversational tool loop or a polite response. Classifier failure is not equivalent to order failure.

**Steer:** fail open for conversation. Fail closed only for side effects such as `confirm_order`, `cancel_order`, payment, and order mutation.

### F6 - Naturalness is bypassed on the hottest transactional paths

For `add_to_cart`, `edit_cart`, `confirm_order`, `confirm_order_changes`, and `reorder_last_order`, V2 often sends `suggestedReply` directly as the final response. This saves one LLM call, but it revives the original "tool-shaped customer experience" problem.

It is acceptable for a final order confirmation to be templated. It is not acceptable for exploration and cart-building to feel like a form engine.

**Steer:** use deterministic templates only when precision beats voice:

- order created
- order cancelled
- payment/status-critical output

Use a voice pass for browse, clarification, cart editing, and soft recovery.

### F7 - Runtime controls are inconsistent

The runbook lists:

```env
CONVERSAFLOW_MAX_LLM_CALLS_PER_TURN=2
CONVERSAFLOW_MAX_TOOL_CALLS_PER_TURN=4
```

The V2 processor reads `CONVERSAFLOW_MAX_TOOL_CALLS_PER_TURN`, defaults to 2, and does not enforce a visible `CONVERSAFLOW_MAX_LLM_CALLS_PER_TURN` in the same way.

This makes operations think there is a cap that code may not actually honor.

**Steer:** mini harness caps should be simple and real:

- max model calls per turn: 2 or 3
- max tool calls per turn: 3 or 4
- max repeated same tool/input: 1
- fallback response on cap reached

### F8 - The architecture applied long-running-agent patterns to a short customer-service turn

The current design resembles an agent scaffold: durable state, strict routing, plan validation, tool loop controls, and trace metadata. But this product is not Claude Code or Codex. It is a short, high-empathy WhatsApp ordering assistant with a bounded tool surface.

The customer experience should feel like a capable employee with a POS, not a form wizard.

**Steer:** treat the model as an augmented conversational LLM, not an autonomous agent and not a rigid slot-filling workflow.

### F9 - Memory must be customer-scoped, not only conversation-scoped

The memory system already has the right ingredients:

- recent messages
- rolling summaries
- `customer_preferences.facts`
- Voyage AI embeddings on messages
- pgvector semantic retrieval
- async `message.embed`, `conversation.summarize`, and `customer.extract_facts` jobs

The missing architecture point is that service memory is about the customer relationship, not just the active WhatsApp thread. A customer who says "lo de siempre" expects the business to remember across visits, not just within the current prompt window.

**Steer:** mini-harness context assembly must always include a relationship-memory step:

- structured facts from `customer_preferences.facts`
- customer-scoped semantic recall via Voyage/pgvector
- recent active-thread context
- transactional tools for current order truth

Embeddings are for probabilistic recall. They must never be the source of truth for current price, availability, order status, or payment state.

### F10 - Raw memory needs product policy, not just retrieval

Raw embedded messages are useful, but not all retrieved text deserves prompt space. Greetings, "sí", repeated assistant boilerplate, and stale one-off instructions can add noise. The mini harness needs retrieval policy that favors customer-authored, preference-bearing, recent-enough, high-confidence memory.

**Steer:** memory injection should be selective:

- prefer user messages and typed facts
- include assistant messages only when needed for complaint/service continuity
- weight by similarity, recency, memory type, and confidence
- distinguish durable preference from one-order note
- keep operational facts behind tools

---

## 5. What To Keep

The audit does not recommend going back to the original shallow-tool architecture.

Keep:

- durable ingress, jobs, and outbox
- deep tools: `search_menu`, `add_to_cart`, `edit_cart`, `confirm_order`, `cancel_order`, `reorder_last_order`
- backend-owned cart, prices, product resolution, variant resolution, order IDs, and transactional side effects
- Voyage AI embeddings, pgvector search, and async memory jobs
- `customer_preferences.facts` as the durable structured preference surface
- customer-scoped semantic recall for fuzzy relationship memory
- tenant voice config in `businesses.config.voice`
- hallucinated order guard
- structured `needs_clarification`, `error_type`, and `auto_recovery`
- compact tool traces in `ai_turn_logs.metadata.tool_chain`
- `conversation_turns` as a turn audit log

Move out of the live path:

- strict router as mandatory first LLM call
- broad persisted `conversation_state` slot memory
- deterministic `routeV2` as the primary decider for ordinary turns
- conservative field dropping as a general policy
- branch-only rollback

---

## 6. Target Mini-Harness

### 6.1 Shape

```text
turn.integrity
  -> load compact context
      -> recent active-thread messages
      -> structured customer facts
      -> Voyage/pgvector customer memory recall
      -> current draft cart / pending clarification
  -> conversational LLM with deep tools
      -> execute validated tool call
      -> return compact tool result
      -> allow one follow-up LLM response
  -> deterministic post-checks
  -> save message + state + outbox + trace
```

The harness is "mini" because it owns only:

- context assembly
- relationship-memory retrieval and pruning
- tool validation and execution
- known deterministic recovery
- side-effect safety
- loop limits
- observability

It does not own:

- normal wording
- every intent classification
- a full dialogue belief state
- preemptive slot gating
- a second planner brain

### 6.2 Prompt Contract

Use the existing `buildHarnessSystemPrompt` direction, but slim it further:

- role and tenant voice
- compact customer memory block
- tool descriptions
- hard rules for irreversible actions
- no numbered FLUJOs
- no exhaustive slot-filling script
- no hidden product-specific assumptions

The prompt should tell the LLM what matters to the customer:

- be brief, warm, and useful
- call tools when menu/order/business truth is needed
- ask one clear question when needed
- never invent prices/order confirmations
- do not expose internal process
- use remembered preferences softly ("normalmente te gusta...") only when relevant
- never treat remembered preferences as current order instructions without confirmation

### 6.3 Tool Contract

Tools should become deeper and more tolerant:

- `search_menu({ query })` accepts vague browse terms such as `comida`, `dulce`, `frio`, `cafe`, and `postre`.
- `add_to_cart({ query, quantity?, size?, temp?, milk? })` may search and resolve internally.
- `add_to_cart` returns `needs_clarification` when more detail is required, with `resume_input`.
- `confirm_order` operates only on the backend draft cart; it never trusts a model-authored item list.
- `cancel_order` and `confirm_order_changes` remain backend-controlled.
- Every tool error has `error_type`; known recoveries include `auto_recovery`.

### 6.4 State Contract

Persist only the state needed to resume the next customer turn:

```ts
type MiniConversationState = {
  current_state:
    | "initial"
    | "browsing"
    | "awaiting_confirmation"
    | "clarification_needed"
    | "ordering";
  draft_cart: DraftCart | null;
  pending_clarification: {
    question: string;
    resume_tool: ToolName;
    resume_input: Record<string, unknown>;
    slot?: string;
    expires_at: string;
  } | null;
}
```

Anything broader belongs in logs, not in live control state.

### 6.5 Memory Contract

Mini-harness context assembly has four memory inputs:

```ts
type MiniHarnessMemory = {
  recent_thread: Array<{ role: "user" | "assistant"; content: string }>;
  structured_facts: {
    preferences: string[];
    dislikes: string[];
    typical_order: string | null;
    allergies: string[];
    notes: string | null;
  } | null;
  semantic_recall: Array<{
    role: "user" | "assistant";
    content: string;
    similarity: number;
    source_scope: "customer" | "conversation";
    created_at?: string;
  }>;
  transactional_snapshot: {
    draft_cart: DraftCart | null;
    pending_clarification: MiniConversationState["pending_clarification"];
  };
}
```

Memory rules:

- Structured facts are the preferred durable memory surface for preferences, dislikes, allergies, and typical order.
- Voyage/pgvector recall is used to recover fuzzy context and candidate memories that structured facts may not yet contain.
- Transactional tools remain the source of truth for catalog, price, order status, fulfillment state, and current cart mutation.
- The LLM may use memory to personalize and reduce repeated questions, but must confirm before applying a preference to a new order if the user did not request it.
- Every memory injection should be traceable in `ai_turn_logs.metadata.memory_context`.

The eventual typed-memory target is a `customer_memories` table with memory type, confidence, source message, embedding, last reinforced timestamp, and expiry policy. That is a later improvement; the immediate mini-harness should use the deployed `customer_preferences.facts` plus customer-scoped semantic recall.

### 6.6 Failure Policy

Fail open for conversation:

- router/classifier unavailable: continue with the normal LLM tool loop
- low confidence: let the model ask naturally
- tool returns unknown product: voice pass proposes alternatives or asks one question
- Voyage unavailable: continue with recent messages and structured facts

Fail closed for side effects:

- no order confirmation without `confirm_order` success
- no cancellation without `cancel_order` success
- no payment or status claim without backend evidence
- no repeated same tool/input loops
- no use of remembered data as current operational truth

---

## 7. Migration Plan

The detailed implementation plan lives in [mini-harness-implementation-plan.md](./mini-harness-implementation-plan.md). The architecture-level migration is:

### Phase 0 - Stop the bleeding

1. Add runtime selection:

```env
CONVERSAFLOW_TURN_PROCESSOR_MODE=v2 | mini_harness | shadow
```

2. Keep V2 available, but no longer make branch rollback the only escape hatch.
3. If the V2 router fails, fall back to mini-harness behavior instead of throwing.
4. Keep customer memory jobs healthy: `message.embed`, `customer.extract_facts`, and customer-scoped semantic recall must remain active.
5. Add a metric for manual-intervention/stuck-turn proxies:
   - repeated same pending clarification
   - `tool_readiness_blocked`
   - `anti_repeat_blocked`
   - job retries for `turn.process`
   - no assistant outbox after released turn
   - missing memory context when facts/embeddings exist

### Phase 1 - Implement mini harness beside V2

Create `job-worker/processors/turn-process-mini.ts`.

Use:

- `buildHarnessSystemPrompt`
- `executeTool`
- `applyToolOutcome`
- `buildWorkingMemory`
- customer-scoped Voyage/pgvector recall
- `logAiTurn`
- `insertOutbox`

Do not use:

- `routeIntent`
- `buildToolPlan` as authoritative control
- `conversation_state` as live slot memory
- `routeV2`

### Phase 2 - Make tools carry more product intelligence

Deepen the tool layer until the model can operate with natural input:

- fuzzy product and variant resolution inside tools
- structured `needs_clarification` everywhere ambiguity is real
- auto-recovery for known errors
- backend-generated summaries that are factual but not over-prescriptive
- preference-aware suggestions that use memory softly, not as hidden order mutation

### Phase 3 - Typed memory hardening

Add a typed memory layer if raw-message recall is too noisy:

- `customer_memories`
- memory type: preference, dislike, allergy, typical_order, complaint_context, service_note
- source message / source order IDs
- confidence and reinforcement count
- embedding for semantic recall
- expiry policy for ephemeral notes

This phase should only happen after mini-harness replay shows real memory value and identifies raw-message noise.

### Phase 4 - Shadow and compare

Run V2 and mini-harness in shadow on the same turns:

- tool chain selected
- memory context injected
- final customer-visible response
- order/cart outcome
- token count
- latency
- clarification count
- manual review naturalness score
- preference-memory usefulness score

V2 should remain only if it wins on both task success and customer experience. Winning on fewer tool mistakes is not enough if the conversation feels worse or gets stuck more often.

### Phase 5 - Retire V2 dialogue manager pieces

After mini-harness passes live gates:

- remove strict router from the live path
- keep router/planner only as offline eval helpers if useful
- stop writing broad `conversation_state` for new turns
- update `V2_ARCHITECTURE_RUNBOOK.md` or replace it with a mini-harness runbook

---

## 8. Acceptance Criteria

Product and user experience first:

| Criterion | Target |
|---|---:|
| Completed order success on replay suite | >= V2 |
| Manual "natural conversation" score | >= 85% acceptable |
| Median customer turns to add one item | <= V2 |
| Repeated missing-field question rate | < 2% |
| Stuck `turn.process` jobs requiring manual repair | 0 over 14 days |
| Hallucinated order confirmations | 0 |
| Tool-call trace present on tool turns | 100% |
| Customer memory context present when facts or relevant embeddings exist | >= 95% |
| Remembered preference used without confirmation as order mutation | 0 |
| Voyage unavailable degradation | graceful, no stuck turn |
| p95 latency for normal browse/order turns | <= V2 or justified by better UX |

Instrumentation should explicitly separate:

- model failed to call a useful tool
- tool returned `needs_clarification`
- tool returned terminal error
- harness blocked side effect
- memory retrieved / memory omitted / memory used in response
- model produced unsafe final text
- job/runtime failure

These are different problems and should not be collapsed into "the bot failed."

---

## 9. Source-Backed Decision Basis

### Documented facts from Umi code/docs

- V2 is the only registered `turn.process` path in `job-worker/processors/index.ts`.
- `V2_ARCHITECTURE_RUNBOOK.md` says rollback is a branch/deploy rollback.
- `turn-process-v2.ts` throws when the strict router fails.
- V2 uses strict routing, conservative field filtering, persisted conversation state, deterministic planning, readiness gates, tool execution, and voice generation.
- The memory system uses Voyage `voyage-4-lite` embeddings, pgvector, `customer_preferences.facts`, async message embedding, and async customer fact extraction.
- Customer-scoped semantic recall is now the desired relationship-memory retrieval mode; conversation-scoped recall is only the fallback.
- Existing review docs correctly identified shallow tools and backend-owned transaction truth as the original failure source.

### Primary sources checked

- Anthropic, [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- Anthropic, [Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents)
- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- OpenAI, [Agents SDK - Agents](https://openai.github.io/openai-agents-python/agents/)
- OpenAI, [Function Calling in the OpenAI API](https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api)
- Voyage AI, [Embeddings](https://docs.voyageai.com/docs/embeddings)
- Yao et al., [ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)
- Tian et al., [Amendable Generation for Dialogue State Tracking](https://arxiv.org/abs/2110.15659)
- Jeon and Lee, [Domain State Tracking for a Simplified Dialogue System](https://arxiv.org/abs/2103.06648)
- Microsoft Research, [S3-DST](https://www.microsoft.com/en-us/research/publication/s3-dst-structured-open-domain-dialogue-segmentation-and-state-tracking-in-the-era-of-llms/)

### Source-backed tradeoffs

- Anthropic distinguishes workflows from agents. Workflows use predefined code paths; agents dynamically direct their own process and tool usage. ConversaFlow's cafe ordering path is bounded enough for workflow-style backend tools, but the current V2 control plane is more complex than needed for that workflow.
- Anthropic recommends simple, composable patterns first and warns that frameworks can obscure prompts/responses and tempt unnecessary complexity. This matches the observed V2 debugging pain.
- Anthropic says routing is useful when categories are distinct and classification is accurate. V2 assumes this is true for every live turn. The reported stuck jobs suggest routing accuracy and downstream state handling are not reliable enough to be the sole gate.
- Anthropic's long-running harness work is about coding agents over many context windows. That research should not be imported wholesale into a short WhatsApp ordering turn.
- OpenAI's Agents SDK defines an agent as an LLM configured with tools and runtime behavior, while noting that if we want to own the loop ourselves, we can use the lower-level API directly. ConversaFlow should own a small loop because side effects and business data are ours.
- Function calling/structured outputs guarantee argument shape, not product correctness or conversational quality. They are useful at the tool boundary, not as a reason to force all conversation through a strict planner.
- Voyage embeddings are appropriate for semantic recall and use asymmetric query/document modes. They improve fuzzy customer-memory retrieval, but do not establish freshness or operational truth by themselves.
- ReAct supports interleaving reasoning and acting for tasks where observations update plans. It does not imply every customer-service turn needs a separate strict router and persisted belief state before tools.
- Dialogue state tracking research supports tracking state, and also shows error propagation is a real concern. The lesson for Umi is to track minimal resumable state and amend through tools/results, not persist every inferred slot as live truth.

### Umi-specific inference

ConversaFlow is not ready for a full agent architecture because the product does not need long-horizon autonomous planning. It needs a reliable, warm ordering assistant with relationship memory. The right middle ground is a mini harness: enough structure to protect orders and tools, enough memory to feel personal, and enough freedom for the model to carry the conversation naturally.

### What would invalidate this decision later

- Replay data shows mini-harness has materially worse order success than V2 after tool improvements.
- Live traffic expands into genuinely open-ended multi-step support where the needed tool path is not predictable.
- A future model/tool stack reliably handles strict routing without the current stuck-state failure modes.
- Product requirements demand formal slot completion for compliance or payment reasons beyond the current cafe ordering scope.
- Customer memory retrieval becomes noisy enough that typed memory must replace raw-message semantic recall before live rollout.

---

## 10. Immediate Engineering Next Step

Do not keep patching V2 heuristics one bug at a time.

The next implementation should be:

1. Add processor mode selection.
2. Build `turn-process-mini.ts`.
3. Make working memory a mandatory mini-harness input: recent thread, facts, customer-scoped Voyage recall, and transactional snapshot.
4. Reuse deep tools and logging.
5. Run shadow comparison against V2.
6. Move live traffic only when customer-visible replay quality is better, not merely when planner/tool agreement looks good.

This keeps the product and user first: the model gets room to be conversational, and the backend still owns every piece of operational truth that can hurt the business if it is wrong.
