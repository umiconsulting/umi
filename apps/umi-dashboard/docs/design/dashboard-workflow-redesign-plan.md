# Umi Dashboard — Workflow Redesign Implementation Plan

_Every decision below names its research basis and its CodeGraph/code scope. Companion
to `dashboard-workflow-redesign-research.md`. Written in ASD-STE100._

Date: 2026-09-03. Branch: build-v3.

---

## 0. Rules for this plan

- **Non-breaking.** Each phase keeps the entitlement guards. Each removed route keeps a
  redirect. No URL returns 404.
- **Additive first.** Build a new home before you remove the old path. (Jakob's Law:
  protect familiarity.)
- **Reuse, do not rebuild.** The `operations` screen already holds every domain's data
  hook and command dialog. Relocate them; do not re-implement them.
- **One design system.** Reuse tokens, `RegionHead`, cards, and the `customers` hub
  pattern. (NN/G, Consistency and Standards.)
- **Verify each move.** Run the focused tests and the `dashboard-customer-ux-validation`
  skill after each phase.

---

## 1. Facts that bound the scope (CodeGraph + source)

- **IA source of truth:** `src/lib/module-registry.js` (`MODULES`, `MODULE_ORDER`,
  section keys, entitlement axes).
- **Nav consumers (codegraph):** `lib/merchant-context.jsx` (`getVisibleModules`,
  `canShowModule`), `app.jsx` (`MODULES` for `GuardedScreen`), `shell.jsx`
  (`SECTION_LABELS`, Topbar `titles`, `locationScoped`).
- **Backend mirror:** `apps/umi-api/src/modules/merchants/module-registry.ts`. It carries
  a `section` field, but no API response reads `.section`. So sections are
  frontend-canonical; the backend copy is documentation. A parity note asks the keys to
  match.
- **`operations` blast radius (codegraph impact):** only `app.jsx` and `main.jsx`.
- **`useOperationsData` callers (codegraph):** only `operations.jsx`.
- **Duplication map (`ACTION_ROUTES` in operations.jsx):** organization→/settings,
  locations→/settings, memberships→/staff, devices→/devices, customers→/customers,
  loyalty→/members, rewards→/members, gift_cards→/gift-cards, kitchen→/orders.
- **Data reuse:** the Dashboard read model is one endpoint, `merchants.operations`, keyed
  by `domain`. `useOperationsData(domain)` already serves all 21 domains. New hubs reuse
  it. No new Dashboard endpoint is needed.
- **The 21 domains and labels (`dashboard-operations.policy.ts`):** organization
  (Organización), locations (Ubicaciones), memberships (Usuarios y membresías), devices
  (Dispositivos POS), registers (Registros), hardware (Hardware), catalog (Catálogo),
  inventory (Inventario), sales (Ventas), receipts (Recibos), refunds_voids (Reembolsos y
  anulaciones), cash_shifts (Turnos de caja), customers (Clientes), loyalty (Lealtad),
  rewards (Recompensas), wallet (Wallet), gift_cards (Gift cards), kitchen (Cocina y KDS),
  recovery (Centro de recuperación), audit (Auditoría), diagnostics (Diagnóstico).

---

## 2. Target information architecture (recommended)

| Section       | Item (top level)      | Sub-tabs (domains it absorbs)                                             | New or exists                                        |
| ------------- | --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| HOY           | Panorama              | role-aware cockpit                                                        | exists (overview)                                    |
| OPERACIÓN     | Pedidos               | live orders                                                               | exists (orders)                                      |
| OPERACIÓN     | Caja y turnos         | Ventas · Recibos · Reembolsos y anulaciones · Turnos de caja · Registros  | NEW hub                                              |
| OPERACIÓN     | Cocina                | estaciones · ruta (KDS)                                                   | exists (part of orders) — optional tab               |
| CLIENTES      | Clientes              | perfil con pestañas                                                       | exists (customers)                                   |
| CLIENTES      | Lealtad y valor       | Lealtad · Recompensas · Gift cards · Wallet                               | NEW hub (absorbs members + gift-cards)               |
| NEGOCIO       | Catálogo e inventario | Catálogo · Inventario                                                     | NEW hub                                              |
| NEGOCIO       | Dispositivos          | Dispositivos POS · Hardware                                               | exists (devices) + absorbs hardware                  |
| NEGOCIO       | Equipo y accesos      | usuarios · roles · permisos                                               | exists (staff)                                       |
| CONFIGURACIÓN | Ajustes               | Negocio (Organización · Ubicaciones) · Horarios · Productos y facturación | exists (settings) + absorbs hours + products-billing |
| CONFIGURACIÓN | Diagnóstico (admin)   | Centro de recuperación · Auditoría · Diagnóstico                          | NEW admin hub                                        |
| PLATAFORMA    | Cafés                 | management + top switcher                                                 | exists (cafes)                                       |

