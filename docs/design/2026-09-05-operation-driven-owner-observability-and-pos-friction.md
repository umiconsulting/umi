# Operation-driven design: owner observability and POS friction removal

- Date: 2026-09-05
- Frame: two users, one operation. The **owner** wants safety, observability, and control — populate the dashboard screens that already exist. The **barista** wants speed — erase POS friction.
- Method (fixed): **physical action → UX translation → engineering**. The physical action is the source of truth. See [research: POS cashier and kitchen action volume](../research/2026-09-05-pos-cashier-kitchen-action-volume-research.md).
- Ground truth: owner screens are a data-driven `DomainWorkspace` (`apps/umi-dashboard/src/screens/cash-shifts.jsx`, `operations-workspace.jsx`) over 20 operation domains served by `GET /api/merchants/:m/operations?domain=…`. Each row today is generic: `{publicReference, title, detail, status, occurredAt, amountMinorUnits}`. "Populate" = extend the per-domain fields and render domain-specific views, not build new screens. The owner can now read cash shifts after the write-only `device_scoping` RLS fix in `docs/migration/build-v3/90_rls.sql`.

## 1. The physical action inventory (the source of truth)

Every real action a worker performs, tagged by who cares. **$ = money or exception** (the owner must observe it). **⚡ = frequent** (it must be frictionless). Counts are from the research file.

### Front of house — cashier / barista

| Physical action                               | Tag  | Owner interest                | Barista interest    |
| --------------------------------------------- | ---- | ----------------------------- | ------------------- |
| Count opening float, load drawer              | $    | opening cash on record        | 1×/shift, quick     |
| Take order (verbal)                           | ⚡   | —                             | speed               |
| Input order to POS (tap product, modifiers)   | ⚡   | —                             | fewest taps         |
| Make the drink (~20 motions/drink)            | ⚡   | routed correctly              | no software in hand |
| Take payment — cash: open drawer, give change | $ ⚡ | every drawer open             | one confirmation    |
| Hand off / call name                          | ⚡   | —                             | —                   |
| Cash movement: paid-in / paid-out / safe-drop | $    | who, how much, why            | occasional          |
| No-sale drawer open (open without a sale)     | $    | the shrinkage signal          | rare                |
| Void / cancel a sale                          | $    | who, why                      | rare                |
| Refund (cash back)                            | $    | who approved, why             | rare                |
| Discount applied                              | $    | margin leak, who              | occasional          |
| Close: count drawer, reconcile variance       | $    | counted vs expected, variance | 1×/shift, guided    |

### Back of house — kitchen / line

| Physical action                              | Tag | Owner interest     | Line-cook interest  |
| -------------------------------------------- | --- | ------------------ | ------------------- |
| Receive / read ticket                        | ⚡  | ticket age         | legible, routed     |
| Make / assemble / cook (~10-20 hand actions) | ⚡  | station load       | no software in hand |
| Bump ticket (advance state)                  | ⚡  | ticket time        | 1 tap               |
| Quality check / expo                         | ⚡  | —                  | —                   |
| Hand to runner                               | ⚡  | order→handoff time | —                   |

**The concentration.** The owner's safety/observability/control interest is almost entirely the **$ rows**: opening float, cash movements, no-sale opens, voids, refunds, discounts, close variance, and **who did each**, plus throughput (order→handoff time). The barista's speed interest is the **⚡ rows**: order input, checkout, and the KDS bump. Design each side to its own column.

## 2. Owner perspective — populate the screens that exist

One rule: **surface the $ actions and the operator behind each.** Screen by screen.

### 2.0 The seam — one deep per-domain module, never a special-cased renderer

The risk in "populate them" is bloating the two shared pieces: widening the operations row with operator/variance/discount/approver columns, and stuffing `if (domain === 'cash_shifts')` into the shared `DomainWorkspace`. Both make shallow modules — a large interface over thin, per-domain pass-throughs — and couple every domain to every field.

Put the seam at the **operation domain**. It already half-exists: the server keeps a domain registry (`row(source, where, order)` in `dashboard-operations.repository.ts`) and a permission map (`dashboard-operations.policy.ts`). Complete it into one deep module per domain, tier-spanning, behind a small interface:

- **Interface (what the generic pipeline knows):** `{ key, permissions, query, view }`. Nothing else. The pipeline never names a domain or computes a variance.
- **Server adapter** (the query): each domain's SELECT additionally projects one typed `facts` JSON — e.g. cash_shifts builds `{operator, register, openingFloat, expectedCash, variance, status}`, computing expected/variance from `cash_ledger_entry`. The transport row grows **one** field, `facts`, not N columns. That keeps the endpoint interface small (deep) while carrying arbitrary per-domain richness. Sort/scan fields (`occurredAt`, `amount`, `status`) and pagination stay exactly as they are.
- **Client adapter** (the view): `DomainWorkspace` renders `VIEWS[domain] ?? GenericTableView`. Each domain view is a pure function of `rows` (with `facts`) → columns/cards. cash_shifts renders the variance strip; unknown domains fall back to today's table, so nothing regresses and you **populate incrementally**.
- **Typed facts** live in `@umi/contract` so server projection and client view agree; the pipeline treats `facts` as opaque. That is the domain module's internal seam, used only by its own view and test.

Why this is the right shape (codebase-design):

- **Depth = leverage:** one pipeline (RLS-safe fetch, permission gate, pagination) pays back across all 20 domains; one interface, twenty payoffs.
- **Two adapters means a real seam:** cash_shifts, registers, and sales genuinely differ, so the domain seam is real, not hypothetical.
- **Deletion test:** delete a domain adapter and only that domain's richness vanishes (locality); delete the pipeline and you re-implement fetch/permission/paginate/render twenty times (it earns its keep).
- **The interface is the test surface:** the server projection is tested through its query (RLS + `facts` shape); the client view is tested as a pure `rows → markup` function — accept dependencies, return results.
- **Localized addition:** a new rich domain is one server `facts` projection plus one client view. Zero edits to the shared pipeline.

Every "Engineering" note below is an instance of this one seam.

### 2.1 Caja y turnos → Turnos de caja (domain `cash_shifts`)

- **Physical actions reflected:** opening float, the live shift, the close variance.
- **What to show:** live open shifts with operator, register, opening float, expected cash (`float + cash sales − payouts`), variance-to-date, time open, status. A closed shift shows counted vs expected vs variance and who closed it.
- **UX:** a live "open shifts" strip at the top, coloured by variance against the policy tolerance (MXN 1.00) and the close-approval threshold (MXN 5000); a history list below.
- **Engineering:** extend the `cash_shifts` operations query (`dashboard-operations.repository.ts`) to carry `{operatorName, register, openingFloat, expectedCash, counted, variance, status, openedAt, closedAt}`. Compute expected/variance from `cash_ledger_entry` (float + cash_sale − change − payouts — the same sum used to reconcile). Render a shift card, not the generic reference row. Data is already owner-readable.

### 2.2 Caja y turnos → Registros (domain `registers`, + a movement log)

- **Physical actions reflected:** paid-in / paid-out / safe-drop, and **no-sale drawer opens** — the theft/shrinkage signals.
- **What to show:** every cash movement (type, amount, operator, reason, time) and every no-sale open, plus register status (`in_use`, `reconciliation_required`).
- **UX:** a chronological movement log per shift; flag no-sale opens and paid-outs prominently. This is the single highest-value control surface, and today it is a generic table.
- **Engineering:** feed the log from `merchant.cash_movement` + `merchant.no_sale_drawer_event`. Both are already owner-visible (no `device_scoping` — verified). Add the movement feed to the `registers` workspace.

### 2.3 Caja y turnos → Ventas (domain `sales`)

- **Physical actions reflected:** each sale, and any discount applied.
- **What to add:** the **operator** on each sale and the **discount** (amount + reason) as a visible flag — margin-leak observability. Sales already render (verified live).
- **Engineering:** extend the `sales` row with `{operator, discountTotal, discountReason}` from `pos_committed_sale` + `order_discount`.

### 2.4 Caja y turnos → Reembolsos (domain `refunds_voids`)

- **Physical actions reflected:** refund/void — money back, the top shrinkage risk.
- **What to show:** each refund/void with operator, **approver** (manager PIN), reason, link to the original sale, and amount.
- **Engineering:** surface approver + reason + original-sale link from `pos_sale_exception` / refund records.

### 2.5 Pedidos (screen `orders.jsx`)

- **Physical actions reflected:** order taken → made → handed off. Throughput and control over speed.
- **What to add:** time-in-state (placed → ready → completed) and an **aging** highlight, so the owner sees where service slows. The order cards exist; they lack timing.
- **Engineering:** compute age and time-to-ready from `merchant.order_event`; add a "tiempo" column and an aging colour on the card.

