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

### 2a. The FSM — DELETE; keep the one working slot (the cart)

The finite-state machine was a crutch for a weak, expensive model: constrain the dialog into
states so a costly LLM could not wander. With a cheap-but-capable model, **the LLM + the recent
messages in context _is_ the state.** What dies is the _machinery_, not the idea of working
state:

- **Deleted (the FSM):** `current_state` (the enum position), `state_version` /
  `draft_cart_version` (the optimistic-concurrency cursors + every compare-and-swap), the
  turn-integrity reconciliation, and the persisted `pending_clarification` slot. The dialog
  "state" label is now **derived** from cart-presence at the start of each turn, not stored.
- **Kept (the one real working slot): the cart.** `runtime.conversation_state` is replaced by a
  slim `runtime.conversation_cart` — the **in-flight order** being built: `cart` (the structured
  `DraftCart`) plus its `selected_branch_id`. Last-write-wins, no version, no CAS. It
  materializes into `customer_order` + `order_item` **at confirmation** and is cleared — so its
  full value lands as real order rows, never a blob (see §2e).
- **The open question** ("I asked which size, waiting") is _not_ a stored slot — the bot's own
  question is in the recent-message buffer, so a capable model infers it. The structured
  `pending_clarification` tracking becomes inert (the LLM handles clarification from context).

This closes the exact mistake §1 names: durability moves off the ephemeral FSM and onto the two
things that deserve it — the buffer (short-term) and the cart-as-order (materialized).

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
  assistant_name / assistant_tone           -- voice  (was config.voice; name + tone-preset)
  open_hours jsonb                          -- hours  (was config, now a column w/ exceptions)
  logo_url / brand_color / secondary_color  -- branding
