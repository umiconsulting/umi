# Embeddings for Customer-Service Memory

## Purpose

This document bridges the technical side of embeddings with the business use case for ConversaFlow.

Scope:

- Customer-service agents for small businesses
- Long-term customer history and memory
- Not internal-document RAG
- Focus on WhatsApp-style recurring customer conversations, preferences, orders, complaints, and service continuity

---

## Executive Takeaways

Embeddings are useful here, but not as the main memory system by themselves.

For a customer-service agent, embeddings are best used for **probabilistic recall**:

- finding semantically related past interactions
- recovering similar past intents
- surfacing forgotten but relevant context
- linking a new message to earlier customer behavior

Embeddings are weak when used as the only source of truth for:

- latest order status
- current prices or menu availability
- exact customer commitments
- operational facts that must be correct

For this business use case, the right architecture is:

1. `Recent working memory` for the active conversation
2. `Structured customer memory` for durable facts and preferences
3. `Semantic memory retrieval` for fuzzy recall across customer history
4. `Transactional source-of-truth tools` for orders, catalog, hours, payments, and status

That is already directionally aligned with ConversaFlow’s current design, but the current implementation is still more **conversation-memory-centric** than **customer-memory-centric**.

The main architectural gap is that semantic retrieval is currently scoped to a single `conversation_id`, while the business goal is customer history across time.

---

## What Embeddings Actually Do

An embedding converts text into a dense numeric vector so semantically related texts land closer together in vector space. In practice, this makes embeddings good for:

- semantic search
- clustering
- recommendations
- classification by similarity
- approximate recall from noisy user language

That is useful in customer service because customers rarely ask the same thing with identical wording.

Examples:

- "lo de siempre"
- "quiero lo mismo que la otra vez"
- "me repites mi pedido anterior"

These may all be close in vector space even when the surface wording changes.

### What embeddings are good at in this product

- Detecting that a customer is referring to a prior order or habit
- Recovering similar past complaint contexts
- Surfacing previous allergy or preference mentions when phrased differently
- Finding prior clarifications about pickup person, sweetness level, milk choice, or delivery constraints

### What embeddings are not good at

- Guaranteeing factual correctness
- Choosing the newest valid fact unless freshness is modeled separately
- Returning exact identifiers reliably
- Distinguishing "historically true" from "currently true"
- Handling exact lexical lookups as well as hybrid lexical + semantic retrieval

This matters because customer memory is partly fuzzy and partly exact:

- fuzzy: taste preferences, style, tone, repeated issues
- exact: last order id, last refund status, current pickup person, today’s menu availability

---

## Why This Use Case Is Different From Internal-Docs RAG

Most RAG examples are about retrieving chunks from internal documents. That is not the same problem.

Customer-memory retrieval differs in four ways:

### 1. The data is behavioral, not documentary

You are not retrieving static policies or manuals. You are retrieving:

- conversational traces
- order events
- extracted preferences
- evolving customer state

### 2. Freshness matters more

A customer may have preferred oat milk six months ago and changed later.

### 3. Contradictions are normal

A customer can say:

- "I don’t like sweet drinks"
- later: "make it extra sweet"

A memory system must represent change over time and confidence, not just store whichever line embeds nearest.

### 4. The retrieval target is action support

The end goal is not answering a knowledge question. It is helping the agent:

- respond faster
- personalize safely
- reduce repeated questions
- increase reorder conversion
- avoid frustrating the customer

---

## Business Value of Customer Memory

For a small business, customer memory creates value when it reduces friction in recurring interactions.

### High-value business outcomes

- Faster repeat ordering
- Less re-asking for known preferences
- Better continuity after delays or follow-up conversations
- More empathetic complaint handling
- Better upsell timing based on history
- Higher conversion from chat to order
- Better retention for repeat customers

### Best customer-service use cases

#### 1. Repeat order acceleration

The agent should infer when the customer means "repeat what I usually get" and resolve it against transaction history plus preferences.