### 2.6 Cocina (screen `cocina.jsx`, domain `kitchen`)

- **Physical actions reflected:** bump, station routing.
- **What to add:** per-station ticket counts and average ticket time as an observability read. Live cook status stays on the KDS device; the owner sees load and timing, not live control.
- **Engineering:** surface per-station counts + average ticket time from `merchant.kitchen_order` / items.

### 2.7 Resumen (screen `overview.jsx`)

- **The "see everything" home.** Roll up the $ signals of the day: open shifts and their variance, cash movements, no-sale opens, refunds/voids, discount total, aging orders, order→handoff time. Each tile links into the screen above that owns it.

## 3. Barista perspective — erase POS friction

One rule: **never add a software tap onto a motion-heavy, injury-prone job** (≈20 motions/drink). Cut taps on the ⚡ actions; keep exactly the one confirmation that prevents a wrong order (an inaccurate order costs +71 s — research §7).

### 3.1 Checkout — collapse three confirmations into one

- **Physical action:** take payment. Frequent, money.
- **Friction today (observed live):** after **Cobrar**, three gestures — "Revisar totales autorizados" → "Confirmar y cobrar" → "¿Confirmar esta venta?" dialog → done. Cash and exact amount are already pre-filled.
- **UX:** one payment screen. Method defaulted to cash + exact amount, the authorized total shown inline, one primary **"Cobrar MXN X"** that authorizes and commits. Keep a single verification of the total (it earns its place); drop the other two.
- **Engineering:** the POS already runs authorize (server recompute) then commit. Keep that two-phase server contract; merge the review sheet and the confirm dialog into the payment sheet so the UI has one gesture. `apps/umi-pos/lib/features/sale/…` checkout flow.

### 3.2 Product → cart — fewer taps per item

- **Physical action:** order input. Frequent.
- **Friction today:** tap product → modifier sheet → add, for every item, even items with no required choice.
- **UX:** a product with no required modifier group adds in **one tap** (tap = add). Open the modifier sheet only when a required group exists. Add a favourites/most-sold rail for the top drinks. Quantity stepper is already on the cart line.
- **Engineering:** branch on the product's required-modifier metadata; single-tap add when none. Build the favourites rail from sales history.

### 3.3 Shift open / close — streamline and de-risk

- **Physical action:** count float / count drawer. 1×/shift, money.
- **Friction today:** the close flow (count → resolve → reconcile → close) is multi-step, and it has a **recovery gap** — a mid-flow reload drops the reconciliation and the close button never returns, stranding the shift in `closing` (hit this session).
- **UX:** one guided flow with a denomination keypad and a progress line; when variance = 0, auto-skip the reason step; a resilient "resume close" if interrupted.
- **Engineering:** fix the recovery gap — persist the close step so an interrupted close resumes instead of stranding the shift. Real bug, found this session.

### 3.4 Keep optional steps off the critical path

- Receipt destination defaults to "mostrar"; attach-customer and note stay optional and skippable. On a session end (role change), bounce to PIN with a clear message rather than a hard error (fixed this session).

## 4. Sequencing

1. **Owner quick wins** (field extensions on the operations query + domain rendering; read path already unblocked): populate Turnos de caja with expected/variance/operator; add the movement + no-sale log to Registros; add operator + discount to Ventas; add approver + reason to Reembolsos.
2. **Barista quick wins:** collapse checkout to one confirmation; single-tap add for no-modifier products.
3. **Bigger:** order/ticket timing on Pedidos and Cocina; the Resumen roll-up; the close-flow recovery fix; the favourites rail.

The two sides meet at one place: the operator's name on every $ action. That single field gives the owner accountability and costs the barista nothing.

## 5. Status — 2026-09-05

Delivered and verified live against the rehearsal DB through the real owner API (see the `facts` seam in §2.0):

