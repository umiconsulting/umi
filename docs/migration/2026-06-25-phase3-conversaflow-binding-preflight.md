# Phase 3.0 — ConversaFlow Port: Confirmed Canonical Binding

**Date:** 2026-06-25
**Status:** Schema preflight COMPLETE. Unblocks Phase 3 code (the conversational engine port).
**Method:** Read-only introspection of the live **prod-schema replica** (`umiapi_pg` :5440, dumped schema-only from `xbudknbimkgjjgohnjgp`) — `information_schema`/`pg_catalog`/`pg_get_functiondef`. This supersedes the stale `docs/migration/local-postgres/004_conversaflow_core.sql` (which uses gen-c `conversaflow.*`/`platform.*`/`contact_id`/`opened_at`/`body` names that are **not** on the live DB).
**Owner decisions (this session):** (1) **per-request tenant resolution** via `ops.channel_accounts`; (2) **full Phase 3 in one build-out** (turn engine + enrichment + dispatch + cash lifecycle crons + Zettle).

---

## 0. Bottom line

The live canonical `comms.*` schema is a **faithful superset of the ConversaFlow runtime** — every state-machine column the bot relies on (`draft_cart`, `state_version`, `draft_cart_version`, `pending_clarification`, `conversation_history`, `state_data`, `current_state`) exists, plus `messages.twilio_message_sid` for MessageSid idempotency and a rich `conversation_turns` table carrying the integrity/debounce machinery. The port is a **re-bind of every query to canonical columns** (like Phase 2 for the dashboard), not a behavioral rewrite. Identity + phone normalization are owned by **SQL functions** (`core.resolve_contact`, `core.normalize_phone`) — the port calls them rather than re-implementing matching in TS. There is **no `search_products` RPC and no loyalty `award/redeem` RPC** on canonical — product search and loyalty reads are **direct SQL** (consistent with how Phase 2 shipped cash writes).

---

## 1. Schemas present (live)

`core, ops, comms, loyalty, device, kitchen, queue, observability, grow` (+ `legacy, _migration, public`, Supabase-managed). **Absent:** `conversaflow, kds, platform, commerce, cash, umi_cash`. The spec §9.1 canonical naming is live and authoritative.

---

## 2. `comms.*` binding (column-exact) — the conversation engine's home

### comms.conversations (the per-conversation state machine)

`id uuid · tenant_id uuid · person_id uuid · order_id uuid · status text · current_state text · conversation_history jsonb · state_data jsonb · draft_cart jsonb · pending_clarification jsonb · summary text · history_migrated bool · state_version bigint · draft_cart_version bigint · last_message_at timestamptz · created_at timestamptz · metadata jsonb`

- Legacy `customer_id`→**`person_id`**; `business_id`→**`tenant_id`**; `opened_at`→**`created_at`**; `updated_at`→**`last_message_at`**. `status` values seen: `open|pending|closed|archived` (Phase 2 also tolerates `active`).
- **CAS columns preserved:** `state_version` + `draft_cart_version` are the optimistic-lock cursors the turn loop/cart writes increment.

### comms.messages

`id · tenant_id · conversation_id · role · content · intent · entities jsonb · message_index int · twilio_message_sid text · embedding vector · embedding_model text · created_at · metadata jsonb`

