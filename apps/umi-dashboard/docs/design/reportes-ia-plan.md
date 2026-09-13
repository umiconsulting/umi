# Reportes IA — Proposal

The target information architecture for Umi's Reportes area, grounded in
[`reportes-ia-research.md`](./reportes-ia-research.md). Draft for founder review —
open decisions are listed in §7.

Date 2026-09-13.

---

## 1. Thesis

**Reportes is an owner-facing, mobile-first, job-organised answer surface — not a
chart library.** It leads with the daily rituals every café operator already does
(cierre de caja, theft check, "did I sell more?"), turns each report into "here's
what changed and what to do", and earns its wedge by reporting on the two things no
US giant can and only Fudo partly can: **WhatsApp-driven sales** and **delivery +
in-store consolidation**. The contador is served by clean **fiscal exports**, not a
dashboard.

This is mostly a **consolidation + narrative layer + gap-closing** effort, not a
rebuild: the by-job direction is already half-shipped (Recibos dissolved into Ventas;
Reembolsos is already a loss-prevention lens), the sales aggregate is a clean
LLM-consumable fact source, and the AI plumbing already ships live.

## 2. Audience

- **Owner** (primary) — smartphone-first, basic-to-medium digital literacy, wants a
  glance and a decision. Everything below is designed for the phone first.
- **Manager/encargado** (first-class, scoped) — the target segment is **owner +
  manager, multi-shift** (decision §7.2), so the manager is a first-class consumer of
  **shift-scoped** operational reports (Ventas, Reembolsos, Caja y turnos for their
  turno), reusing existing role grants (`sale.refund.*`, `cash.shift.close.approve`).
  Multi-shift makes the business-day rollover, multi-turno-per-day, and per-cashier
  scoping load-bearing, not optional.
- **Contador** (not a dashboard user) — consumes a month-end fiscal export.

## 3. The organising principle: jobs, not documents

Nav is grouped by the operator's job, in the order they care (research §4). This is
the founder's `recibos-reportes-split-by-job` decision, now evidence-backed.

| # | Job (owner's words) | Surface | Cadence |
|---|---|---|---|
| 1 | "¿Cuadró mi caja?" | **Caja y turnos** (corte X/Z, faltante/sobrante) | daily ritual |
| 2 | "¿Me están robando?" | **Reembolsos / pérdidas** (by cashier, anomaly-flagged) | daily/weekly |
| 3 | "¿Vendí más o menos?" | **Ventas** (hero KPIs + delta + narrative) | daily glance |
| 4 | "¿Cómo voy de costos?" | **Costos** (prime cost: labor % + food %) | weekly |
| 5 | "¿Qué platillo da dinero?" | **Menú** (quadrant) | monthly |
| 6 | "¿Estoy en regla con el SAT?" | **Fiscal / facturación** (export) | monthly |
| 7 | Café lens (attach rate, day-part) | woven into Ventas + Menú | always |

## 4. Target IA

Keep the nav **flat** — Square's 2025 over-nesting is the cautionary tale. Reportes
stays one OPERATIONS-section entry with a short, stable child list.

```
Reportes
├── Ventas            ← the landing answer surface (default)
│     Resumen · Tabla dinámica · (Recibos folded in)   [existing, extend]
├── Reembolsos        ← loss-prevention lens, by cajero  [existing, extend]
├── Menú              ← menu-performance quadrant         [new]
└── Fiscal            ← CFDI/global status + contador export [new, read-model]

Caja y turnos         ← sibling OPERATIONS entry (cash-first, already strong)
├── Turnos de caja    [existing]
└── Registros         [existing]
```