- **RLS foundation** — owners can now read cash shifts. `device_scoping` on `merchant.cash_shift` made write-only (`docs/migration/build-v3/90_rls.sql`), with a static gate assertion (`gate-5a-…spec.ts`), a live integration test (`rls.integration.ts`), and the shape-count snapshot updated (`migration-shape.spec.ts`).
- **Turnos de caja (`cash_shifts`)** — per-shift `facts` (operator, register, opening float, live expected cash, gated counted) via a server projection in `dashboard-operations.repository.ts`; client `CashShiftsSummary`/`DomainSummary` strip in `operations-workspace.jsx`. Contract carries `facts`. Verified: cards render (Barista Kalala, Fondo $500, Esperado $653; Admin, Esperado $195).
- **Ventas (`sales`)** — `detail` enriched with the operator (via the now-readable shift) and discount total. Verified: sales show `· Barista Kalala` / `· Admin`.
- **Reembolsos (`refunds_voids`)** — `detail` enriched with operator + `aprobado`. SQL verified; no refund rows in this dataset to render.

Gates: API `tsc` clean, ESLint/Prettier clean on all edited files; dashboard ESLint/Prettier clean.

Staged next (each needs its own reviewed change; noted so nothing is silently dropped):

- **Registros movement log** — a chronological `cash_movement` + `no_sale_drawer_event` feed. Needs a query shaped as events, not one-row-per-register; no movement rows in the current dataset to verify against.
- **Pedidos / Cocina timing** — order→ready/handoff time from `order_event`, per-station ticket time from `kitchen_order`. Separate data path (`/orders`, `cocina.jsx`), not the operations seam.
- **Resumen roll-up** — `overview.jsx` aggregate of the $ signals above.
- **Barista (POS, Flutter)** — collapse checkout to one confirmation, single-tap add for no-modifier products, and fix the shift-close recovery gap. These change production POS UX and need the POS rebuild-and-drive cycle plus a UX review, so they are staged rather than rushed.

## 6. Status update — barista checkout collapsed (2026-09-05)

Delivered and verified live on the POS: **checkout collapsed from three confirmation gestures to one.** `checkout_surface.dart` — the `collectingPayment` button now reads "Cobrar" (was "Revisar totales autorizados"); on tap it authorizes (server recompute) and, when the recomputed total matches what the cashier already saw, commits in the same action; the redundant "¿Confirmar esta venta?" dialog is removed. The one verification is kept: if UMI recomputes a **different** total, the flow falls through to the review screen so the cashier sees the new number (the +71 s inaccuracy penalty). Static analysis clean; verified with a real committed sale (receipt POS-01ecdd36, MXN 55.00, one tap → "Venta completada" → DB committed sales 4→5).

Still staged: single-tap add for no-modifier products, the close-flow recovery gap, and the owner Registros/Pedidos-timing/Resumen items.

## 7. Status update — single-tap add (2026-09-05)

Delivered and verified live: **a product with no size/variant and no modifier group now adds in one tap.** `catalog_surface.dart` `_showDetail` adds straight to the cart and skips the sheet when `detail.variants.isEmpty && detail.optionGroups.isEmpty` (and it is a new line the operator may write). Verified: tapping "Agua" put it in the cart with no sheet; "Americano" (has options) still opens the modifier sheet. Static analysis clean; formatted.

### Plan tally

- **Owner quick wins (§4.1):** Turnos de caja, Ventas, Reembolsos delivered + verified. Registros movement log staged (needs an event-shaped query; no movement rows to verify against).
- **Barista quick wins (§4.2):** checkout collapse and single-tap add delivered + verified.
- **Bigger (§4.3):** order/ticket timing, Resumen roll-up, and the close-flow recovery gap remain — each a larger, own-cycle change.

## 8. Status update — close-flow recovery fix (2026-09-05)

Root cause found and fixed in `pos-cash.repository.ts`: the snapshot's `allowedActions` checked `handoffReady` before the `reconciliation ? ['close']` branch, and `handoffReady` stayed true after reconcile (it only tests count + zero-variance). So a balanced, handoff-enabled shift was offered `['handoff','reconcile','count']` forever and **`'close'` was never surfaced** — the shift could not be closed, and a mid-flow reload stranded it in `closing`. Fix: `handoffReady` is now false once a reconciliation exists (`reconciliationHeader === null` added), so after reconcile the snapshot returns `['close']` and a reload reconstructs it from the persisted reconciliation. Verified by tracing + API `tsc`/Prettier clean. End-to-end drive was blocked by pre-existing immutable count/reconciliation artifacts on the only test shift (ledger sequence 2 vs the shift's 4, from an earlier aborted close), which make that shift un-closeable and un-recountable; a clean shift is needed for the live pass.

