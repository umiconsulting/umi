# The conversation model — decision record

_build-v3 · `tenant` + `runtime` schemas · conversation pipeline → CDP · 2026-07-25_

How build-v3 represents a WhatsApp conversation, why it is shaped that way after a
deliberate retreat from over-engineering, and the delta the current DDL + backend still
need. Grounded in two things: how the pipeline actually runs today (the ported
`turn.service` / `conversation-turns` / `memory` / `business-config` code read against the
schema), and the platform's own domain model, which already names the target
([`2026-07-05-platform-domain-model-synthesis.md`](../../architecture/2026-07-05-platform-domain-model-synthesis.md)).
Companion to [`ORDER_MODEL.md`](./ORDER_MODEL.md); the DDL lives in
[`20_tenant.sql`](./20_tenant.sql) and [`30_runtime.sql`](./30_runtime.sql).

---

## 1. The principle

**The conversation is a _producer_, not the product. The product is the CDP.**

The pipeline began life as a WhatsApp bot on n8n + Supabase edge functions — no repo, no
model, one goal: answer messages. When it was made "agentic", it grew a turn-integrity
engine and a finite-state machine: `conversation_turn` with `integrity_decision` /
`reconciled_action` / `base_state_version` / `superseded_at`, and `conversation_state`
with an optimistic-concurrency `state_version`. That was over-engineering — machinery for
a multi-step autonomous agent reconciling its own actions against a user who keeps typing.
A café bot that answers hours and takes an order does not have that problem. Much of it was
already removed; this record finishes the retreat coherently.

The mistake it corrects: **the pipeline put durability and formal state on the most
_ephemeral_ thing in the system.** A conversation lives for ninety seconds. The thing with
real lifespan and business value is the **customer** — and the platform docs already name
the home for it:

> The CDP (`core.people` + `comms` + `loyalty`) is _tenant-owned_ customer knowledge,
> product-agnostic, **fed by ConversaFlow / Cash / future producers.** … Memory item /
> Customer preference — durable AI-remembered facts and the aggregated per-person profile.
> **The knowledge half of the CDP.**

So: the conversation is raw material; the **customer** (messages + facts + loyalty +
identity) is the durable asset; **Customer 360** is how the tenant reads it (a dashboard to
explore a customer, supervise the bot's answers, and file a ticket when one was wrong).
The conversation gets _smaller_; the customer gets _bigger_.

### Three lifespans, welded into one cluster (the source of the confusion)

| Layer                         | Lifespan  | What it is                                         | Verdict                          |
| ----------------------------- | --------- | -------------------------------------------------- | -------------------------------- |
| **1 · message log**           | permanent | what was said, per message (+ embeddings)          | keep — the KYC asset             |
| **2 · in-flight exchange**    | seconds   | "what did they just ask", the draft cart, debounce | throwaway — no durable machinery |
| **3 · customer relationship** | permanent | facts/preferences, loyalty, lifecycle              | the product — elevate it         |

The agentic framing gave layer 2 (the throwaway) the heaviest schema. Correct that, and the
rest falls out.

---

## 2. The decisions

### 2a. `conversation_state` — DELETE (no FSM)

The finite-state machine was a crutch for a weak, expensive model: constrain the dialog into
states so a costly LLM could not wander. With a cheap-but-capable model, **the LLM + the
recent messages in context _is_ the state.** There is no `current_state`, no `state_version`,
no compare-and-swap.

- **The one thing it was load-bearing for is the draft cart.** When state is gone, the
  in-progress order lives in the LLM's reconstruction from the merged turn + recent messages,
  and only becomes a real `customer_order` **at confirmation**. That is _more_ correct by the
  order model — a half-built cart is not a commercial fact yet. It strains only on a very long
  multi-turn order (40 items), which is not the café use case.
- Retires: `runtime.conversation_state` (the whole table), `state_version` optimistic
  concurrency, `selected_location_id` / `draft_cart_version` / `pending_clarification` typed
  columns, and the `s.business_id` joins the conversation reads made against it.

### 2b. `conversation_turn` — KEEP, slimmed to a merge buffer

The turn survives, for a real reason validated by stress-testing: WhatsApp customers send
**fragments** — _"give me two coffees" · "wait, make it three" · "add sugar" · "make them all
on the rocks."_ The bot must **merge the fragments into one coherent instruction before it
acts**. That is the turn's job, and only that:

- **Survives:** `source_message_ids`, `merged_user_text`, `status`, `hold_until` /
  `released_at` (the debounce window), `superseded_at` (re-merge if a fragment lands
  mid-flight), and `extracted_intent` if it earns its place.
- **Dies with the FSM:** `base_state_version`, `reconciled_action`, `integrity_decision`,
  `integrity_reason`. These exist _only_ to reconcile a turn against `conversation_state`.
  Delete the state and they have nothing to reconcile against.
- **Bonus:** the merged turn is also the right unit for the **Customer 360 conversation
  view** — show grouped turns, not raw fragments.

### 2c. `business.config` — DISSOLVE (do not restore)

`business.config` was the n8n-era catch-all blob for everything the bot needed to know about
the tenant. build-v3 **already decomposed it into typed columns**, so restoring the blob would
undo a decision the schema already made:

```
tenant.business:
  bot_voice / bot_tone / bot_instructions   -- voice  (was config.voice)
  open_hours jsonb                          -- hours  (was config, now a column w/ exceptions)
  logo_url / brand_color / secondary_color  -- branding
```

So `business-config.service` becomes a **thin adapter**: read the typed columns, return the
shape `turn.service` / voice / `business-hours` expect. Its `WHERE business_id` is also a bug
— `tenant.business`'s PK is `id` — fixed on the way. _(Open: keep the adapter vs. absorb it —
see §5.)_