**Ventas** opens on a phone-sized answer: a hero total + prior-period delta, then a
one-line **AI narrative in Spanish** ("Ayer vendiste $X, 12% más que el martes;
Americano y Latte fueron el 40% de las ventas"), then the KPI tiles, the trend chart,
the payment-mix, and — the wedge — a **channel row (POS · WhatsApp · Delivery)**.
Tabla dinámica (group by producto/categoría/barista/hora) stays as the power view.

**Every report page** follows the modern bar: filters (rango + sucursal + canal) →
tabs (Gráficas / Resumen / Desglose) → one-click export. Each carries a **compare
control** (vs. período anterior) and **data-freshness label** (real-time vs. delayed).

## 5. Current → target (reuse vs build)

| Piece | State | Action |
|---|---|---|
| `salesSummary` aggregate | ✅ rich, LLM-ready | **Reuse** as the fact source for the narrative + KPIs |
| Ventas Resumen / Pivot | ✅ built | **Extend** — add compare, channel row, export |
| Reembolsos "Por operador" | ✅ built | **Extend** — period aggregate (drop 50-row cap), anomaly flag |
| Caja y turnos reconciliation | ✅ strong (cash math, X/Z, separation-of-duties) | **Keep**; surface faltante/sobrante as headline; owner read now works (RLS fixed) |
| AI narrative | ✅ pattern exists (`describe()`) | **Clone** into `/operations/reports/sales/insight` |
| Export (CSV/PDF) | ❌ none | **Build** — first the contador fiscal export, then per-report CSV |
| Channel split | ⚠️ SQL-now | **Build query** + fix per-order channel tagging |
| IVA breakdown | ⚠️ SQL-now | **Build query** (data stored; seed real IVA on products) |
| Cross-location roll-up | ⚠️ needs GROUP BY | **Build** aggregate queries (RLS already allows) |
| Menu quadrant | ⚠️ no COGS | **Build** popularity × **retention** first (no COGS); CM later |
| COGS/margin | ❌ schema gap | **Defer** — needs a cost dimension on inventory |

## 6. Phased roadmap

**Phase 1 — Answer + wedge (cheap, high-signal). ~1–2 weeks.**
- AI Spanish narrative on Ventas (clone `describe()`; DeepSeek). ~2–4 days.
- Channel row (POS · WhatsApp · Delivery) on Ventas — the wedge made visible.
  *Prerequisite:* clean per-order channel tagging (today WhatsApp orders have
  `location_id = NULL`, no channel).
- Compare-to-prior control + data-freshness labels across existing reports.
- Fix the WhatsApp/delivery attribution data quality (the gate for everything).

**Phase 2 — Close the obvious gaps. ~2–3 weeks.**
- IVA/impuestos breakdown (SQL-now; seed real `tax_rate_basis_points` on products).
- Net-of-refunds in the Ventas summary; unify the two refund ledgers in the read model.
- Reembolsos period aggregate + per-cashier anomaly flags (loss-prevention job).
- Per-report CSV export; the **contador month-end fiscal export** (CFDI/global status).
- Cross-location roll-up (GROUP BY location) for multi-sucursal owners.

**Phase 3 — Depth & differentiation.**
- Menú quadrant — popularity × retention first (Customer 360), CM once COGS exists.
- Delivery-aggregator consolidation with margin-after-commission (Rappi/UberEats/DiDi).
- Conversational-health → revenue (needs outcome attribution).
- COGS/margin: add a cost dimension to inventory (schema work), then true prime cost.

## 7. Decisions (locked 2026-09-13)

1. **Fiscal scope → export first.** Reportes does **not** issue CFDI. The Fiscal
   surface is a read-model over facturación state (global status, IVA, cancelaciones)
   plus a **month-end contador export**. Issuance/timbrado stays the separate backend
   track. Reportes consumes and reconciles.
2. **Segment → owner + manager, multi-shift.** The manager is a first-class,
   **shift-scoped** consumer (see §2). Business-day rollover, multi-turno-per-day, and
   cross-location roll-up (within one merchant) are in scope; role-scoped views are
   required, not optional.
3. **Wedge → channel wedge, delivered through the AI narrative.** The narrative's
   headline job is to surface channel performance (POS · WhatsApp · Delivery); the
   Spanish AI summary *carries* the wedge rather than competing as a bare assistant.
   Differentiate vs. Fudo on native conversational commerce + Customer 360; lead the
   less-crowded delivery-consolidation angle where Umi already has Rappi data.
4. **Data quality → yes, enforced.** Clean per-order channel/attribution tagging is a
   **blocking Phase 1 prerequisite**. Today WhatsApp orders carry `location_id = NULL`
   and no channel tag; the fix (ingestion + backfill) gates the channel row and the
   wedge — nothing channel-split ships until tagging is trustworthy.
5. **Cost gate → DeepSeek.** The narrative runs on `LLM_PROVIDER=deepseek`
   (Phase 1 shipped, OpenAI-compatible adapter at the `LLM_COMPLETION` choke point),
   behind the existing fingerprint 6h cache + fail-safe null so per-café cost stays
   bounded.

## 8. Risks & honesty notes

- **The demo data is thin and tax-free.** No IVA, no COGS, no card, no tips in the
  Kalala rehearsal set. Design must render honest **"needs data" states**, and Phase 2
  should seed realistic IVA/cost before showing fiscal/margin reports to anyone.
- **The WhatsApp wedge is contested by Fudo.** Differentiate on *native* conversational
  commerce + Customer 360, not a bolt-on agent — and lead with delivery consolidation,
  which is less crowded and where Umi already has Rappi data.
- **Live-query cost.** Every report is ~10 live aggregates with no materialized views;
  cross-location and wide-window reports may need a rollup table before they scale.
- **AI trust.** Reuse the existing fail-safe null + cache pattern; never show an
  ungrounded number. Narrate only facts computed deterministically.
- **Lingui gate.** All new copy goes through `<Trans>`/`` t`` `` or CI fails.
