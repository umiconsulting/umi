# Customers screen redesign — research

Status: research complete · 2026-09-08 · branch `chore/build-v3-checkpoint`
Companion: [`customers-redesign-plan.md`](./customers-redesign-plan.md)

This document records the research behind the Customers screen redesign: how the
market leaders build the surface, what Umi has today, the target architecture,
and the fastest tech stack to reach it. Speed and optimization are the guiding
constraint.

---

## 1. Competitor research — how Toast, Square, Lightspeed do it

All three use the same shape: a searchable **list → an individual profile →
sub-tabs**. None is a single page. The depth is mostly transaction and
marketing data. Only Square has a real two-way message inbox, and even Square
keeps it on a separate surface, not inside the profile.

| | Toast (Guestbook / Guest CRM) | Square (Customer Directory) | Lightspeed (Restaurant K / Retail X) |
|---|---|---|---|
| Surface | Guests → Guestbook (web only) | Customers → Directory | Customers (Back Office) |
| Structure | List → profile → 6 modules | List → profile → sections | List → profile → tabs |
| Profile tabs | Overview, Booking, Feedback, Loyalty, Marketing, Details | Contact, Activity, Loyalty, Notes, Files, Appointments, Cards on file, Groups | Retail: Store credit, Account, Loyalty + Sales history. Restaurant: contact + notes (loyalty/gift separate) |
| Value metrics | Lifetime spend, avg spend, avg tip, channel mix, top items, last order | Visit frequency, spend, purchase behaviour | Sales history, balances |
| Chat / thread | **No** in CRM. Two-way SMS only in Toast Tables (bookings), booking-topic only | **Yes** — Square Messages, unified 2-way inbox (SMS + email) + AI "Square Assistant". Separate surface; not confirmed inside profile | **No.** Broadcast marketing only; business-level "SMS history" log. Two-way only via third-party (Ikeono) or the separate DMS product |
| Identity / merge | Auto-created from orders/loyalty; select-two merge | Instant Profiles from card; duplicate flag + merge | Phone-as-"customer code" lookup + manual merge |
| Custom fields | Tags + notes | Custom fields + notes + files | Retail groups; custom fields unverified |

**The opening for Umi.** Restaurant CRM software does not do conversation. The
customer record and the conversation are two separate places for every leader.
Because Umi's WhatsApp channel is native and two-way, Umi can put the **full
transcript inside the customer profile** — which none of the three clearly does.

Key sources (full list at the end): Toast Guestbook help
(`support.toasttab.com`), Square Customer Directory + Messages docs
(`squareup.com/help`, `developer.squareup.com`), Lightspeed K-Series / X-Series
support (`*-support.lightspeedhq.com`).

---

## 2. Current state — what Umi has today

**Frontend** (`apps/umi-dashboard/src/screens/customers.jsx`, 985 lines): already
a two-pane master/detail.
- Left: customer list. Search + filters (Todos, WhatsApp, Lealtad, Notas,
  Revisión). Rows show avatar, name, phone, last-touch, product icons, spend,
  visits. Pagination.
- Right: profile with tabs — Resumen (3 metrics + timeline), WhatsApp, Pedidos,
  Lealtad (add-seals / top-up / scan), Notas, Datos (identity + merge candidates
  + data-quality).
- Data via bespoke hooks in `data.jsx` (`useCustomersData`, `useCustomerDetail`,
  `useCustomerInsights`, `useConversationsData`). No caching/query library.

**The gap.** The WhatsApp tab (and the standalone `conversations.jsx`) show only
conversation **metadata** — a summary, a message count, a status badge. There is
**no message-thread / bubble view**. That transcript is the main new build.

**Backend** (`apps/umi-api/src/modules/customers/`): already the right shape — a
**Customer 360 read/composition layer** gated on the `dashboard` product.
- `CustomersController`: `GET customers` (list rollup), `GET customers/:id`
  (composite detail), and per-facet endpoints `/timeline`, `/conversations`,
  `/orders`, `/cash`, `/identity`, plus `/insights/customer-platform`.
- `CustomersService.detail()` calls `list()` for one row, then
  `Promise.all([timeline, conversations, orders, cash, identity])`.
- The list uses a lateral-join rollup; it reads data owned by other contexts
  (conversations, orders, cash/loyalty, memory) unified by the identity spine
  `platform.contacts` / `contact_identities` (see the
  `customer-identity-resolution` skill).

**The single biggest performance limiter** (confirmed in
`customers.repository.ts`): the list `ORDER BY` is a computed `last_touch_at`
(a `MAX` across six lateral-derived timestamps). No index can serve that sort
and no cursor can keyset it, so the cost scales with **total contacts** on every
page load — plus a second full query re-runs the whole fan-out just to get
`count(*)`.

---

## 3. Target architecture (abstract)