Result: 6 sections, 11-12 items, each with strong scent, each a single home. The generic
`operations` browser is gone. `Crecimiento` is gone. Every orphan domain has a home.

Open owner decisions:

- Fold `Cocina` into `Pedidos` as a tab, or keep it top level.
- Put `Wallet` in `Lealtad y valor`, or as a `Clientes` tab.
- Put `Registros` in `Caja y turnos`, or in `Dispositivos`.

---

## 3. Decision ledger — each decision, research, and scope

### D1. Remove the `Crecimiento` section

- **Decision:** Delete the `GROWTH` section. Move `members` and `gift-cards` under a new
  `CLIENTES` section.
- **Research:** Information scent — abstract theme labels carry almost no signal; group by
  the owner's job; the customer is the through-line. (NN/G, Information Scent; 3 IA
  Mistakes; Personas vs. JTBD.)
- **CodeGraph / code scope:**
  - `module-registry.js`: change `section` on `members` and `gift-cards`.
  - `shell.jsx` `SECTION_LABELS`: remove `GROWTH`; add `CLIENTES`.
  - `module-registry.ts` (backend mirror): update the same `section` values; widen the
    `section` type union.
  - Specs: `module-registry.spec.js`, `module-registry.spec.ts`.
  - No screen logic changes. The sidebar groups from `visibleModules`.
- **Risk:** low. Fully reversible.

### D2. Regroup and reorder sections by the operator's day

- **Decision:** New sections: `HOY`, `OPERACIÓN`, `CLIENTES`, `NEGOCIO`, `CONFIGURACIÓN`,
  `PLATAFORMA`. Daily jobs on top. Settings and Diagnostics near the bottom.
- **Research:** Organize by the owner's day; order by frequency; keep two tiers; keep the
  grouped, always-visible sidebar. (NN/G, Intranet IA; Menu Design; IBM Carbon.)
- **CodeGraph / code scope:** same files as D1. `MODULE_ORDER` sets the order.
  `SECTION_LABELS` sets the Spanish names. Sidebar rendering in `shell.jsx` needs no logic
  change.
- **Risk:** low. Reversible.

### D3. Make `Panorama` the only home; give `operations` no nav row

- **Decision:** Remove `operations` from `MODULE_ORDER` and the sidebar. Redirect
  `/operations` to `/` (Panorama).
- **Research:** One canonical entry per task; a home triages and links, it does not
  re-host. (NN/G, Duplicate Links; Pogo-Sticking; Shopify/Stripe Home.)
- **CodeGraph / code scope:**
  - `impact OperationsScreen` = `app.jsx`, `main.jsx` only. Safe.
  - `app.jsx`: replace the `operations` route with `<Navigate to="/" replace />`.
  - `module-registry.js` + `.ts`: remove the `operations` entry from the order (or keep
    the key for permission grouping but hide it from nav).
  - Keep `operations.jsx` on disk until Phase 5.
- **Risk:** low for the redirect. The screen file stays until its parts move.

### D4. Build `Caja y turnos` (relocate sales, receipts, refunds, shifts, registers)

- **Decision:** New hub screen with tabs `Ventas · Recibos · Reembolsos y anulaciones ·
Turnos de caja · Registros`. Reuse the existing dialogs (Refund, Receipt reprint,
  Register).
- **Research:** Jobs not tables; hub with in-page tabs; one primary action per tab; keep
  daily jobs shallow. (NN/G, Complex Application Design; IBM Carbon tabs; Design Language
  V1.)
- **CodeGraph / code scope:**
  - Data: reuse `useOperationsData('sales' | 'receipts' | 'refunds_voids' | 'cash_shifts'
| 'registers')`. No new endpoint.
  - Dialogs to move from `operations.jsx`: `RefundDialog`, `ReceiptReprintDialog`,
    `RegisterDialog`.
  - New file: `screens/cash-shifts.jsx` (or `caja-turnos.jsx`).
  - `app.jsx`: add the route behind `GuardedScreen`. `module-registry.js` + `.ts`: add the
    module (product `dashboard`, the matching permissions, `locationScoped: true`).
  - `shell.jsx`: add the title to `titles`; add the key to `locationScoped`.