### 2d. KYC = the CDP knowledge half (facts, not just vectors)

Messages + embeddings are not over-engineering — they are the **wealth of knowledge** the
tenant explores, and they power "search this customer's history" in the dashboard. But the
durable value is the **facts** (`memory_items` / `customer_preferences` — usuals, allergies,
"birthday in March"), not the message vectors. build-v3 folds the facts into
`tenant.customer_note` (backfilled from `comms.memory_items`; Customer 360 reads it as
"memory"). _(Open: `customer_note` overload vs. a purpose-named `customer_fact` /
`customer_memory` — see §5.)_

---

## 3. The three knowledge axes the bot draws from

The bot's context is **who am I talking to (CDP) + what can I tell them (business knowledge) +
how do I say it (behavior).** All three already have homes in build-v3 — the conversation code
just predates them and still reads the dissolved `business.config`.

| Axis                         | What it is                 | Owner                      | Where it lives (build-v3)                                                                                                                             |
| ---------------------------- | -------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer knowledge (CDP)** | who this customer is       | the relationship (learned) | `message` + facts + `loyalty` + identity                                                                                                              |
| **Business knowledge**       | what the bot can tell them | the tenant (authored)      | `product` (menu), `business.open_hours`, `branch` (locations), `knowledge_document`→`knowledge_chunk`→`runtime.knowledge_embedding` (FAQ/RAG), promos |
| **Bot behavior**             | how it says it             | the tenant (authored)      | `business.bot_voice` / `bot_tone` / `bot_instructions`                                                                                                |

The tenant-authorable "business info" the bot answers from — hours, locations, menu, and
arbitrary FAQ ("do you have parking / wifi") — is the RAG knowledge base
(`knowledge_document` + `knowledge_chunk`) plus the structured tables. Nothing new is needed
here except **promotions** (§5).

---

## 4. The delta

### Schema (`20_tenant.sql` / `30_runtime.sql`)

- **DROP `runtime.conversation_state`** (§2a).
- **`runtime.conversation_turn`** — restore, _slimmed_ to the merge-buffer columns (§2b); the
  table does not exist in build-v3 today, so this is a create, not an alter.
- **`tenant.conversation`** — add `summary text` (the closed-conversation summary the code
  writes).
- **`tenant.message`** — add only what is _read_; drop denormalized writes. `business_id`
  derives via `conversation` (RLS reaches it there), so the write can drop it rather than add a
  column; `twilio_message_sid` → the existing `provider_message_id`; `intent` / `message_index`
  decided at implementation by whether anything reads them.
- **Customer facts** — the memory columns on `customer_note`, or a `customer_fact` table (§5).

### Convergence (backend — no DDL)

- **Message embeddings → `runtime.message_embedding`** (that table already exists; the code
  still writes `tenant.message.body_embedding`). Rewrite the writer + the two similarity reads.
- **`business-config.service`** reads the typed `business.bot_*` / `open_hours` columns, not
  `config`; fix `WHERE business_id` → `WHERE id`.
- **Hours** read `business.open_hours` jsonb, not the `open_hours` table (shared with the hours
  track).

---

## 5. Open decisions (not yet made)

1. **`business-config.service`** — keep it as the thin typed-column adapter (least churn for
   `turn.service` / voice / `business-hours`), or absorb it and have those call sites read the
   columns directly?
2. **Promotions** — a shared `tenant.promotion` entity (message, active window, days) that
   _both_ the wallet pass and the bot read (one concept, two consumers), or lean on
   `loyalty_program.promo_*` for the single-promo case and defer a real promotions model?
3. **Customer facts naming** — fold into `customer_note` with a `source` discriminator (the
   current code shape), or a purpose-named `customer_fact` / `customer_memory` table (the CDP
   atom deserves its own name)?

---

## 6. Ecosystem fit

The conversation is one **producer** into the tenant's CDP; Cash (loyalty) and future channels
(kiosk, web) are others. The CDP is domain-named, not product-named — there is no
`conversaflow` schema, no `ai` table; the bot _consumes_ `message` / `customer` / `loyalty` /
`knowledge_chunk`, it does not own them. Customer 360 is the read model over the CDP; the
lifecycle follow-ups (birthday grant, reward-expiring, winback) fire off the customer's loyalty
state, not off any conversation FSM. This record is the conversation slice of that larger
picture.

## Sources

- Platform domain model + CDP framing:
  [`2026-07-05-platform-domain-model-synthesis.md`](../../architecture/2026-07-05-platform-domain-model-synthesis.md),
  [`2026-07-03-reality-first-audit-and-redesign.md`](../../architecture/2026-07-03-reality-first-audit-and-redesign.md).
- The pipeline as it runs today: `apps/umi-api/src/modules/conversations/*`
  (`turn.service`, `conversation-turns.repository`, `memory.repository`,
  `business-config.service`), read against `20_tenant.sql` / `30_runtime.sql`.
- Order-model interplay (draft cart materialises at confirmation): [`ORDER_MODEL.md`](./ORDER_MODEL.md).