**The one idea.** The Customers screen does not own data. It is a **view** — a
read-optimized composition over data other contexts own, unified by one identity
spine. It is a query/composition problem, not a storage problem. Every
performance decision follows from that.

Principles:
1. **Identity is the spine.** One resolved identity (`platform.contacts` +
   `contact_identities`) is the join key. Nothing merges silently.
2. **Contexts own; Customers composes.** WhatsApp, orders, loyalty/cash, memory
   own their truth. Customers only reads and joins. Coupling stays one-way.
3. **Two read shapes.** List = wide and shallow (one rolled-up row per
   customer). Profile = narrow and deep.
4. **Profile = shell + lazily-hydrated facets.** The shell loads instantly;
   heavy or seldom-opened facets hydrate per tab. Never pay for a tab nobody
   opened. (The per-facet endpoints already exist.)
5. **Two data temperatures.** Most facets are snapshots (cacheable). Two are
   live streams — the WhatsApp transcript and the triage queue.
6. **The conversation is a first-class aggregate, not a metric.** Promote the
   message thread to a paginated, streaming sub-view; add a global triage queue.
   This is the only genuinely new seam.
7. **Read/write separation.** Writes (loyalty seals, top-up, scan, future
   "send reply / take over from the AI") are idempotent commands to the owning
   context; they invalidate or append to the read views.
8. **Performance is a budget by frequency.** Fast path = list + shell (must feel
   instant). Slow path = deep facets (may be lazy). Live path = transcript +
   triage (stream and append, never poll).

Layers:
```
Client read model   list (virtualized) · profile shell + lazy facets · transcript (virtualized + streamed)
Delivery            snapshot API (req/resp)            realtime channel (transcript, triage)
Composition (BFF)   list rollup · profile shell · per-facet reads · caching · fan-out   ← CustomersService
Context read ports  conversations · orders · cash/loyalty · memory
Identity spine      platform.contacts / contact_identities  (join key + merge/quality)
```

---

## 4. Tech stack — the fastest path (Phase B research)

The stack is ~70% reuse of what Umi already has, plus two high-leverage backend
changes.

| Layer | Pick | Why |
|---|---|---|
| Identity spine | `platform.contacts` / `contact_identities` (reuse) | One join key. |
| List read | On-demand lateral rollup **+ stored `last_activity_at` + keyset cursor** | Removes the only cost that scales with total contacts. |
| Profile read | **Narrow shell query + lazy per-facet endpoints** (already exist) | TTFB = fastest query, not slowest of six. |
| Search | **`pg_trgm` GIN** on name/email/normalized-phone; btree for exact | Serves `contains`; FTS stays for message/memory content. |
| Snapshot delivery | REST under RLS + short-TTL `private` cache | Cache list + shell for seconds; `no-store` on money/live facets. |
| Live delivery | **Existing Socket.IO dashboard gateway** + a new per-conversation room | "Socket is a wake-up, not a delivery gate" — nudge over socket, payload over RLS REST. |
| Change signal | App-publish at write → in-process bus; add `LISTEN/NOTIFY` at multi-instance | Skip logical replication; REST-under-RLS stays the truth. |
| Client data | **TanStack Query v5** (replace bespoke hooks) | Dedup, stale-while-revalidate, hover-prefetch, infinite, optimistic (~13 kB). |
| List render | **`@tanstack/react-virtual`** (headless, ~3 kB) | Constant DOM; pairs with `useInfiniteQuery`. |
| Transcript render | **`react-virtuoso`** free `Virtuoso` (code-split) | Bottom-anchoring + prepend-with-scroll-lock are free. Avoid the paid Message List. |
| Perceived speed | `keepPreviousData` + hover/route prefetch + `useTransition` | Removes blank states; clicks feel instant. |

### Backend detail
- **List:** move the default sort key to a stored `last_activity_at` on
  `merchant.customer` (written by the owning modules or a trigger). Keyset-page
  on `(last_activity_at, id)` (the cursor pattern already exists in
  `pos-customer-value`). Drop the second `count(*)`; use `limit + 1`. Add
  `(merchant_id, customer_id)` indexes on every child table the laterals touch,
  and `(merchant_id, last_activity_at DESC, id DESC)` for the sort.
- **Promote to a maintained summary table** only when a merchant passes ~10–20k
  contacts *and* owners sort/filter by a rolled-up metric (value/visits). A
  materialized view is the middle option (minutes of staleness OK). Not needed
  yet.
- **Profile shell:** write a dedicated narrow shell query — do **not** reuse the
  10-lateral list query for one row as `detail()` does today. Each facet is one
  set-based, keyset-paginated query.
- **Search:** `pg_trgm` GIN for name/email/phone `contains`; btree for exact
  email/phone. Normalize the phone query with the same normalizer as the stored
  value. Not full-text (reserve tsvector for message/memory content).
