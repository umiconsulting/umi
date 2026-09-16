# Reportes IA — Research

Evidence base for the Reportes (Reports) redesign. Companion to
[`reportes-ia-plan.md`](./reportes-ia-plan.md).

Produced 2026-09-13 from a 12-task parallel research swarm (5 external / web, 4
internal codebase+DB, 3 strategy). Two rounds of external UI benchmarking preceded
it (US giants, then LatAm cohort). Every claim below is flagged **[C]** confirmed
(cited source, screenshot, or file:line) or **[I]** inferred. Where an external
"best practice" and Umi's real data/code disagree, the code wins.

---

## 0. Why this method

An LLM writing a Reportes IA from priors produces a fluent, generic blend of
Toast and Square with Spanish labels — plausible and subtly wrong for a Mexican,
cash-heavy, WhatsApp-first café POS. To avoid that, the design is _assembled from
evidence_, not authored from memory:

- **External research** where the model is weakest — the LatAm competitor set and
  Mexican fiscal (CFDI) norms, not the well-documented US giants.
- **Internal research** (codebase, schema, real DB) as ground truth, so no report
  is proposed that the data cannot feed.
- **A few decisions** that only the founder can make, researched to inform, not to
  pre-empt.

---

## 1. The two archetypes (and the modern bar)

Reporting back-offices fall into two shapes, and strong products ship both:

- **Report catalog** — a landing dashboard plus a categorised list of pre-built
  reports (Toast, Square, Lightspeed-basic, Soft Restaurant, Parrot). [C]
- **Report builder / analysis engine** — the user composes reports via
  pivot/graph/table + measures + group-by (Odoo, Lightspeed Analytics, PoloTab). [C]

The modern UX bar (set by Parrot and Fudo, and where Soft Restaurant/Aloha lose
reviewers on "anticuada"): **filters + tabs (Gráficas / Resumen / Desglose) +
one-click Excel + a mobile owner app**, KPI-first and chart-first, depth without a
learning curve. [C]

Every strong product also has a **landing dashboard distinct from the report
library** — KPI tiles + date toggle + best sellers + payment mix (Toast Weekly
Overview, Lightspeed Home, Square Home, PoloTab Inicio, Wansoft App Reporteadora). [C]

---

## 2. Competitor benchmark

### US giants (round 1)

| Product        | Reports nav                                                                      | Grouping                                                                                  | Report page shape                                                                                                            | Export                            | AI                                                                                    |
| -------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| **Toast**      | Left-nav peer → Weekly Overview; arrow expands 9 categories / 40+ reports        | Document type (Sales, Labor, Menu, Payments, Cash & Loss, Accounting, Kitchen, Marketing) | Charts on top → reorderable KPI cards (gear) → drill-down carets; filters + right-side "More filters"; data-freshness labels | CSV/XLS                           | **Toast IQ** (GA Oct 2025): NL Q&A, "For you" feed, daily briefings                   |
| **Square**     | Reporting hub → Reports page (2025 nav consolidation drew complaints)            | Domain (Sales & transactions, Team, Restaurant, Retail, Custom)                           | KPI/balance-sheet summary → interactive chart → detail table; date+location top; drill-down                                  | CSV only; "summary emails"        | **Square AI**: conversational assistant, auto-updating "AI widgets", external context |
| **Lightspeed** | Two tiers: basic **Reports** + separate **Advanced Insights/Analytics** (Looker) | Basic = document type; Analytics = by job (Sales & Inventory, Marketing, Employee)        | Filters + visualizations + data table; Home + KPI donut gauges                                                               | CSV/XLS; **real scheduled email** | **Lightspeed AI** + benchmarking; **Magic Menu Quadrant**                             |
| **Odoo**       | No hub — a Reporting menu **inside each app** (POS ▸ Reporting ▸ Orders)         | Per-app analysis views                                                                    | Graph/Pivot/List switcher, measures selector, group-by in search bar                                                         | XLSX; "insert in spreadsheet"     | none in std                                                                           |

### LatAm cohort (round 2 — the real competitive set)

