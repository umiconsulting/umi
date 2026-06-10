---
name: dashboard-customer-ux-validation
description: "Validate Umi Dashboard customer-facing owner UX for Customers sidebar navigation, customer profile tabs, customer timeline, conversation detail, Insights, responsive owner admin UI, desktop/mobile browser checks, entitlement gating, and text/layout overlap."
---

# Dashboard Customer UX Validation

## Overview

Use this skill after designing or editing the owner-facing Dashboard customer experience. It checks that the customer platform UX is useful, entitlement-safe, responsive, and consistent with Umi's operational dashboard style.

## Workflow

1. Confirm the route owner:
   - Dashboard shell, Customers, Insights, and owner-facing conversations: `apps/umi-dashboard`
   - ConversaFlow write model and WhatsApp runtime: `apps/umi-conversaflow`
   - Cash loyalty/wallet behavior: `apps/umi-cash`
2. Verify navigation:
   - `Customers` is reachable from the sidebar as the customer hub.
   - Conversation detail is reachable from both Customers and active Conversations when applicable.
   - Cash/Loyalty/Wallet tabs are hidden, disabled, or marked unavailable when Cash is inactive.
3. Validate customer profile structure:
   - Header shows name, normalized phone, product badges, last touch, and clear actions.
   - Tabs use owner-facing labels such as Overview, WhatsApp, Orders, Loyalty, Wallet, Notes, Data.
   - Timeline events are grouped, scannable, and product-labeled.
4. Validate conversation detail:
   - Owner-readable thread comes first.
   - Customer context, order/KDS state, memory health, and handoff/status controls are visible without raw traces.
   - Diagnostics are collapsed, admin-gated, or omitted.
5. Validate Insights:
   - Each metric has a drill-down row set or clear owner action.
   - Memory and embedding health are phrased as quality/status, not raw AI internals.
6. Run browser verification when a runnable UI exists:
   - Check a desktop viewport and a mobile viewport.
   - Inspect for overlapping text, clipped controls, horizontal scroll traps, broken nav, and unreadable dense tables.
   - Capture screenshots when layout judgment is uncertain.
7. Record UX findings as blockers or non-blockers with exact route, viewport, and user impact.

## UI Standards

- Favor compact tables, tabs, drawers, state badges, timeline rows, and direct actions.
- Avoid decorative hero sections, nested cards, card-in-card layouts, and marketing copy.
- Keep controls stable in size across loading, empty, and populated states.
- Do not use visible instructional text to explain the UI; make labels and actions clear.
- Prefer restrained owner-admin density over oversized headings or decorative layouts.

## References

- Read `references/browser-checklist.md` before final UI verification or review.