Concurrency note: another session is running a dashboard i18n (lingui) + token migration, so many dashboard screens are in flux. The remaining owner items (Resumen roll-up, Pedidos/Cocina timing) touch those screens; doing them now risks clobbering that work. The Registros movement log is server-side (safe) plus a view on the seam I own.

## 9. Status update — Registros movement summary (2026-09-05)

Delivered server-side and verified via the live API: the `registers` domain `detail` now carries a movement summary — `MXN · Movimientos N` plus `Sin venta M` when any no-sale drawer opens exist (the shrinkage signal). It renders in the existing "Detalle" column, so no dashboard-client edit was needed — deliberately, because a peer session is mid-migration on the dashboard screens. A richer chronological movement log (the DomainSummary view) is deferred until that migration settles. Fed from `cash_movement` + `no_sale_drawer_event`, both owner-readable. Gates clean.

This completes all four §4.1 owner quick-win domains at the data layer (Turnos, Ventas, Reembolsos, Registros). Remaining owner "bigger" items (Resumen roll-up, Pedidos/Cocina timing) are client-side on screens the peer session is actively editing, so they are held to avoid clobbering that work.

## 10. Status update — Pedidos order detail enriched (2026-09-05)

Delivered and verified live on the dashboard: the **individual order tab** (`OrderDetail` in `orders.jsx`) now shows the full scope of an order, not just channel + items + one total. This is §2.5's headline (order lifecycle timing) plus the rest of the order model made visible.

The order detail read follows the same "one deep projection" shape as the operations `facts` seam (§2.0): the enrichment is one enriched SELECT in `orders.repository.ts`, mapped once in `orders.service.ts`, consumed by one client view. No new endpoint.

Added to the detail tab:

- **Lifecycle timeline** — `Nuevo → Preparando → Listo → Completado/Cancelado`, each with the moment it was reached, the time spent in that state, the operator (`order_event.staff_id → staff.name`, when present), and a total. The current, still-open state of an active order colours by age (warn ≥ 10 min, danger ≥ 20 min). The rail uses fuller, deeper tones (strong ink labels + a `--info`/`--warning`/`--success`/`--ink-1`/`--danger` dot per state, deep ink for `Completado` instead of grey) rather than the washed status tokens — all theme-aware, so it holds in both Umi and Midnight (verified in both). Built from `merchant.order_event` (`kind='status_changed'`); `placed` is taken from `placed_at`, since backfilled orders carry no opening event, and each later milestone is the FIRST time that status was reached, so a re-fire does not scramble the line.
- **Meta strip** — status badge, handoff (`fulfillment_type`), and reference, which the sheet never showed before.
- **Money split** — `gross − discount = total` from the `merchant.order_total` view (was one number). Discount lines list their `order_discount` label; comps colour differently.
- **Voided lines** — a void is now SHOWN struck-through with an "Anulado" chip and its reason (ORDER_MODEL §3 waste visibility), instead of filtered out. The article count and the total still use live lines only, so a void does not inflate either.
- **Per-line modifiers** (`order_item_modifier`) and the **cancel reason** for a canceled order.

Engineering notes:

- The projection adds voided lines, `order_event`, `order_item_modifier`, `order_discount` and the `gross`/`discount` columns of `order_total`. All are owner-readable under the request RLS context (`order_event`/`order_item` scope through the parent order; `order_item_modifier`/`order_discount` through their own `merchant_id`) — verified by running the exact query as `api_login` with the merchant GUCs set. The `authorized_by → umi.user` join was dropped: `api_login` cannot read `umi.user`, and approver identity is the Reembolsos surface (§2.4), not this one.
- Verified live against the rehearsal DB (Kalala Café) through the real owner API: a completed order renders its timeline, item and modifier; a canceled order renders two `Anulado` lines with their modifiers and a total that counts only the live line.

Gates: API `tsc` clean, 10/10 orders service unit tests pass (a new case covers the money split, voided-line exclusion from the count, modifiers and the lifecycle); dashboard ESLint clean (a now-dead `react-hooks/purity` suppression pruned after the fix), Prettier clean, i18n extracted + English catalog complete + `compile --strict` clean, production build clean.

**Status is read-only on this screen (2026-09-05).** The transition controls were removed from both the order list card (`Cocina` / `Listo` / `Cerrar`) and the detail tab (`Avanzar estado`). Advancing the lifecycle belongs to the kitchen (Cocina / KDS), where the physical action happens; the owner's order screen observes the status, it does not drive it. The status badge stays as a read-only display. The `transition` endpoint and its service stay in place (unused by this screen) for the kitchen surface. This matches the §2.6 rule that live cook control stays on the KDS device while the owner sees load and timing.