| Product                                   | Reports nav                                                                              | Distinctive                                                                                                                                                     | AI                                                                          | CFDI                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| **Fudo** _(strongest analytics+AI rival)_ | Top-menu **Indicadores** (ventas/productos/mesas, balance, gastos, stock, multisucursal) | **arqueo ciego**, **mapa de calor de mesas**, emailed multi-sucursal reports                                                                                    | **Radar de Precios, WhatsApp-agent analytics, 30-day cash-flow projection** | native                              |
| **Parrot** _(cleanest hub)_               | Left-rail Reportes catalog                                                               | tabs **Gráficas/Resumen/Desglose**, filter by **Canal** (Mostrador/Domicilio/Delivery), native **Costos y márgenes (CMV)**, Rappi/UberEats/DiDi in same reports | **"Pregunta a Parrot AI"** on every report                                  | separate module                     |
| **Soft Restaurant** _(breadth leader)_    | Back-office (50+ reports) + free **Analytics** BI catalog                                | **corte de caja por correo/WhatsApp** (declaración de cajero, faltantes/sobrantes), recipe costing, metas, antifraude                                           | —                                                                           | native + autofactura                |
| **Clip / Wansoft by Clip**                | Payments Panel + acquired Wansoft back-office ("+50 reportes", App Reporteadora)         | up to 1,000 role users; propinas/corte by cajero; sucursal-vs-sucursal                                                                                          | —                                                                           | native, multi-sucursal traceability |
| **NCR Aloha (MX)**                        | Back Office ▸ Results (Sales/Operations/My Store)                                        | deep but dated: **tables only, no KPI tiles/charts** (SSRS); strong cash/shift; multi-site                                                                      | Aloha Insight (add-on)                                                      | **not native** (3rd party)          |
| **Rappi POS**                             | Aliados portal only                                                                      | delivery reconciliation "Relación de ventas" spreadsheet; no corte/CFDI/inventory                                                                               | —                                                                           | no                                  |
| **Loyverse**                              | Back Office ▸ Reports + mobile Dashboard                                                 | free-tier baseline; clean but shallow                                                                                                                           | —                                                                           | 3rd party                           |
| **Bewe**                                  | —                                                                                        | out of scope (beauty/wellness, not hospitality)                                                                                                                 | "Linda"                                                                     | no                                  |

### What the LatAm cohort does that the US giants do not [C]

1. **Corte de caja / turno is a first-class report, not a setting** — often auto-sent
   by email/WhatsApp (Soft Restaurant, Fudo arqueo ciego, Wansoft, Clip).
2. **Native CFDI 4.0 is table stakes, pushed to the POS** with multi-sucursal
   traceability (Soft Restaurant, Parrot, Fudo, Clip). Aloha/Rappi/Loyverse lean on
   third parties and are penalised for it in reviews.
3. **Owner-on-the-phone reporting is the norm** — nearly all ship a real-time mobile
   owner app (KPI hero + trend). Reinforces §7.
4. **Delivery-aggregator consolidation is a live battleground** — Parrot and Fudo
   fold Rappi/UberEats/DiDi into unified reports with margin-after-commission;
   Rappi's own portal proves the pain (revenue trapped outside the main system).
5. **AI in reporting is nascent → differentiable now** — only Parrot and Fudo ship
   it in this cohort.

---

## 3. Mexican fiscal reporting (CFDI 4.0 / SAT) — Gap 2 [C]

The reporting surface (not issuance) must expose:

- **Facturación global de tickets** — un-invoiced POS tickets consolidate into a
  factura global (receptor RFC genérico `XAXX010101000`, Uso `S01`, "Información
  Global" node: Periodicidad/Meses/Año). Most restaurants close a **global diario**.
  The back-office must show which tickets fell into a global vs. were invoiced
  nominatively, and reconcile the total.
- **IVA/IEPS breakdown** — restaurant on-site service is **16% IVA**; split
  trasladado 16% / 0% / exento (+ IEPS on alcohol/sugary drinks). The contador's
  monthly IVA-trasladado view.
- **Cancelaciones CFDI 4.0** — motivos `01`–`04`; motivo `04` = a ticket pulled out
  of a global into a nominative invoice (adjusts the global). Keep the acuse.
- **Método/forma de pago** — PUE dominant; surface any PPD → complemento pendiente.
- **Propinas reported separately as nómina** — never inside the IVA base; card tips
  assimilated to salary (ISR), stamped in CFDI de nómina.
- **A month-end contador export** (CFDI emitidos/recibidos, global, IVA, DIOT-ready).

**Boundary [I]:** issuance/timbrado (CSD, XML, REP, cancellation flow, auto-invoice
QR) is a **separate backend track**; Reportes _consumes_ its outputs and reconciles.

---

## 4. Operator jobs-to-be-done & cadence — Gap 4 [C]

Half of "reporting" is a trust/compliance ritual, not analytics. Prioritised:

1. **"¿Cuadró mi caja?"** — cierre de caja (daily trust ritual, #1).
2. **"¿Me están robando?"** — void/comp/refund by employee; flag cash voids & EOD
   spikes (loss-prevention; push an anomaly, not a chart).
3. **"¿Vendí más o menos?"** — sales vs yesterday / last week, one phone glance.
4. **"¿Cómo voy de costos?"** — weekly **prime cost** (labor % + food %), not monthly.
5. **"¿Qué platillo da dinero?"** — menu-engineering quadrant (monthly).
6. **"¿Estoy en regla con el SAT?"** — CFDI/global reconciliation (contador).
7. **Café lens** — attach rate + day-part throughput as first-class.

Design consequence: **lead with rituals and anomaly answers, turn each report into
"here's what changed and what to do"** — not a chart wall. Café ticket ≈ $80–120 MXN;
~68% of Mexican F&B sales are cash → cash reporting weight is real.

## 5. Cash-market norms — Gap 5 [C]

Caja y turnos must be **cash-first**: per-turno, per-cajero close with fondo →
method split → expected vs counted → **diferencia (faltante/sobrante)** as the
primary KPI, signed by the cashier. **Corte X** (live, repeatable) distinct from
**Corte Z** (locked daily close). Tips split cash vs card and routed to payroll.
Group by the configurable **business-day rollover**. IVA-inclusive display + base+IVA
breakdown; peso "$" format. Voids/refunds/no-sale/discounts framed as
loss-prevention per cashier.

## 6. Menu engineering — Gap 3 [C]

Classic **Kasavana–Smith** matrix: popularity (menu-mix %) × **contribution margin
(dollars, not food-cost %)**; midpoints are _this café's_ averages (avg CM; popularity
cutoff = (1/items)×0.70). Quadrants Star / Plowhorse / Puzzle / Dog with standard
actions. **Lightspeed's Magic Menu Quadrant swaps profitability for a retention
axis** (popularity × reorder rate) — which Umi can match via Customer 360 and which
**needs no COGS**. Pitfalls: the averaging trap, food-cost% instead of CM, comparing
across categories. Compare within category and by day-part.

---

## 7. Target user — Gap 10 [C]

**Design for the OWNER, smartphone-first.** 97.2% of Mexican internet users are on
smartphone vs ~15–25% desktop; micro-firms (97.6% of businesses) barely use
computers. **Manager** = scoped secondary consumer (shift-level, existing role
grants). **Contador is not a dashboard user** — no `contador` role exists in code
(roles: owner/admin/manager/supervisor/cashier/staff/viewer/super_admin); they
consume **fiscal exports**. Umi's own signal agrees: the active work is a mobile
dashboard shell.

## 8. The wedge — Gap 11 [C]

- **AI-in-reporting is table stakes** (Toast IQ, Square AI, Lightspeed AI, Parrot
  "Pregunta a Parrot AI", Fudo). An AI narrative _alone_ is parity, not a wedge.
- **The structural wedge is WhatsApp-driven sales analytics** — reporting revenue by
  channel with the WhatsApp bot as a first-class channel and a conversational funnel
  (messages → cart → confirmed order). **Contested by Fudo's WhatsApp-agent
  analytics**, so it must be sharpened: native conversational commerce + Customer 360,
  not a bolt-on ordering agent. Umi's bot already _writes_ orders (`add_to_cart`,
  `confirm_order`).
- **Second wedge surfaced by Gap 1: delivery-aggregator consolidation** — one report
  unifying in-store + WhatsApp + Rappi/UberEats/DiDi with margin-after-commission.
  Umi already ingests Rappi data at Kalala.
- Founder decisions: positioning; the per-order channel/attribution data-quality
  prerequisite; the DeepSeek-vs-Anthropic cost gate.