Business impact:

- fewer turns to conversion
- better reorder rate
- less cognitive load on the customer

#### 2. Preference-aware ordering

Examples:

- milk preference
- sugar preference
- drink temperature
- allergy/intolerance
- disliked ingredients

Business impact:

- more personalized experience
- fewer order corrections
- better trust

#### 3. Complaint continuity

If a customer previously had a delayed order or a mistaken item, the agent should remember that context when they return.

Business impact:

- better recovery experience
- less repeated explanation from the customer
- lower escalation burden

#### 4. Service continuity across sessions

If the customer returns the next day or next week, the system should still understand:

- who they are
- what they tend to order
- what unresolved context exists

Business impact:

- feels like a persistent service channel, not a stateless bot

#### 5. Campaign and segmentation foundations

The same memory system can later support:

- promo targeting by taste profile
- lapsed-customer winback
- seasonal recommendations
- VIP or high-frequency customer handling

This should be secondary. The first win is service quality.

---

## What ConversaFlow Already Has

ConversaFlow already implements a strong first version of a layered memory system:

- recent messages
- rolling summary
- structured facts
- semantic retrieval with pgvector

Relevant local references:

- [MEMORY_ARCHITECTURE.md](../architecture/memory/MEMORY_ARCHITECTURE.md)
- [_shared/memory.ts](../../supabase/functions/_shared/memory.ts)
- [conversation-process.ts](../../supabase/functions/job-worker/processors/conversation-process.ts)
- [prompts.ts](../../supabase/functions/whatsapp-handler/prompts.ts)
- [KALALA_CAFE_BUSINESS_PROPOSAL.md](../product/KALALA_CAFE_BUSINESS_PROPOSAL.md)

### Current strengths

#### Good separation of memory layers

`buildWorkingMemory()` combines:

- last 8 messages
- `customer_preferences.facts`
- conversation summary
- semantic retrieval

That is directionally correct because customer-service agents need both exact short-term state and fuzzy long-term recall.

#### Correct use of asymmetric embedding modes

The code uses `input_type='document'` for stored messages and `input_type='query'` for search queries in Voyage. That matches Voyage’s retrieval guidance and is a real quality improvement over using the same embedding mode for both.

#### Async embedding generation

Embeddings are generated after the synchronous response path. That is important for WhatsApp latency and for small-business economics.

#### Facts are separated from free-form retrieval

The existence of `customer_preferences.facts` is one of the most important design choices in the codebase. Preferences, allergies, dislikes, and typical order should not depend only on vector recall.

### Current limitations

#### 1. Semantic recall is scoped to one conversation

Your SQL retrieval function searches by `p_conversation_id`, not by `customer_id`. That means semantic memory does not truly span the customer’s lifetime history.

For business memory, this is the biggest gap.

Effect:

- good within an active thread
- weak across days, weeks, or reopened conversations
- limited value for real repeat-customer memory

#### 2. Raw messages are the main retrieval unit

Embedding raw messages is simple, but raw messages are often poor memory objects.

Examples of bad retrieval candidates:

- greetings
- filler
- confirmations
- generic assistant replies
- short ambiguous replies like "sí", "ok", "el mismo"

These can rank surprisingly high and pollute prompt context.

#### 3. Assistant messages are embedded alongside user messages

This is not always wrong, but for customer-memory use cases it can add noise.

Assistant text often reflects:

- business policy boilerplate
- operational language
- repeated menu explanations

If not controlled, retrieval may surface the bot’s own prior wording instead of customer-specific memory.

#### 4. Retrieval is still similarity-heavy, not policy-heavy

Current ranking adds:

- similarity
- recency weight
- novelty weight

That is a good start. But business memory usually also needs:

- memory type weighting
- confidence weighting
- freshness expiry
- source reliability weighting

#### 5. No clear distinction between durable memory and ephemeral memory

Some customer data should decay or expire:

- current intent
- temporary pickup person
- one-off note for a single order

Some should remain durable:

- allergy
- persistent dislike
- stable preference
- frequent order pattern

Without typed memory records, these can blur together.

---

## Recommended Memory Model For This Product

The right model is not "embed every message and search it later."

It is:

### Layer A: Operational Truth

Use tools and transactional tables for:

- menu
- prices
- availability
- order status
- payment methods
- business hours

Never let embeddings override these.

### Layer B: Structured Customer Profile

Store durable, typed facts such as:

- preferences
- dislikes
- allergies
- usual pickup pattern
- favorite categories
- complaint history summary
- tone or service notes if policy allows

These should be normalized, versioned, and optionally confidence-scored.

### Layer C: Memory Objects

Instead of retrieving only raw messages, create compact memory records such as:

- `preference`
- `habit`
- `complaint`
- `resolution`
- `special_instruction`
- `relationship_context`
- `order_pattern`

Each memory object should have:

- `customer_id`
- `memory_type`
- `text`
- `embedding`
- `source_message_ids`
- `confidence`
- `valid_from`
- `valid_to` or expiry
- `last_confirmed_at`
- optional `importance`

This is the best place to use embeddings.

### Layer D: Cross-session semantic recall

Search across the customer’s full history, not just the active conversation.

At query time:

1. retrieve by `customer_id`
2. filter by valid memory types for the current intent
3. rank by semantic similarity plus freshness plus confidence
4. inject only a few high-value results

### Layer E: Summaries

Use summaries as compression, not as the primary retrieval substrate.

Good uses:

- carry long-thread context forward
- provide a short synopsis to the model

Bad use:

- relying on summaries alone for customer history

---

## Recommended Data Model

### Keep

- `messages`
- `conversations.summary`
- `customer_preferences.facts`
- `transactions`

### Add

#### `customer_memories`

Suggested fields:

```sql
create table customer_memories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  customer_id uuid not null,
  conversation_id uuid,
  memory_type text not null,
  text text not null,
  embedding vector(1024),
  confidence real not null default 0.5,
  importance real not null default 0.5,
  source text not null default 'extracted',
  source_message_ids uuid[] not null default '{}',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  last_confirmed_at timestamptz,
  superseded_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

Recommended indexes:

- btree on `(customer_id, memory_type, created_at desc)`
- btree on `(customer_id, valid_to)`
- hnsw on `embedding vector_cosine_ops`

#### `customer_memory_events`

Optional but useful for auditability:

- created
- confirmed
- contradicted
- expired
- merged
- superseded

This matters because customer memory changes over time.

---

## Retrieval Policy For Customer Service

Retrieval should depend on intent.

### Intent: repeat order

Prefer:

- recent reusable orders from `transactions`
- `typical_order`
- order-pattern memories

Do not rely on semantic similarity alone.

### Intent: product preference clarification

Prefer:

- durable preference memories
- dislikes
- allergies
- recent order variants

Semantic search helps when the customer uses vague phrasing.

### Intent: complaint or issue follow-up

Prefer:

- complaint memories
- resolution memories
- recent support summaries

This is a strong embeddings use case because complaint descriptions vary a lot in wording.

### Intent: general small talk or menu browse

Prefer:

- little or no long-term memory injection

Most memory retrieval here is noise.

### Intent: identity / relationship continuity

Prefer:

- customer name
- tone-safe notes
- stable facts only

Do not over-personalize in a way that feels intrusive.

---

## Ranking Strategy

The current ranking formula is a reasonable baseline:

- similarity
- recency
- novelty

For business memory, extend it to:

```text
final_score =
  semantic_similarity * A +
  freshness_weight * B +
  confidence_weight * C +
  importance_weight * D +
  intent_type_match * E +
  source_reliability * F
