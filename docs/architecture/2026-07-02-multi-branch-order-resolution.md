# Multi-Branch WhatsApp Order Resolution — 2026-07-02

Scope:

- backend owner: `apps/umi-api` (`src/modules/conversations/*`, `src/modules/kds/*`, `src/modules/tenants/*`)
- write producer: the WhatsApp turn engine (`turn.service.ts` → tools → `ops.orders`)
- consumer: dashboard Pedidos/KDS screen (`apps/umi-dashboard`) + the iPad KDS board
- runtime schemas: canonical `core.*` (tenants, locations), `ops.*` (orders, channel_accounts), `comms.*` (conversations)

Evidence base:

- code read of `turn.service.ts`, `tool-loop.service.ts`, `tools.service.ts`, `tools/*.tools.ts`, `tenant-resolution.service.ts`, `channel.repository.ts`, `tenants.repository.ts`, `kds.repository.ts` at HEAD (file:line cited inline)
- canonical DDL read of `docs/migration/build/10_core.sql` (locations) and `12_ops.sql` (composite-tenant FK precedent)
- **Not** `docs/migration/audit-output/supabase-prod-schema.sql` — that is a stale pre-migration dump with no `core.*` tables; do not use it for schema facts.
- design derived via a bounded multi-agent design pass (ground → 3 diverse designs → adversarial critique → synthesis), 2026-07-02

