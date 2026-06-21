# Conversation & session layers — ConversaFlow

**Status:** design specification (implementation partial)  
**Last updated:** 2026-04-06  
**Related:** [memory/MEMORY_ARCHITECTURE.md](./memory/MEMORY_ARCHITECTURE.md) (3-tier *prompt* memory), [../research/EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md](../research/EMBEDDINGS_CUSTOMER_MEMORY_RESEARCH.md) (customer memory direction)

---

## Why not a single “session”?

Research on task-oriented dialogue (DSTC2 goal changes, task lineages, stack-based resumption) and on open-domain chat (joint **segmentation + state**, e.g. S3-DST) shows that **one scalar “session”** cannot simultaneously serve:

- **Channel persistence** (WhatsApp thread never ends)
- **Visit / recency** (when to compress context or reset tone)
- **Task focus** (order vs browse vs complaint; interrupt → resume)
- **Transactional truth** (order status, pickup — independent of chat)
- **Relationship memory** (preferences across weeks)

ConversaFlow therefore uses **five explicit layers**. Each layer answers a different question; they **compose** instead of replacing one another.

---

## The five layers


| Layer                          | Question it answers                          | Primary store / handle                                                                                        | Typical use                                                                |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **L1 — Channel thread**        | “Which WhatsApp DM is this?”                 | `conversations.id`                                                                                            | Persistence, routing, Twilio thread                                        |
| **L2 — Visit episode**         | “Is this a new ‘come back’ after silence?”   | `conversation_sessions` (planned) or derived from `messages.created_at`                                       | Working-memory scope, analytics “sessions”, summarization windows          |
| **L3 — Task focus**            | “What is the user trying to do *right now*?” | Dialogue state: `conversations.current_state`, `draft_cart`, `conversation_turns`, future explicit task stack | Interrupt FAQ mid-order → resume cart; clarify intent                      |
| **L4 — Order / transaction**   | “What is true about money, prep, pickup?”    | `transactions`, cart snapshots, POS / payment integrations                                                    | WISMO, modifications allowed by status — **never** inferred only from chat |
| **L5 — Customer relationship** | “Who is this person over time?”              | `customers`, `customer_preferences`, future `customer_memories`                                               | Preferences, allergies, repeat patterns; cross-thread recall               |


**Count:** **five** layers. This is not “5 instead of 2 time thresholds” — the old **8h / 24h** ideas collapse into **one mechanism inside L2** (configurable inactivity + optional calendar bucketing for reporting). **L3–L5** add the **task**, **truth**, and **relationship** dimensions research and operations require.

---

## How layers interact (rules of thumb)

1. **L1** is always there for WhatsApp: one row per customer thread unless you explicitly split threads (not required for v1).
2. **L2 (visit)** is **orthogonal** to **L4 (order)**. A long silence may start a **new visit** (L2) while an **open order** (L4) is still `in_prep` — the bot must still answer “¿dónde va mi pedido?” from **transaction state**, not from “same session.”
3. **L3 (task)** can **interrupt and resume** without closing L2: user switches to chitchat, then returns to the order — aligns with **task stack / lineage** ideas in dialogue research (interruptible TOD, TL-DST-style lineages).
4. **L4** closes by **business events** (paid, ready, picked_up, cancelled), not by chat timeout. Session analytics may still record a “case closed” when **L4** reaches a terminal state — that is a **reporting slice**, not deletion of the thread.
5. **L5** spans **all L2 visits** on **L1** for the same customer: durable facts and (later) embeddings over **customer_id**, not only `conversation_id`.

---

## L2 — Visit episode (design)

**Purpose:** Bound **recency-sensitive context** (summaries, “fresh visit” greeting policy, optional semantic-retrieval scope before full customer-level memory exists).

**Signals (combine as policy, not one global truth):**

- **Inactivity:** gap since last **user** message (assistant latency must not drive this).
- **Optional:** calendar-day boundaries for **dashboards** only.
- **Optional later:** model-assisted “new primary intent” when gap is short (high confidence only).

**Not used alone for:** order truth, refund eligibility, or “conversation ended” in a legal sense — use **L4** and tooling.

---

## L3 — Task focus (design)

**Purpose:** Track **current user goal** within a visit: ordering, modifying draft, WISMO, complaint, small talk.

**Implementation direction:** align with existing `current_state`, `draft_cart`, `conversation_turns` integrity pipeline; add explicit **suspend/resume** when the user pivots and returns (“seguimos con mi pedido”).

**Relation to research:** mirrors **stack / lineage** DST patterns — one **active task**, with ability to **resume** after interruption.

---

## L4 — Order / transaction (design)

**Purpose:** Single **source of truth** for fulfillment.

**Rule:** Chat “session” boundaries **must not** be the only carrier of order context. After payment or handoff to kitchen, **post-purchase** questions bind to `**transaction_id` + status**, consistent with industry post-purchase / WISMO patterns.

**Pickup vs “order complete”:**  

- **Business complete** may mean **picked_up** or **delivered** — product decision.  
- **Chat analytics** may log a **fulfillment episode** from **paid → terminal** regardless of L2 visit splits.

---

## L5 — Customer relationship (design)

**Purpose:** Long-horizon memory and personalization — see embeddings research doc.

**Direction:** structured facts today; **customer-scoped** retrieval and typed memories later; **L2** segments help **label** which visit produced which memory.

---

## Mapping to current codebase (honest snapshot)


| Layer | Implemented today                                   | Gap                                                     |
| ----- | --------------------------------------------------- | ------------------------------------------------------- |
| L1    | `conversations` per customer thread                 | —                                                       |
| L2    | Not first-class; only implicit timestamps           | Add `conversation_sessions` or `session_id` on messages |
| L3    | `current_state`, `draft_cart`, `conversation_turns` | Explicit task stack / resume policy optional            |
| L4    | `transactions` (per product scope)                  | Ensure every post-order bot answer hits tools/DB        |
| L5    | `customer_preferences.facts`                        | Customer-level vectors / `customer_memories` (planned)  |


---

## References (research & practice)

- **Goal change / dynamic DST:** DSTC2; sequential tracking ([W14-4345](https://aclanthology.org/W14-4345.pdf)).
- **Task lineages:** Lee & Stent, *Lineages: Dialog State Tracking for Flexible Interaction* ([W16-3602](https://aclanthology.org/W16-3602.pdf)).
- **Segmentation + state in open-domain:** S3-DST ([arXiv:2309.08827](https://arxiv.org/abs/2309.08827)).
- **Interrupt / multi-task TOD:** Converse ([arXiv:2203.12187](https://arxiv.org/abs/2203.12187)).
- **Transactional vs relational service:** standard CRM/CX split (efficiency vs long-term relationship) — see e.g. HubSpot / industry writeups.
- **Post-purchase / WISMO:** operations assume **order + logistics data**, not chat thread ID, as the anchor for “where is my order?”

---

## Document history

- **2026-04-06:** Initial five-layer model; replaces informal dual time-threshold framing for session semantics.

