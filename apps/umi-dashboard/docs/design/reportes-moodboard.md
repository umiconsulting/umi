# Reportes — Moodboard & North-Star Teardowns

Taste anchor for the Reportes redesign: annotated teardowns of **PoloTab** (the north
star) and **Square**, each from real screenshots, with a synthesis rule for Umi.
Companion to [`reportes-design-system.md`](./reportes-design-system.md) and
[`reportes-patterns.md`](./reportes-patterns.md). Screenshot sources are indexed in
[`reportes-ia-research.md`](./reportes-ia-research.md) §10.

## The synthesis rule (read this first)

**Square's ledger + restraint for reading numbers; PoloTab's color + density +
plain-Spanish builder for navigating and exploring.** Clarity where money is read,
richness where the operator moves around. Everything below serves that split.

---

## PoloTab teardown (north star)

_From: chart-builder, heatmap grouping, multi-sucursal P&L, editable pivot._

- **Layout:** fixed left rail (~220px / ~56 collapsed) + one wide content column on
  pure white. Low chrome — content sits on white, not in boxed cards. Calm vertical
  rhythm: greeting → filter row → KPI row → chart pair (2-up) → table, separated by
  large (~40–56px) whitespace bands. Centered with side gutters, not edge-to-edge.
- **Color:** white ground, near-black text, one vivid electric blue (~#2563EB) accent,
  used semantically. Deltas green-up / red-down. Standout = the **diverging red↔blue
  heatmap** (red = worst day/branch, blue = best) — worst/best read pre-attentively
  before any number. Waterfall reuses blue = value / red = deduction.
- **Type:** geometric sans; tight hierarchy (colored eyebrow → bold H1 greeting → gray
  timestamp). Numbers are the system: full peso format `$#,###.00`, tabular alignment,
  big-number + inline colored delta repeated everywhere.
- **Nav:** icon rail with **color-coded module glyphs** (Reportes green, etc.); active =
  pale-tint pill + colored label. **Chain/branch switcher pinned top**, branded human
  support ("Soporte · TíoPolo") pinned bottom.
- **Report anatomy:** metric selector + Histórico + Comparar (shown disabled = honest
  state) + Acciones; second filter row (Método de Pago, Mes grouping, NL search); KPI
  tiles with value + delta + info tooltip; **waterfall (Cascada)**, combo column+line
  dual-axis, full **P&L (Estado de Resultados)**; **editable/reorderable pivot** with
  drag handles + "Cambiar columnas" + "Guardar"; a **plain-Spanish chart-builder** sheet
  with live preview and "Recomendado" defaults (¿Qué visualizar? / ¿Cómo agrupar? /
  Cálculo / Tipo).

**STEAL:** diverging heatmap; plain-Spanish chart-builder w/ live preview + Recomendado
defaults; waterfall P&L; one value+delta+tooltip KPI; branded human support pinned
bottom; editable pivot with explicit Guardar; one peso number-format contract.
**AVOID:** low-contrast text on saturated cells (set a WCAG floor); 5-up KPI row + 8-col
heatmap with no responsive plan; color-only wayfinding when collapsed (needs tooltips);
dense metric names (COGS/Varianza) without glossary tooltips for a low-literacy owner.

---

## Square teardown

_From: Sales Summary, Locations, COGS, old Sales, nav+export, summary-emails, home._

- **Layout:** two-pane — fixed left report list (~200px) + wide content pane; full-width
  control bar, then a loose chart grid (one full-width line, two half-width below) and
  the balance-sheet table. Generous whitespace, tall table rows, hairline dividers.
  Content fills the pane edge-to-edge (suits dense number tables). Focused drill-downs
  (COGS) open as a full-screen modal with an X.
- **Color:** very restrained — white, near-black text, gray secondary; **one** blue
  accent for charts/active-nav/links; pale-blue area fill under solid stroke; flat solid
  bars. KPI deltas add the only extra color (green/red/gray pills) — semantic.
- **Type:** small ALL-CAPS gray section labels; the **Gross→Net balance-sheet table** is
  the star — right-aligned money columns (Sales/Returns/Net), bold subtotal rows,
  negatives in parentheses. Big-number KPI tiles (tiny caps label / large bold figure).
- **Nav:** flat text-only report list, active = blue tint/fill. The **2025 consolidation**
  folds reports into collapsible groups (Reports / Accounting / Payments / Operations) +
  a global search. Locations = multi-select with search + count in the trigger.
- **Report anatomy:** control bar (date stepper ‹ ›, day-part, locations, Summary view,
  Advanced Options, Export pinned right); line/area trend with hover tooltip; day-of-week
  bars + time-of-day area; Gross→Net money-walk; COGS = 4 KPI tiles + per-item table
  with "–" for empty cells. **Scheduled summary emails** live in Settings > Notifications.

**STEAL:** the **Gross→Net balance-sheet table** (clearest money-walk in POS reporting —
copy verbatim, adapt to MXN/IVA); KPI tiles with colored delta pills + "vs prior" baked
in; one-accent restraint + ledger typography; location multi-select with count;
scheduled summary emails as a zero-effort report channel; full-screen modal for focused
drill-downs. **AVOID:** gray-on-gray labels near the legibility floor (bump weight/size);
flat mono-blue charts (under-differentiate multi-series); the old flat report list (use
the grouped nav).

---

## Where each wins (take the best of both)

| Dimension                      | Winner            | Umi takes                                            |
| ------------------------------ | ----------------- | ---------------------------------------------------- |
| Reading money (tables)         | **Square**        | the Gross→Net ledger table + tabular restraint       |
| KPI + delta tiles              | tie               | Square's "vs prior" default + PoloTab's info tooltip |
| At-a-glance texture / charts   | **PoloTab**       | heatmap, waterfall, warmer color, density            |
| Lowering the analytics barrier | **PoloTab**       | plain-Spanish builder + Recomendado defaults         |
| Restraint / focus on numbers   | **Square**        | one accent, high contrast, no chart clutter          |
| Nav / multi-sucursal identity  | **PoloTab**       | branch switcher pinned; color-coded modules          |
| Report list scale              | **Square (2025)** | grouped/collapsible nav, not a flat scroll           |
| Push reporting                 | **Square**        | scheduled summary emails/WhatsApp                    |
| Human support                  | **PoloTab**       | branded support pinned in-shell                      |

**Contrast/legibility is the shared failure** (PoloTab saturated cells, Square gray
labels) — Umi must beat both by holding a WCAG floor (see `reportes-patterns.md` §7).
Umi already ships a **dark rail on a light canvas**, so it can land between the two:
Square's clarity in the content, warmth in the shell.
