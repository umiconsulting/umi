# ConversaFlow Edge Functions → umi-api: Deep Port Analysis (Phase 3 prep)

**Date:** 2026-06-24
**Status:** Analysis complete — input to Phase 3 of `docs/architecture/2026-06-23-umi-api-centralization-spec.md`
**Source:** Opus 4.8 multi-agent workflow (8 read-only agents, full reads of `apps/umi-conversaflow/supabase/functions/**` + `supabase/migrations/`, ~829K tokens). One agent per subsystem: ingress · tools · worker-turns · enrichment · dispatch · kds · shared · data.

---

## Bottom line up front

The ConversaFlow backend is a well-built but **Supabase-Edge-Functions-shaped, single-tenant, Deno** system. Porting it to the long-running NestJS+Fastify VPS API is mostly mechanical *per file*, but five themes dominate and several need an **owner decision before code**:

1. **Schema reconciliation is the #1 blocker** (and bigger than the spec assumed). There are **four** naming generations live in the DB at once: `public.*` (legacy), `conversaflow.*`/`kds.*` (the **actual live bot runtime**, `DB_SCHEMA=conversaflow`), the migration-landed canonical `platform/commerce/cash/observability/*`, and the spec's *intended* `core/ops/comms/loyalty/device/kitchen/queue`. The last two **don't even match each other**. No port SQL can be written until the live schema is confirmed.
2. **The edge-function-isms are a finite, well-understood catalog** (§2) — `Deno.serve`, `Deno.env`, `EdgeRuntime.waitUntil`, supabase-js, the `triggerJobWorker`/`pg_cron`/INSERT-trigger wake machinery, and the `edge_function_logs`/`logEdgeFunction` misnomer you flagged.
3. **The reliability model is precise and feeds Phase 1c directly** (§3): a per-conversation single-flight mutex, an interactive-vs-background priority that **BullMQ inverts**, deterministic idempotency keys, 2-min stale-lock recovery that must be **sized up for >2-min LLM turns**, and a transactional-outbox reply path. There is also a **real bug to fix, not copy**: order checkout has **no idempotency key**.
4. **Single-tenant is baked in deep** (§5) — a module-load `BUSINESS_ID` that throws, hardcoded `kalalacafe` ids, hardcoded location. The VPS must resolve tenant per inbound webhook.
5. **Large amounts of Spanish prompt/heuristic/safety logic must port verbatim** (§6) — paraphrasing silently changes customer-facing behavior.

Owner decisions needed before Phase 3 code: **§10**.

---

## 1. Subsystem → port-target map

| Slice | What it is | Port target in `umi-api` |
|---|---|---|
| **ingress** | WhatsApp webhook entry + guardrails (Twilio sig, rate-limit, prompt-injection, sanitize, business-hours, intent, TwiML, MessageSid idempotency) | `modules/conversations/whatsapp.controller.ts` (ingress), `security.service.ts`, `prompts.ts`, `intent.service.ts`, `business-hours.service.ts`, `*.repository.ts`. Enqueues BullMQ `turns`→`turn.integrity` (jobId=MessageSid). |
| **tools** | The 10 LLM agent tools (search/cart/checkout/cancel/reorder/info) + product search waterfall + variant/synonym matching | `modules/conversations/tools/*.tools.ts` + `ProductSearchService` + `CartService` (CAS) + `OrderingService`. Result contract preserved for the turn loop. |
| **worker-turns** | The worker drain loop + the `turn.integrity → turn.process` mini-harness (Claude + tool loop + memory + safety + outcome state machine) | `jobs/turns.processor.ts` + `modules/conversations/turn.service.ts`. The loop/claim machinery is **replaced by BullMQ**, not ported. |
| **enrichment** | Background jobs (embed/summarize/extract-facts/product-embed/backfill), Zettle sync, 7 cash lifecycle WhatsApp crons | `jobs/enrichment.processor.ts`, `jobs/integrations.processor.ts` + `zettle.adapter.ts`, `jobs/lifecycle.scheduler.ts` + `jobs/outbound.processor.ts`. |
| **dispatch** | Outbox dispatch (twilio.reply / status / cancel / location / whatsapp-lifecycle) | `jobs/outbound.processor.ts` (kind registry) → `TwilioAdapter`. **Re-add `toWhatsAppMarkdown`** (lost in the Phase-1 adapter port). |
| **kds** | KDS device endpoints (command/board/pairing) + device-token auth — **frozen Swift contract** | `modules/kds/{kds.controller,kds.service,device-auth.guard}.ts` + frozen DTOs + `/functions/v1/kds-*` aliases. |
| **shared** | working-memory + semantic search, turn DB ops, pending-clarification, job/outbox enqueue, business/voice config, phone-normalize, synonyms, inbound gate, geo | `modules/conversations/memory.service.ts` + repositories; `jobs/queues.ts`; `BusinessConfigRepository`; `InboundEventRepository`; `geo.adapter.ts`. `supabase.ts`/`claude.ts`/`cors.ts` **deleted** (PgService/AnthropicAdapter/Fastify-CORS). |
| **data** | migrations, RPCs, triggers, pg_cron, Vault, pgvector, KDS projection, Zettle OAuth | BullMQ replaces the queue RPCs + wake cron/trigger; KDS RPCs kept (called from VPS) or reimplemented; `integrations` module hosts Zettle OAuth; identity via `resolve_person`/`normalize_phone`. |

