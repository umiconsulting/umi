# Customers screen redesign — implementation plan

Status: ready to build · 2026-09-08 · branch `chore/build-v3-checkpoint`
Companion: [`customers-redesign-research.md`](./customers-redesign-research.md)

Build order is safest-and-highest-leverage first, then toward the differentiator
(the embedded WhatsApp transcript). Each phase is independently shippable and
testable. Exact table/column/endpoint names marked _(confirm)_ are pinned in
Phase 0 with CodeGraph before code changes.

Guiding constraint: **speed**. Do not add storage the read model does not need;
reuse the existing realtime gateway and keyset-cursor helpers.

---

## Goals / non-goals

**Goals**

- Two-pane list → profile that stays fast at scale.
- Embed the real WhatsApp **transcript** in the profile (bubbles, paginated,
  live) + a global **triage** queue (AI runs chats, owner supervises).
- Relationship-first Overview (last WhatsApp touch, memory facts) then value
  (spend, visits, recency) then loyalty.

**Non-goals (now)**

- Manual outbound marketing campaigns / segments UI.
- A maintained summary table or materialized view (only if a merchant passes
  ~10–20k contacts and sorts by a rolled-up metric).
- Feedback/surveys module.

---

## Phase 0 — Dig & confirm (CodeGraph, no code changes)

Use CodeGraph (`explore`, `node`, `callers`, `impact`) — not raw grep first.

Confirm and record:

- WhatsApp **message** + **conversation** tables: names, columns, FKs to
  customer/contact, ordering column(s) for keyset _(confirm)_.
- RLS policies on those tables (merchant scope, any device/restrictive policy).
- The realtime gateway public API: how to publish a nudge, room-name contract in
  `packages/contract/.../realtime-channels.ts`, and the in-process event bus
  (`DashboardRealtimeEvents`) _(confirm)_.
- `merchant.customer` columns + where `last_touch_at` inputs come from (which
  writers touch orders/conversations/cash) — to decide trigger vs writer for
  `last_activity_at`.
- The `pos-customer-value` keyset cursor helpers to reuse
  (`encodeHistoryCursor` / `decodeHistoryCursor`).
- The build-v3 migration + test gates that guard schema/RLS changes.

Output: a short "confirmed seams" note appended to the research doc.

---

## Phase 1 — Backend performance foundation (invisible, safe)

1a. **Stored sort key.** Add `merchant.customer.last_activity_at timestamptz`.
Backfill from the current six timestamp sources. Keep current: prefer the
domain writers (order/conversation/cash) to bump it; a trigger is the
fallback. Migration under `docs/migration/build-v3/` _(confirm file
numbering)_.

1b. **List query rewrite** (`customers.repository.ts`): `ORDER BY
   (last_activity_at DESC, id DESC)`, keyset `WHERE (last_activity_at, id) <
   cursor`, `limit + 1` for "has next" — **remove the second `count(*)`**. Keep
the laterals for the row body (page rows only).

1c. **Indexes.** `(merchant_id, last_activity_at DESC, id DESC)` on
`merchant.customer`; `(merchant_id, customer_id)` on every child table the
laterals touch; `pg_trgm` GIN (`extensions.gin_trgm_ops`) on name, email,
normalized phone.

1d. **Search** (`customers.repository.ts` / `.service.ts`): trigram `contains`
for name/email/phone; btree exact for email/phone; normalize the phone query
input with the same normalizer as stored. Enforce a min query length.

1e. **RLS wrap.** Rewrite `merchant_id = umi.current_merchant()` →
`merchant_id = (select umi.current_merchant())` across `merchant`/`umi`/
`runtime` policies (`90_rls.sql`). Keep the literal-string RLS gate tests
green.

Acceptance: list returns identical rows in the same order; keyset paging has no
duplicates/gaps under inserts; `EXPLAIN (ANALYZE, BUFFERS)` shows the sort index
used and no per-row resolver calls; search matches on partial phone/name.

---

## Phase 2 — Message-thread read + triage (new seam, backend)

2a. **Transcript endpoint.** `GET
   customers/:contactId/conversations/:conversationId/messages` _(confirm shape)_