---

## 9. Internal ground truth

### 9.1 Reportable data model — Gap 6 [C]

Two parallel sale worlds: an **Order cluster** (`merchant.customer_order`, WhatsApp
lineage, `merchant.payment`/`refund`) and a **POS financial cluster** (`pos_cart`,
`pos_tender_fact`, `receipt_snapshot`, `pos_committed_sale`, `cash_shift`). Refund/
void/exception live **append-only in `pos_sale_exception`** (triggers block
UPDATE/DELETE) and **never touch** the original sale/receipt — so Reembolsos reads a
separate source. There are **two un-unified refund ledgers** (`pos_sale_exception` +
`merchant.refund`).

| Metric                   | Status                                | Evidence                                              |
| ------------------------ | ------------------------------------- | ----------------------------------------------------- |
| Gross sales (POS)        | ✅ now                                | `receipt_snapshot.grand_total`                        |
| Net of refunds           | ⚠️ SQL-now (derivable)                | subtract `pos_sale_exception`                         |
| Discounts / comps        | ✅ / ⚠️ split                         | `order_discount.kind`                                 |
| Voids                    | ✅                                    | `order_item.voided_at` / `pos_sale_exception`         |
| Refunds                  | ✅ (separate source)                  | `pos_sale_exception`, `merchant.refund`               |
| Tips                     | ✅                                    | `snapshot.tip`                                        |
| **Tax / IVA**            | ⚠️ **SQL-now** (stored, not surfaced) | `snapshot.tax`, `pos_cart_line.tax_rate_basis_points` |
| Item / category mix      | ✅                                    | `pos_cart_line` + `product_category`                  |
| Payment-method mix       | ✅                                    | `pos_tender_fact` + wallet allocation                 |
| **Channel (POS/WA/web)** | ⚠️ **SQL-now** (POS-only today)       | `customer_order.source` unused by summary             |
| Cashier/employee         | ⚠️ shift-level only                   | `cash_shift.responsible_operator_id`                  |
| **COGS / margin**        | ❌ **schema gap**                     | no cost columns; inventory tracks quantities only     |

Three tiers: **reportable now**, **SQL-reachable now** (net-of-refund, IVA breakdown,
channel split — data exists, queries don't), and **schema gap** (COGS/margin needs a
cost dimension before any margin metric).

### 9.2 Current money-hub, as-built — Gap 7 [C]

Screens (all bespoke, not DomainWorkspace): `reportes.jsx` → `ventas-report.jsx`
(Resumen · Tabla dinámica · Recibos) + `reembolsos.jsx`; `cash-shifts.jsx` →
`caja-turnos.jsx` + `registros.jsx`. **Your by-job move is already partly shipped**:
Recibos has dissolved into a Ventas inner toggle, and Reembolsos is already a
loss-prevention lens with a "Por operador" breakdown.

Backend: `apps/umi-api/src/modules/dashboard-operations/` — `GET /operations`
(snapshot, limit 50), `/operations/reports/sales?range`, `/operations/cash-shifts/:id`,
`/operations/sales/:saleId/receipt`. `salesSummary()` runs ~10 live aggregate queries
(totals, prior-window delta, items, payment/wallet mix, product mix, by-operator,
by-hour, series). RLS via `runWithMerchant` GUCs.

Gaps to close: **no export anywhere**, refunds capped at one 50-row page (no period
aggregate), client-side search, **no cross-location roll-up**, hand-rolled
single-series CSS charts, CFDI not built.

### 9.3 Multi-branch / RLS — Gap 8 [C]

Tenancy is **two-level and flat**: `merchant` → `location`. A **sucursal is a
location** (child of one merchant); there is **no chain/cadena/org table**. A "cadena"
= one merchant with many locations; a **multi-brand** operator = separate merchant
rows with no schema link (café switcher).

- **Multi-branch within one merchant: possible today.** `location_narrowing` is
  opt-in — omit `locationId` and every branch's rows return, tagged by location. Only
  **roll-up aggregate queries** (`GROUP BY location_id`) are missing (app-layer).
- **True cross-merchant "cadena": needs work** — app fan-out per merchant, or a new
  `org` table + `current_org()` resolver + rewriting ~46 RLS policies.

