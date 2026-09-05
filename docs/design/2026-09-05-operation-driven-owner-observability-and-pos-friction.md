# Operation-driven design: owner observability and POS friction removal

- Date: 2026-09-05
- Frame: two users, one operation. The **owner** wants safety, observability, and control — populate the dashboard screens that already exist. The **barista** wants speed — erase POS friction.
- Method (fixed): **physical action → UX translation → engineering**. The physical action is the source of truth. See [research: POS cashier and kitchen action volume](../research/2026-09-05-pos-cashier-kitchen-action-volume-research.md).
- Ground truth: owner screens are a data-driven `DomainWorkspace` (`apps/umi-dashboard/src/screens/cash-shifts.jsx`, `operations-workspace.jsx`) over 20 operation domains served by `GET /api/merchants/:m/operations?domain=…`. Each row today is generic: `{publicReference, title, detail, status, occurredAt, amountMinorUnits}`. "Populate" = extend the per-domain fields and render domain-specific views, not build new screens. The owner can now read cash shifts after the write-only `device_scoping` RLS fix in `docs/migration/build-v3/90_rls.sql`.

## 1. The physical action inventory (the source of truth)

Every real action a worker performs, tagged by who cares. **$ = money or exception** (the owner must observe it). **⚡ = frequent** (it must be frictionless). Counts are from the research file.

### Front of house — cashier / barista

| Physical action | Tag | Owner interest | Barista interest |
| --- | --- | --- | --- |
| Count opening float, load drawer | $ | opening cash on record | 1×/shift, quick |
| Take order (verbal) | ⚡ | — | speed |
| Input order to POS (tap product, modifiers) | ⚡ | — | fewest taps |
| Make the drink (~20 motions/drink) | ⚡ | routed correctly | no software in hand |
| Take payment — cash: open drawer, give change | $ ⚡ | every drawer open | one confirmation |
| Hand off / call name | ⚡ | — | — |
| Cash movement: paid-in / paid-out / safe-drop | $ | who, how much, why | occasional |
| No-sale drawer open (open without a sale) | $ | the shrinkage signal | rare |
| Void / cancel a sale | $ | who, why | rare |
| Refund (cash back) | $ | who approved, why | rare |
| Discount applied | $ | margin leak, who | occasional |
| Close: count drawer, reconcile variance | $ | counted vs expected, variance | 1×/shift, guided |

### Back of house — kitchen / line

| Physical action | Tag | Owner interest | Line-cook interest |
| --- | --- | --- | --- |
| Receive / read ticket | ⚡ | ticket age | legible, routed |
| Make / assemble / cook (~10-20 hand actions) | ⚡ | station load | no software in hand |
| Bump ticket (advance state) | ⚡ | ticket time | 1 tap |
| Quality check / expo | ⚡ | — | — |
| Hand to runner | ⚡ | order→handoff time | — |

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

### 2.1 Caja y turnos → Turnos de caja  (domain `cash_shifts`)

- **Physical actions reflected:** opening float, the live shift, the close variance.
- **What to show:** live open shifts with operator, register, opening float, expected cash (`float + cash sales − payouts`), variance-to-date, time open, status. A closed shift shows counted vs expected vs variance and who closed it.
- **UX:** a live "open shifts" strip at the top, coloured by variance against the policy tolerance (MXN 1.00) and the close-approval threshold (MXN 5000); a history list below.
- **Engineering:** extend the `cash_shifts` operations query (`dashboard-operations.repository.ts`) to carry `{operatorName, register, openingFloat, expectedCash, counted, variance, status, openedAt, closedAt}`. Compute expected/variance from `cash_ledger_entry` (float + cash_sale − change − payouts — the same sum used to reconcile). Render a shift card, not the generic reference row. Data is already owner-readable.

### 2.2 Caja y turnos → Registros  (domain `registers`, + a movement log)

- **Physical actions reflected:** paid-in / paid-out / safe-drop, and **no-sale drawer opens** — the theft/shrinkage signals.
- **What to show:** every cash movement (type, amount, operator, reason, time) and every no-sale open, plus register status (`in_use`, `reconciliation_required`).
- **UX:** a chronological movement log per shift; flag no-sale opens and paid-outs prominently. This is the single highest-value control surface, and today it is a generic table.
- **Engineering:** feed the log from `merchant.cash_movement` + `merchant.no_sale_drawer_event`. Both are already owner-visible (no `device_scoping` — verified). Add the movement feed to the `registers` workspace.

### 2.3 Caja y turnos → Ventas  (domain `sales`)

- **Physical actions reflected:** each sale, and any discount applied.
- **What to add:** the **operator** on each sale and the **discount** (amount + reason) as a visible flag — margin-leak observability. Sales already render (verified live).
- **Engineering:** extend the `sales` row with `{operator, discountTotal, discountReason}` from `pos_committed_sale` + `order_discount`.

### 2.4 Caja y turnos → Reembolsos  (domain `refunds_voids`)

- **Physical actions reflected:** refund/void — money back, the top shrinkage risk.
- **What to show:** each refund/void with operator, **approver** (manager PIN), reason, link to the original sale, and amount.
- **Engineering:** surface approver + reason + original-sale link from `pos_sale_exception` / refund records.

### 2.5 Pedidos  (screen `orders.jsx`)

- **Physical actions reflected:** order taken → made → handed off. Throughput and control over speed.
- **What to add:** time-in-state (placed → ready → completed) and an **aging** highlight, so the owner sees where service slows. The order cards exist; they lack timing.
- **Engineering:** compute age and time-to-ready from `merchant.order_event`; add a "tiempo" column and an aging colour on the card.

### 2.6 Cocina  (screen `cocina.jsx`, domain `kitchen`)

- **Physical actions reflected:** bump, station routing.
- **What to add:** per-station ticket counts and average ticket time as an observability read. Live cook status stays on the KDS device; the owner sees load and timing, not live control.
- **Engineering:** surface per-station counts + average ticket time from `merchant.kitchen_order` / items.

### 2.7 Resumen  (screen `overview.jsx`)

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