```

So `business-config.service` becomes a **thin adapter**: read the typed columns, return the
shape `turn.service` / voice / `business-hours` expect. Its `WHERE business_id` is also a bug
— `tenant.business`'s PK is `id` — fixed on the way. **Decided (2026-07-26): keep the thin
adapter** — least churn for `turn.service` / voice / `business-hours`, and one place that maps
the typed `bot_*` / `open_hours` columns back to the legacy `config` shape those call sites read.

### 2d. KYC = the CDP knowledge half → `tenant.customer_fact`

Messages + embeddings are not over-engineering — they are the **wealth of knowledge** the
tenant explores, and they power "search this customer's history" in the dashboard. But the
durable value is the **facts** (usuals, allergies, "birthday in March"), not the message vectors.

**Decided (2026-07-26): the fact atom is `tenant.customer_fact`** — a rename + reshape of the
misnamed `customer_note`, not a new table and not an overload. What the trace settled:

- The old fact source (`comms.customer_preferences`) is **dropped** in the backfill
  (derived-cache, recomputable from retained messages), so facts start empty and the running
  bot repopulates them. No data migration constrains the shape.
- The `customer_note` table had **exactly one consumer**: the bot's fact extraction writes it
  (`source='preferences'`), Customer 360 reads it as "memory". Its authored staff-prose columns
  (`staff_id`, `body`) had **no writer at all**.
- The name collided with a different, live thing (the order note — see the two lanes below),
  which is what made it confusing in the first place.

So `customer_fact` is `(id, business_id, customer_id, source, key, value jsonb, created_at,
updated_at)`, unique on `(business_id, customer_id, source, key)`. This retires the `metadata`
jsonb junk-drawer the memory code invented for want of a typed home — the exact pattern the
malaise audit killed. Two things are **deferred, on purpose**:

- **Staff-authored notes** — no writer exists today; `source='staff'` absorbs them when a real
  one appears, no second table needed (that was the rejected split).
- **Provenance (`source_message_id`)** — the current extractor rewrites the whole fact set
  wholesale, with no per-message origin, so the column would be born always-null (a
  built-too-thin / unwritten-column smell). It lands when extraction becomes incremental; then
  it is the spine of the "wrong fact → where did it come from → file a ticket" supervise flow.

#### Two lanes named "customer_note" (recorded so this is never re-litigated)

| Lane                    | Where it lives                               | Written by          | Read by                                          |
| ----------------------- | -------------------------------------------- | ------------------- | ------------------------------------------------ |
| **order note**          | `tenant.customer_order.notes`                | WhatsApp checkout   | frozen iPad KDS ticket (aliased `customer_note`) |
| **customer fact** (CDP) | `tenant.customer_fact` (was `customer_note`) | bot fact extraction | Customer 360 "memory"                            |

The order note ("two coffees, no sugar") is alive and justified on its own column; per-line
tweaks go to `order_item.notes`. The rename removes the collision — the order note keeps its
name, the knowledge atom finally gets an honest one.

### 2e. Three memories, one branch rule (the working model)

The name ConversaFlow is literal: the bot _fills conversations_. A customer may talk for a dozen
messages — "what's good on a hot day?", recommendations, an upsell — before ordering. That
surfaced that "memory" is **three different mechanisms**, each with a different lifespan and
owner (grounded in standard dialogue-system practice: a short-term buffer + slot-based dialogue
state + a long-term vector store — _not_ a state machine):

| Mechanism          | What it is                                     | Lifespan   | Owner                           | Where                                                |
| ------------------ | ---------------------------------------------- | ---------- | ------------------------------- | ---------------------------------------------------- |
| **Working memory** | recent-message buffer + rolling summary        | this convo | the **bot** (stay coherent now) | `tenant.message` + `tenant.conversation.summary`     |
| **Dialogue state** | the cart (in-flight order + branch) — one slot | this convo | the **bot**                     | `runtime.conversation_cart`                          |
| **Long-term**      | message embeddings + `customer_fact`           | permanent  | the **tenant** (Customer 360)   | `runtime.message_embedding` + `tenant.customer_fact` |

The two are not interchangeable: **embeddings serve the tenant** (the gist of the conversation +
the customer's facts, shown in Customer 360); the **working buffer serves the live bot** (so
"add one of those you mentioned" resolves against the last few messages — no machinery). The
recommendation/upsell answers ("what do you suggest?", "today's 2-for-1") come from **business
knowledge** (menu embeddings + `tenant.promotion`), not from customer state at all.

**Branch is resolved at confirmation, not up front.** Asking "which branch?" at hello would force
tracking "did they already choose today" across conversations — repetitive and complex for no
gain. Instead the branch is asked **at checkout** (or when the customer explicitly asks a
branch-specific question), captured as part of the in-flight order (`conversation_cart`), and
persisted onto `customer_order` at confirmation. Per-branch locations and promotions are
tenant-authored on the dashboard, so `tenant.promotion` wants an optional `branch_id` scope (a
promo is all-branches or one) — recorded for the promotions track.

---

## 3. The three knowledge axes the bot draws from

The bot's context is **who am I talking to (CDP) + what can I tell them (business knowledge) +
how do I say it (behavior).** All three already have homes in build-v3 — the conversation code
just predates them and still reads the dissolved `business.config`.

| Axis                         | What it is                 | Owner                      | Where it lives (build-v3)                                                                                                                                         |
| ---------------------------- | -------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer knowledge (CDP)** | who this customer is       | the relationship (learned) | `message` + facts + `loyalty` + identity                                                                                                                          |
| **Business knowledge**       | what the bot can tell them | the tenant (authored)      | `product` (menu), `business.open_hours`, `branch` (locations), `knowledge_document`→`knowledge_chunk`→`runtime.knowledge_embedding` (FAQ/RAG), `tenant.promotion` |
| **Bot behavior**             | how it says it             | the tenant (authored)      | `business.bot_voice` / `bot_tone` / `bot_instructions`                                                                                                            |

The tenant-authorable "business info" the bot answers from — hours, locations, menu, and
arbitrary FAQ ("do you have parking / wifi") — is the RAG knowledge base
(`knowledge_document` + `knowledge_chunk`) plus the structured tables. Nothing new is needed
here except **promotions**, resolved in §5.

---

## 4. The delta

### Schema (`20_tenant.sql` / `30_runtime.sql`)

- **DROP `runtime.conversation_state`** (§2a).
- **`runtime.conversation_turn`** — create, _slimmed_ to the merge-buffer columns (§2b); the
  table does not exist in build-v3 today, so this is a create, not an alter. The FSM columns the
  ported repository still writes (`integrity_decision` / `integrity_reason` /
  `base_state_version` / `reconciled_action`) do **not** come across.
- **`tenant.conversation`** — add `summary text` only if the ported close path actually persists
  one; the backfill dropped the legacy summary as a derived-cache, so keep it dropped otherwise.
- **`tenant.message`** — no DDL change: `provider_message_id` already exists (the
  `twilio_message_sid` rebind is code-only) and body embeddings already live in
  `runtime.message_embedding`, not on the row. Convergence item, not a schema one.
- **Rename + reshape `tenant.customer_note` → `tenant.customer_fact`** (§2d): drop the unused
  `staff_id` / `body`; the atom is `(id, business_id, customer_id, source, key, value jsonb,
created_at, updated_at)`, unique `(business_id, customer_id, source, key)`. Update the
  `90_rls` policy-generator row too.

### Convergence (backend — no DDL)

- **Message embeddings → `runtime.message_embedding`** (that table already exists; the code
  still writes `tenant.message.body_embedding`). Rewrite the writer + the two similarity reads.
- **`business-config.service`** reads the typed `business` columns, not `config`; fix
  `WHERE business_id` → `WHERE id`. The `bot_*` naming this line anticipated landed as
  `whatsapp_*` (2026-07-29, hours track): the ordering switch must not read as governing the
  POS, which is a second ordering channel that a WhatsApp pause has no business stopping.
  The same `WHERE business_id` bug was in `ordering-settings.repository` and is fixed there.
- **`memory.repository`** reads/writes `customer_fact` with typed `key` / `value` columns,
  dropping the `metadata` jsonb round-trip; Customer 360's `customers.repository` reads the same.
- **Hours** ✅ **DONE 2026-07-29.** They read `business.open_hours` jsonb — with a
  `branch.open_hours` override — not the `open_hours` table, and the same change cleared the
  deferred `cash-scan.isAfterHours` read. `modules/business-hours/open-hours.ts` owns what the
  document MEANS, so the bot, the dashboard and the register cannot drift apart on a missing day,
  a split shift, a holiday, or a window past midnight.
- **Naming.** `modules/hours` became `modules/business-hours` (Square's `Location.business_hours`),
  and the bot's old `conversations/business-hours.service` became `ordering-window.service` —
  it never owned the hours, it decides when the WhatsApp CHANNEL takes an order. Google keeps
  per-service hours in `moreHours` beside `regularHours` and Toast serves online ordering from a
  separate `/orderingSchedule`, for the same reason. The column stays `open_hours`:
  `business.business_hours` would stutter.

---

## 5. Resolved decisions (2026-07-26)

1. **`business-config.service`** — **thin typed-column adapter** (§2c). Absorbing it into every
   call site was rejected: more churn, and more places to carry the `business_id` → `id` fix.
2. **Promotions** — the target is a shared **`tenant.promotion`** entity (one concept: wallet
   pass + bot both read it), **not** `loyalty_program.promo_*`. Because the live wallet-pass
   renderer already reads `loyalty_program.promo_*`, rationalising both consumers onto
   `tenant.promotion` is a **dedicated follow-up track** (it touches cash) — not part of this
   conversation branch. Recorded here so the direction is fixed; the bot gains no promo read
   until that track lands.
3. **Customer facts** — **`tenant.customer_fact`** (§2d): a rename + reshape, not a
   `customer_note` overload and not a second table. The trace settled it — `customer_note` had a
   single consumer (the facts path) and its name collided with the order note.

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
