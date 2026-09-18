# POS channel attribution — the upstream fix for the Reportes channel wedge

_ADR · build-v3 · `merchant` schema · order + POS-checkout cluster · 2026-09-13_

**Status:** ACCEPTED (2026-09-13) — Approach **B** (link, don't merge); owner-facing channel
view **held** until the Flutter incoming-orders surface ships (no interim `walk_in`-only view).
**Extends:** [`ORDER_MODEL.md`](/home/jc/umi/docs/migration/build-v3/ORDER_MODEL.md) §4 (money) · §6 (ecosystem fit)
**Drives:** [`reportes-ia-plan.md`](/home/jc/umi/apps/umi-dashboard/docs/design/reportes-ia-plan.md) §3 (channel wedge) ·
[`reportes-build-gaps.md`](/home/jc/umi/apps/umi-dashboard/docs/design/reportes-build-gaps.md) "Channel split"

---

## 1. Context — what the wedge assumed, and what is true

The Reportes plan (decision #3) makes the **channel wedge** — sales split by
`POS · WhatsApp · Delivery` — the strategic differentiator, delivered through the AI
narrative. The build-gap map scoped it as a **reporting-layer** job: "a unified revenue
aggregate grouped by channel … `UNION ALL` POS (`pos_committed_sale` +
`receipt_snapshot.grand_total`) and non-POS (`customer_order` + `order_total`)."

A CodeGraph + data dig (rehearsal DB, Kalala `1860305f-…`) shows that scoping is wrong.

**Data reality (Kalala):**

| fact                            | POS       | WhatsApp |
| ------------------------------- | --------- | -------- |
| orders                          | 15        | 53       |
| committed sales                 | 10        | **0**    |
| payments captured               | 10 ($787) | **0**    |
| channel of every committed sale | `pos`     | —        |

**Code reality (structural, not a test-data quirk):**

- `pos-checkout.repository.ts:1098` — every checkout calls
  `writeOrder({ source: 'pos', externalRef: 'pos-cart:<cartId>' })`. The POS **mints a
  fresh `source='pos'` order** for the cart and writes `payment`, `receipt_snapshot` and
  `pos_committed_sale` against it. It never references the WhatsApp order it may fulfil,
  and `pos_committed_sale` has **no channel/origin column**.
- `pos_cart` (`20_merchant.sql:1854`) carries **no `customer_id`, `order_id` or channel** —
  it is pure preparation state.
- `merchant.payment` is written **only** in the POS commit path. A WhatsApp order captures
  no money; it dies as an uncommitted **quote** (`order_total` = Σ live lines), which
  `ORDER_MODEL.md` §4 forbids reporting as revenue: _"Do not wire a revenue chart to the
  live-lines SUM."_
- The Flutter POS has **no incoming-orders surface** (`apps/umi-pos/lib/features/`: cart,
  cash, catalog, checkout, kitchen, … — nothing lists or picks up a WhatsApp order).

**Consequence.** A latte ordered on WhatsApp and paid at the counter is booked as `pos`
revenue with no link back. "WhatsApp revenue is invisible" is a misdiagnosis: it is not
_hidden_, it is **never captured**, and POS revenue that originated on WhatsApp is
mis-attributed to `pos`. Honest channel **revenue** attribution is therefore impossible at
the reporting layer. A `UNION` of `receipt_snapshot` + `order_total` would invent ~$2,783
of WhatsApp "revenue" that was never collected — and would sweep in canceled-order quotes.

The wedge's real blocker is **upstream** — the POS does not record which channel a sale
fulfils, and cannot even see the commercial orders it settles.

---

## 2. Decision drivers

- **Honesty (non-negotiable).** Revenue must come from frozen money-truth
  (`receipt_snapshot` / `payment`), never from a working/owed quote (`order_total`).
  ORDER_MODEL §4 is binding.
- **Fidelity.** The owner wants to see that WhatsApp drives real, _collected_ business —
  not a demand pipeline they must mentally discount.
- **Cost / risk.** The order + checkout cluster is governed by a strict decision record and
  guarded by migration gates (`security_gate.sql`, `reconcile_v3.sql`). Line reconciliation
  and receipt/order uniqueness are the sharp edges.
- **Forward compatibility.** Whatever lands should not have to be undone to reach full
  order unification later.

---

## 3. Options

### A — Full order unification ("merge")

When the POS rings up a WhatsApp order, it **binds the cart to that existing order** and
does **not** mint a `source='pos'` twin. `payment` / `receipt_snapshot` /
`pos_committed_sale` attach to the WhatsApp order; its `source` stays `whatsapp`; its status
advances to `completed`. One order per economic transaction.

- **Pros:** eliminates the duplicate order row; channel is simply `customer_order.source`;
  cleanest data model.
- **Cons:** heaviest. The cart re-rings lines that the order already has → **line
  reconciliation** (snapshot divergence, voids, price drift). `receipt_snapshot` and
  `pos_committed_sale` are `UNIQUE (order_id)` → a re-settled order collides. `writeOrder`'s
  "always mint" contract is rewritten. Highest gate risk. **Multi-week, high risk.**

### B — Link, don't merge (RECOMMENDED)

Keep the POS order as the money-truth (its receipt is what was charged), but **record the
economic link**: add nullable `origin_order_id` (FK → `customer_order`) and `origin_channel`
to `pos_cart` → carried to `pos_committed_sale`. When the POS settles an incoming order, it
stamps `origin_order_id` and marks the commercial order `completed`.

- Channel revenue = `GROUP BY` the **origin order's `source`** (fallback: the POS order's
  own `source='pos'` = walk-in). Revenue stays **frozen** (`receipt_snapshot`). Honest by
  construction.
- **Pros:** delivers real, frozen channel revenue; creates the WhatsApp↔POS link (closes the
  quote, stops double-counting demand); **no** line reconciliation, **no** uniqueness
  conflict, **no** rewrite of `writeOrder`. Forward-compatible with A (A is "collapse the two
  linked rows into one" later). **Medium cost, contained risk.**
- **Cons:** two order rows remain (a POS order + the fulfilled commercial order) — a
  data-model imperfection, not a reporting error.

### C — Channel tag only (operator-asserted)

Add `origin_channel` to `pos_cart` → `pos_committed_sale`; the operator picks a channel at
checkout. No order link.

- **Pros:** smallest; no incoming-orders surface required.
- **Cons:** attribution is operator-asserted, not verified; no link to close the WhatsApp
  quote; demand stays double-counted. Weakest fidelity.

**Shared dependency (B and A):** the Flutter POS needs an **incoming-orders surface** — list
open commercial orders (`placed/preparing/ready`, `source ≠ pos`), select one, load its lines
into the cart. This is the bulk of the client work and is required for any _verified_ upstream
fix. C avoids it at the cost of fidelity.

---

## 4. Recommendation — Option B (link, don't merge)

B captures ~all of the reporting value (honest, frozen channel revenue + a real economic
link) at a fraction of A's risk, and is a strict subset of A on the way to full unification.
`origin_channel` also gives a graceful fallback (walk-in vs. an ad-hoc phone/aggregator sale)
when no order is linked, subsuming C.

---

## 5. Deltas by surface (Option B)

### Schema (`docs/migration/build-v3/`)

- `pos_cart`: `+ origin_order_id uuid null references merchant.customer_order(id)`,
  `+ origin_channel text null check (origin_channel in ('walk_in','whatsapp','web','aggregator'))`.
- `pos_committed_sale`: same two columns, stamped from the cart at commit (denormalized onto
  the frozen fact so reports never re-derive).
- Gates: extend `security_gate.sql` / `reconcile_v3.sql` for the new columns; RLS unchanged
  (same rows, `device_scoping` write-only / `using(true)` read — see
  [[dashboard-cash-shifts-rls-device-scoping]]).
- Backfill: history cannot be attributed (no link ever existed) → legacy committed sales are
  `origin_channel = 'walk_in'`, `origin_order_id = NULL`. State this honestly in the UI.

### Contract (`packages/contract/src/reports.ts`)

- `+ ReportsChannelSlice { channel, netSalesMinorUnits, orders }` and
  `channelMix: ReportsChannelSlice[]` on `ReportsSalesSummary`.
- New POS contract: `PosOpenOrders` list + `PosBindOrder` (attach `origin_order_id` to a cart).

### API (`apps/umi-api`)

- `pos-checkout.repository.ts` commit: thread `origin_order_id` / `origin_channel` from cart →
  `pos_committed_sale`; on commit, transition the linked commercial order to `completed`
  (status row + `order_event`, together — ORDER_MODEL §1).
- `pos-cart` / `pos-sale`: endpoint to list open commercial orders for the till; endpoint to
  bind an order to the active cart (and load its lines).
- `dashboard-operations.repository.ts` `salesSummary`: add the `channelMix` aggregate —
  `GROUP BY coalesce(origin order.source, 'walk_in')` over `receipt_snapshot.grand_total`
  in the window. Reconciles to `netSalesMinorUnits` (same committed-sale set).

### Flutter POS (`apps/umi-pos`)

- New `features/orders` surface: list open commercial orders, select → load lines into cart,
  carry `origin_order_id` through checkout. (The largest single piece; see phasing.)

### Dashboard (`apps/umi-dashboard`)

- `channelMix` row in `ventas-report.jsx` (reuse the `PaymentMix` stacked-bar shape); Lingui
  strings; the AI narrative (`salesInsight`) reads `channelMix`.

---

## 6. Phasing (locked: hold the owner-facing view for the POS surface)

Build bottom-up as stacked PRs off `build-v3`, TDD with the lint gate green before each push.
The **owner-facing channel row does not ship until 2b lands**, so the wedge launches fully
attributed in one go — no interim `walk_in`-only view is put in front of owners.

- **2a — backend seam (small/medium):** schema + contract + commit threading + `channelMix`
  aggregate + open-orders/bind endpoints. Lands and is tested, but exposes no owner-facing
  channel UI yet. TDD; lint gate; validate on staging (Kalala).
- **2b — Flutter POS (medium/large):** incoming-orders surface + bind + close-on-commit. The
  fidelity payoff; drives real `origin_order_id` values. **Gates the release.**
- **2c — dashboard (small):** channel row (`PaymentMix` shape) + narrative wiring — merged /
  flag-flipped together with 2b so owners first see the split already attributed.

`channelMix` never renders a fabricated WhatsApp revenue figure: an unlinked sale is
`walk_in`, and a channel with no linked committed revenue shows the **"needs data"** state
(per [`reportes-patterns.md`](/home/jc/umi/apps/umi-dashboard/docs/design/reportes-patterns.md)).

---

## 7. Consequences

- **Positive:** honest, frozen channel revenue; a real WhatsApp↔POS link; the wedge narrative
  becomes true, not aspirational; forward-compatible with full unification.
- **Negative / deferred:** two order rows per WhatsApp-fulfilled sale remain (Option A later);
  Delivery (Rappi/UberEats/DiDi) sub-channel stays Phase 3 (needs its own ingestion — see
  build-gap "Delivery consolidation").
- **Risk:** the POS incoming-orders surface is net-new client work; the commit-time status
  transition of the linked order must respect the append-only spine.

---

## 8. Resolved at the approach lock (2026-09-13)

1. **B vs A → B.** "Link, don't merge" for Phase 2. Full unification (A) is deferred and stays
   forward-compatible with this seam.
2. **Sequencing → hold for the POS surface.** No interim `walk_in`-only owner view; 2c ships
   with 2b so the split launches attributed.
3. **`origin_channel` fallback → `walk_in`** for an unlinked POS sale. An explicit
   counter/phone distinction is not modelled now; it can be added as a `CHECK` value later
   without migration cost.

---

## 9. Resolved 2026-09-17 — the table-order channel lands as INTAKE, payment stays at the counter

§8I step 2 ("Add QR order and pay for a seated table") was deferred because **pay-on-page versus
pay-at-counter would change the design**. That is true of the _payment_, and it is not a reason to
hold the _order_. Re-read, the workstream's acceptance is:

> _"A QR order appears in the POS cart and on the kitchen board with no manual step."_

It says nothing about where the money is taken. So the deferral is split rather than answered
wholesale.

**The decision.** The table channel ships as **order intake**. A seated guest orders from the table;
the order is written through the one order writer with the channel identity `web` and linked to that
table ONLY when a party is present; the POS picks it up from the incoming-orders surface it already
has; the kitchen receives it because `writeOrder` itself projects the kitchen ticket. **Payment stays at the counter**
until the Conekta online gateway lands, at which point pay-on-page is an additional step on the SAME
order — the order's identity does not change, so nothing built now is thrown away.

**"A party is present" is `seated_at IS NOT NULL`, and NOT `state = 'open'`.** This ADR said "linked
to that table's open state" and that phrasing is a trap: `merchant.table_state.state` has a value
named `open` that means **the table is free** — `open` and `dirty` are the unoccupied states, and
`table_state_party_presence` is the constraint that ties occupancy to `seated_at`. A first
implementation reading the sentence literally would refuse every seated guest and admit exactly the
empty tables. The intake test makes the inversion executable: a table whose state is literally `open`
is refused, and a seated one orders.

**Why in this order.** It makes the acceptance true with machinery that exists and is already proved
(one writer, channel identity, `link`-not-`merge`, the projector inside the writer). It does not
invent a payment path the platform cannot honour: there is no Conekta client, so a "pay now" button
would be a promise the API cannot keep. And it keeps §8.3's `walk_in` fallback intact — a table order
that is later settled at the till links to the POS sale exactly as a WhatsApp order does.

**What this obliges the channel to say about itself.** The guest-facing surface must state that the
order is placed at the table and **paid at the counter**, and must not offer a payment step. A screen
that looks like it takes money and does not is the same class of defect as a terminal tile that
fails after the customer decides.

**What is explicitly NOT decided here.** Rappi/DiDi ingestion stays Phase 3 (§7) and its own
sub-channel; a customer-visible order status beyond what the counter tells them is not modelled; and
QR credentials for a table are an intake concern that must be revocable without reprinting every
table's code.
