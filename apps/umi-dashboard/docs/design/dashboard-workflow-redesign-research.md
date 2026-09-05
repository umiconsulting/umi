# Umi Dashboard — Workflow Redesign Research Dossier

_Proven UX research (functional design philosophy + human psychology) mapped onto a
current-state audit of the owner console, a CodeGraph scope, and a non-breaking plan.
Companion to `login-redesign-research.md`. Written in ASD-STE100._

Date: 2026-09-03. Branch: build-v3.

---

## 0. Thesis (read this first)

The dashboard does not need a new look. It needs a **compact, layered information
architecture**. One system already resolves the visual decisions (tokens, cards,
`RegionHead`, honest states). The problem is structural, not stylistic.

Three moves fix it:

1. **Remove duplication.** Dissolve the generic `Centro operativo` browser. Give each
   task exactly one home.
2. **Layer the app.** Use a small set of hub screens with tabs. A new feature becomes a
   tab in a hub, not a new sidebar row.
3. **Group by the operator's day.** Name sections and screens after owner jobs, not
   after database tables or abstract themes like `Crecimiento`.

---

## 1. Diagnosis — what is wrong with the `Centro operativo` screen

`apps/umi-dashboard/src/screens/operations.jsx` (1,870 lines). It is a two-column
browser: a numbered list of 21 domains on the left, one generic table on the right
(`Referencia · Detalle · Estado · Importe · Fecha · Acciones`) and about 10 modal
dialogs.

Its origin explains its shape. The product roadmap, Gate 5A, states:

> "Gate 5A adds a safe and paginated read model for all 21 operational domains … The
> Dashboard uses the same domain authority, approvals, fingerprints, and recovery as
> each operational client."

So the screen is a **certification proof surface**. It shows that the Dashboard can
reach every domain with the same authority as the POS. It was not designed as a daily
operator screen. The owner's own words: "created just to explain what was needed."

### 1.1 Duplication is the root defect (confirmed)

The 21 backend domains (`dashboard-operations.policy.ts`) split into two sets:

- **Domains that already have a rich, dedicated screen**, which `operations` repeats:
  `devices`, `customers`, `loyalty`, `gift_cards`, `kitchen`, `memberships` (staff),
  and `sales/refunds/receipts` (through Orders).
- **Orphan domains that have no home except this browser**: `organization`,
  `locations`, `registers`, `hardware`, `catalog`, `inventory`, `cash_shifts`,
  `wallet`, `rewards`, `recovery`, `audit`, `diagnostics`.

NN/G is direct about duplication: multiple paths to one destination raise interaction
cost and make users doubt whether the two paths differ, which causes pogo-sticking
(NN/G, "Are Duplicate Links Twice as Helpful?"; "Pogo-Sticking"). The screen is the
duplicate-path anti-pattern by definition.

### 1.2 The twin defect — orphan domains have nowhere else to land

The same screen is a duplicate **and** the only home for 12 orphan domains. So feature
growth has no natural place. A new domain becomes one more row in a generic table, or
one more top-level sidebar item. Both paths degrade as features grow.

### 1.3 Stale visual language

The screen still opens with `21 / DOMINIOS OPERATIVOS`, the `sec-index` ordinal that
the rest of the app removed on purpose. The `shell.jsx` comments record the decision:
"The groups are not a sequence … The number was there to look considered." So
`operations` speaks an older dialect than every other screen.

### 1.4 Wrong altitude and a cramped layout

The screen mixes altitudes. A generic table sits where a designed task screen should be.
A nested nav of 21 items squeezes into the content column, beside the real sidebar. Two
navigation systems compete on one page. The result reads as squeezed because it is.

---

## 2. Diagnosis — the IA around the screen

### 2.1 `Crecimiento` is a weak section (agreed)

