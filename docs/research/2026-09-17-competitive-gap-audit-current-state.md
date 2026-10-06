# Competitive gap audit — the measure, re-taken 2026-09-17

- Date: 2026-09-17 (local, America/Mazatlan).
- The measure: the plan's **§5.1 eight openings** and **§5.3 twelve module leaders**, which came
  from `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md` and
  `docs/research/2026-09-06-competitive-scan-and-gap-audit/` (Lightspeed, Toast, Square, Odoo,
  PoloTab). The rivals named across those documents: **Square, Toast, Clover, Lightspeed, Odoo,
  Fudo, SoftRestaurant, PoloTab**.
- Why re-take it: §5.1 was written on 2026-09-15, and a great deal has landed since — the fiscal
  and tender rails, courses and staging, the offline acceptance proof, the table-order intake. A
  measure that is not re-taken is a memory.
- Method: every "current state" line below is read from the **worktree and the built database on
  2026-09-17**, not from the plan's own status table. Competitor capabilities are as recorded in the
  matrix, which is the primary-sourced comparison we already hold.
- Labels: **Leads** / **At parity** / **Behind**, each with the evidence that produced it.

## 1. The eight openings

| #   | Opening (the benchmark)                                                                                                                                                                           | Our state today                                                                                                                                                                                                                                                                                                                                                                                | Verdict                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Roles are weak in the middle of the market** — Toast publishes ~100 permissions, Odoo offers three levels                                                                                       | `umi.permission` holds **137** rows in the built schema; staff carry a `role_id`, `umi.role` distinguishes platform roles, and per-permission overrides exist in the POS (`operator_permissions.dart`) and gate the surfaces                                                                                                                                                                   | **Leads** on the catalog; make the count a published number                                                                                    |
| 2   | **Approval on action** — Fudo: PIN to touch another waiter's table. SoftRestaurant: password/fingerprint for cancel, discount, comp, **re-open**, **reprint**                                     | Built as **thresholds and permissions** rather than blanket blocks: `manual_terminal_approval_threshold`, `cashier_discount_threshold`, `custom_discount_requires_approval`, `waste_approval_threshold`, negative-stock approval in procurement, `APPROVAL_REQUIRED` in cash, and a manager-PIN flow in the till's checkout                                                                    | **At parity, and better shaped** — threshold-based beats blanket. **Gaps: comp, re-open and reprint have no approval gate at all**             |
| 3   | **Offline is open ground** — Fudo calls the internet indispensable; Square allows offline card only inside a window; Toast needs a local hub                                                      | Durable journal + **ordered** replay + unknown-before-reuse, all proven in SQL as of today; the OS connectivity source landed today; **the policy is cash-only offline** (`offline_policy.dart` refuses any non-cash method)                                                                                                                                                                   | **Leads.** Card is excluded by design, not by accident, and the product says so                                                                |
| 4   | **Loyalty, gift cards and WhatsApp are a regional gap** — Fudo and PoloTab have none of the three; ship **tiers** and a reward catalog                                                            | Reward catalog, points ledger, gift cards, stored value and the WhatsApp channel all exist. **Tiers do not exist anywhere** — no column, no table, no route, no screen. Consent records on marketing fields are also missing                                                                                                                                                                   | **Leads on four of five, and the fifth is the one this opening names.** See gap A                                                              |
| 5   | **Recipes are the deepest moat** — SoftRestaurant has sub-recipes, unit conversion, cooking loss; Square cannot nest, cannot put a recipe on a modifier, cannot put one on a multi-variation item | Present: **unit conversion** (`conversion_numerator`/`denominator` + `rounding_policy`), **recipe on a modifier** (`modifier_id` on `inventory_recipe_component`), **yield** (`yield_quantity/scale/unit`), **waste** (`waste`, `effect_waste`, `waste_approval_threshold`), versioned recipes with `effective_at`/`retired_at`. **Absent: nesting** — nothing lets a recipe reference another | **At parity with SoftRestaurant on four of five, ahead of Square on three of its four limits. The moat is one column away.** See gap B         |
| 6   | **Table timers are cheap and rare** — Clover turns a table red at 90 min; Square goes yellow then red; Fudo has no turn-time metric                                                               | The POS floor plan runs a live per-second turn timer _only while seated_, the party carries it through a move, and the dashboard's model computes turn time with a test for a `seated_at` in the future. **No turn-time report exists** in `reportes`/`operations`                                                                                                                             | **At parity on the timer, behind on what it is for** — a timer nobody reports on is decoration. See gap D                                      |
| 7   | **Kitchen staging is the clearest product gap** — Fudo has no course concept and no recall; SoftRestaurant recalls for 2 h; Clover has expo mode                                                  | **Closed since the matrix was written**: per-item state, courses and staging (held courses are not bumpable; one action fires the lowest held course), recall, all-day counts, routing by product/category/location with a refusal for a rule naming both, and the realtime nudge replacing the poll as the delivery path                                                                      | **Leads on staging and recall** (Fudo has neither). **Behind Toast on expo sequencing and load balancing** — no such concept exists. See gap C |
| 8   | **Pricing transparency is a trust weapon** — Clover hides prices; six rivals publish them                                                                                                         | The public site (`apps/umi-landing-page`) is a single page — Navbar, Hero, Services, Stats, a diagnostic quiz. **No pricing exists in public**                                                                                                                                                                                                                                                 | **Behind, and it is the cheapest item here**                                                                                                   |