- **RLS:** wrap the resolver call as `merchant_id = (select
  umi.current_merchant())` for a per-statement InitPlan and index use; keep the
  `merchant_id` index on every table; policies `TO authenticated`.

### Realtime detail
- Reuse the Socket.IO dashboard gateway. Triage nudges on the per-merchant room,
  then REST refetch. Transcript nudges on a new per-conversation room, then REST
  refetch of the tail.
- Keyset pagination on `(created_at, id)` DESC for the thread; index
  `(conversation_id, created_at, id)`.
- At-least-once push + dedup by message id + REST catch-up on every reconnect.
  REST under RLS is the source of truth; the push is only "look again".

### Client detail
- TanStack Query v5. Shell from `placeholderData` reading the list query's cached
  row; per-tab `useQuery` keyed `['customer', id, facet]`; prefetch the
  likely-next tab and the row on hover; `keepPreviousData` on the paginated list.
- `@tanstack/react-virtual` for the list; `react-virtuoso` `Virtuoso` for the
  transcript (`followOutput` + `firstItemIndex` prepend), code-split into the tab.
- All client-side, static-hosting-safe for Cloudflare Pages.

---

## 5. Verified facts (2026-09-08)

1. **`pg_trgm` is installed.** Declared in build-v3 (`00_foundation.sql:54`,
   in the `extensions` schema), present in prod + the Supabase schema dumps,
   already used by `merchants.repository.ts`. The DB `search_path` is
   `"$user", public, extensions`, so unqualified `gin_trgm_ops` resolves — but
   schema-qualify it in DDL (`extensions.gin_trgm_ops`) to be safe.
2. **The RLS resolver is `STABLE`** — `umi.current_merchant()` is `language sql
   stable` (`00_foundation.sql:23`, `90_rls.sql:12`). But all 44 policy
   references use the **bare** form `merchant_id = umi.current_merchant()`; zero
   use `(select …)`. Wrapping in `(select …)` gives a per-statement InitPlan and
   lets the `merchant_id` index be used. Pure perf rewrite; same rows, same
   security. Queued as a build task.
3. **The API is not behind Cloudflare's proxy.** `api.umiconsulting.co` responds
   with `via: 1.1 Caddy`, HTTP/2 + h3, no `cf-ray` — a self-hosted Caddy origin
   reached directly. So Cloudflare's WebSocket idle-timeout / 524 / SSE-buffering
   caveats do **not** apply to the realtime socket. (Re-check if the API is ever
   moved behind Cloudflare's proxy.)

Runtime re-confirm (any environment):
```sql
select extname, extnamespace::regnamespace from pg_extension where extname='pg_trgm';
select proname, provolatile from pg_proc where proname='current_merchant';   -- expect s
```

---

## 6. Sources

Competitor (all official):
- Toast Guestbook — https://support.toasttab.com/en/article/Access-Your-Guest-Data-with-the-Guest-Report
- Toast Tables 2-way SMS — https://support.toasttab.com/en/article/How-do-I-turn-on-Two-Way-SMS
- Toast SMS Marketing (broadcast) — https://support.toasttab.com/en/article/SMS-Marketing-FAQ
- Square Customer Directory — https://squareup.com/help/us/en/article/6217-get-started-with-your-customer-directory
- Square Messages — https://squareup.com/us/en/messages · https://squareup.com/help/us/en/article/8415-reply-to-customers-with-square-messages
- Square Customers API — https://developer.squareup.com/docs/customers-api/what-it-does
- Lightspeed K-Series customers — https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089353-About-customers
- Lightspeed X-Series customers — https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534063246235-Managing-customers-in-Retail-POS-X-Series
- Lightspeed SMS (broadcast) — https://retail-support.lightspeedhq.com/hc/en-us/articles/360011038433-SMS-Marketing

Tech (primary):
- Postgres LIMIT/OFFSET — https://www.postgresql.org/docs/current/queries-limit.html · keyset — https://use-the-index-luke.com/no-offset
- Postgres pg_trgm — https://www.postgresql.org/docs/current/pgtrgm.html
- Postgres Materialized Views — https://www.postgresql.org/docs/current/rules-materializedviews.html
- Postgres Row Security — https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Supabase RLS performance — https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Postgres NOTIFY/LISTEN — https://www.postgresql.org/docs/current/sql-notify.html
- Cloudflare WebSockets — https://developers.cloudflare.com/network/websockets/
- NestJS Gateways — https://docs.nestjs.com/websockets/gateways · SSE — https://docs.nestjs.com/techniques/server-sent-events
- TanStack Query — https://tanstack.com/query/latest/docs/framework/react/overview · placeholderData — https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data
- TanStack Virtual — https://tanstack.com/virtual/latest/docs/introduction
- react-virtuoso — https://virtuoso.dev/ · stick-to-bottom — https://virtuoso.dev/stick-to-bottom/