Status: **IMPLEMENTED** on branch `feat/multibranch-order-resolution` (PR #29). Companion to the shipped display-side fix (`kds.repository.ts` `listOrders` NULL-escape, see §1).

---

## Architecture revision (as built — supersedes the flag-based draft below)

The exploratory design below gated the feature behind a global `BRANCH_RESOLUTION_ENABLED` env flag. **That was dropped.** A global boolean can't express a per-tenant fact (is *this* business multi-branch?), and it conflated rollout-safety with business capability. The as-built architecture instead makes branch selection a **domain policy whose behavior is derived purely from data**:

**`OrderLocationResolver`** (`src/modules/conversations/order-location.resolver.ts`) — one service, one precedence, consumed by the write path (checkout), the prompt path (turn.service), and the `set_branch` tool:

1. **ByChannel** — the inbound number is bound to a branch (`channel_accounts.location_id`). *Defined but dormant* today (tenants use one number); works with no code change when a tenant adopts per-branch numbers.
2. **BySole** — the tenant has exactly one active branch → resolved, no question.
3. **BySelection** — multi-branch, the customer already chose (durable `comms.conversations.selected_location_id`).
4. **NeedsSelection** — multi-branch, no valid choice yet → the bot asks *once*, in the business voice, via the `# SUCURSALES` prompt block; `set_branch` records the answer.
5. **None** — no active branch → order still written (NULL location), never blocked over a config gap.

Consequences vs. the draft: **no feature flag**; the scattered active-location `count` checks collapse into the resolver; a single-branch café can never reach the selection path (it resolves `BySole`); rollout is "apply the additive migration, deploy, done — all multi-branch tenants at once." The migration adds only `selected_location_id` (not `aliases[]`/`descriptor`, which are Phase 2). `pg_trgm`/embeddings remain Phase 2/3 refinements on top of this policy.

Everywhere the draft below says "gated behind `BRANCH_RESOLUTION_ENABLED`" or "count ≤ 1 check", read: "decided by `OrderLocationResolver`."

---

### Original exploratory design follows

---

## Executive summary

A WhatsApp business with more than one branch needs each order routed to the branch the customer actually wants — from free text like "chapule" (→ Chapultepec), a neighborhood, or a landmark. We cannot hand-maintain a synonym table, and we cannot let a fuzzy guess silently commit, because **a wrong branch means the wrong kitchen makes the food.**

The decision: add a **`resolve_branch` tool that validates, never invents.** The LLM does the fuzzy match in-prompt from an injected branch list (zero new matching infra); the tool only *validates* the pick against the tenant's real active branches and assigns a confidence band. **Only a deterministic exact match may auto-commit.** Every fuzzy/model pick is confirm-or-ask, and the resolved branch is **echoed back at order confirmation** ("recoges en Chapultepec, ¿correcto?") so a wrong route is always catchable before `createOrder` writes the ticket.

Three properties make this fit the existing system without fighting it:

1. **Single-branch tenants (2 of 3 today) are never asked and never pay for any of it** — a location-count gate short-circuits everything.
2. **No hardcoded customer messages** — the tool returns `needs_clarification` data; the LLM voices every question in the tenant's configured voice, exactly like the existing safety gates.
3. **Phase 1 ships with no embeddings.** `pg_trgm` (already installed) is a free Phase-2 second vote; `pgvector`/Voyage is an optional Phase-3 escape hatch.

---

## 1. Problem & current behavior

Today a WhatsApp order's branch is decided at *ingress*, not by the customer:

- `whatsapp.controller.ts:97-102` resolves the inbound business number to `{ tenantId, locationId }` via `resolveInboundTenant`, and enqueues `location_id` onto the turn (`:189`).
- `tenant-resolution.service.ts:53` returns `account.locationId` (the `ops.channel_accounts.location_id` bound to that number), or `null` on the DEFAULT_TENANT_ID fallback (`:66-70`).
- `turn.service.ts:170` sets `ctx.locationId = payload.location_id ?? null` — **re-derived from the inbound number on every single turn.**
- `checkout.tools.ts` writes `locationId: ctx.locationId ?? null` into `OrdersRepository.createOrder` (`:126` confirm, `:170` reorder).

So unless the WhatsApp number is itself branch-bound, **every order is written `location_id = NULL`**, and the customer has no way to choose a branch. For a single-branch tenant that is merely untidy (NULL instead of the one real location). For a multi-branch tenant it is unworkable.

**Already shipped (display side):** `kds.repository.ts` `listOrders` now NULL-escapes its branch filter (`AND (o.location_id = $N OR o.location_id IS NULL)`) so NULL-location orders surface on the dashboard regardless of the selected branch — matching the iPad `boardSnapshot`, which carries no location filter. That makes today's orders *visible*; this document is about making them *routed*.

---

## 2. Architectural facts that constrain the design

| Fact | Evidence | Consequence for the design |
|---|---|---|
| `ctx.locationId` is re-derived from ingress **every turn** | `turn.service.ts:170` | A customer's branch pick cannot live in `ctx.locationId` — it would be clobbered next turn. It needs a **durable column**. |
| Locations live in `core.locations`; columns are `id, tenant_id, slug, name, address, lat, lng, status, metadata, created_at, updated_at` — **no alias/descriptor/embedding/timezone** | `docs/migration/build/10_core.sql`; `12_ops.sql:22` | Matching metadata (aliases, descriptor, embedding) must be **added** to `core.locations`. Timezone stays tenant-level (`core.tenants.timezone`). |
| Composite `references core.locations (tenant_id, id) on delete set null` is the house pattern | `12_ops.sql:125` (`ops.orders.location_id`) | The durable conversation column uses the **same composite FK** → a cross-tenant branch id is structurally impossible, and deleting a branch nulls stale picks. |
| Tools register at exactly 3 seams | `tool-definitions.ts:8`; `tools.service.ts:33-87`; `conversations.module.ts:70-76` | `resolve_branch` = add schema + `case` + provider. No other wiring. |
| `needs_clarification` is the first-class "ask the customer" channel | `tool-loop.service.ts:961-977` | Disambiguation returns a `needs_clarification` string; the loop stores `resume_tool/resume_input` in `pending_clarification` and the LLM voices the question. **No hardcoded strings.** |
| Tool results pass through a whitelist (`compactToolObservation`) | `tool-loop.service.ts:61-89` | `success/match_type/message/needs_clarification/candidates` already survive → **no tool-loop edit needed.** |
| The turn budget is 4 tool calls | `turn.service.ts:32` (`MAX_TOOL_CALLS_PER_TURN`) | `resolve_branch` must be cheap / short-circuit; keep it one deterministic call. |
| `resolveLocationIdWorker(tenantId, hint)` already returns sole/oldest-active on the worker pool | `tenants.repository.ts:156-177` | The single-branch fallback and the NULL→oldest-active fix reuse existing code. |

---

## 3. Decision: `resolve_branch` validates, never invents

- The **LLM** reads an injected `# SUCURSALES` block (branch name + short descriptor) and maps the customer's free text — "chapule", "la de la Roma", "cerca del parque" — to a branch, calling `resolve_branch`. This is the fuzzy layer, and it needs **zero new matching infrastructure**.
- The **tool** does not trust the model's pick blindly. It runs a deterministic ladder (§4) on the worker (BYPASSRLS) pool with explicit `tenant_id` predicates, and returns a **confidence band**, never a bare commit.
- **Auto-commit is reserved for a deterministic exact match only.** Every model/fuzzy outcome is at most *confirm*.
- On auto/single, the tool persists the pick to `comms.conversations.selected_location_id` and still requires the **echo-back** at confirmation.

This keeps the model as the flexible front door and the database as the source of truth, and makes a silent wrong-branch commit structurally impossible.

---

## 4. The resolution ladder

Bands: **auto** (persist silently, still echo back) · **single** (sole branch) · **confirm** (one candidate, ask yes/no) · **ask** (ranked candidates, ask which) · **none** (offer all branches).

```text
GATE  (worker pool, first, always):
      count active core.locations WHERE tenant_id=$1 AND status='active'.
      <= 1  -> SINGLE short-circuit: no prompt block, no question,
               checkout uses sole/oldest-active. Ladder never runs.
      >= 2  -> run ladder. Entire ladder behind BRANCH_RESOLUTION_ENABLED (default false).

TIER 0  LLM in-context (fuzzy, zero infra):
      injected # SUCURSALES block; model maps free text/landmark -> a branch and
      calls resolve_branch. NEVER auto on its own.

TIER A  deterministic EXACT (the ONLY auto band):
      normalized exact hit on name / slug / alias -> match_type:auto, score 1.0, persist.
      A model-supplied location_ref is honored ONLY if: tenant-owned AND active
        AND in this conversation's offered candidate set AND agrees with latest text;
        otherwise demote to confirm.
      Multiple exact hits -> ask (never auto).

TIER B  pg_trgm second vote  [Phase 2, free, deterministic — never auto]:
      word_similarity(f_unaccent(query), search_text) over <= 15 rows.
        s1 >= 0.72 & margin >= 0.25 -> confirm
        s1 >= 0.72 & margin <  0.25 -> ask
        0.45 <= s1 < 0.72           -> ask
        s1 < 0.45                   -> none
      Cross-check: if the Tier-0/A pick disagrees with the trigram top-1, or top-2
        are within 0.15 of each other -> force ask.
      (Thresholds are on the word_similarity scale — NOT a cosine 0.60.)

TIER C  pgvector semantic  [Phase 3, optional, only on Tier B miss — never auto]:
      cosine = 1 - (descriptor_embedding <=> $::vector), <= 15 rows.
        top >= 0.62 & margin >= 0.10 -> confirm
        0.45 <= top < 0.62           -> ask
        < 0.45                       -> none
      No-op if VOYAGE_API_KEY is unset.

BAND -> ACTION:
      auto/single -> persist + MANDATORY echo-back at confirm
      confirm     -> single candidate + needs_clarification
      ask         -> ranked candidates + needs_clarification
      none/empty  -> all branches + needs_clarification
```

The safety invariant, stated once: **no fuzzy or model-derived outcome ever auto-commits.** Auto is deterministic-exact only; everything else is confirm-or-ask; and confirmation is always echoed back before the kitchen sees the ticket.

---

## 5. Data model changes (DRAFT DDL — not applied)

Additive and dormant; safe to apply to prod (`xbudknbimkgjjgohnjgp`) ahead of the flag flip. Extensions live in the `extensions` schema — qualify accordingly.

```sql
-- Phase 1: branch metadata + durable per-conversation selection
alter table core.locations
  add column aliases   text[] not null default '{}',   -- owner-curated nicknames: {'chapule','chapu'}
  add column descriptor text;                            -- one short line for the LLM prompt + future embedding

alter table comms.conversations
  add column selected_location_id uuid;

alter table comms.conversations
  add constraint conversations_selected_location_fk
  foreign key (tenant_id, selected_location_id)
  references core.locations (tenant_id, id) on delete set null;   -- mirrors ops.orders.location_id

-- Phase 2: free deterministic second vote (pg_trgm)
-- unaccent() is STABLE and is rejected in a generated column / index expr; wrap IMMUTABLE.
create function core.f_unaccent(text) returns text
  language sql immutable strict parallel safe
  as $$ select extensions.unaccent('extensions.unaccent', $1) $$;

alter table core.locations
  add column search_text text
  generated always as (
    lower(core.f_unaccent(name || ' ' || coalesce(array_to_string(aliases, ' '), '')))
  ) stored;

create index locations_search_text_trgm
  on core.locations using gin (search_text extensions.gin_trgm_ops);

-- Phase 3: optional semantic (pgvector) — mirrors ops.products.name_embedding
alter table core.locations
  add column descriptor_embedding       extensions.vector(1024),
  add column descriptor_embedding_model text;

create index locations_descriptor_embedding_hnsw
  on core.locations using hnsw (descriptor_embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);
```

Notes:

- Apply `f_unaccent` in **both** the generated column and the Tier-B query so Tier-A and Tier-B normalization agree (this closes a real accent-mismatch defect one of the source designs had).
- Consider a tenant-scoped uniqueness check on aliases so a data-entry slip (alias "centro" on the wrong branch) can't produce a false exact hit — see open decision §11.2.

---

## 6. Tool contract

Added to `TOOL_DEFINITIONS` (`tool-definitions.ts`), dispatched in `tools.service.ts` `execute()` to a new `BranchTools.resolve(input, ctx)` registered in `conversations.module.ts`.

Model-facing description (Spanish):

> "Resuelve a cuál sucursal se refiere el cliente, solo cuando el negocio tiene más de una sucursal activa. Úsala cuando el cliente mencione una sucursal, zona, colonia o punto de referencia, o antes de confirmar un pedido si aún no se ha elegido sucursal."

```jsonc
// input_schema
{
  "query":        "string  // texto del cliente que refiere la sucursal/zona/colonia",
  "location_ref": "string? // opcional: name/slug de una sucursal de la lista SUCURSALES que el cliente confirmó"
}
// required: []

// return (only whitelisted compactToolObservation keys — no tool-loop edit needed)
{
  "success": true,
  "match_type": "auto | single | confirm | ask | none",
  "candidates": [ { "location_id": "uuid", "name": "…", "slug": "…", "score": 0.0, "tier": "A|B|C" } ], // ranked, <= 6
  "message": "internal hint naming the resolved/likely branch",
  "needs_clarification": "compact topic hint, e.g. 'de cuál sucursal (Roma / Condesa)'"   // present for confirm/ask/none
}
```

Behavior:

- Runs entirely on the **worker (BYPASSRLS) pool** with explicit `tenant_id` predicates — the WhatsApp path is unauthenticated, so it cannot use the RLS app pool.
- **Never throws** (uses the tool-error helpers).
- **Neutral w.r.t. `ToolOutcomeState`** — like `search_menu`, it does not set `orderConfirmed`/`cartUpdated`/etc., so no `applyToolOutcome`/`deriveNextConversationState` branch is needed.
- A model-supplied `location_ref` is validated for **tenancy AND membership in the offered candidate set AND agreement with the latest text** before it is honored. The model is never trusted to carry a bare id.

---

## 7. Checkout gate & mandatory echo-back

Enforcement point: `checkout.tools.ts` `confirmOrder` (`:126`) and `reorderLastOrder` (`:170`) — replace `locationId: ctx.locationId ?? null` with `locationId: await this.resolveOrderLocation(ctx, conv)` **before** `OrdersRepository.createOrder`.

`resolveOrderLocation` (worker pool, deterministic per turn, no LLM):

1. If `conv.selectedLocationId` is set, re-validates active, **and has been echo-back-confirmed** → use it.
2. Else if the matched `ops.channel_accounts.location_id` is **non-NULL** (an explicitly branch-*locked* number) → the channel binding **wins** over a fuzzy in-conversation mention. (Precedence is inverted vs. the naive design: a fuzzy mention must not override a number that was deliberately locked to a branch. An *explicit echo-back-confirmed* pick may still override — see open decision §11.1.)
3. Else count active locations:
   - `<= 1` → `resolveLocationIdWorker(tenantId, ctx.locationId)` (sole/oldest-active) — **fixes the NULL-vs-oldest-active asymmetry** where hours already resolved to oldest-active but the order wrote NULL.
   - `>= 2` with no valid confirmed selection → **DO NOT WRITE.** Return `needs_clarification` ("elegir sucursal antes de confirmar") to force the branch question via `pendingClarification`.

**Mandatory echo-back:** even when a selection exists, the resolved branch *name* is injected as data into the `awaiting_confirmation` summary + `formatOrderCustomerReply`, plus an orchestration rule ("confirma la sucursal `<X>` antes de cerrar el pedido"), so the model must name the branch back to the customer. A wrong route is catchable **before** `createOrder`.

Correctness details:

- Deterministic per turn ⇒ safe under `createOrder`'s `(tenant_id, source_transaction_id = conversaflow:turn:<id>)` idempotency (a retry re-writes the identical `location_id`).
- `reorderLastOrder` does **not** re-load the conversation the way `confirmOrder` does (`:106`) — it must issue its own fresh worker-pool read of `selected_location_id`, pre-seed from the prior order's `location_id` with the same echo-back, and re-validate active.
- Gated behind `BRANCH_RESOLUTION_ENABLED`; when off, collapses to step 3 (oldest-active) and never asks.

---

## 8. Single-branch guarantee (today's reality)

Tenants with 0 or 1 active `core.locations` are **never asked and never pay for the ladder** (per MEMORY, 2 of 3 tenants):

- The GATE counts active locations first, on the worker pool, in both the prompt-build path and `resolveOrderLocation`.
- When count `<= 1`, `turn.service.ts` skips injecting the `# SUCURSALES` block and the branch orchestration rule → the model gets no cue to call `resolve_branch`.
- If `resolve_branch` is somehow called, it short-circuits to `match_type:'single'` (sole/oldest-active, no `needs_clarification`).
- The only behavioral change for single-branch tenants is the strict **NULL → oldest-active** write fix (Phase 0), so their orders carry the one real branch instead of NULL.
- `BRANCH_RESOLUTION_ENABLED` defaults **false**, so even the multi-branch machinery is dormant until explicitly enabled.

---

## 9. Disambiguation UX (voice invariant)

Honors the no-hardcoded-user-messages rule exactly like the existing safety gates:

- `resolve_branch` and the checkout gate **never emit a customer-facing string.** For confirm/ask/none the tool returns a `needs_clarification` **string** (a compact topic hint). The loop (`tool-loop.service.ts:961-977`) converts it to `{ needs_clarification, ask_customer_about, guidance:'…en la voz del negocio.' }` and stores `resume_tool/resume_input` in `pending_clarification` (persisted via `commitTurnReply`).
- Branch **names ride as DATA** in `candidates[]` + the internal `message` hint. The LLM composes the "yes/no" (confirm) or enumerated "which one" (ask) in the tenant's configured voice (`resolveVoiceConfig`) — the same way it already voices menu-search candidates.
- **Positional "#N" refs are deliberately not offered** — the prompt orders branches by `created_at` while the customer hears a voiced/regrouped list, so "la segunda" would index the wrong branch. Selection is by name/slug/alias only.
- The one behavioral addition is the mandatory echo-back (§7): a silent auto becomes a catchable one.

---

## 10. Phasing

- **Phase 0 — ship first (single-branch only, zero schema, no flag).** In `confirmOrder`/`reorderLastOrder`, when active-location count `<= 1`, call `resolveLocationIdWorker(tenantId, ctx.locationId)` so sole/channel-bound orders stop being written `location_id = NULL`. ⚠️ **Scoped to count `<= 1` only** — do NOT apply oldest-active to multi-branch tenants yet, or every unresolved multi-branch order silently routes to branch #1. Immediate correctness win for the 2/3 single-location tenants; no tool, no LLM, no prompt. Pairs with the display-side `listOrders` NULL-escape already shipped.
- **Phase 1 — branch resolution core (no embeddings, shippable).** Migration adds `core.locations.aliases[] + descriptor` and `comms.conversations.selected_location_id` + composite FK; thread `selectedLocationId` through `ConversationRecord` + the load query + a `setSelectedLocation` worker UPDATE. Inject the `# SUCURSALES` block (count `>= 2` only) + one orchestration rule. Build `BranchTools` + `resolve_branch` with **Tier 0 (LLM) + Tier A (exact/validated-ref) only.** Wire the 3 registration points + the count-gated checkout resolver + mandatory echo-back. Owner seeds `aliases[]` for the one multi-branch tenant. Behind `BRANCH_RESOLUTION_ENABLED`.
- **Phase 2 — free deterministic second vote.** Add the IMMUTABLE `f_unaccent` wrapper + generated `search_text` + GIN `gin_trgm_ops` index; enable Tier B `word_similarity` as an ambiguity cross-check (disagreement or tie → force ask). Add the dashboard per-location branch-profile editor (aliases chips + descriptor textarea) reusing the Hours screen's `?locationId` + `SELECTED_LOCATION_KEY` plumbing, membership-guarded on the RLS app pool. No new external calls.
- **Phase 3 — optional semantic (only if in-prompt picking degrades).** Migration adds `descriptor_embedding vector(1024)` + HNSW index; add a `location.embed` enrichment job (`voyage-4-lite`, `input_type='document'`) + a one-off manual backfill enqueue (no auto cron exists); enable Tier C. No-op if `VOYAGE_API_KEY` is unset.
- **Phase 4 — polish (out of current scope).** `maybeForceTool` heuristic to re-fire `resolve_branch` on a mid-conversation branch-change ("mejor a Polanco"); a resolution-outcome audit log (query/tier/chosen/band) for threshold recalibration; a `MAX_PROMPT_BRANCHES` degrade-and-flag path.

---

## 11. Open decisions (owner)

1. **Locked-number precedence.** For a WhatsApp number bound to a specific branch (`ops.channel_accounts.location_id` non-null): this design lets an *explicit echo-back-confirmed* pick override the lock, but a *fuzzy* mention cannot. Confirm this, or decide a locked number is immutable regardless of what the customer says.
2. **Alias curation & disjointness.** Who curates `aliases[]`/`descriptor` per branch, and do we enforce cross-branch alias uniqueness (tenant-scoped) so an owner data-entry slip can't create a false exact hit?
3. **pg_trgm in Phase 2, or stay LLM-exact-only?** Recommendation: ship it — `pg_trgm` is already live in the `extensions` schema, the row set is `<= 15`, and it is the cheapest ambiguity defense.
4. **Phase 0 scope confirmation.** Ship the NULL→oldest-active fix for single-branch tenants only (recommended). If wanted for all tenants, it must ship *after* Phase 1's gate exists.
5. **`MAX_PROMPT_BRANCHES` cap** value and above-cap behavior (degrade to ask-neighborhood + exact-match, flag the tenant for Tier C).
6. **Migration timing.** The Phase 1 columns are additive/dormant and safe to apply to prod ahead of the flag flip (owner-gated Supabase CLI apply).

---

## 12. Files to touch (Phase 1 unless noted)

```text
apps/umi-api/src/modules/conversations/tools/tool-definitions.ts     # + resolve_branch schema
apps/umi-api/src/modules/conversations/tools.service.ts              # + case 'resolve_branch'
apps/umi-api/src/modules/conversations/conversations.module.ts       # + BranchTools provider
apps/umi-api/src/modules/conversations/tools/branch.tools.ts         # NEW: BranchTools.resolve + ladder
apps/umi-api/src/modules/conversations/tools/checkout.tools.ts       # resolveOrderLocation + echo-back
apps/umi-api/src/modules/conversations/turn.service.ts               # count gate -> inject # SUCURSALES block
apps/umi-api/src/modules/conversations/prompts.ts                    # # SUCURSALES block + orchestration rule
apps/umi-api/src/modules/conversations/conversation.types.ts         # selectedLocationId: string | null
apps/umi-api/src/modules/conversations/conversations.repository.ts    # project + setSelectedLocation (worker)
apps/umi-api/src/modules/tenants/tenants.repository.ts               # reuse resolveLocationIdWorker / active-count
apps/umi-api/src/modules/conversations/orders.repository.ts          # verify location_id bind (no change expected)
docs/migration/2026-07-02-branch-resolution.sql                      # NEW: §5 DDL (Phase 1 / 2 / 3 blocks)
apps/umi-api/src/jobs/enrichment.processor.ts                        # Phase 3: location.embed job
apps/umi-dashboard/src/screens/settings.jsx                          # Phase 2: per-location branch-profile editor
apps/umi-dashboard/src/data.jsx                                      # Phase 2: branch-profile fetch/save (?locationId)
```

Add a guard test asserting `commitTurnReply` never writes `selected_location_id` (it must write only its existing `state/pending_clarification/summary/draft_cart` columns, or it would clobber a mid-turn pick — a fragile invariant worth pinning).

---

## 13. Rejected alternatives

- **Silent-auto from a trigram/cosine threshold (the naive "ladder" design).** Rejected for its *default posture*: auto-committing from a fuzzy score silently cooks the wrong kitchen for a mis-anchored query ("cerca de Polanco, aquí en Anzures" → auto Polanco). We keep the skeleton (durable column, composite FK, checkout gate), discard the silent-auto.
- **Pure LLM slot-filling with no validation ladder.** Rejected because validating *referential* integrity (is this a real active branch?) is not validating *intent* (is it the branch the customer meant?); a valid-but-wrong id passes, persists, and writes with no echo-back. We keep its cheap in-prompt matching, add the intent defenses (echo-back, ambiguity detection).
- **Embeddings in Phase 1.** Rejected as premature — in-prompt LLM matching over `<= 15` branches plus a free `pg_trgm` second vote covers the one multi-branch tenant with no Voyage/HNSW cost. Deferred to Phase 3, and only if in-prompt picking measurably degrades.
- **Positional "#N" branch refs.** Rejected — the prompt orders by `created_at` while the customer hears a voiced/regrouped list, so "la segunda" indexes a different branch. Name/slug/alias only.