## 2. The twelve module leaders — what we have taken, and what is still untaken

| Module                | Leader and what to take                                                                         | Taken?                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordering and sales    | Square: seat-level ordering tied to cart, tickets, **allergens**, split by seat                 | **No.** No seat on a line and no allergen field anywhere (zero references in the tree). The tables model seats and party size; the cart does not                                                               |
| Floor plan            | Clover: sections, shape, capacity, clone, drag, **table timer**                                 | **Yes** except the timer's reporting (gap D)                                                                                                                                                                   |
| Kitchen               | Toast: stations, **load balancing**, **expo sequencing**, partial fulfilment, all-day counts    | **Partly.** Stations, routing, partial (per-item) state and all-day counts are built; load balancing and expo are not (gap C)                                                                                  |
| Menu and catalog      | Square: one menu drives POS, online, kiosk and delivery, with **time windows**                  | **Partly.** One catalog drives the POS and the (new) table-order guest menu; `available_from` exists on product availability. Channel-scoped visibility per category, and true day-part windows, are not built |
| Inventory and recipes | SoftRestaurant: sub-recipes, unit conversion, cooking loss, product explosion, min/max ordering | **Partly** — see opening 5. **Min/max ordering thresholds** exist on items; **sub-recipes** are the gap                                                                                                        |
| Roles and permissions | Toast: ~100 named permissions in nine groups, jobs as the unit                                  | **Yes.** 137 permissions, roles as the unit, Spanish names per the plan's constraint                                                                                                                           |
| Customers and loyalty | Square: loyalty, marketing, gift cards and directory as one loop                                | **Partly.** The loop exists except **tiers** and **consent**, and "directory" is not a Umi concept                                                                                                             |
| Payments and hardware | Clover: owns hardware, software and processing, publishes prices                                | **Partly.** Both rails are now real — Mercado Pago Point for card-present, Conekta specified for online; publishing prices is opening 8, and hardware is the customer's terminal rather than ours by design    |
| Online ordering       | Fudo and Square: one menu, one stock pool, WhatsApp, **QR at the table**                        | **Partly.** WhatsApp identity and the channel receiving end exist; the table-order **intake** landed today; the guest page and the QR image do not exist yet                                                   |
| Reporting             | Toast: 40+ reports in nine categories                                                           | **Partly.** 44 screen files in the dashboard (~35 screens) against Toast's 40+ reports; the plan's own stance is "faster and clearer rather than wider", so treat the count as a floor, not a goal             |
| Multi-location        | Square for Franchises: named roles, menu concepts, location groups, royalties                   | **No**, and the plan says later                                                                                                                                                                                |
| Offline               | SoftRestaurant: desktop offline, queue and sync, local network                                  | **Yes, and better**: the queue and sync are proven end to end, and the OS connectivity source now exists                                                                                                       |

## 3. Where we can defend a lead today

Stated as claims that survive scrutiny, with the evidence in this repository:

1. **Offline-complete for cash, proven.** A cash sale made offline lands **once** after reconnection
   and the shift total matches the ledger — counted in SQL, not asserted from the API's answer
   (`pos-offline.integration.ts`). No rival in the matrix claims this.
2. **Kitchen staging and recall inside the POS.** Per-item state, courses, held courses and recall
   on the same device that takes the order. Fudo has neither a course concept nor recall.
3. **Recipes deeper than Square's**, with modifier consumption, unit conversion and yield; Square
   cannot nest, cannot put a recipe on a modifier, and cannot attach one to a multi-variation item.
4. **Loyalty, gift cards, stored value and WhatsApp identity in one system.** Fudo and PoloTab have
   none of the four.
5. **A 137-permission catalog against Toast's ~100**, in Spanish, gating both clients.
6. **A replaceable payment rail.** Card-present is one adapter behind one port; the second brand
   would not touch checkout. Clover's advantage is that it owns all three layers — which is also
   its lock-in.

## 4. The gaps to close, ordered by what they buy

| #     | Gap                                                       | Why it is the one to close                                                                                                                           | Rough shape                                                                                     |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **A** | **Tiers** (opening 4, §8J's acceptance line)              | The single named regional opening we have not shipped, in the module where we already beat everyone, and the workstream's own acceptance sentence    | a tier table + a route + a screen; the customer's tier is derived from the ledger, never stored |
| **B** | **Sub-recipes / nesting** (opening 5)                     | The plan calls recipes the deepest moat. We hold four of the five capabilities and the fifth is what SoftRestaurant has that we do not               | one self-reference on the recipe, plus the explosion and the cycle refusal                      |
| **C** | **Expo sequencing and load balancing** (opening 7)        | The only kitchen capability Toast leads on that we have not taken, and we already own the board, the stations and the routing it would sit on        | a station-level queue view and a balancing rule; the routing table is the natural home          |
| **D** | **The turn-time report** (opening 6)                      | We already pay for the timer and get nothing from it. Clover and Square both turn it into an operating number; Fudo has no such metric at all        | a report over `seated_at` and clearing, which are already recorded                              |
| **E** | **Seat-level ordering and split by seat** (module leader) | Square's ordering advantage, and it pairs with the floor plan we already lead on. It also gives split-by-seat billing for free                       | a seat on the order line + a cart grouped by seat                                               |
| **F** | **Allergens** (module leader)                             | Square has them and no regional rival in the matrix does; it is a safety feature, and it is what makes seat-level ordering _useful_ rather than neat | a field on the product, a display on the ticket, no arithmetic                                  |
| **G** | **The guest page and the QR image** (§8I)                 | Fudo/Square parity on online ordering. The intake half is already built and tested; this is the half a customer can see                              | a public route in the existing Next app + a QR render                                           |
| **H** | **Comp, re-open and reprint approval gates** (opening 2)  | The remainder of the one Latin-American pattern we already lead on in shape; today those three actions have no gate                                  | three permission checks on existing commands                                                    |
| **I** | **Publish Umi's prices** (opening 8)                      | Six of seven rivals publish; Clover's secrecy is the outlier. It costs nothing technical                                                             | a pricing page on the public site                                                               |

## 5. What is deliberately not a gap

- **Multi-location franchise features.** The plan says later, and Square for Franchises is the
  reference when it lands.
- **Owning the hardware.** Clover's model is vertical lock-in; our bet is the opposite — one adapter
  behind one port, so the terminal is replaceable. That is a strategy, not a shortfall.
- **Report count for its own sake.** Toast's 40+ in nine categories is a breadth claim; the plan's
  stance is fewer, faster, clearer. The gap that matters is the specific missing report (D), not the
  total.

## 6. The honest summary

Of the eight openings the matrix found, **three are closed** (roles, offline, kitchen staging and
recall), **three are closed except one named item each** (recipes without nesting, loyalty without
tiers, timers without the report), **one is a threshold-and-permission system that is better shaped
than the rivals' blanket blocks but has three ungated actions**, and **one is untouched and cheap**
(publishing prices).

The shortest path from here to a defensible "best in the region" is **A → B → C**, because each of
them closes the last item in a module where we already lead everything else, and none of them needs
a new rail, a new client or a vendor decision.
