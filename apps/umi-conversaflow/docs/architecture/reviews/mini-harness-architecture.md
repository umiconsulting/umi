# Mini-Harness Architecture

**Date:** 2026-05-11  
**Owner:** `apps/umi-conversaflow`  
**Status:** Canonical target architecture for the WhatsApp assistant  
**Implementation plan:** [mini-harness-implementation-plan.md](./mini-harness-implementation-plan.md)

---

## 1. North Star

ConversaFlow should feel like a capable employee with a POS and customer memory.

The assistant should:

- understand casual customer language
- remember stable client preferences
- search and modify orders through backend tools
- speak naturally in the tenant's voice
- protect every irreversible business action with backend truth
- recover gracefully when a model, tool, or memory lookup fails

The product is not an autonomous coding agent and not a rigid slot-filling form. It is a customer-service assistant. The architecture must optimize for customer experience first, then reliability, then cost.

---

## 2. Runtime Pillars

The system has five runtime pillars.

### 2.1 Mini Harness

The harness owns the turn lifecycle:

```text
turn.process
  -> load turn, conversation, customer, business
  -> build customer-aware working memory
  -> call conversational LLM with deep tools
  -> execute validated tool calls
  -> return compact tool observations
  -> let the LLM produce the final reply
  -> run deterministic safety checks
  -> persist assistant message, outbox, logs, and memory jobs
```

The harness does not own normal wording, every intent classification, or broad slot-filling state. It owns context, tool execution, safety, limits, and observability.

### 2.2 Deep Tools

Tools are the business interface. They should accept natural inputs and do the deterministic work internally.

Required tool behavior:

- `search_menu` handles exact names, typos, vague categories, and mood-based asks.
- `add_to_cart` resolves products and variants internally.
- `edit_cart` modifies only the backend draft cart.
- `confirm_order` creates an order only from the backend draft cart.
- `cancel_order` changes backend order state only when valid.
- business info and hours come from tenant config/data.

Tools return structured outcomes:

```ts
type ToolOutcome =
  | { success: true; data_summary?: object; suggested_reply?: string }
  | {
      success: false;
      error: string;
      error_type: "retryable" | "needs_input" | "terminal";
      needs_clarification?: string;
      resume_input?: Record<string, unknown>;
      auto_recovery?: { tool: string; input: Record<string, unknown> };
    };
```

### 2.3 Customer Memory

Memory is a product feature, not a sidecar.

Each turn receives:

- recent thread context
- `customer_preferences.facts`
- customer-scoped Voyage/pgvector semantic recall
- conversation summary when useful
- current draft cart and pending clarification

Memory rules:

- Stable preferences, dislikes, allergies, typical orders, and service notes live in structured facts.
- Voyage embeddings support fuzzy recall across customer history.
- Raw semantic recall is advisory context, not truth.
- Order status, prices, menu availability, and payment state always come from tools.
- Remembered preferences may personalize the conversation, but they must not silently mutate a new order.

### 2.4 Transactional Truth

Operational truth belongs to backend data and tools:

- products and variants
- prices and availability
- draft cart
- order creation
- cancellation and order changes
- fulfillment state
- outbox side effects

The LLM can request actions. It cannot create operational truth by text.

### 2.5 Evaluation And Observability

Quality is not only "did a tool get called."

Every run should log:

- model calls
- tool calls and compact outcomes
- memory context presence
- safety guard decisions
- final response type
- latency and token counts
- stuck-turn indicators

Testing must include replay, synthetic edge cases, and manual transcript review.

---

## 3. Prompt Contract

The prompt should be short and operationally sharp.

It includes:

- tenant voice
- compact customer memory
- recent thread
- current cart/pending clarification
- tool descriptions
- irreversible-action rules

It excludes:

- numbered conversation flows
- exhaustive scripts
- implementation history
- hidden tenant-specific constants
- broad orchestration instructions

Required behavior:

- be brief, warm, and useful
- call tools for menu, cart, order, hours, and business truth
- ask one clear question when needed
- do not mention tools, prompts, databases, or internal process
- do not invent prices, order IDs, availability, or confirmations
- use memory softly and relevantly
- confirm before applying remembered preferences to a new order

---

## 4. State Contract

Persist only what is needed to resume the customer experience.

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
    resume_tool: string;
    resume_input: Record<string, unknown>;
    slot?: string;
    expires_at: string;
  } | null;
};
```

Do not persist a broad belief state of inferred slots. If the system cannot safely infer a value from recent thread, cart, pending clarification, facts, or tools, it should ask naturally.

---

## 5. Memory Contract

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
};
```

Memory quality policy:

- prefer user-authored semantic recall
- filter out low-signal messages
- rank by similarity, recency, novelty, memory type, and confidence
- preserve facts separately from raw recall
- treat allergies/intolerances as high-salience but still confirm when changing an order
- expire one-off order notes instead of turning them into durable preferences

Future typed memory table:

```ts
type CustomerMemory = {
  id: string;
  customer_id: string;
  business_id: string;
  memory_type:
    | "preference"
    | "dislike"
    | "allergy"
    | "typical_order"
    | "complaint_context"
    | "service_note";
  content: string;
  confidence: number;
  source_message_id?: string;
  source_transaction_id?: string;
  embedding?: number[];
  reinforced_count: number;
  last_reinforced_at: string;
  expires_at?: string;
};
```

Add this table when replay shows raw-message recall is too noisy or not auditable enough.

---

## 6. Failure Policy

Fail open for conversation:

- model error: fallback response and retryable job logging
- Voyage unavailable: continue with facts and recent context
- semantic recall empty: continue normally
- low confidence: ask naturally
- tool ambiguity: ask one clear question

Fail closed for side effects:

- no order confirmation without `confirm_order` success
- no cancellation without `cancel_order` success
- no price/availability claim without tool evidence
- no repeated same tool/input loops
- no memory-based order mutation without explicit confirmation

---

## 7. Acceptance Criteria

| Criterion | Target |
|---|---:|
| Hallucinated order confirmations | 0 |
| Stuck `turn.process` jobs needing manual repair | 0 over 14 days |
| Repeated missing-field question rate | < 2% |
| Tool-call trace present on tool turns | 100% |
| Customer memory context present when relevant facts/embeddings exist | >= 95% |
| Remembered preference silently mutates order | 0 |
| Manual naturalness score | >= 85% acceptable |
| Normal browse/order p95 latency | operationally acceptable |

---

## 8. Source-Backed Basis

Documented facts:

- Voyage `voyage-4-lite` returns 1024-dimensional embeddings, matching the current `vector(1024)` schema.
- Message and product embeddings are already part of the backend runtime.
- Customer facts already exist in `customer_preferences.facts`.
- Customer-scoped semantic recall is now available through `search_customer_messages`.

Source-backed tradeoffs:

- Function calling and structured outputs are useful at the tool boundary, but they do not guarantee business correctness or good conversation.
- Embeddings are strong for fuzzy recall and weak as a source of operational truth.
- Customer-service memory needs freshness, confidence, and type policy because preferences can change.
- Simple harnesses are preferable when the task is bounded and the business owns deterministic side effects.

Umi-specific conclusion:

Use the LLM as the conversational layer, backend tools as the operational layer, and customer memory as a personalization layer. Keep the harness small enough to debug and strong enough to prevent business-damaging actions.
