# Umi Dashboard — Completeness Audit

Scope: `/home/jc/umi/apps/umi-dashboard` (React/JSX). Branch `chore/build-v3-checkpoint`.
Date: 2026-09-06. Method: CodeGraph + source reads. Evidence is `file:line`.

## Executive summary

The dashboard is **substantially complete and wired to real backend endpoints** — no
mock/fake data layer, no no-op handlers, no skipped tests, no "coming soon" strings. All
`_apiFetch` calls hit real `/api/merchants/...` routes (`src/data.jsx`). The big open
work is the **workflow-redesign tail** (operations bridge not deleted, Ajustes not
consolidated, Panorama cockpit shallow), a few **read-only-by-policy hub tabs**, and a
**thin automated-test surface**. Both flagged in-flight bugs (cash-shift RLS, refunds/
voids RLS) are FIXED in the schema.

Architecture note: most nav items are thin wrappers around **one workhorse**,
`DomainWorkspace` in `src/screens/operations-workspace.jsx` (2800 lines), fed by the
single `merchants.operations` read model via `useOperationsData(domain)`
(`data.jsx:1066`). Five "money hub" domains get purpose-built editorial views; every
other domain renders a generic card+table (`operations-workspace.jsx:2298-2308`).

---

## Per-area status

### Navigation / IA — ✅ Done (~90% of redesign)
- 6 sections HOME/OPERATIONS/CUSTOMERS/BUSINESS/CONFIGURATION/PLATFORM
  (`lib/module-registry.js` `MODULE_ORDER` :175-206). `Crecimiento`/GROWTH **removed**.
- `operations` (Centro operativo) **dissolved from nav** — not in `MODULE_ORDER`; route
  kept as bridge (`app.jsx:247-254`).
- Hubs-with-tabs built via `HubTabs` (`shell.jsx`): cash-shifts, catalog-inventory,
  loyalty-value, diagnostics.
- Redirects preserved: `/members`,`/gift-cards`→`/loyalty-value`; `/insights`,
  `/conversations`→`/customers` (`app.jsx:329-335`). Catch-all `*`→`/`.
- Deferred (see redesign plan §8): Ajustes consolidation, `operations.jsx` deletion.

### Overview / KPIs (overview.jsx) — 🟡 Partial
- Real data (`useOverviewData`, `overview.jsx:16`). Follows an "honesty doctrine":
  renders `–` / "sin calcular" for uncomputed metrics rather than faking
  (`overview.jsx:26-56, 108-131`). Many deltas (`revenueDeltaPct`, `memberDeltaPct`,
  `birthdayActivatable`, `highBalanceCount`, `walletProcessedToday`, `avgTicketMXN`) will
  stay blank unless the backend computes them.
- "Centro de acción" surfaces **only one alert type** — the local `ordersPaused` toggle
  (`overview.jsx:60-69`). No real alert feed.
- Redesign plan explicitly **defers** Panorama Phase-2 cockpit deepening (plan §8).

### Cafés / locations (cafes.jsx, settings.jsx) — ✅ Done
- Platform-gated (`cafes.jsx:355` `platformRole !== 'super_admin'`), `useCafes` +
  `provisionCafe` (`cafes.jsx:7,350`). Locations: create/save + geocoding in settings
  (`data.jsx:1143-1179`, `settings.jsx:1186,1358,1492`).

### Catalog & Inventory (catalog-inventory.jsx) — 🟡 Partial
- Tabs Catálogo / Categorías / Inventario (`catalog-inventory.jsx:12-16`).
- Catalog: full create/edit via `CatalogDialog` (`operations-workspace.jsx:937`).
- Inventory: `InventoryDialog` "Operar" adjustments (`operations-workspace.jsx:315`) —
  "direct inventory mutations stay online-only by product policy"
  (`catalog-inventory.jsx:9-10`). Generic-table domain; functional, read + adjust only.

### Categories / colors (categories-workspace.jsx) — ✅ Done
- Real CRUD + color picker; persists via `createCatalogCategory`/`updateCatalogCategory`
  (`categories-workspace.jsx:28-39,108-124`). Server seeds a curated palette colour; owner
  recolours; POS paints it behind photo-less products. **Known item: category colors =
  DONE.**

### Orders (orders.jsx) — ✅ Done (read-only by design)
- `useOrdersData` (`orders.jsx:79`), filters/channels/counts. Lifecycle status is
  **READ-ONLY** here — advanced from KDS/Cocina (`orders.jsx:404-407,606-607`). Matches
  the product rule (dashboard/KDS boards are read-only for advance).

### Cash & shifts / turnos (cash-shifts.jsx) — ✅ Done
- Tabs Ventas·Recibos·Reembolsos·Turnos de caja·Registros (`cash-shifts.jsx:11-17`).
- Purpose-built editorial views: `CashShiftsView`, `SalesView`, `ReceiptsView`,
  `RefundsView`, `RegistersView` (`operations-workspace.jsx:2298-2304`).