**Correction to two prior memories** (verified 2026-09-13 against `90_rls.sql`): the
cash_shift `device_scoping` bug is **fixed** — `using (true)` with the device check on
writes only (90_rls.sql:594-611); same for `pos_sale_exception`. And the InitPlan
wrapper `(select umi.current_merchant())` is now applied to 41 policies (0 bare).
Caveat: a rehearsal DB built from an older dump may still show the old behaviour until
rebuilt.

### 9.4 Real data (Kalala rehearsal DB) — Gap 9 [C]

Only **Kalala** has transactional data. Of 68 orders, **53 WhatsApp / 15 POS**, but
only **10 POS sales (Sep 2–5)** are fully paid + receipt-backed. Reality check:

- **100% cash, 0 card. No tips, no discounts.**
- **No IVA anywhere** — `tax_rate_basis_points = 0` on all 136 products; every
  receipt `taxTotal = 0`. A "desglose de IVA" report has no real numbers _yet_.
- **No COGS** — `merchant.product` has only `price`; inventory/recipe tables empty.
- Refunds only in `pos_sale_exception` (2 full, 1 partial, 1 void).
- A **balanced cash-shift reconciliation** exists (expected $598 = counted $598).
- The 53 WhatsApp orders have `location_id = NULL` and no channel tagging — the
  data-quality prerequisite for the wedge.

Consequence: build on the POS receipt/tender/cash data that exists; render IVA,
margin/COGS, tips, card-mix, discounts as explicit **"needs data" states**, not
numbers averaged from fiction.

### 9.5 Build constraints — Gap 12 [C]

Vite + React (JSX) SPA; react-router v6; money-hub uses a bespoke `_useAsync` hook
(not React Query); **no charting library** (hand-rolled CSS bars); Lingui 6 with an
**error-level lint gate** on unlocalised strings; the mobile shell needs a nav-label
map entry per route. NestJS backend; **no materialized views** (every report is ~10
live queries, location-scoped). **The AI plumbing is already live end-to-end**:
`LLM_COMPLETION` choke point + the `customers/:id/description` pattern (deterministic
KPIs → compact JSON → completion → **fingerprint 6h TTL cache → fail-safe null → UI
hides card**); DeepSeek Phase 1 shipped. Deploy: Cloudflare Pages; `build-v3` staging
→ `api-staging.umiconsulting.co` on a real backfilled Postgres.

**Effort:** an AI narrative over the existing sales summary ≈ **2–4 days** (endpoint +
cache + card + strings + contract type + tests); new SQL/metrics/viz → 1–2 weeks.

---

## 10. Screenshot source index

Local copies were pulled to the session scratchpad during research; the durable
sources are the URLs. External images cannot be embedded in a Claude Artifact (CSP),
so they are linked, not inlined.

**PoloTab** (vendor): `polotab.com/producto/creacionReportesNew.avif`,
`agrupacionNew.avif`, `multiSucursalNew.avif`, `tablasDinamicasNew.avif`.
**Toast**: tech.co `Reporting.png`, `toast-home-setup…png`; businessnewsdaily
`toast-reporting.png`; business.com `toast-analytics-1.png`.
**Square**: dpl.company `Square-Analytics-Report-1.png`, `-Locations.png`,
`Square-POS-Sales-Report.png`; coupler.io export shots.
**Lightspeed**: theretailexec crozdesk `…Lightspeed-Sales-reporting.png`,
`…Lightspeed-Dashboard.png`; business.com `lightspeed-analytics-1.png`;
kitchenbusiness `Lightspeed-reports-products-dashboard-web.jpg`.
**Odoo**: cybrosys `odoo-17-enterprise-reporting-{1..7}.png`, pivot/dashboard shots.
**LatAm**: Soft Restaurant `analytics.png` + `…dashboard.png`; Parrot arcade.software
hub/ventas/artículos; Fudo intercomcdn `ranking_camareros.png`, `Filtros1.png`;
Wansoft `…portal-admin…webp` + App Store iOS; NCR docs
`Results_*Reports_*.png`; Rappi `images.rappi.com/…reporteventas/…`.

Full per-source detail (page URLs, per-image descriptions, reviewer quotes) is in the
research-swarm transcripts for this session.