Already ported (Phase 1, reference only): `AnthropicAdapter`, `VoyageAdapter`, `TwilioAdapter`, `EmailAdapter`, `TraceService`.

---

## 2. Edge-function-ism refactor catalog (cross-cutting)

Every slice surfaced the same patterns. This is the definitive list:

| # | Edge-ism (where) | VPS replacement |
|---|---|---|
| 1 | `Deno.serve(req→Response)` + manual OPTIONS/CORS/method (every function) | Fastify controllers (`@Post`), framework CORS/OPTIONS, `405` via routing |
| 2 | `Deno.env.get(...)` scattered; **module-load `BUSINESS_ID = getRequiredBusinessId()` throws** | `ConfigService` (typed, validated at boot). **Add** `TWILIO_WEBHOOK_URL`, `GOOGLE_MAPS_API_KEY`; handle tenant per-request not via a global env id |
| 3 | `EdgeRuntime.waitUntil(...)` / floating `.catch()` fire-and-forget (audit, trace, embed, resolve_person) | **Classify each:** fast best-effort writes → `await` inline; durable work (embeddings, identity) → BullMQ job. Never leave a floating promise (lost on SIGTERM) |
| 4 | `supabase-js` `.from()/.rpc()/.schema()` everywhere; `error.code==='23505'` magic-string idempotency; `(supabase as any).schema('kds')` guards | Raw parameterized SQL via `PgService` pools (`umi_worker` BYPASSRLS for service tables; `umi_app` for tenant reads). Keep `23505` handling. Schema-qualify explicitly |
| 5 | `triggerJobWorker()` HTTP self-wake + `pg_cron` heartbeat + `AFTER INSERT` trigger (`net.http_post`) + **Vault `service_role_key`** | **Delete all of it.** BullMQ push delivers instantly. Drop `trg_wake_job_worker`, the heartbeat cron, `pg_net`, and the Vault secret |
| 6 | Web Crypto globals (`crypto.subtle`, `getRandomValues`, `btoa`/`atob`, `crypto.randomUUID`) | `node:crypto` (Node 22 also has `globalThis.crypto`). **KDS token/PIN hashing must stay byte-identical** (§8) or paired iPads break |
| 7 | PostgREST overload-juggling (KDS 5/6/7-param RPCs, anon grants, "always pass 7 params") | Call SQL functions directly with positional args — overload ambiguity **and** the anon-grant surface disappear |
| 8 | RLS via `user_has_business_access(auth.uid())`; bot runs as service_role and **bypasses RLS** | Explicit `tenant_id/business_id` `WHERE` clauses in every repository query (service_role ignores RLS → **zero** isolation otherwise) |
| 9 | `.ts` import extensions, `jsr:`/`npm:` specifiers, `Deno.test` | Extensionless TS, vitest. Pure-function `.test.ts` (turns, pending-clarification, normalize-phone) port almost verbatim — **do port them, they're the fidelity guards** |
| 10 | **`edge_function_logs` / `logEdgeFunction` / `function_name`** (the misnomer you flagged) | **Decision (below).** |

