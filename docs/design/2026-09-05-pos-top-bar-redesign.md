# POS top-bar redesign — decision log

- Date: 2026-09-05
- Scope: the barista operating screen's top app bar (`apps/umi-pos/lib/features/catalog/catalog_surface.dart`, the `AppBar` `actions:` list).
- Method: every decision is judged on two axes before it is accepted.
  - **UX** — the rule from the research, with its source.
  - **Meta (main plan)** — the operation-driven frame
    ([operation-driven design](2026-09-05-operation-driven-owner-observability-and-pos-friction.md)):
    two users, one operation. The **barista wants speed** → erase friction on the
    frequent (⚡) actions; the **owner wants safety/observability/control** →
    money ($) and administration are observed/managed on the owner side
    (dashboard) or gated by role. **The barista screen serves the barista's
    frequent tasks with minimum friction.**
- Research inputs:
  [navigation & cashier-vs-manager IA](../research/2026-09-05-pos-navigation-and-cashier-vs-manager-ia.md)
  and [POS UX design principles](../research/2026-09-05-pos-ux-design-principles.md).
- Problem: the bar carried ~11 icon-only controls plus a status chip and two text
  labels — over the Material 3 count (3-4 trailing icons), and every control was
  icon-only (a tooltip, no visible label).

## Structural decisions

| #   | Decision                                                                                  | UX (rule + source)                                                                                                   | Meta (main plan)                                                   | Verdict |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| D1  | Give each primary action a visible **text label** (not only a tooltip)                    | An icon needs a visible label; a tooltip does not satisfy it (NN/g icon usability)                                   | The barista recognises instead of recalls → less friction each use | ✅      |
| D2  | Cap the bar at **~4 primary actions**; the rest go to a **"Más" overflow**                | ≤3-4 trailing icons, rest to overflow (Material 3, Apple HIG)                                                        | Less noise on the barista's frequent path                          | ✅      |
| D3  | Split by **frequency**: frequent stays on the surface, rare goes to overflow              | Progressive disclosure; hidden nav is costly (~50% less discoverable, ~39% slower) so only the rare is hidden (NN/g) | Protects the barista's speed; only the rare is hidden              | ✅      |
| D4  | Consolidate identity + exit into one **account menu** (operator · branch · Lock · Logout) | Group related controls; separate status/identity from actions (Apple HIG)                                            | Frees space for the frequent actions; keeps Lock one tap away      | ✅      |

## Per-item decisions

| #   | Item                        | Decision                                                                      | UX (rule + source)                                                               | Meta                                                   | Verdict |
| --- | --------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ | ------- |
| D5  | Nueva venta                 | **Primary (out of the kebab)**                                                | Most frequent action; never bury the frequent (NN/g)                             | ⚡ barista → top priority                              | ✅      |
| D6  | Centro de caja → **"Caja"** | **Primary (open/close drawer)**; corte/report → dashboard                     | Cashier ends drawer on POS; reconciliation/report is back-office (Square, Toast) | Barista action stays; owner's corte moves to dashboard | ✅      |
| D7  | Ventas (history)            | **Primary**; refund/void gated by role inside                                 | Same-day lookup/reprint is front-of-house; void/refund gated (Toast)             | Lookup = barista; refund = $ gated                     | ✅      |
| D8  | Adjuntar cliente            | **Primary**                                                                   | Per-transaction, frequent                                                        | ⚡ barista                                             | ✅      |
| D9  | Suspender / Cancelar        | **Overflow** (Cancelar confirmed + role)                                      | Rarer; destructive → overflow low-priority (Apple)                               | Off the frequent path; risk controlled                 | ✅      |
| D10 | Centro de clientes (CRM)    | **Overflow**                                                                  | Not a per-transaction task (progressive disclosure)                              | Not ⚡ barista                                         | ✅      |
| D11 | Inventario                  | **Overflow / manager** (quick "86" stays a later add)                         | Inventory edit is a manager permission (Square)                                  | Admin/control → gated                                  | ✅      |
| D12 | Centro de hardware          | **Overflow now; setup → dashboard**; POS keeps status + reprint + open-drawer | Hardware setup is back-office in all 4 vendors                                   | Removes an admin tool from the fast path               | ✅      |
| D13 | Recuperación (offline)      | **Overflow** (ideally contextual when pending)                                | Rare technical exception (progressive disclosure)                                | Zero noise unless it matters                           | ✅      |
| D14 | Bloquear                    | **Account menu (one tap)**                                                    | Frequent on a shared terminal; safety                                            | ⚡ + safety → reachable                                | ✅      |
| D15 | Cerrar sesión               | **Account menu**                                                              | End-of-shift, rarer than Lock (Apple overflow-low-priority)                      | Off the primary bar                                    | ✅      |
| D16 | Estado de conexión          | **Keep visible (compact)**                                                    | Visibility of system status                                                      | Tells the barista what is possible                     | ✅      |
| D17 | Operador + sucursal         | **Fold into the account menu**                                                | Group identity/status apart from actions (Apple)                                 | Frees space                                            | ✅      |
| D18 | Diagnóstico (debug)         | **Overflow, debug-only** (unchanged gating)                                   | Developer tool, not production                                                   | Not barista-facing                                     | ✅      |

## Resulting bar

- **Primary (visible, labelled):** Nueva venta · Caja · Ventas · Adjuntar cliente — plus the compact connectivity chip and the account menu.
- **Overflow "Más":** Suspender · Cancelar · Centro de clientes · Inventario · Hardware · Recuperación · (Diagnóstico in debug).
- **Account menu:** operator name + branch header · Bloquear · Cerrar sesión.

Net: ~11 icon-only controls → **4 labelled primaries + status chip + account menu + one overflow**.

## Follow-ups (not in this POS pass)

- **Dashboard-side moves:** hardware **setup** (pairing/config), full inventory ops, and the cash **corte/reconciliation** report + variance thresholds belong on the owner dashboard (per the research). This pass only removes them from the barista's primary bar; the dashboard homes are separate work.
- **Minimal hardware surface on POS:** status + reprint + open-drawer as a small control, instead of the full "Hardware center". Staged.
- **Shift close vs corte permissions:** make reconciliation admin-only (remove `cash.reconcile` from the Cashier role). Staged.
- **Quick "86" (mark unavailable):** a cashier-fast inventory action, separate from full inventory ops. Staged.
- **Responsiveness:** on a narrow width the labelled bar may need to drop labels; the target terminal is landscape ≥1280, so labels are kept for now.