```

Suggested interpretation:

- `semantic_similarity`: how related the memory is to the current message
- `freshness_weight`: newer unless explicitly durable
- `confidence_weight`: how likely the memory is true
- `importance_weight`: allergies or complaints should outrank casual likes
- `intent_type_match`: only certain memory types should compete for certain intents
- `source_reliability`: confirmed order data > extracted free-form guess

---

## What To Embed

### Embed

- extracted customer memory objects
- concise complaint summaries
- concise order-pattern summaries
- normalized preference statements
- conversation summaries when useful as fallback

### Usually do not prioritize embedding

- generic assistant replies
- short acknowledgements
- raw boilerplate
- pure operational outputs
- messages that contain only exact identifiers with no semantics

### Better than raw message embedding

Instead of storing:

- `"sí, el mismo de siempre"`

derive and store:

- `"Customer often reorders the same medium hot americano with oat milk."`

Instead of storing:

- `"la vez pasada me llegó frío"`

derive and store:

- `"Customer previously reported receiving a drink cold when it should have been hot."`

These memory objects retrieve better because they are denser, more explicit, and more stable.

---

## Freshness and Decay Rules

Customer memory needs decay rules.

### Durable

- allergies
- intolerances
- stable dislikes
- stable favorite items
- frequent order patterns

### Semi-durable

- preferred milk
- sweetness level
- pickup person pattern
- preferred time window

These should be re-confirmed occasionally.

### Ephemeral

- current cart intent
- current pickup person for one order
- one-time custom note
- temporary complaint state

These should expire quickly or stay attached only to the relevant order/conversation.

---

## Risks and Failure Modes

### 1. Memory hallucination

The system may retrieve an old statement and treat it as current truth.

Mitigation:

- add timestamps
- add confidence
- separate durable from ephemeral memories
- prompt the model to verify uncertain memories with the customer when necessary

### 2. Over-personalization

The system can sound creepy if it recalls too much unprompted.

Mitigation:

- use memory to improve tool behavior and clarification questions
- mention memory explicitly only when helpful and natural

### 3. Retrieval noise

Nearest neighbors are often plausible but not useful.

Mitigation:

- typed memory objects
- hybrid retrieval
- reranking
- strict top-K limits

### 4. Exact-match misses

Embeddings may miss exact order IDs, codes, or names.

Mitigation:

- combine embeddings with lexical search or structured filters

### 5. Policy drift

Old assistant messages can contain outdated operational statements.

Mitigation:

- never use embeddings as source of truth for business operations

---

## Hybrid Retrieval Recommendation

For this use case, hybrid retrieval is better than embeddings alone.

Recommended retrieval stack:

1. Structured filters first
2. Transactional lookup when the task is operational
3. Semantic retrieval over customer memory objects
4. Optional lexical/BM25 retrieval for exact phrase support
5. Optional reranking on the candidate set

Why:

- structured data handles correctness
- embeddings handle fuzzy recall
- lexical retrieval handles exact strings
- reranking improves precision before prompt injection

For small-business customer service, this mix is usually better than investing heavily in one retrieval method.

---

## Recommended Changes For ConversaFlow

### Priority 1: Move semantic retrieval from conversation scope to customer scope

Current state:

- semantic search is tied to `conversation_id`

Recommended:

- add customer-level retrieval for long-term memory
- optionally keep conversation-level retrieval for active thread recall

This should probably become two separate retrieval modes:

- `thread recall`
- `customer history recall`

### Priority 2: Create typed memory records

Add async extraction jobs that create `customer_memories` rows from recent messages and transactions.

Candidate memory types:

- `preference`
- `dislike`
- `allergy`
- `typical_order`
- `order_pattern`
- `complaint`
- `resolution`
- `service_note`

### Priority 3: Retrieve memories, not just raw past messages

Keep raw-message embeddings as a fallback layer, but rank typed memory objects first.

### Priority 4: Add memory expiration and confirmation logic

Examples:

- allergy memories rarely expire
- pickup-person memories expire fast
- preference memories decay if unused for long periods

### Priority 5: Add hybrid retrieval and optional reranking

For high-value flows such as repeat order and complaint handling:

- retrieve candidates
- rerank them
- inject only top 2-5 memories

### Priority 6: Reduce assistant-message noise

Consider embedding only:

- user messages
- extracted memory objects
- selected summaries

or at least downweight assistant-origin memories.

---

## Suggested Prompting Policy

The prompt should distinguish between:

- `verified business facts`
- `customer profile facts`
- `recalled historical context`

Recommended behavioral rules:

- treat retrieved memory as context, not unquestionable truth
- if a memory is old or weak, confirm before acting on it
- never use memory for prices, stock, or hours without tools
- prefer saying less over sounding invasive

Example instruction:

```text
Customer memory may contain historical preferences or prior issues.
Use it to personalize and shorten the interaction, but if the memory is old,
ambiguous, or action-critical, confirm it with the customer before proceeding.
Never use memory as the source of truth for prices, menu availability, order status, or business hours.
```

---

## Metrics That Actually Matter

Do not evaluate this only with vector similarity metrics.

Business-relevant metrics:

- reorder conversion rate
- average turns to completed repeat order
- percentage of conversations where known preferences were reused correctly
- complaint follow-up resolution rate
- customer re-ask rate
- escalation rate
- memory-caused error rate

Retrieval-quality metrics:

- top-K relevance judged by humans
- percentage of injected memories that were actually used
- percentage of injected memories later contradicted
- retrieval hit rate by intent type

Operational metrics:

- embedding coverage
- retrieval latency
- reranking latency
- memory extraction success rate
- stale-memory rate

---

## Implementation Roadmap

### Phase 1: Fix retrieval scope

- add customer-level vector retrieval
- keep conversation-level retrieval as a separate mode
- add intent-aware gating for when retrieval runs

### Phase 2: Introduce typed memory records

- create `customer_memories`
- extract memory objects asynchronously
- embed those objects

### Phase 3: Hybrid retrieval

- combine structured facts + recent orders + semantic memories
- optionally add lexical retrieval for exact phrase matches

### Phase 4: Reranking and evals

- rerank retrieved candidates
- create offline eval sets from real conversations
- measure business outcomes, not just similarity

### Phase 5: Lifecycle management

- add confirmation
- add expiry
- add contradiction handling
- add operator visibility into memory changes

---

## Bottom Line

For ConversaFlow, embeddings should not be framed as "search over old chats."

They should be framed as:

- a recall layer for customer history
- a support layer for personalization
- a complement to structured facts and transactional truth

The best design for a small-business customer-service agent is:

- tools for operational truth
- structured profile memory for durable facts
- vector retrieval for fuzzy customer-history recall
- optional hybrid lexical retrieval and reranking for precision

ConversaFlow already has the right foundation. The next major step is to evolve from **message embeddings inside one conversation** to **typed, customer-level memory retrieval across the full relationship**.

---

## References

### Local project references

- [MEMORY_ARCHITECTURE.md](../architecture/memory/MEMORY_ARCHITECTURE.md)
- [_shared/memory.ts](../../supabase/functions/_shared/memory.ts)
- [voyage.ts](../../supabase/functions/_shared/voyage.ts)
- [prompts.ts](../../supabase/functions/whatsapp-handler/prompts.ts)
- [conversation-process.ts](../../supabase/functions/job-worker/processors/conversation-process.ts)
- [KALALA_CAFE_BUSINESS_PROPOSAL.md](../product/KALALA_CAFE_BUSINESS_PROPOSAL.md)

### External sources

- OpenAI embeddings overview and model pages:
  - https://developers.openai.com/api/docs/models/text-embedding-3-small
  - https://developers.openai.com/api/docs/models/text-embedding-3-large
- Voyage AI embeddings docs:
  - https://docs.voyageai.com/docs/embeddings
- pgvector official README:
  - https://github.com/pgvector/pgvector
- Anthropic embeddings guidance:
  - https://docs.anthropic.com/en/docs/build-with-claude/embeddings
- Anthropic Contextual Retrieval:
  - https://www.anthropic.com/engineering/contextual-retrieval