- Dialogs: `RefundDialog` (:104), `ReceiptReprintDialog` (:635), `RegisterDialog` (:1098).
- **RLS bug FIXED** (see Known items). Cash movement stays POS-only by policy — hub shows
  record + authorized actions.

### Kitchen / cocina (cocina.jsx) — 🟡 Partial
- Thin wrapper → `DomainWorkspace domain="kitchen"` (`cocina.jsx:9`). Generic table +
  `KitchenRouteDialog` for station routing (`operations-workspace.jsx:1178`). Setup only;
  live cook board stays on KDS/overview by design. Functional but minimal.

### Devices (devices.jsx) — ✅ Done
- Largest real screen (2231 lines). Full enroll/pair/approve/deny/revoke via `data.jsx`
  (`:682-811`). `console.error` only on failures (`devices.jsx:635,648,942,956,1699,2134`).
  Hardware domain removed by owner decision (redesign plan corrections, §7).

### Members / Staff (staff.jsx) — ✅ Done
- `createStaffMember`/`updateStaffMember`, roles, permissions, invites, PIN
  (`staff.jsx:10-15,54-56`). Real.

### Gift cards (gift-cards.jsx) — ✅ Done
- `issueGiftCard` + `redeemGiftCardByCode` + `useGiftCardsData` (`gift-cards.jsx:7`). Now a
  tab of the loyalty-value hub; `/gift-cards` redirects.

### Loyalty (members.jsx + loyalty-value hub) — 🟡 Partial
- **Members is a REAL program, not an estimator**: `registerMember`, `useMembersData`,
  sort by visits/balance/LTV/inactive (`members.jsx:8,19-25,45`); reward-config edited in
  settings (`settings.jsx:22`, `data.jsx:353,531`).
- Hub tabs `Recompensas` and `Wallet` are **read-only generic tables** — not in
  `DOMAIN_VIEWS`, no row action button (`operations-workspace.jsx:2298-2304`,
  action buttons list :2588-2659 has no rewards/wallet case). Wallet funding read-only by
  policy; rewards program config lives in settings, not this tab.

### Customers & Conversations / CRM (customers.jsx, conversations.jsx) — ✅ Done (real)
- **Customer 360 is real, not a scaffold**: profile tabs, timeline
  (`customers.jsx:288-291,925`), insights metrics (`useCustomerInsights` →
  `/insights/customer-platform`, `data.jsx:978-987`, `customers.jsx:945-946`), identity
  merge candidates (`customers.jsx:704`), memory tab (:934), product chips
  whatsapp/cash/orders (:868-880). The `placeholder` classNames at :798/815/826 are
  empty/loading/error states, not stubs.
- Conversations: real WhatsApp list (`useConversationsData` → `/conversaflow/conversations`,
  `data.jsx:1054-1065`, `conversations.jsx:8-14`), paginated. Folded into Customers via
  redirect.

### Hours (hours.jsx) — ✅ Done
- Business hours, special notice, phone blocklist, WhatsApp pause **persisted** via
  `acceptsOrders` from `hoursData` (`hours.jsx:109,126,166-173`). conversaflow-gated.

### Diagnostics (diagnostics.jsx) — 🟡 Partial
- Wrapper → `DomainWorkspace` recovery/audit/diagnostics (`diagnostics.jsx:10-14`).
  Generic tables + `RecoveryDialog` (`operations-workspace.jsx:1266`). Admin-gated
  (`module-registry.js` permissions `audit.read`,`hardware.diagnostics`). Functional but
  generic presentation; owner-insights-migration classification only partially applied.

### Settings (settings.jsx) — ✅ Done (mostly)
- 1661 lines. Business profile, voice/tone assistant (conversaflow-gated,
  `settings.jsx:432-533`), locations + geocoding, reward config (`data.jsx:531`). D9
  "Ajustes consolidation" (fold hours + products-billing into tabs here) **deferred**
  (plan §8) — they stay separate CONFIGURATION items.

### Profile (profile.jsx) — ✅ Done
- Personal, ungated (`app.jsx:374`). Access method + permissions view.

### Billing / products (products-billing.jsx) — 🟡 Partial
- **Display-only** entitlement status cards (dashboard/conversaflow/kds/cash/
  observability) — `isProductStatusActive` (`products-billing.jsx:53,101-135`). **No actual
  billing / subscription / payment management.** Platform-gated with a documented masking
  bug: a platform operator who also holds a café role is refused
  (`module-registry.js` `products-billing` comment :~95-115).

### Automations — 🔴 Missing (as a dashboard surface)
- No dedicated automations/rules/workflow builder screen exists (grep for
  automation/rule/trigger/flujo finds only comments). Automation is owned by ConversaFlow
  (WhatsApp auto-orders); the dashboard exposes only voice/tone (settings), hours, and the
  WhatsApp pause. Absent if automations are expected in-dashboard; likely out of scope.

### Auth / login (login.jsx, reset-password.jsx) — ✅ Done
- Email/password + OTP flow (`login.jsx`; "000000" at :419 is placeholder text only),
  reset-password min-8 (`reset-password.jsx:136`). `RequireAuth` gate (`app.jsx:432-450`)
  via `lib/auth.jsx`.