- Legacy `body`→**`content`**; `provider_message_id`/MessageSid→**`twilio_message_sid`** (the per-message idempotency key — `insertMessage`'s `'DUPLICATE'` short-circuit binds here). `role ∈ user|assistant|system|tool|operator`.
- `embedding` is pgvector (message-embed enrichment writes it). `message_index` is the per-conversation ordinal.

### comms.conversation_turns (turn-integrity / debounce machinery)

`id · tenant_id · conversation_id · person_id · status · source_message_ids uuid[] · assistant_message_id uuid · merged_user_text text · integrity_decision text · integrity_reason text · base_state_version bigint · extracted_intent jsonb · reconciled_action jsonb · first_message_at · last_message_at · hold_until timestamptz · released_at · processed_at · superseded_at · created_at · metadata jsonb`

- `status ∈ pending|processing|completed|failed|superseded`. `hold_until` + `source_message_ids` + `merged_user_text` are the multi-bubble debounce (turn-integrity 1000/2500/3000ms). `base_state_version` anchors the CAS.

### comms.tool_calls

`id · tenant_id · conversation_id · turn_id · tool_name · input jsonb · output jsonb · status (started|succeeded|failed) · error · started_at · completed_at · metadata jsonb`

### comms.memory_items (working/semantic memory)

`id · tenant_id · person_id · conversation_id · memory_type · content · attributes jsonb · embedding vector · embedding_model · created_at · updated_at · metadata jsonb`

- Legacy `contact_id`→**`person_id`**. Semantic search = cosine over `embedding`.

### comms.customer_preferences (extract-facts target)

`id · tenant_id · person_id · favorite_service_ids uuid[] · usual_modifications jsonb · total_transactions int · avg_transaction_value_cents int · last_transaction_at · facts jsonb · created_at · updated_at`

### comms.knowledge_documents / comms.knowledge_chunks (RAG)

`knowledge_chunks`: `id · tenant_id · document_id · chunk_index · content · embedding vector · embedding_model · metadata · created_at`. Plus `comms.daily_summaries`.

---

## 3. `ops.*` binding — tenant resolution, products, hours, orders

### Tenant resolution (per-request — owner decision #1)

- **ops.channels:** `id · tenant_id · key (whatsapp|sms|slack|web|voice) · name · status · metadata · created_at`.
- **ops.channel_accounts:** `id · tenant_id · location_id · channel_id · provider text · provider_account_id text · address text · config jsonb · status · metadata · created_at · updated_at`. **`UNIQUE(provider, provider_account_id)`**.
- **Resolution path:** inbound Twilio `To` (the business WhatsApp number, `whatsapp:+…`) → strip prefix → look up `ops.channel_accounts` where `provider IN ('twilio','whatsapp') AND provider_account_id = <number>` (also try `address`) → `tenant_id` (+ `location_id`, `channel_account_id`). Store in `RequestContext`. **Fallback:** `DEFAULT_TENANT_ID` env when no channel account matches (keeps the single live tenant working if its number isn't seeded yet). ⚠️ **Deploy preflight:** confirm the live prod `ops.channel_accounts` row exists for the active WhatsApp number (the replica seed is synthetic; real seeding is verified against prod at cutover).

### ops.products (catalog — direct-SQL search, no RPC)

`id · tenant_id · category_id · name · description · price_cents int · is_available bool · variants jsonb · name_embedding vector · embedding_model · synced_at · metadata jsonb · created_at · updated_at`

- Legacy `source_product_id`/`zettle_uuid`/`available`/`category`(text) → live `metadata` (source/zettle ids) + `category_id` (FK `ops.product_categories`) + `is_available`. Product search = pgvector cosine on `name_embedding` + text ILIKE waterfall (port `tools.ts` search logic as repository SQL).
- Also: `ops.product_categories`, `ops.product_modifiers`, `ops.product_modifier_groups`.

### Business config + hours

- **ops.businesses:** `id · tenant_id · name · business_type · city · config jsonb · open_times jsonb · branding jsonb · metadata · …`. Voice config + business config live in **`config`** (legacy `businesses.config.voice`); hours fallback in **`open_times`**. Also a structured **ops.business_hours** table + **ops.service_windows**.

### Orders (checkout writes)

- **ops.orders:** `person_id · tenant_id · source · source_transaction_id · status · channel · total_cents · placed_at · created_at · updated_at` (+ more). **ops.order_items** (holds `kitchen_status` — KDS, Phase 4), **ops.order_events**, **ops.payments**, **ops.refunds**, **ops.v_kds_tickets** (the KDS projection view — confirmed present, Phase 4).

---

## 4. RPCs (live `core.*`) — what exists vs. what the port replaces

| Need                                                          | Live RPC                                                                                                                        | Port use                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Phone normalize                                               | **`core.normalize_phone(text)`** (IMMUTABLE SQL)                                                                                | The lockstep source of truth. TS mirror only for client-side hashing/logging; identity never re-normalizes in TS.            |
| Identity resolve (was `resolve_person`/`getOrCreateCustomer`) | **`core.resolve_contact(tenant_id, kind, raw_value, display_name, source_system, external_id) → person_id`** (SECURITY DEFINER) | Ingress calls this with `kind='whatsapp'`. Creates `core.people` + `core.contact_methods` idempotently; returns `person_id`. |
| RLS helpers                                                   | `core.current_tenant_id() · current_user_id() · current_person_id() · can_access_tenant() · rls_tenant_check()`                 | Used by RLS policies; `withTenant` sets `app.tenant_id`/`app.user_id`.                                                       |
| Append-only guard                                             | `core.block_append_only_mutation`, `ops.block_order_event_mutation` (triggers)                                                  | Backstop — points/order-events are append-only.                                                                              |
| **Product search**                                            | **none**                                                                                                                        | Direct SQL (pgvector + ILIKE).                                                                                               |
| **Loyalty award/redeem**                                      | **none**                                                                                                                        | Cash crons only READ `loyalty.*`; no write RPC needed (Phase 2 cash writes are direct SQL).                                  |

**`core.normalize_phone` canonical logic** (TS mirror must match): strip non-digits → `''`=null; len10→`+52`+d; len11 & `1…`→`+52`+last10; len12 & `52…`→`+52`+last10; len13 & `521…`→`+52`+last10; `0…` & len>10→`+52`+last10; len 11–15→`+`+d; else null. (The old `_shared/normalize-phone.ts` `{e164,last10,confidence}` logic **diverges** from this — do not port it verbatim for identity; mirror the SQL.)

---

## 5. `queue.*` (from Phase 1c preflight — unchanged)

`queue.inbound_events` `UNIQUE(provider, provider_event_id)` = Twilio MessageSid gate; `queue.outbox_events` `UNIQUE(idempotency_key)` = transactional outbox the relay drains; `queue.dead_letters` (tenant_id NOT NULL — infra jobs log-only); `queue.idempotency_keys` `UNIQUE(tenant_id, scope, key)` = lifecycle-send dedup. All worker-pool (service schemas). See `2026-06-24-phase1c-queue-schema-preflight.md`.

---

## 6. Config additions for Phase 3 (config.schema.ts)

- `TWILIO_WEBHOOK_URL` (string, optional) — the exact public URL Twilio signs, for HMAC-SHA1 validation (don't infer from `req.url`).
- `GOOGLE_MAPS_API_KEY` (string, optional) — location-pin tool (`geo.ts`).
- `DEFAULT_TENANT_ID` (uuid string, optional) — tenant-resolution fallback when no `channel_account` matches.
- `PROMPT_VERSION` is a code constant (`v5.1.0`) logged to traces, **not** env.
- Already present and reused: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `TWILIO_*`, `ZETTLE_*`, `OBSERVABILITY_SCHEMA`, `OUTBOX_RELAY_ENABLED` (flip on in 3b once routes register).

---

## 7. Behavior-fidelity carry-overs (port verbatim — port analysis §6)

`prompts.ts` (`PROMPT_VERSION=v5.1.0`), `intent-extractor.ts` Spanish rules, `turn-tool-loop.ts` forced-tool/block regexes, safety gates (`blockUnverifiedOrderConfirmation`, `MAX_GUARD_FIRES=4`, `MAX_TOOL_CALLS_PER_TURN=4`), semantic-memory constants (`MIN_SIMILARITY=0.62`, re-rank `sim*0.55+recency*0.30+novelty*0.15`, halflife 3d, novelty floor 0.35, exclude-recent-8, len≥8), turn-integrity timings (1000/2500/3000ms + `isRevisionLike`/`isExtensionLike` regexes), `synonyms.ts` codes, lifecycle/cancellation Spanish copy. **No hardcoded assistant text** — every reply comes from the LLM in business voice; `requireVoiceConfig` becomes a per-request throw (one bad tenant must not 500 the shared process).

## 8. Known bugs to FIX (not copy)

- **Checkout has no idempotency key** — `confirm_order`/`reorder` insert a fresh UUID each call → derive a deterministic key (turn_id / hash of conversation+cart+version).
- **Cash `workflow_jobs` had no retry** (81 failed rows) → real BullMQ `attempts`/backoff + per-tenant fan-out.
- **`toWhatsAppMarkdown`** (`**bold**`→`*bold*`) was lost in the Phase-1 TwilioAdapter port → re-add in the outbound processor.
- **Wallet-push double-fire** — cash crons must be **WhatsApp-only** here; Apple/Google pushes stay in `umi-cash` (spec §2.1.1).