Remaining owner "bigger" items: the Resumen roll-up, the Cocina per-station timing, and the order-list row aging colour (§2.5's row-level ask, distinct from this tab).

## 11. Status update — money hub full redesign (2026-09-05) — SUPERSEDED by §12

> The KPI-hero + stat-tiles + tables treatment described here was rejected in review as
> "too much like a dashboard." The seam and the server `facts` it introduced still stand;
> only the client presentation changed. See §12 for the current editorial design and the
> refund-placement decision.

Delivered and verified live: the whole **Caja y turnos** hub (`cash-shifts.jsx`) is redesigned. All five tabs — Ventas, Recibos, Reembolsos, Turnos de caja, Registros — now render a purpose-built domain view instead of the generic reference table. This is §2.1–§2.4 completed at the client layer, on the §2.0 seam.

The seam is now the shape §2.0 described: `DomainWorkspace` renders `DOMAIN_VIEWS[domain]` when one exists, else the generic table (untouched — every other domain still uses it). One registry entry plus one component adds a rich domain; nothing else changes.

Shared primitives keep the five tabs one system: `KpiRow` + `Kpi` (the roll-up header, reusing the `.kpi` tokens), one `StatusBadge` vocabulary (colour is a redundant cue — the status word always shows, WCAG 1.4.11), and `CopyButton`. Each view is a pure function of `rows` (with `facts`).

Per tab:

- **Turnos de caja** — a KPI header (open shifts, expected cash in open drawers, "por revisar", net closed variance), a live open/in-progress strip (operator, expected cash, opening float, "abierto hace …" from `openedAt`, a `Requiere revisión` flag on `reconciliation_required`), and a reconciliation history (Expected / Counted / Variance as sign + word — Cuadrado/Sobrante/Faltante — + colour).
- **Ventas** — KPIs (count, total sold, average ticket, discounted count + total) and a table with the operator and a discount flag on every sale.
- **Recibos** — KPIs (total, printed, queued, failed) and a table keyed by print status.
- **Reembolsos** — the shrinkage-control surface: KPIs (exceptions, total refunded, voids, approved) and a table with type, original receipt, operator, reason, approver flag, and amount.
- **Registros** — KPIs (registers, in use, movements, no-sale opens) and register cards; the no-sale count is the shrinkage signal.

**Server (`dashboard-operations.repository.ts`).** Each domain's SELECT now projects a typed `facts` JSON, the §2.0 shape: `openedAt`/`closedAt` on `cash_shifts`; `{operator, discountMinorUnits}` on `sales`; `{exceptionType, reasonCode, operator, approved, originalReceipt}` on `refunds_voids`; `{movements, noSaleOpens, status}` on `registers`. All from joins already owner-readable under the request RLS context (verified live). `facts` is `z.record(z.unknown())` in the contract — opaque passthrough, so **no contract or Dart codegen** changed.

**One deliberate non-duplication.** The client never re-derives the merchant's variance tolerance or close-approval threshold. The shift `status` already carries the authoritative outcome the server computed against that policy (`reconciliation_required` = a blocked close), so "por revisar" and the attention accent key off `status`, not a client-side threshold. Colouring a nonzero variance on a _closed_ shift is honest (the close was tolerated or approved); a blocked shift is the red flag.

**Domain-label i18n.** The workspace heading used the API's Spanish domain `label`, so it stayed Spanish in English mode. Fixed with a client `DOMAIN_LABELS` message map (all 20 domains), rendered through `i18n._()` with a fallback to the server label. The heading now follows the active language ("Cash shifts", "Refunds and voids", …).

**Verified live** against the rehearsal DB (Kalala Café, Chapultepec) through the real owner API, in **both** Spanish/Umi and English/Midnight: the five views render real data — a closed shift shows `Faltante $110.00` (expected $708 vs counted $598) and the net-variance KPI reads −$110.00; Reembolsos shows an approved full refund + void with their original receipts and reason. Colours and badges hold in both themes; the new strings resolve in English.

Gates: API `tsc` clean, ESLint/Prettier clean, 8/8 dashboard-operations tests. Dashboard ESLint/Prettier clean, i18n extracted + 59 new English strings + `compile --strict` clean, production build clean.

Still deferred (as in §9): the Registros full chronological movement log (an event-shaped `cash_movement` + `no_sale_drawer_event` query), and the Resumen roll-up + Cocina timing on screens owned elsewhere.

## 12. Status update — money hub as a calm editorial briefing (2026-09-06)

The §11 treatment was rejected in review: "this is not supposed to be like a dashboard —
remember the feeling the owner must get from it." The owner opening this must feel **calm
and safe**, reading an honest account of "is my money okay, and who did what" — not
operating a metrics cockpit. This is the product's own stated intent, recovered from the
dossier: `login-redesign-research.md` — _"Beauty = honesty + craft… trust reads as beauty"_
(Rams: honest, unobtrusive) and _"think outside the database — your UI doesn't need to map
1:1 to your data's fields"_; `redesign-research-psychology-flow.md` §9 — _design around
**jobs, not tables**; do not expose the schema as the UI_; and the app's **broadsheet /
masthead** identity. The direction was confirmed with the owner before the rebuild ("calm
editorial briefing").

**The design, applied to all five tabs (Ventas, Recibos, Reembolsos, Turnos de caja,
Registros).** Each tab is one quiet rhythm, on the canvas, with generous whitespace:

1. **A lede** — one honest sentence with a state dot ("Todo cuadrado. Nada requiere tu
   atención." / "1 turno necesita tu revisión." / "Recibos: 7 · todos impresos.").
2. **A few unboxed figures** — a small label over a display-face, tabular figure; two or
   three, separated by whitespace, a single hairline beneath. No tile grid.
3. **Narrative rows** — each item as a sentence (a state dot, a subject, a muted predicate,
   the amount on the right in the display face), hairline dividers. Jobs, not a data table.

The KPI-tile and table components from §11 (`KpiRow`, `Kpi`, `StatusBadge`, the reconciliation
table) were removed and replaced by editorial primitives (`Lede`, `FigureStat`, `FigureRow`,
`NarrativeRow`, `BriefSection`, `StateDot`, `RowAmount`) reused across the five views, so a
tuning change flows to all five from one place. The five money-hub domains render on the
canvas (`MONEY_HUB` in `operations-workspace.jsx`); every other domain keeps the generic
card+table, untouched. Colour stays state-only (variance, attention) with sign + word, never
colour alone; money uses tabular slashed-zero numerals.

**Refund placement — a real correction (research-backed).** The dashboard no longer
initiates refunds. A **cash** refund physically needs a person at the drawer with the
customer present; Toast's own docs state Toast Web cannot issue cash refunds because it
"does not access the cash drawer," and Square/Shopify "remote cash refunds" are a
book-keeping fiction that records money returned with no one witnessing it leave the drawer —
a fraud vector. So the owner's role is **observe + govern, not execute**:

- **Reembolsos** is now an accountability surface only — each exception shows type, original
  receipt, operator, reason, and approver, with the honest line: "Los reembolsos y las
  anulaciones se hacen en la caja, con el cliente presente. Aquí los revisas: quién, por qué
  y quién autorizó."
- The **"Reembolsar" initiation button was removed from Ventas.** The `refund.*` command and
  its dialog stay in the code for a future card-not-present ("charged twice yesterday")
  refund-from-transaction surface, which is the one refund that legitimately belongs remotely
  — a separate, scoped feature, not this screen.
- Legitimate dashboard actions are kept: **Reimprimir** (Recibos — not money movement) and
  **Configurar** (Registros — configuration).

This also answers §2.4's "Reembolsos" item more correctly than §11 did: the owner observes
and authorises the exception; the register, with the customer, executes it.

**Verified live** (Playwright) against the rehearsal DB (Kalala Café, Chapultepec) through
the real owner API, across all five tabs in **both** Spanish/Umi and English/Midnight: the
editorial layout holds, semantic colours and MX$ tabular numerals read on true black, and
every new string resolves in English (the Midnight surface==canvas is black, so depth comes
from hairlines and the warm/figure treatment, not surface contrast).

Gates: dashboard ESLint/Prettier clean, i18n extracted + English catalog complete +
`compile --strict` clean, production build clean. Server `facts` (§11) unchanged, so the API
`tsc` + dashboard-operations tests from §11 still stand.

Follow-ups: a dark/English polish is done; remaining are the deferred §9 items and an
optional card-not-present refund-from-transaction surface (permission-gated, reason-required)
if the business wants remote card refunds.