### i18n / localization — ✅ Done (essentially complete)
- Lingui, Spanish source + English catalog. **1 empty `msgstr` out of 975 msgids** in
  `src/locales/en/messages.po`. **Zero `lingui/no-unlocalized-strings` suppressions**
  (`eslint-suppressions.json` holds only `no-unused-vars` ×14, `react-hooks/*` ×7).
- Non-Lingui files are legitimate: `cocina.jsx` (no strings), `tweaks-panel.jsx`
  (dev-only, English by design, `eslint-disable` at `app.jsx:381-427`).

---

## Known in-flight items — verified status

1. **Cash-shifts empty for owners (RESTRICTIVE device_scoping RLS)** — ✅ **FIXED.**
   `docs/migration/build-v3/90_rls.sql:594-611`: `device_scoping` on `merchant.cash_shift`
   now `using (true)` (open SELECT, falls through to tenant isolation) with the device
   predicate moved to `with check` (writes only). Same fix applied to
   `merchant.pos_sale_exception` (Reembolsos) at `90_rls.sql:613+`. Caveat: takes effect
   only where the migration is applied to the DB.

2. **i18n → Lingui migration** — ✅ **Complete across screens.** 1/975 untranslated, no
   i18n lint suppressions. See i18n area above.

3. **Workflow redesign (dissolve operations, drop Crecimiento, hubs-with-tabs)** —
   🟡 **~90%.** Nav regroup + Crecimiento removal + hub construction + operations removed
   from nav = done. `operations.jsx` is now a self-described **BRIDGE** reusing
   `DomainWorkspace` (`operations.jsx:6-12`) — **not** a duplicate implementation, so the
   duplication is dissolved in code. Still open: Ajustes tab consolidation (D9),
   `operations.jsx` file deletion (kept because `organization`/`locations`/`memberships`
   domain tables live only there; plan §8), Panorama deepening.

4. **Category colors / refunds-voids in dashboard** — ✅ **DONE.** Colors:
   `categories-workspace.jsx` (real CRUD + picker). Refunds/voids: `RefundDialog` +
   `RefundsView` + the pos_sale_exception RLS fix above.

5. **Loyalty real vs placeholder** — 🟡 **Real program (members), thin hub extras.**
   Members/points/reward-config are real; the hub's Recompensas + Wallet tabs are
   read-only generic tables (no config UI, read-only by policy).

6. **Conversations/customers CRM real vs scaffold** — ✅ **Real.** Customer 360 with
   timeline, platform insights, identity merge, memory, product chips; WhatsApp
   conversations from ConversaFlow. Not a scaffold.

---

## Test coverage gap

Only **10 spec files**, mostly utilities/registry: `data.devices.spec`, `shell.spec`,
`build-config.spec`, `module-registry.spec`, `theme.spec`,
`administrative-command-identity.spec`, `devices.pos-card.spec`, `profile-format.spec`,
`operations.spec` (15 lines), `device-utils.spec`. **No tests** for the major workflow
screens: orders, staff, settings, gift-cards, hours, members, customers,
operations-workspace, overview, cafes, login, conversations, loyalty-value, cash-shifts,
diagnostics, catalog-inventory, categories-workspace. No `.skip`/`xit`/`it.todo`.

---

## Prioritized unfinished list

- **P1 — `operations.jsx` bridge not retired; org/locations/memberships lack a real home.**
  These three domain tables live only in the bridge (plan §8), reachable only by typing
  `/operations` (no nav row). settings covers org profile + locations and staff covers
  people, so the bridge is largely redundant but undeleted → dead-ish surface + an
  un-navigable path. Confirm coverage, redirect `/operations`→`/`, delete file.
- **P1 — Panorama/Overview cockpit is shallow.** Single alert type; several KPIs render
  blank pending backend delta computation. Phase-2 deepening deferred (`overview.jsx:60-69`).
- **P2 — Loyalty hub Recompensas + Wallet tabs are read-only generic tables** (no rewards
  program config in-hub; wallet read-only by policy) (`operations-workspace.jsx:2298-2304`).
- **P2 — products-billing is display-only** (no real billing/subscription mgmt) and carries
  a documented platform-role **masking bug** (`module-registry.js` products-billing comment).
- **P2 — Ajustes (D9) consolidation deferred** — hours + products-billing remain separate
  CONFIGURATION items instead of settings tabs (plan §8).
- **P3 — Automated test coverage** absent on all major workflow screens (10 util-level
  specs only).
- **P3 — Automations**: no dashboard surface (owned by ConversaFlow) — gap only if
  in-dashboard automation is a requirement.
- **P3 — Kitchen (cocina) and Diagnostics** render as generic tables — minimal
  purpose-built UI vs the money hub's editorial views.
- **Note — `tweaks-panel.jsx` dev artifact** ships in the bundle, gated by
  `CFG.environment === 'development'` (`app.jsx:382`).