- **Risk:** medium. Data and authority do not change. The change is presentation.
- **Note:** `cash_shifts` and `registers` write actions stay POS-owned by policy. The hub
  shows the read model and the authorized Dashboard actions only. (`PRODUCTO_Y_NEGOCIO`:
  "Cash movement remains POS-only.")

### D5. Build `Catálogo e inventario` (relocate catalog, inventory)

- **Decision:** New hub with tabs `Catálogo · Inventario`. Reuse `CatalogDialog` and
  `InventoryDialog`.
- **Research:** Give each orphan domain a home; recognition over recall; one accent per
  view. (NN/G, Recognition and Recall; Design Language V1.)
- **CodeGraph / code scope:**
  - Data: `useOperationsData('catalog' | 'inventory')`.
  - Dialogs: `CatalogDialog`, `InventoryDialog` from `operations.jsx`.
  - New file: `screens/catalog-inventory.jsx`.
  - `app.jsx`, `module-registry.js` + `.ts`, `shell.jsx` (title + locationScoped).
- **Risk:** medium. Presentation only.

### D6. Build `Lealtad y valor` (absorb members + gift-cards; relocate rewards, wallet)

- **Decision:** New hub with tabs `Lealtad · Recompensas · Gift cards · Wallet`. Keep the
  existing `members.jsx` and `gift-cards.jsx` content as the first two tabs. Add
  `rewards` and `wallet` from the operations read model.
- **Research:** Group customer value by the customer job; hubs with tabs; consistency.
  (NN/G, Personas vs. JTBD; Consistency and Standards.)
- **CodeGraph / code scope:**
  - Data: `useMembersData`, `useGiftCardsData` (exist), plus
    `useOperationsData('rewards' | 'wallet')`.
  - Dialogs: `LoyaltyDialog`, `GiftCardIssueDialog` from `operations.jsx`.
  - New shell: `screens/loyalty-value.jsx`, or extend `members.jsx` to host tabs.
  - `app.jsx` route; `module-registry.js` + `.ts` (product `cash`, loyalty/wallet
    permissions).
  - Redirect `/members` and `/gift-cards` into the hub tabs; keep the old paths as
    redirects.
- **Risk:** medium. `wallet` funding stays read-only by product policy.

### D7. Extend `Dispositivos` to absorb `hardware`

- **Decision:** Add a `Hardware` tab to the devices screen. Reuse `HardwareDialog`.
- **Research:** One home per asset class; progressive disclosure. (NN/G, Progressive
  Disclosure.)
- **CodeGraph / code scope:**
  - Data: `useDevicesData` (exists) + `useOperationsData('hardware')`.
  - Dialog: `HardwareDialog` from `operations.jsx`.
  - `devices.jsx` gains a tab. `app.jsx` route unchanged. `module-registry.js` label may
    read `Dispositivos`.
- **Risk:** low to medium. `devices.jsx` is already large (2,100 lines); add a tab, do not
  merge logic.

### D8. Build `Diagnóstico` (admin) — recovery, audit, diagnostics

- **Decision:** New admin-gated hub with tabs `Centro de recuperación · Auditoría ·
Diagnóstico`. Reuse `RecoveryDialog`.
- **Research:** Move diagnostics into owner-safe views; technical codes only in
  Diagnostics; gate by permission. (owner-insights-migration skill; Design Language V1;
  NN/G, Audience-Based Navigation.)
- **CodeGraph / code scope:**
  - Data: `useOperationsData('recovery' | 'audit' | 'diagnostics')`.
  - Dialog: `RecoveryDialog` from `operations.jsx`.
  - New file: `screens/diagnostics.jsx`. `app.jsx` route with the admin permission gate.
  - `module-registry.js` + `.ts`: add the module with `audit.read` /
    `hardware.diagnostics` permissions.
  - Apply the `owner-insights-migration` classification: owner-facing vs admin-gated vs
    internal-only. Keep raw traces out.
- **Risk:** medium. Governance-sensitive; use the migration skill rules.

### D9. Absorb `organization`, `locations`, `hours`, `products-billing` into `Ajustes`