`Crecimiento` holds `Lealtad` and `Tarjetas de regalo`. The label is an abstract theme,
not a job. NN/G's information-scent work says users predict a destination from its
label, and abstract labels carry almost no scent (NN/G, "Information Scent"; "3 Common
IA Mistakes"). "Growth" does not tell an owner what is behind it.

The content also belongs with the customer. Loyalty, gift cards, wallet, and rewards are
all customer value. The customer is the through-line. So the fix is to remove
`Crecimiento` and group customer value under the `Clientes` job.

### 2.2 Sections mix altitudes and will overflow

`OPERACIÓN` holds `Resumen` (a dashboard), `Centro operativo` (a meta-browser), and
`Pedidos` (a task screen) side by side. As the platform adds features, the flat model
pushes every new feature to the top level, which crowds the rail. Hick's Law: each new
top-level choice taxes every owner on every visit (Laws of UX, "Hick's Law").

---

## 3. Proven UX research (the two streams)

Full reports: `redesign-research-navigation-ia.md`, `redesign-research-psychology-flow.md`.
The directives below are proven, not experimental. Each names its source.

### 3.1 Navigation and information architecture

1. **One canonical entry point per task.** Remove duplicate paths. (NN/G, "Duplicate
   Links"; "Pogo-Sticking")
2. **Keep the grouped, two-tier, always-visible sidebar.** Never go three tiers; use
   in-page tabs for deeper content. (NN/G, "Menu Design"; IBM Carbon, UI shell left panel)
3. **Aim for about 4-6 items per group; reject a magic total.** Introduce a second level
   when a domain passes about 5 sub-screens. (Laws of UX, "Miller's Law"; Material 3;
   Toast Reports landing)
4. **Overflow rarely-used items; do not crowd the rail.** (Shopify app navigation;
   Salesforce Lightning; Laws of UX, "Hick's Law")
5. **Use concrete Spanish café nouns with strong scent.** Avoid `Hub`, `Centro`,
   `Explorar`. (NN/G, "Information Scent"; "3 IA Mistakes")
6. **Organize by the owner's day; order by frequency.** About 86% of modern IAs are
   task-based, not data-model based. Push settings to a bottom area. (NN/G, "Intranet IA")
7. **Gate by role and entitlement automatically; never ask the user to self-identify.**
   Keep a stable core so no role hits an empty shell. Add one "discover/activate" surface
   for unbought products. (NN/G, "Audience-Based Navigation"; Stripe Dashboard)
8. **Cafés is a location switcher, not nav rows.** Never place unbounded user lists in
   the primary nav. (IBM Carbon)

### 3.2 Psychology and interaction flow

1. **Chunk the screen; do not cap it at 7.** Working memory holds about 4 chunks. Group
   the home into a few labeled blocks. Do not force nav or tables to "7±2". (Laws of UX,
   "Miller's Law"/"Working Memory"; NN/G, "Chunking")
2. **Show one primary action per task; defer the rest.** (Laws of UX, "Hick's Law";
   Design Language V1)
3. **Make money actions large and close to the last field.** Respect tablet touch
   targets. (NN/G, "Fitts's Law"; "Touch Target Size")
4. **Protect familiarity; ship additively.** Do not move or rename a daily control
   without a bridge. (Laws of UX, "Jakob's Law")
5. **Reveal complexity gradually.** Daily core shallow; advanced settings one level
   deeper. (NN/G, "Progressive Disclosure")
6. **Favor recognition over recall.** Keep key data on the card. Pre-fill Mexican-café
   defaults. (NN/G, "Recognition and Recall")
7. **Group by proximity first; add borders sparingly.** Too many cards create false
   floors. (NN/G, "Proximity"; "Common Region")
8. **Keep system status always visible.** This is the top heuristic for an operations
   dashboard. (NN/G, "10 Usability Heuristics"; "Visibility of System Status")
9. **Enforce one design language.** New features reuse the same components. (NN/G,
   "Consistency and Standards")
10. **Prevent and forgive errors.** Confirm money actions by restating amount and
    customer; offer undo; plain-Spanish messages. (NN/G, heuristics #3, #5, #9)
11. **Design around jobs, not tables.** Name screens after owner jobs. (NN/G, "Personas
    vs. JTBD"; "Complex Application Design")
12. **Overview at a glance; detail on drill-down.** A few key numbers, each a jump-off
    point; bars and lines, not gauges. (NN/G, "Dashboards")

---

## 4. The design canon already in the app (extend, do not replace)

The current app already follows a strong doctrine. The redesign must keep it.

- **Honesty as trust.** The overview never renders an empty container. It never shows a
  green delta or an arrow for absent data. (`overview.jsx` comments; NN/G; Rams)
- **Restraint.** One accent color per view. Green is not a general primary. (Design
  Language V1)
- **One primary action per screen.** (Design Language V1)
- **Editorial figures.** Tabular numbers, hero metric, eyebrow, section head.
- **Accessibility.** Dot plus word, never hue alone. Named controls. WCAG AA. Reduced
  motion. (Design Language V1)
- **Token contract.** `packages/tokens` generates `dashboard.css`; a drift register
  guards divergence.

The daily flow (`PRODUCTO_Y_NEGOCIO.md`) is the backbone: before open the manager checks
health, cash, devices, catalog, and inventory, then opens the shift; during the day the
cashier sells and the Dashboard supervises; at close the team reviews shifts, sales,
refunds, inventory, recovery, and audit. Roles: Owner, Admin, Manager, Supervisor,
Cashier, Staff, Viewer.

---

## 5. The redesign direction — compact, layered, well thought out

- **Compact.** Fewer top-level items. Overflow rarely-used items. Hubs with tabs. No
  duplicate paths. Cafés becomes a switcher.
- **Layered.** Overview → hub → tab → detail. The daily core stays shallow. Advanced
  work goes one level deeper. This is progressive disclosure.
- **Well thought out.** One design system. Group by the operator's job. One entry per
  task. Honest states everywhere. The authorized-command power of `operations` moves
  into each hub as per-row actions with approvals and recovery. It does not stay a
  separate meta-browser.

### The hub pattern already exists

`customers.jsx` is the model: a list with search and segmented filters, a detail with a
header and tabs (`Overview · WhatsApp · Orders · Loyalty · Wallet · Notes · Data`), and a
grouped timeline. Reuse this pattern for the new hubs.

---

## 6. Proposed information architecture

### Option A — hubs with tabs, sections by the operator's day (recommended)

Sidebar (concrete nouns, daily jobs on top, settings at the bottom):

| Section | Item (hub) | Tabs / contents | Replaces / absorbs |
| --- | --- | --- | --- |
| HOY | Panorama | role-aware cockpit | overview |
| OPERACIÓN | Ventas y caja | Pedidos · Ventas · Recibos · Reembolsos · Turnos y caja | orders + sales/receipts/refunds + cash_shifts/registers |
| OPERACIÓN | Cocina | estaciones · ruta de cocina | kitchen (KDS) |
| CLIENTES | Clientes | perfil con pestañas (ya existe) | customers |
| CLIENTES | Lealtad y valor | Lealtad · Recompensas · Tarjetas de regalo · Wallet | members + gift-cards + rewards + wallet |
| NEGOCIO | Catálogo e inventario | Catálogo · Inventario | catalog + inventory (orphans) |
| NEGOCIO | Dispositivos | Dispositivos · Hardware · Registradoras | devices + hardware + registers |
| NEGOCIO | Equipo y accesos | personal · roles · permisos | staff + memberships |
| CONFIGURACIÓN | Ajustes | Negocio (organización/ubicaciones) · Horarios · Productos y facturación | settings + hours + products-billing + organization/locations |
| CONFIGURACIÓN | Diagnóstico (admin) | Recuperación · Auditoría · Diagnósticos | recovery + audit + diagnostics (orphans) |
| PLATAFORMA | Cafés | (also a top switcher) | cafes |

Result:

- Every one of the 21 domains gets a real, designed home.
- `Centro operativo` dissolves. Duplication ends.
- `Crecimiento` is gone. Its content moves under the `Clientes` job as `Lealtad y valor`.
- The sidebar stays about 10 items in 6 short sections. Each section holds 1-3 items.
- Feature growth lands as a new tab in a hub, not a new rail item.

### Option B — lighter, faster

- Keep the flat module list.
- Dissolve `operations` into only three new screens: `Catálogo e inventario`,
  `Caja y turnos`, and `Diagnóstico`.
- Merge `Crecimiento` into `Clientes`.
- Regroup sections by the operator's day.

Option B removes duplication and fixes `Crecimiento` with less work. Option A also solves
feature-growth scaling. **Recommendation: Option A**, delivered in the phases in Section 9.

Open decision for the owner: the exact hub boundaries (for example, is `Cocina` a hub or
a tab of `Ventas y caja`; does `Wallet` sit in `Lealtad y valor` or as a `Clientes` tab).

---

## 7. Scope (CodeGraph-backed)

Index: 1,121 files, 21,170 nodes, 54,056 edges (`codegraph status`).

- **`OperationsScreen` blast radius is small.** `codegraph impact OperationsScreen`
  returns only `app.jsx` and `main.jsx`. The screen is safe to dissolve behind a route
  redirect.
- **Shared design-system pieces:** `RegionHead` (used across many screens), `Sidebar`,
  `Topbar`, `Spark`, `MiniBars`. Change these once; every screen inherits.
- **The IA source of truth is one file:** `lib/module-registry.js` (`MODULES`,
  `MODULE_ORDER`, sections, entitlement axes). A nav change starts here.
- **Data contracts to preserve:** 19 hooks in `data.jsx` (for example `useOverviewData`,
  `useOrdersData`, `useOperationsData`). A reorganization must keep the same hooks and
  endpoints. The API owns authority; the Dashboard consumes it.
- **Entitlement model (three axes):** `product`, `permissions`, `platform`. The new hubs
  keep the existing `GuardedScreen` gate. Show only what a role and tenant can use.

CodeGraph limits to respect: it does not prove SQL or schema facts, and it can miss
indirect calls. Verify each move against the source and the tests.

---

## 8. Skills that drive the work

- **repository-cartographer** — build the factual module/domain/dependency map; confirm
  coupling before the refactor.
- **CodeGraph CLI** (`impact`, `callers`, `affected`) — per-change blast radius.
- **dashboard-customer-ux-validation** — the acceptance gate for each customer-facing hub.
- **owner-insights-migration** — the rules for moving diagnostics and insights into
  owner-safe views; governs the `Diagnóstico` hub and the orphan domains.
- **codebase-design** — deep-module vocabulary for hub interfaces (tabs, seams).
- **domain-modeling** — fix the ubiquitous language for hub and section names.
- **prototype** (UI branch) — throwaway UI variants on one route to choose hub layouts.
- **design** — Claude Design canvas for IA artboards and screen-flow mockups.
- **research** — background primary-source UX research (used to build this dossier).
- **tdd**, **code-review**, **pr-gates** — the execution and ship gates.
- **playwright-cli** / **run** — see the current and new screens in the real app.

---

## 9. Non-breaking phase plan

Every phase stays behind the existing entitlement guards. Every removed route keeps a
redirect, so no URL returns 404. Every phase reuses the existing components and tokens.

- **Phase 0 (done): research and scope.** This dossier.
- **Phase 1: nav only.** Edit `module-registry.js` sections and order. Remove
  `Crecimiento`. Regroup by the operator's day. No screen logic changes. Fully reversible.
- **Phase 2: Panorama.** Make the overview a role-aware daily cockpit. Keep the honest
  states.
- **Phase 3: dissolve `operations`.** Promote the orphan hubs first: `Catálogo e
  inventario`, `Caja y turnos`, `Diagnóstico`. Reuse the `customers` hub pattern. Move
  the authorized commands into each hub as per-row actions with approvals and recovery.
  Redirect `/operations` to `Panorama`.
- **Phase 4: consolidate.** Build `Lealtad y valor`, `Dispositivos`, and `Ajustes` as
  tabbed hubs.
- **Phase 5: remove the legacy browser.** Delete `operations.jsx` after each domain has a
  hub and parity is proven by tests and the UX validation skill.

---

## 10. Sources

- NN/G: Duplicate Links; Pogo-Sticking; Menu Design; Information Scent; 3 Common IA
  Mistakes; Intranet IA; Audience-Based Navigation; Chunking; Progressive Disclosure;
  Recognition and Recall; Proximity; Common Region; 10 Usability Heuristics; Visibility of
  System Status; Consistency and Standards; Fitts's Law; Touch Target Size; Personas vs.
  Jobs-To-Be-Done; Complex Application Design; Dashboards.
- Laws of UX: Hick's Law; Miller's Law; Working Memory; Jakob's Law.
- Design systems: IBM Carbon (UI shell left panel); Material 3 (navigation drawer);
  Shopify admin and app navigation; Stripe Dashboard; Salesforce Lightning; Toast; Square.
- Umi primary sources: `docs/product/UMIPOS_PRODUCT_ROADMAP.md` (Gate 5A);
  `docs/knowledge-base/PRODUCTO_Y_NEGOCIO.md`; `docs/design/UMIPOS_DESIGN_LANGUAGE_V1.md`;
  `apps/umi-dashboard/src/lib/module-registry.js`;
  `apps/umi-api/src/modules/dashboard-operations/dashboard-operations.policy.ts`;
  `apps/umi-dashboard/src/screens/{operations,overview,customers}.jsx`;
  `apps/umi-dashboard/docs/design/login-redesign-research.md`.
- Full research reports: `redesign-research-navigation-ia.md`; `redesign-research-psychology-flow.md`.