### The `logEdgeFunction` / `edge_function_logs` rename — decision

There are no edge functions on the VPS, so the name is wrong — but `umi-logs` reads the `edge_function_logs` **table** (and `ai_turn_logs`, `security_logs`) live, by exact name, from schema `conversaflow` (spec §8.3). So:

- **Keep the table name + columns unchanged** (don't break `umi-logs`). `TraceService` already writes them.
- **Rename the concept, not the storage:** the method/interface becomes runtime-neutral (`logComponent` / a "component log"), and the value written into the `function_name` column becomes a **runtime-neutral component identifier** — the BullMQ queue/worker name or a logical route (e.g. `conversations.whatsapp_webhook`, `enrichment.message_embed`, `kds.command`) instead of `'whatsapp-handler'`/`'job-worker'`/`'embedding'`.
- The eventual `observability.ai_runs`/`pipeline_spans` migration (canonical) renames the table later — a config flip, out of scope here.

This is a clean, low-risk change: `umi-logs` keeps grouping by `function_name`; the values just stop pretending to be edge functions.

---

## 3. Reliability → BullMQ design (this is the Phase 1c spec)

The hand-rolled Postgres queue encodes behaviors that **must be reproduced** in BullMQ — several are non-obvious correctness invariants.

| Behavior (today) | BullMQ port |
|---|---|
| **Per-conversation single-flight** — `claim_next_job` will not claim a `turn.integrity`/`turn.process` job for a conversation that already has one claimed/running | **THE critical invariant.** Per-conversation lock/FIFO group (BullMQ group/concurrency-by-key, FlowProducer, or a Redis lock on `conversation_id`). Naive concurrent workers → double replies + lost-update on `draft_cart`/`state_version`. ⚠️ Two migration definitions diverge (all-aggregates vs turn-only) — **confirm the live one** (`20260506120000` is the latest, turn-only) |
| **Priority** `INTERACTIVE=100` > `BACKGROUND=-10`, `ORDER BY priority DESC` | **BullMQ uses lower-number = higher priority — INVERT the sign.** Do it once, centrally in `jobs/queues.ts` enqueue helpers. Easy to get backwards; would make enrichment preempt customer turns |
| **Idempotency** — `inbound_events UNIQUE(source, source_event_id=MessageSid)`; `jobs UNIQUE(inbound_event_id, job_type)`; `outbox UNIQUE(idempotency_key)` patterns `twilio_reply_turn:{msgId}`, `twilio_status:{ticket}:{seq}`, `lifecycle:{cardId}:{journey}` | Deterministic BullMQ `jobId` (MessageSid for ingress, turn_id for reply, `card_id:journey:date` for lifecycle) **+** keep `queue.inbound_events` as the durable pre-enqueue gate **+** `queue.outbox_events` UNIQUE for the reply relay |
| **Retry/backoff** — `jobs` max_attempts 3, `outbox` 5, `2^attempt s` capped 5 min | `attempts` + `backoff:{type:'exponential'}`. Don't double-wrap Voyage's internal retry (2×) or the Anthropic SDK's `maxRetries:2` |
| **Dead-letter** — `state='dead'` at max attempts | BullMQ `failed` + a handler that records to `queue.dead_letters` + a `pipeline_traces` dead row |
| **Stale-lock reclaim** — `claimed`/`running` > 2 min → `pending` | `lockDuration`/`stalledInterval` — **size for >2-min LLM turns** (multi-call loops can exceed 2 min). Too tight → false reclaim → duplicate processing (mitigated only by `state_version` CAS) |
| **turn-integrity 3 s inline sleep** + recursive self-call (debounce of split WhatsApp bubbles) | **BullMQ delayed job** (re-enqueue with delay) so the worker slot frees; preserve `MIN/EXTENDED/MAX_HOLD_MS` = 1000/2500/3000 exactly |
| **Transactional outbox** — today the post-turn message-insert + outbox-insert + turn-complete are **sequential, not one transaction** | **Improve, don't copy:** write the `queue.outbox_events` row in the **same tx** as the assistant message (spec §10.4), relay → BullMQ. Prevents a crash dropping a customer reply |
| **At-least-once delivery** — Twilio 2xx then crash before mark-delivered → reclaim re-sends (no delivered-SID guard) | Conscious decision: accept at-least-once, or add a Twilio idempotency key / delivered-SID guard |
| **cash `workflow_jobs` have NO retry** (single `failed`) | **Bug to fix, not copy** — give cash crons real `attempts`/backoff + per-tenant fan-out |
| **Order checkout has NO idempotency key** (`confirm_order`/`reorder` insert a fresh UUID each call) | **Bug to fix** — derive an idempotency key (turn/inbound_event_id, or hash of conversation+cart+version) so a tool/worker retry can't create a duplicate order |

**Queue shape (recommended):** separate `outbound` into priority lanes (interactive `twilio.reply` vs bulk `whatsapp.lifecycle`) — the legacy outbox has **no priority column**, so a big lifecycle batch can starve real-time replies.

---

## 4. Schema reconciliation — the #1 blocker (expanded)

> **⚠️ SUPERSEDED for the platform DB (2026-06-24 preflight).** Read-only introspection of the live platform DB `xbudknbimkgjjgohnjgp` shows the canonical `core/ops/comms/loyalty/device/kitchen/queue/observability/grow` schema is **already live** and is exactly what the spec §9.1 specifies — there is **no** `conversaflow`/`kds`/`platform`/`commerce`/`cash` schema on it. The four-generation ambiguity below describes the ConversaFlow *app's own* DB (`DB_SCHEMA=conversaflow`, a separate project), not the DB `umi-api` connects to. §10.1 (naming) and §10.2 (which queue) are **resolved** — see `docs/migration/2026-06-24-phase1c-queue-schema-preflight.md` for the column-exact confirmed map. The sections below are retained as the analysis of the *source* (conversaflow) system.

Four generations coexist in the live DB:

| Gen | Schemas | Status |
|---|---|---|
| (a) | `public.*` | Legacy pre-cutover copies. **Retire** (confirm dead first) |
| (b) | `conversaflow.*`, `kds.*` | **The live bot runtime** (`DB_SCHEMA=conversaflow`). `kds.*` is a trigger-maintained projection that FKs into `conversaflow.transactions/businesses/customers` |
| (c) | `platform.*`, `commerce.*`, `cash.*`, `observability.*`, `legacy.*`, `dashboard_compat.*` | Migration-landed "canonical" (note: `platform.contacts` → renamed `platform.people`). Also new `conversaflow.workflow_jobs/channels/memory_items/tool_calls` built + cron-wired for cash but **the bot still uses `conversaflow.jobs/outbox`, not these** |
| (d) | `core/ops/comms/loyalty/device/kitchen/queue` | The naming the **spec** wants — **does not match (c)**. A mapping/rename is required |

**Two parallel queues** also exist: `conversaflow.jobs`/`outbox` (live bot path, per-conversation serialized claim) **vs** `conversaflow.workflow_jobs` (cash cron path, `claim_next_workflow_job`, no serialization). The port must pick one and migrate in-flight rows.

**Blocking preflight (do before any Phase 3 SQL):** against the live platform DB (`xbudknbimkgjjgohnjgp`), confirm the actual schema + table + column names for: conversations/messages/turns/customer_preferences; jobs/outbox/inbound_events; businesses + whether hours live in `businesses.config` JSONB or `ops.business_hours`; products + the `search_products_*` RPC home; `kds.*` vs `v_kds_tickets`/`ops.order_items`/`device.*`/`kitchen.*`; the loyalty/`umi_cash` situation; and whether `resolve_person`/`normalize_phone` RPCs exist and are EXECUTE-grantable to the worker role. Output: a confirmed schema map (this supersedes the spec §9.1 "confirmed canonical" claim, which the live code contradicts).

---

## 5. Multi-tenant — the deepest single assumption

| Where | Single-tenant bake-in | Fix |
|---|---|---|
| `_shared/cors.ts` | `BUSINESS_ID = getRequiredBusinessId()` read at **module load**, throws if missing; used pervasively by ingress/context/security/tools | Resolve tenant **per request** from the inbound WhatsApp `To` number → `ops.channel_accounts` → tenant, stored in the Phase-0 `RequestContext` (AsyncLocalStorage) |
| `cash-cron.ts`, dispatch | Hardcoded `business_id 'ef9005a2-…' (kalalacafe)` for all cash WhatsApp + seed jobs | Real `tenant_id` per card/tenant; tenant-aware WhatsApp `from` |
| `twiml.ts` | Hardcoded `BUSINESS_LOCATION` lat/lng/address | Per-tenant config |
| `business-hours.ts` | `DEFAULT_CONFIG` Mazatlán fallback | Per-tenant config; fallback only |
| `zettle-oauth-setup` | `DEFAULT_BUSINESS_ID`; static `ZETTLE_API_KEY` ('organizations/self' = single account) | Per-tenant token; OAuth-per-tenant if multi-account |

This is the single largest design question: **does ConversaFlow go multi-tenant now, or stay single-tenant for the port?** (§10).

---

## 6. Behavior fidelity — port verbatim (do not paraphrase)

These are load-bearing and brittle; a "cleanup" silently changes customer-facing behavior. Port the strings/regexes/constants byte-for-byte and **port the `.test.ts` to vitest as guards**:

- **`prompts.ts`** — `buildVoiceSystemPrompt`/`buildHarnessSystemPrompt`, `PROMPT_VERSION='v5.1.0'` (logged to `ai_turn_logs.prompt_version`; bump on edits).
- **`intent-extractor.ts`** — the Spanish extraction rules in the system prompt + `applyClarificationHeuristics` + fuzzy synonym matching.
- **`turn-tool-loop.ts`** — the heuristic forced-tools/rewrites/blocks regex layer (voice/UX-critical).
- **Safety gates** — `blockUnverifiedOrderConfirmation` (HALLUCINATED_ORDER regex, gated on `toolOutcomes.orderConfirmed`), confirm-order pre-conditions, guard-fire circuit breaker (`MAX_GUARD_FIRES=4`), tool-call dedup, `MAX_TOOL_CALLS_PER_TURN=4`. **Never tell a customer an order is confirmed without a real tool success.**
- **Semantic memory** — `MIN_SIMILARITY=0.62`; pondering re-rank `sim*0.55 + recency*0.30 + novelty*0.15`, recency halflife 3 d, novelty floor 0.35; exclude-recent-8; content length ≥ 8.
- **turn-integrity timing** — `1000/2500/3000ms`, `isRevisionLike`/`isExtensionLike` Spanish regexes (the multi-bubble debounce customers feel directly).
- **`normalize-phone.ts`** — **must equal `platform.normalize_phone()` SQL byte-for-byte** (E.164, MX default, strip `+52` mobile `1`); divergence → wrong-customer identity matches across Cash + WhatsApp. Port the lockstep vector test.
- **`synonyms.ts`** — size/temp/milk canonical codes the catalog/cart resolve against.
- **Lifecycle copy** + cancellation copy — deterministic Spanish, profanity-scrubbed (`redact_customer_text`).
- **No hardcoded assistant text** — every customer reply comes from the LLM in business voice; `requireVoiceConfig` throws if `businesses.config.voice` is missing (make it a per-request throw, not module-load, so one bad tenant can't 500 the shared process).

---

## 7. Cash lifecycle crons — owner decisions required

`cash-cron.ts` reads the **legacy `umi_cash`** schema (Prisma PascalCase: `"LoyaltyCard"`, `"User"`, `"Tenant"`, `"Visit"`, `"BirthdayReward"`, …) via cross-schema RPCs. Conflicts to resolve:

- **Which DB/schema at runtime?** Memory says the real cash prod DB is `rrkzhisnadfrgnhntkiz` (untouchable) and the platform `umi_cash` is a **stale copy**. Spec §2.1.1 says read canonical `loyalty.*` + WhatsApp-only. Reading stale `umi_cash` acts on stale loyalty data; reading `loyalty.*` requires rewriting the 3 `get_*` RPCs + PascalCase→snake_case mapping (per `2026-06-18-curated-column-mapping.md`).
- **Wallet-push double-fire:** the code sends **Apple + Google wallet pushes** inside `birthday_rewards`/`expire_birthday_rewards`/`goal_proximity`, but spec §2.1.1 says those crons are WhatsApp-only and `umi-cash` keeps its **own** pass-push cron. Porting the pushes into `umi-api` → **double-push**. Decide: WhatsApp-only here, pushes stay in `umi-cash`.
- **D11 write-inert:** crons write `LoyaltyCard.lifecycleMessage` (→ `cards.metadata`) and `BirthdayReward`. Is that allowed when `CASH_WRITE_ENABLED=false`? The `lifecycle_sends` dedup is the §11.5 carve-out, but a `cards.metadata` write may not be.
- **Idempotency journey key:** `winback/streak/welcome` use a bare `lifecycle:{cardId}:{journey}` (no period) → a customer can **never** get `winback_30` twice, ever. Intentional, or should re-fire (spec's `card_id:journey:date`)?
- **Fan-out:** prefer one BullMQ job per tenant (per card) over one cross-tenant mega-job — isolation + bounded concurrency + per-tenant retry.

---

## 8. KDS — frozen-contract specifics

The Swift client is **not recompiled** — request/response JSON, headers, enums, error codes, and **token hashing** must port verbatim (contract-test against captured real payloads):

- Headers: `Authorization: Bearer <anon>`, `apikey`, `X-KDS-Device-Token`; CORS allow-list must include `x-kds-device-token` + `x-umi-user-id`; `OPTIONS`→200, non-POST→`405 method_not_allowed`.
- Enums (exact): status `new|accepted|preparing|ready|completed|cancelled|partial_cancelled`; cancel reason `out_of_stock|kitchen_overload|closing_soon|customer_no_show|duplicate_order|other` (`other` requires note ≥3 chars); event kind `snapshot_reconciled|order_upserted|status_changed|order_removed`; monotonic BIGINT `sequence` cursor.
- State machine (`assert_transition`), device-scope auth (mismatch → **404 not 403**, to avoid leaking existence), broadcast station (NULL station visible on all boards).
- **Token hashing byte-identical:** device token = `sha256(token)` **no salt**; PIN = `sha256(`${salt}:${pin}`)`. Change it → every paired iPad silently revoked. Revocation gate: `is_active=false` → `403 {error:'device_revoked'}`.
- WhatsApp status notifications are produced **inside** `SECURITY DEFINER` RPCs (`enqueue_whatsapp_status_notification` etc.) with exact idempotency keys + Spanish copy — **if you reimplement transitions in TS, don't lose the notification enqueue**.
- **`admin_*` pairing actions have NO auth** in the function (rely on service_role) — on the VPS they **must** sit behind the dashboard admin auth guard, split from the device routes. (Also: remove the dashboard's `callKdsPairingBackend` proxy duplicate per spec §6.1; back the in-memory heartbeat with Redis/DB.)
- `device_sessions` exists in **3 incompatible shapes** across migrations; the code papers over it — confirm the **live** column set before dropping the tolerance.
- Bind-time: confirm whether the live DB still exposes `kds.*` RPCs or the canonical `v_kds_tickets` view over `ops.order_items.kitchen_status` + `device.*`/`kitchen.*`.

---

## 9. Dead code, regressions, and cleanup

- **`tools.ts` dead import** `insertJob/insertOutbox` (never called) — drop.
- **`twilio.cancel_notification` + `twilio.location_pin` dispatchers have no producer** anywhere — likely dead; confirm before porting.
- **`toWhatsAppMarkdown` regression:** the `**bold**`→`*bold*` conversion was **not** carried into the Phase-1 `TwilioAdapter` — a naive port sends literal `**bold**`. Re-add in the outbound processor/adapter.
- **`public.*` copies** — retire after confirming dead.
- **Secrets:** Vault `service_role_key` is flagged **unrotated + previously leaked** (memory). Remove the Vault/pg_net dependency, rotate, and ensure the `trg_wake_job_worker` trigger is dropped (leaving it active post-cutover double-fires the defunct edge worker).
- Adapter **masks the real Twilio error** (returns null, logs body) → dead-lettered messages lose the actual status; consider surfacing it for diagnosability.

---

## 10. Owner decisions required (consolidated)

> **Update (2026-06-24 preflight):** items 1 and 2 are **resolved** against the live platform DB — see `docs/migration/2026-06-24-phase1c-queue-schema-preflight.md`. (1) The spec's `core/ops/comms/loyalty/device/kitchen/queue/observability/grow` is live and canonical. (2) A single `queue.jobs` with `job_class IN ('standard','workflow')` is authoritative; `queue.jobs`/`job_attempts` are superseded for execution by BullMQ. Two new findings surfaced for later phases: the live `observability.*` tables are canonical (`ai_runs`/`pipeline_spans`/`security_events`), which does **not** match the committed Phase-1b `TraceService` binding (`conversaflow.ai_turn_logs/…`) → Phase-1b reconciliation; and `umi_app`/`umi_worker`/`umi_readonly` are NOLOGIN with no `queue.*` grants → Phase-2 grant work.

1. **Live schema map** (blocking) — confirm the actual schemas/tables/columns/RPCs on `xbudknbimkgjjgohnjgp` (the code says `conversaflow`/`kds`/`umi_cash`; the spec says `core/ops/comms/loyalty/queue`). And **which canonical naming wins** — the migration-landed `platform/commerce/cash` or the spec's `core/ops/comms/loyalty`.
2. **Which queue is authoritative** — `conversaflow.jobs`/`outbox` (live bot) or `conversaflow.workflow_jobs` (cash cron)?
3. **Multi-tenant now or later** — resolve tenant per inbound webhook, or keep single-tenant `kalalacafe` for the first cut?
4. **Cash crons:** which DB/schema do they read (untouchable `rrkz`, stale `umi_cash`, or canonical `loyalty.*`)? Do wallet pushes move to `umi-api` or stay in `umi-cash`?
5. **KDS:** call live `kds.*` RPCs verbatim, or reimplement over `v_kds_tickets`/`ops.order_items`? Where does dashboard admin auth for `admin_*` pairing come from?
6. **Delivery guarantee** — accept at-least-once WhatsApp, or add a delivered-SID/Twilio idempotency guard?
7. **Secrets** — VPS secret store + rotate the leaked service_role key as part of cutover.

---

## 11. Revised Phase 3 plan (sequenced)

Informed by the above, Phase 3 splits into ordered sub-phases (each independently testable; the WhatsApp pipeline cuts over via the Twilio webhook flip, KDS via the iPad config flip — both reversible):

- **3.0 — Schema preflight (blocking).** Confirm the live schema map (§4) + the queue decision (§10.2) + multi-tenant decision (§10.3). Bind `prisma`… (no — raw SQL) the repository SQL to confirmed names. Add missing config (`TWILIO_WEBHOOK_URL`, `GOOGLE_MAPS_API_KEY`, tenant-resolution).
- **3a — Conversations domain (read/util first).** Port the pure/low-risk pieces: `security.service`, `prompts`, `intent`, `business-hours`, `synonyms`, `normalize-phone` (+ their vitest tests), `memory.service` + repositories, `BusinessConfigRepository`. The `logEdgeFunction`→component rename (§2) lands here.
- **3b — The worker engine (Phase 1c lands here too).** BullMQ reliability policy from §3: per-conversation single-flight, priority inversion, deterministic jobIds, retry/backoff, dead-letter, stalled-job sizing, transactional outbox. `jobs/turns.processor.ts` + `turn.service.ts` + the tool loop + safety gates (verbatim).
- **3c — Tools + ordering.** The 10 tools, product-search waterfall, cart CAS, ordering — **add the checkout idempotency key** (§3 bug).
- **3d — Ingress cutover.** `whatsapp.controller.ts` (raw-body signature, MessageSid idempotency, enqueue). Repoint the Twilio webhook to the VPS; canary/soak vs the edge function.
- **3e — Dispatch + enrichment + cash crons.** Outbound processor (re-add markdown), embeddings/summaries/facts, Zettle sync, lifecycle crons (per the §7 decisions).
- **3f — KDS.** `modules/kds/*` against the confirmed projection; frozen-contract DTOs + contract tests; iPad config repoint + `/functions/v1/*` aliases.
- **3g — Decommission.** Remove the edge functions, the wake cron/trigger/Vault, the `public.*` copies; confirm `umi-logs`/`umi-cash` untouched.

---

*This document is the synthesis of the 2026-06-24 Opus 4.8 analysis workflow. The per-slice raw structured output (keyFiles, full edgeFunctionIsms with replacements, full businessLogic, risks, openQuestions for all 8 subsystems) is in the workflow transcript under the session's `tool-results/`.*