- **Decision:** Make `Ajustes` a hub with tabs `Negocio (Organización · Ubicaciones) ·
Horarios · Productos y facturación`.
- **Research:** Push setup to a bottom settings area; group by the setup job. (NN/G,
  Intranet IA.)
- **CodeGraph / code scope:**
  - `settings.jsx` (1,561 lines) gains tabs. `hours.jsx` and `products-billing.jsx`
    content becomes tabs or stays behind redirects.
  - `ACTION_ROUTES` already sends organization and locations to `/settings`, so the read
    model fits.
  - `module-registry.js` + `.ts`; `shell.jsx` titles; keep `/hours` and
    `/products-billing` as redirects.
- **Risk:** medium. `settings.jsx` is large; add tabs, keep logic split.

### D10. Keep `Cafés` as a switcher plus one management entry

- **Decision:** Keep the merchant switcher in the sidebar footer and the location select
  in the Topbar. Keep `Cafés` as one platform management entry.
- **Research:** Never place unbounded user lists in the primary nav; use a switcher. (IBM
  Carbon.)
- **CodeGraph / code scope:** small. The switcher already exists in `shell.jsx` footer and
  Topbar. No new work beyond section placement.
- **Risk:** low.

### D11. Panorama becomes a role-aware cockpit

- **Decision:** Keep the overview shape. Add role-aware content and jump-off links to the
  new hubs. Keep the honesty doctrine.
- **Research:** Overview at a glance, each number a jump-off; visibility of system status;
  order by frequency. (NN/G, Dashboards; Visibility of System Status.)
- **CodeGraph / code scope:** `overview.jsx` (410 lines) + `useOverviewData`. Link targets
  update to the new routes.
- **Risk:** low to medium.

### D12. Registry parity (frontend and backend sections)

- **Decision:** Keep sections frontend-canonical. Update the backend mirror to the same
  keys. Widen the backend `section` type union. Update the parity note.
- **Research:** Consistency and a single source of truth. (NN/G, Consistency and
  Standards.)
- **CodeGraph / code scope:** `module-registry.ts` type + values;
  `module-registry.spec.ts`. No API response reads `.section`, so no runtime risk.
- **Risk:** low.

---

## 4. Phase order (each phase ships and is reversible)

| Phase | Content                                                                     | Decisions            | Risk    | Gate                                         |
| ----- | --------------------------------------------------------------------------- | -------------------- | ------- | -------------------------------------------- |
| 1     | Nav only: sections, order, remove Crecimiento, redirect /operations         | D1, D2, D3, D10, D12 | low     | unit tests + shell.spec + manual nav check   |
| 2     | Panorama cockpit                                                            | D11                  | low-med | overview tests + UX validation               |
| 3     | Dissolve operations part A: Caja y turnos, Catálogo e inventario            | D4, D5               | med     | tests + UX validation + parity vs operations |
| 4     | Dissolve operations part B: Lealtad y valor, Dispositivos+Hardware, Ajustes | D6, D7, D9           | med     | tests + UX validation                        |
| 5     | Diagnóstico (admin) + remove legacy operations.jsx                          | D8 + cleanup         | med     | owner-insights-migration rules + full suite  |

Ship gates every phase: `tdd` for new logic, `code-review` on the diff, `pr-gates` before
merge, `dashboard-customer-ux-validation` for customer-facing hubs.

---

## 5. Skills mapped to phases

- **Phase 1:** CodeGraph (`impact`, `callers`) to confirm no hidden nav consumer;
  `domain-modeling` to fix section and hub names.
- **Phase 2-4:** `prototype` (UI branch) to pick hub layouts; `codebase-design` for the
  hub and tab seams; `dashboard-customer-ux-validation` as the gate.
- **Phase 5:** `owner-insights-migration` for the Diagnóstico classification;
  `repository-cartographer` to confirm no dead references before deletion.
- **Every phase:** `tdd`, `code-review`, `pr-gates`, and `run` / `playwright-cli` to see
  the app.

---

## 6. What does not change

- The API keeps all authority. The Dashboard stays a consumer. (Gate 5A.)
- The entitlement model keeps its three axes: product, permissions, platform.
- The token contract and the honesty doctrine stay.
- Cash movement stays POS-only. Wallet funding stays read-only. (Product policy.)

---

## 7. Locked decisions (2026-09-03) and sequencing correction

Owner decisions:

- `Cocina` stays a top-level item. It is not a tab of `Pedidos`.
- `Wallet` goes in `Lealtad y valor`.
- `Registros` goes in `Caja y turnos`.

Sequencing correction (safety): do NOT redirect or delete `operations` in Phase 1.
The orphan domains have no other home until the hubs exist. Keep `operations`
reachable as a bridge through Phase 4. Remove it, redirect `/operations`, and delete
the file only in Phase 5, after each hub proves parity.

---

## 8. Delivery status (2026-09-03)

Implemented on branch build-v3, verified in the running app and by unit tests (31
passing) and ESLint (clean).

Done:

- Phase 1 — nav regroup. Sections HOY, OPERACIÓN, CLIENTES, NEGOCIO, CONFIGURACIÓN,
  PLATAFORMA. `Crecimiento` removed; loyalty and gift cards moved under CLIENTES.
- Shared foundation — extracted `DomainWorkspace` (data + table + 10 dialogs) into
  `screens/operations-workspace.jsx`; added `HubTabs` to `shell.jsx` and CSS.
- Phase 3 — new hubs `Caja y turnos` (sales, receipts, refunds, cash shifts, registers)
  and `Catálogo e inventario` (catalog, inventory).
- Phase 4 — `Lealtad y valor` hub (Lealtad, Recompensas, Gift cards, Wallet; absorbs
  members + gift-cards; `/members` and `/gift-cards` redirect in); `Dispositivos` hub
  (Dispositivos + Hardware); `Cocina` top-level (kitchen).
- Phase 5 (part) — `Diagnóstico` admin hub (recovery, audit, diagnostics). `Centro
operativo` removed from the sidebar; its `/operations` URL kept as a bridge.

Deferred, with reason:

- `Ajustes` consolidation (settings + hours + products-billing into one tabbed hub).
  Reason: `settings.jsx` is large and `hours`/`products-billing` carry conditional
  entitlement (conversaflow product, platform grant), so a tabbed hub needs per-tab
  gating. The current CONFIGURACIÓN section is already compact. Low risk to leave as is.
- Full deletion of `operations.jsx`. Reason: `organization`, `locations`, and
  `memberships` domain tables live only there; `settings` and `staff` cover the same
  ground as real screens, but keep the bridge until that coverage is confirmed.
- Panorama (Phase 2) cockpit deepening. Its jump-off links still resolve, so no change
  was required for correctness.

Files added: `screens/operations-workspace.jsx`, `screens/cash-shifts.jsx`,
`screens/catalog-inventory.jsx`, `screens/loyalty-value.jsx`, `screens/devices-hub.jsx`,
`screens/diagnostics.jsx`, `screens/cocina.jsx`.
Files changed: `lib/module-registry.js`, `shell.jsx`, `app.jsx`, `screens/operations.jsx`,
`styles.css`.

### Correction (2026-09-03): Dispositivos is one surface, not tabs

Owner feedback: devices and hardware are the same category, so a Dispositivos/Hardware
tab split is false separation, and adding printers later must not add a tab. Fix:
`devices-hub.jsx` now stacks the devices sections and the hardware section on one page,
no tabs. New device types (printer, drawer, scanner, scale) join this surface. This tab
pattern stays only where the tabs are genuinely distinct sub-domains (Caja y turnos,
Lealtad y valor, Catálogo e inventario, Diagnóstico).

### Correction (2026-09-03): remove hardware; keep only devices

Owner decision: hardware is not used; Dispositivos is devices only. Changes:

- Frontend: removed the `HardwareDialog` and the hardware domain from
  `operations-workspace.jsx`; removed `hardware.read`/`hardware.diagnostics` from the
  operations bridge module; deleted the `members`/`gift-cards` module entries folded
  into `loyalty-value`.
- Backend: removed the `hardware` domain from `DASHBOARD_DOMAIN_POLICY` (21 → 20
  domains) and the same stale hardware permissions from the mirror registry. Updated the
  service spec to 20.
- Kept on purpose: the `hardware.*` COMMANDS in the contract (receipt reprint uses
  `hardware.printer.reprint`), the `diagnostics` hub, and the POS hardware runtime.
  These are not the "device browsing" surface the owner removed.
- Runtime note: the API runs from a compiled build. The backend change takes effect on
  the next API rebuild/restart. The running instance was not restarted, to avoid
  disrupting the live stack.