— keyset on `(created_at, id) DESC`, latest N, `before` cursor for older.
Returns bubbles (sender, body, timestamp, media ref, status). RLS-scoped.
New index `(conversation_id, created_at, id)`.

2b. **Triage endpoint.** `GET insights/triage` (or reuse conversations list with
a `needs_attention` filter) — conversations flagged for human attention (AI
escalation / status). Short list; keyset-paged.

Acceptance: thread loads latest fast; scroll-up returns older with a stable
cursor; triage returns only attention items for the merchant; both pass RLS
tests.

---

## Phase 3 — Realtime rooms (reuse the gateway)

3a. **Per-conversation room** in `realtime-channels.ts`:
`conversation:<merchantId>:<conversationId>` _(confirm naming convention)_.
Publish a **nudge** (id only) from the service that persists a new WhatsApp
message, after commit, into the in-process bus; the gateway fans it to the
room.

3b. **Triage nudge** on the existing per-merchant dashboard room when a
conversation enters/leaves "needs attention".

Rule kept: the socket is a wake-up, not a delivery gate. Payload always over
RLS REST. Add `LISTEN/NOTIFY` only when a second API instance appears.

Acceptance: a new message nudges the open transcript; a new escalation nudges the
triage queue; a dropped socket recovers via REST catch-up.

---

## Phase 4 — Frontend data layer (TanStack Query)

4a. Add `@tanstack/react-query` + `QueryClient` provider. Re-implement the
bespoke `data.jsx` hooks as thin wrappers over `useQuery`/`useInfiniteQuery`/
`useMutation` so call sites barely change.

4b. **List**: `useInfiniteQuery` on the keyset endpoint +
`@tanstack/react-virtual`; `keepPreviousData`; debounced + cached search
(`useDeferredValue`); **prefetch the row's profile on hover**.

4c. **Profile**: shell from `placeholderData` reading the list query's cached
row; per-tab `useQuery` keyed `['customer', id, facet]`, mounted on tab open;
prefetch the likely-next tab; optimistic updates for loyalty credit/top-up.

Acceptance: navigating list↔profile never flashes blank; a hovered row opens
instantly; unopened tabs fetch nothing.

---

## Phase 5 — Frontend transcript + triage + Overview

5a. **Transcript** in the WhatsApp tab: `react-virtuoso` `Virtuoso`
(code-split), `followOutput` for bottom-anchor, `firstItemIndex` decrement on
prepend for scroll-lock; live append via the socket nudge → REST tail refetch
→ dedup by message id.

5b. **Triage queue**: reframe `conversations.jsx` as the global attention queue
(not a manual inbox); row → opens the customer profile on the WhatsApp tab.

5c. **Overview enrichment**: relationship metrics first (last WhatsApp touch,
memory facts, sentiment/state), then value (lifetime spend, visits,
**recency**), then loyalty (wallet, seals, pending rewards).

5d. **i18n**: all new strings through Lingui (es source + en catalog); run
extract/compile; keep the lint gate green. See [[dashboard-i18n-lingui]].

Acceptance: transcript stays pinned to newest, holds scroll on prepend, appends
live without dupes; triage opens the right customer; Overview leads with
relationship data; dark mode + a11y pass.

---

## Phase 6 — Validate & harden

- `EXPLAIN (ANALYZE, BUFFERS)` on the list + shell + thread against a large
  merchant; confirm index-only / index range scans.
- Reconnect/dedup test for the transcript; RLS tests for every new endpoint.
- Bundle check (code-split transcript + virtuoso); Cloudflare Pages build green.
- Keep the repo gates green (Writing standard, adapter-sync-check, RLS
  literal-string tests, contract version bump if channels change).

---

## Risks / watch-items

- **`last_activity_at` correctness**: the backfill and the keep-updated path must
  match the old `last_touch_at` semantics — guard with a test.
- **RLS wrap regressions**: apply mechanically; rely on the existing RLS gate
  tests; do not change policy logic, only the `(select …)` wrapper.
- **Contract version**: new realtime channel names bump the contract version
  (mirror the pattern in recent commits).
- **build-v3 branch**: build against the build-v3 schema; the dashboard prod
  build still comes from `main` via CI (see [[cloudflare-frontend-migration]]),
  so keep changes on this branch until build-v3 ships.
