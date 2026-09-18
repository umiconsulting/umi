# Recipes and Inventory — the module plan

_Plan · build-v3 · inventory + recipes + procurement cluster · 2026-09-17_

**Status:** COMPLETE, with three items stated rather than claimed. All six phases are
built. Every acceptance sentence is verified, on the API, in the real browser and on
the native till, except three that this café's own data cannot exercise and that the
integration and widget suites prove instead: the four menu classes (no mapped product
sold), a live allergen badge on a ticket (no ticket's product has a mapped allergenic
recipe), and the per-item unexplained variance on a sales-heavy period. Those three
are spelled out below.

**Phase 6 evidence (2026-09-17).**

- §13's counters exist and are emitted AFTER the work succeeds, never before:
  `inventory.production.batches{outcome=full|shortfall}`,
  `inventory.production.yield_loss_quantity{unit=...}`, `inventory.invoice.lines{match=...}`,
  `inventory.invoice.commits{outcome=...}`, and the GAUGE
  `inventory.variance.unexplained_quantity{basis=available_stock}`. The gauge is a
  level, because a counter would report the sum of every time somebody looked.
- THE FULL SWEEP RAN. Every console surface this cluster added was clicked in the real
  Chromium with zero failed requests: `Catálogo`, `Categorías`, `Inventario`,
  `Recetas`, `Preparación`, `Facturas`, `Costo`, `Variación`, `Ingeniería de menú`.
- THE NATIVE TILL RAN. It signs in with the operator PIN, renders the kitchen board
  with the café's own tickets, and reaches `Operaciones de inventario` with
  `Producir` on screen, which is the surface the produce acceptance was proven on.
- The kitchen ticket now RENDERS the allergens the API has carried since Phase 1. It
  did not before: `grep -rn allergen apps/umi-pos/lib` returned nothing, so §8.5 was
  half-built and the plan had overstated it. The board draws a badge per label, draws
  nothing for an empty list, and three widget tests cover it.
- §12.2's PROPERTY TESTS exist: `inventory-costing-domain.property.spec.ts`, 11
  properties on `fast-check@4.10.1` (the house tool, already a direct devDependency).
  They assert that scaling a quantity up is exact, that a conversion up and back is
  the identity, that a conversion down moves the number by at most half a unit of the
  target scale, that the one rounding step is exact when the division divides, that a
  plate cost never falls as quantity rises, and that an item with no receipt has NO
  cost rather than a zero.
- §8.4's KITCHEN-BOARD TAB exists. The console had a `Preparación` tab; the till did
  not, so half of that sentence was missing. The till's kitchen board now has a
  `Preparación` tab beside `Comandas`, and it was read live: the window
  `Del 2026-09-16 al 2026-09-18` and the row `Prep de prueba`, par `5 pza`, on hand
  `0.2 pza`, to make `4.8 pza`. The POS needs its own read for this, because the
  console's is gated by `merchant.manage`, which a till session does not carry; the new
  `pos.inventoryPrepList` route is gated by `inventory.read` and carries the operator
  session and the branch, and the forecast is still the costing module's one function.

**Phase 5 evidence (2026-09-17).** Every acceptance sentence was run live against
`umi_transition_rehearsal_20260901` through the console's own authenticated session.

- **A CFDI XML was uploaded** and parsed into an invoice with its line.
- **The upload is idempotent on the UUID.** A second upload of the same file with a
  new command identity answered the SAME invoice id, and no second row was written.
- **A matched line moved the cost basis.** The commit wrote a receipt line for
  `CAFE-GRANO` at `99900` minor units and stamped its `invoice_line_id`; the
  cost-basis read then answered `60700` from two receipts, which is the weighted
  average of `21500` and `99900`.
- **An unmatched line blocked the commit** with `SUPPLIER_INVOICE_UNMATCHED_LINES`,
  and the named code reached the client.
- **A price change was flagged with both numbers**: `priceChanged` true, the order's
  `21500` beside the invoice's `99900`.

**THE XML READER IS A LIBRARY, NOT HAND-WRITTEN.** `fast-xml-parser@5.11.1` was added
to `@umi/api` for this phase. A supplier's file is untrusted input, and an XML reader
written by hand is exactly the component the tool-and-research doctrine says not to
build. Entities are not expanded, and a unit test feeds it an external entity and
proves the process never fetches it.

**Two defects found and fixed inside the phase.**

1. THE MIGRATION COULD NOT ADD THE ARTIFACT COLUMNS. `supplier_invoice` is created
   with `create table if not exists`, so the two columns written inside that CREATE
   never reached a database that already had the table. The file now adds them with
   explicit `alter table ... add column if not exists`, which is the pattern the rest
   of the file already uses.
2. AN UNLISTED ERROR CODE IS REPLACED ON THE WIRE. The phase's refusals
   (`SUPPLIER_INVOICE_UNMATCHED_LINES` and six siblings) were raised by the API but
   absent from `API_ERROR_CODES`, and `publicError` substitutes the generic code for
   the status when it does not find one. An operator who needed to read "this line
   has no match" would have been shown "conflict". The seven codes are now in the
   catalogue, and the platform-wide size of the same gap is recorded in §15.

**Phase 4 evidence (2026-09-17).**

- The three reads answer live over the console's own session:
  `usage-variance`, `recipe-costs` and `menu-engineering`, each parsing against its
  contract model.
- `inventory-costing.integration.ts` proves the decomposition sums, per line and for
  the totals: `variance = waste + damage + countCorrection + yieldLoss + unexplained`.
- A recipe version keeps the cost it computed when it was written (D3), in
  `computed_cost_minor` / `computed_defects` / `computed_at`. A version written before
  this phase is costed at read time and its `capturedAt` says when, so a stored point
  and a fresh one are never confused.
- The console's `Costos y márgenes` screen now has three tabs. `Variación` shows the
  period and the basis (`existencia disponible`) from the response, and it puts the
  UNEXPLAINED remainder in the headline position, because that is the number the
  owner acts on. `Ingeniería de menú` shows the four classes with their own
  explanation and an `unclassified` state for a plate that cannot be costed.

**One defect found and fixed inside the phase.** Every named part of the variance was
read from the row's `quantity` instead of from its MOVEMENT. A
`production_yield_loss` written before the loss moved stock therefore acted as a
phantom explanation of every other item's variance, and this café's report showed
`-199700` unexplained. Each part is now the effect the row had on the available pool,
which is the only thing that can explain usage, and the same report reads `+0.1 L`
for the milk a batch consumed.

**The four classes are proven by the suite, not by this café.** The rehearsal café
has exactly one product mapped to inventory, and that product did not sell inside the
period, so every menu row is honestly `unclassified`: none of the sold products has a
recipe to cost. The four classes come from fixtures in the integration suite, which
seeds a star, a plow horse, a puzzle and a dog.

**Phase 3 closed on the native till (2026-09-17).** A cook produced `Prep de prueba`
on the Linux POS with real clicks through the repo's own semantics driver. The
result dialog showed the lot `PROD-20260917-A33C2C6B`, the expiry `2026-09-20`, the
produced quantity, the declared yield, the shortfall, the rolled-up unit cost and the
consumed input. The database then held exactly three rows for that batch:
`production_produced` 200 on `PREP-PRUEBA` with its lot, `production_yield_loss`
199800 with NO stock effect, and `production_consumed` 100 on `LECHE`.

**Four defects stood between the plan and that proof, and all four are fixed.**

1. The café had NO inventory policy lease, so the till's inventory overview answered
   `INVENTORY_POLICY_REQUIRED` and the surface never loaded. The policy is a lease
   with an expiry, and NOTHING IN THE APPLICATION ISSUES IT: only the demo seed and
   the tests write `merchant.inventory_policy`. A local lease was issued to unblock
   verification, and the gap is named here as a follow-up, because any environment
   whose seed did not write one has a till whose inventory surface cannot open.
2. The till's command builder threw `Bad state: No element` when the produced item
   had no stock row yet — which is the NORMAL case for a prep that has never been
   made. It now sends version 1, which is the server's own default for a missing
   balance.
3. `production_yield_loss` removed stock that had never been credited, so any real
   shortfall on a fresh prep was refused with `NEGATIVE_STOCK_BLOCKED`. The row now
   NAMES the loss and moves no stock: the missing output never entered stock, and
   D7's variance arithmetic reads `production_produced` as what actually increased
   it. The integration test had passed only because that prep already had stock.
4. The API logged 2xx responses ONLY. A client that was refused over and over left
   no trace, which is why the first three defects took an afternoon to find. Every
   4xx is now a `warn` line with the code and the merchant scope.

**Phase 3 evidence (2026-09-17).**

- Production is one transaction on one command. `POST /api/v1/pos/merchants/:id/inventory/production`
  serves the till and the administrative command `inventory.production.produce`
  serves the console, and both call the same service method.
- `inventory-authoring.integration.ts` proves from the DATABASE that the batch
  consumes its inputs, credits the output with its lot, costs it from the receipt
  basis, and writes `production_yield_loss` only for a shortfall. A full batch writes
  no loss row.
- The prep list answers PAR minus on-hand minus forecast usage, on the honest
  observed-days denominator. In the console, `Preparación` named `Prep de prueba` at
  `5 pza` to make, from par 5 and on-hand 0.
- The label sheet is a real PNG over HTTP (`image/png`, PNG magic bytes) and the
  rendered label carries the item, the batch code, the produced date and the expiry.
  A probe with no shelf life printed `sin caducidad`; after a three-day shelf life it
  printed `Caduca: 2026-09-20`.
- The recall answers the sales of the lot's item inside its life window and states
  `basis: 'item_and_window'`. v1 has no lot-attributed sale consumption, and the
  response says so instead of implying it does.

**The till click-through is done.** See the four defects above: the surface needed a
policy lease, the command builder needed a default version, the loss row needed to
stop moving stock, and the API needed to log its refusals. With all four fixed, the
native till produced a batch end to end.

**Phase 2 evidence (2026-09-17).**

- The console has a `Recetas` tab: a list with cost and margin, and an editor with a
  target picker, a yield, component lines, a sub-recipe hint, `used in N recipes`, a
  live cost, and the server's own explosion beside it
  (`apps/umi-dashboard/src/screens/recipe-workspace.jsx` and `recipe-model.js`).
- The commands are `inventory.recipe.create|update|retire`. An update retires the old
  version, writes the next one and repoints an active catalogue mapping. The reads
  are `GET recipes` and `GET recipes/:recipeId/explosion`.
- `merchant.explode_inventory_recipe` walks every level and answers an EXACT RATIONAL
  per item, so the plate cost rests on the raw items and never on a rounded
  intermediate. It excludes modifier lines, which is what the two sale-side paths
  already do.
- Verified in the real Chromium, with real clicks. The owner created the item
  `PREP-PRUEBA`, a sub-recipe that consumes `Leche entera`, and a plate that consumes
  the sub-recipe. The console showed `$12.25` for the sub-recipe and `$612.50` for
  the plate, and both are the hand-computed values from the receipt price of milk
  (`0.5 L x $24.50` and `50 x $12.25`). The seeded `Pumpkin Spice Latte` showed
  `$7.48`, which is `0.012 kg x $215.00 + 0.200 L x $24.50`. The plate was then
  RETIRED through the console, and `Se usa en 0 recetas` moved with it.
- `inventory-authoring.integration.ts` proves a three-level chain whose plate cost is
  computed by hand in the test from its own receipt, and a cycle refused at write
  time with `INVENTORY_RECIPE_CYCLE`.

**Phase 1 evidence (2026-09-17).**

- The console's `Catálogo e inventario → Inventario` tab is a working editor:
  `apps/umi-dashboard/src/screens/inventory-workspace.jsx` and its pure model.
- The writes are administrative commands: `inventory.item.create|update|archive`,
  `inventory.conversion.set`, `inventory.allergen.set` and
  `inventory.item_allergen.set`, served by
  `apps/umi-api/src/modules/inventory-authoring/**`.
- The reads are `GET items`, `GET unit-conversions` and `GET allergens`, each gated
  by `merchant.manage`.
- The allergen list is DERIVED by one SQL walk
  (`merchant.product_allergen_labels`) and reaches the kitchen board and the guest
  menu. The ticket carries `allergens`; so does `TableOrderMenuItem`.
- Verified in the real Chromium over CDP, with real clicks: an owner created the
  item `HARINA-PRUEBA`, set an exact conversion, and attached the label
  `gluten_prueba`. The three rows were then read back from the database. The console
  BLOCKS a conversion that does not divide and explains why; the API refuses the
  same conversion with `INVENTORY_UNIT_CONVERSION_INVALID`, which the integration
  suite asserts.
- `inventory-authoring.integration.ts` (6 cases) and `table-order.integration.ts`
  (15 cases) pass against `umi_transition_rehearsal_20260901`. The KDS suite
  (29 cases) passes against a database the repo's own script builds from the chain.

**Two defects the browser pass found, and their fixes.** The allergen loader asked
for `limit=200` after the contract capped a page at 100, so the label list read as
empty; the panel also sent a null version when the operator retyped a code that
already existed, so an amend answered `OPTIMISTIC_VERSION_CONFLICT`. Both are fixed
in the console. The server-side default of `includeItemsWithoutCost` stays FALSE,
because the boolean query coercion cannot express `false` and only the default can.
The console asks for the wider list explicitly.

**Phase 0 evidence (2026-09-17).**

- `docs/migration/build-v3/76_recipes_inventory.sql` applies on the chain, and
  `99_verify.sql` now asserts the build-v3-76 invariants. Two pristine databases
  were built to `build-v3-76` in a row, and the migration re-runs on its own.
- The recipe target, the cycle guard and the depth cap were probed in SQL. A cycle
  is refused, a target of two is refused, a target of none is refused, a variant
  recipe is accepted, a chain of 12 items is accepted and a 13th level is refused.
- `production_consumed`, `production_produced` and `production_yield_loss` were
  posted through `merchant.append_stock_ledger`. The produced entry carries its
  lot, and a lot from another item is refused.
- `packages/contract/src/recipes.ts` and the extensions to `procurement.ts` and
  `inventory-costing.ts` describe the surface. The route table carries 10 new
  read paths, and the 12 writes are named as administrative-command operations
  instead (the correction in §6.2). `pnpm --filter @umi/contract test` passes 79
  of 79, and `@umi/api` typechecks against the new contract.
- The new read routes have no controller yet. Each one is listed in the
  route-table test's `PENDING` map with the phase that serves it, which is the
  house pattern.
- The command policies and the execution cases are NOT in yet. The execution
  service throws `unsupported_administrative_operation` for an operation it has
  no case for, so a policy lands with the service that answers it.

**Program link:** it completes workstream E of
[the ultimate platform plan](./2026-09-15-ultimate-platform-plan.md#e-inventory-and-recipes)
and it closes gap B (sub-recipes) and gap F (allergens) of
[the competitive gap audit](../research/2026-09-17-competitive-gap-audit-current-state.md).

**Evidence:** four notes hold the research behind every competitive claim in §3.

- `docs/research/2026-09-17-inventory-kitchen-systems-deep-dive.md` — the deep pass.
- `docs/research/2026-09-17-inventory-kitchen-systems-and-reviewers.md` — the reviewer voice.
- `docs/research/2026-09-17-competitive-gap-audit-current-state.md` — the re-taken measure.
- `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md` — the matrix.

**Method.** The audit in §2 comes from the CodeGraph index and from the SQL chain.
The competitive claims come from the primary sources in the four notes. Each claim
below carries one of three labels from the research standard:

- **Documented fact** — a source owns the claim.
- **Source-backed tradeoff** — a source shows both sides.
- **Umi-specific inference** — the claim depends on Umi's own state or plan.

## 1. The goal, and the one sentence

**Goal.** An owner can build a recipe, see the true plate cost, produce the prep,
and reconcile the stock the kitchen used against the stock the sales say it used.

**The sentence.** The recipe is the source of truth for cost, and the ledger is the
source of truth for stock.

That sentence shapes every decision below. A price lives on the document that
charged it. A stock number lives on the ledger. Nothing else stores either fact a
second time.

## 2. What exists, and what is missing

### 2.1 What exists

Umi already holds a strong transactional core. The table below is the audit result.

| Piece                                                       | Where                                                                                                                  | State |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----- |
| Append-only stock ledger, with seven effect columns         | `docs/migration/build-v3/36_pos_inventory.sql:272`; effects `:291`                                                     | Built |
| Twenty ledger entry types                                   | `36_pos_inventory.sql:279`; three purchase types added in `69_procurement.sql:371`                                     | Built |
| One ledger door, `merchant.append_stock_ledger`             | `36_pos_inventory.sql:542`, insert at `:661`                                                                           | Built |
| Ledger callers                                              | `pos-inventory.repository.ts:774`, `:939`, `:1240`; `pos-checkout.repository.ts:805`; `procurement.repository.ts:1088` | Built |
| `stock_balance` projection                                  | `36_pos_inventory.sql:692`, `:847`                                                                                     | Built |
| Item, unit conversion, recipe, component and mapping tables | `36_pos_inventory.sql:47`, `:78`, `:101`, `:132`, `:175`                                                               | Built |
| Policy, reservations, counts and reconciliation             | `36_pos_inventory.sql:214`, `:361`, `:432`, `:498`                                                                     | Built |
| Suppliers, purchase orders, receiving with actual unit cost | `procurement.repository.ts:231`, `:276`, `:375`, `:671`, `:897`, `:988`                                                | Built |
| Costing reads: `cost-basis`, `plates`, `days`, `low-stock`  | `inventory-costing.controller.ts:42`, `:51`, `:60`, `:69`                                                              | Built |
| Low-stock rate, cover and honest denominator                | `inventory-costing-domain.ts:225`, `:240`, `:261`                                                                      | Built |
| Contract types for items, units, recipes, counts, waste     | `packages/contract/src/pos-inventory.ts:11`, `:29`, `:49`, `:183`, `:195`, `:323`, `:332`                              | Built |
| Catalog mapping writer                                      | `pos-catalog.repository.ts:471`                                                                                        | Built |

### 2.2 What is missing

The audit found four tables with no production writer at all. The API reads them.
No client can create them.

| Gap                                                                           | Evidence                                                                                 | Consequence                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| No writer for `inventory_item`                                                | Reads only in `pos-checkout.repository.ts:551`, `pos-catalog.repository.ts:217`          | An owner cannot create an ingredient                          |
| No writer for `inventory_recipe`                                              | Read join at `pos-inventory.repository.ts:545`                                           | A recipe exists only in a test or a seed                      |
| No writer for `inventory_recipe_component`                                    | Read join at `pos-checkout.repository.ts:552`                                            | A component cannot be added                                   |
| No writer for `inventory_unit_conversion`                                     | Read at `pos-inventory.repository.ts:1717`                                               | A conversion cannot be set                                    |
| No `packages/contract/src/recipes.ts`                                         | Filename search returns nothing                                                          | No contract for authoring                                     |
| No route-table entries for items, conversions, recipes, allergens or invoices | `route-table.ts:583`, `:2595` cover costing and POS inventory only                       | No route exists                                               |
| No `stock_lot` table                                                          | Repo-wide search returns nothing                                                         | No lot and no expiry                                          |
| No `supplier_invoice` table                                                   | Repo-wide search returns nothing                                                         | No invoice capture                                            |
| No `inventory_allergen` or `inventory_item_allergen` table                    | Repo-wide search returns nothing                                                         | No allergen                                                   |
| No production action                                                          | No `produce` reference in `apps/umi-pos`                                                 | No prep production                                            |
| `EXPECTED_SCHEMA_VERSION` examples lag                                        | `apps/umi-api/.env.example:68` and `deploy/pilot/pilot.env.example:16` say `build-v3-71` | The live `.env:20` says `build-v3-75`; the examples are stale |

The recipe is the deepest existing asset and the least reachable. Checkout consumes
it. Costing prices it. No person can author it.

## 3. The competitive measure

### 3.1 What the field does

| Capability                     | Fudo              | SoftRestaurant                   | PoloTab           | Lightspeed K   | Toast / xtraCHEF | MarginEdge         | Square       |
| ------------------------------ | ----------------- | -------------------------------- | ----------------- | -------------- | ---------------- | ------------------ | ------------ |
| Sub-recipes                    | Yes, **3 levels** | Yes                              | Yes, two kinds    | Batches        | Nested prep      | Prep items         | **No**       |
| Yield validated                | **No, drifts**    | Unit conversion and cooking loss | **Rendimiento %** | Expected yield | Yes              | Worked %           | No           |
| Theoretical vs actual variance | Partial           | **Not found**                    | Partial           | Yes            | Yes              | Yes                | Retail only  |
| Waste log with reasons         | Yes               | **Cooking loss only**            | Not documented    | Yes            | Yes              | Yes                | Reasons only |
| Allergens                      | No                | No                               | No                | Not named      | Not named        | Yes                | **Yes**      |
| Purchase orders                | **No**            | Yes, min/max auto-PO             | Partial           | Yes            | Yes              | Yes                | Retail       |
| Invoice-driven price           | No                | **XML import with auto-link**    | No                | MarketMan      | Yes              | **Reads invoices** | No           |

Sources: `2026-09-17-inventory-kitchen-systems-deep-dive.md:240` (Fudo's three
levels), `:244` (Fudo's silent yield drift), `:266` (SoftRestaurant has no variance
report), `:281` (SoftRestaurant XML purchase import), `:290` (PoloTab's two kinds and
the double-count hazard), `:106` (MarginEdge prep items), `:122` (MarginEdge
theoretical usage and waste log), `:113` (Square cannot nest), and
`2026-09-17-competitive-gap-audit-current-state.md:74` (allergens).

### 3.2 The four claims this module wins on

Each claim inverts a documented weakness. Each claim is testable.

1. **Sub-recipes with no level cap.** Fudo stops at three levels and shows an error.
   _Documented fact_ (`...deep-dive.md:240`). Umi will carry no cap. A depth of 12
   exists only as a runaway stop. _Umi-specific inference._
2. **A yield the system validates.** Fudo tells the operator to enter the yield and
   does not check it. Cost and stock then drift. _Documented fact_
   (`...deep-dive.md:244`). Umi will compare the produced quantity with the declared
   yield and will write the shortfall as a named loss. _Umi-specific inference._
3. **A variance report the owner can act on.** SoftRestaurant has no variance
   report. Fudo and PoloTab have partial reports. _Documented fact_
   (`...deep-dive.md:266`). Umi will decompose the variance
   by ledger entry type and will name the unexplained remainder. _Umi-specific
   inference._
4. **An ingredient price that keeps itself current.** Chefs in the one reachable
   practitioner thread refresh a price database by hand on a six-month cycle
   ("Every 6 months or so do an update to your price DB",
   `...deep-dive.md:68`). Umi already captures receipts with the actual unit cost.
   This plan closes the loop from the supplier document to the cost basis.
   _Source-backed tradeoff._ SoftRestaurant already imports purchase XML with
   automatic item linking (`...deep-dive.md:281`). The claim is therefore about the
   closed loop and the receipt, not about XML alone.

### 3.3 What we will not claim

- We will not claim that we beat SoftRestaurant on purchasing. It owns the
  order-to-receipt chain today. _Documented fact_ (`...deep-dive.md:281`).
- We will not claim full SAT validation of a received CFDI in v1. The plan validates
  the structure and the UUID. Full schema validation comes later. _Umi-specific
  inference._
- We will not claim a kitchen lead. Toast leads on expo sequencing and load
  balancing. That work is a separate plan. _Documented fact_
  (`2026-09-17-competitive-gap-audit-current-state.md:71`).

## 4. The decisions

### D1. A sub-recipe is an item, not a second tree

An `inventory_recipe` gets `target_item_id`. The `product_id` and `variant_id`
columns become nullable. A check constraint allows exactly one target. A recipe for
a product stays what it is today. A recipe for an item is a sub-recipe.

Lightspeed's batches, PoloTab's _preparados_ and MarginEdge's prep items all give
the prepared item its own stock and cost. _Documented fact_
(`...deep-dive.md:106`, `:165`, `:290`). The existing component table already points
at an item, so nesting needs no new table. _Umi-specific inference._

**Consequence.** An item of type `composite_component` becomes reachable. That enum
value exists today and nothing writes it. Depth is unlimited. A cycle guard refuses
a chain that revisits an item.

### D2. A recipe has exactly one target

The check constraint is `(product_id is not null)::int + (variant_id is not
null)::int + (target_item_id is not null)::int = 1`.

**Correction, 2026-09-17.** That arithmetic refuses every variant recipe. A variant
recipe carries `product_id` AND `variant_id`, because those two columns are the
composite key of `product_variant`. The sum is then two, not one. The migration
states the same rule in the form the existing rows satisfy:

```
(target_item_id is not null and product_id is null and variant_id is null)
or (target_item_id is null and product_id is not null)
```

A product target may carry a variant. An item target carries nothing else. A row
with no target and a row with two are both refused, which is what this decision
asks for. A probe in `99_verify.sql` proves all four cases.

This keeps plate costing unchanged and makes the sub-recipe the same object as a
plate recipe. One editor serves both. _Umi-specific inference._

### D3. A recipe version is immutable

The table already carries `version`, `effective_at` and `retired_at`
(`36_pos_inventory.sql:101`). An edit retires the old version and writes a new one.

Each version stores the cost it computed when its inputs changed. The owner can then
answer "why did my plate cost move". A daily cost per recipe would copy the ledger.
_Umi-specific inference._

### D4. The system validates the yield

Production compares the quantity declared by the recipe with the quantity the cook
actually produced. A shortfall writes `production_yield_loss`.

This is the direct inversion of Fudo's documented silent drift. _Documented fact_
(`...deep-dive.md:244`). The ledger already holds effect columns and a waste type, so
a yield loss is one more named effect rather than a new subsystem. _Umi-specific
inference._

### D5. Production rolls the cost up from what the inputs actually cost

`production_produced` carries a unit cost derived from the inputs the server
consumed. A sub-recipe therefore has a real cost, and that cost cascades upward.

The cost basis stays the weighted average of receipts. There is no price column on
`inventory_item`, and this plan does not add one. _Documented fact_
(`packages/contract/src/inventory-costing.ts:11`). Production reads the same basis
rather than introducing a valuation method. _Umi-specific inference._

### D6. The variance is computed on read

Variance has no materialised row. The read joins the ledger, the counts and the
sales. A second source of truth would drift from the ledger, and the ledger is the
door every stock movement already uses. _Source-backed tradeoff._

### D7. The variance names its parts

Actual usage is opening on-hand plus receipts plus production produced minus closing
on-hand. Theoretical usage is the sum over the period's sales of every component,
exploded to raw items. The difference is decomposed by ledger entry type: waste,
damage, count correction, yield loss and the unexplained remainder.

The unexplained remainder is the headline number. A single total hides the reason.
_Umi-specific inference._

### D8. Allergens are derived by explosion, never stored twice

`inventory_allergen` holds merchant-editable labels. `inventory_item_allergen` maps
an item to a label. A product's allergens come from the explosion of its recipe.

A stored product-level list would go stale on the next recipe edit. A direct
non-stock product can carry its own labels, because no explosion reaches it.
_Source-backed tradeoff._ Square is the only regional rival with allergens.
_Documented fact_ (`2026-09-17-competitive-gap-audit-current-state.md:74`).

### D9. A lot is a first-class row

`stock_lot` carries the item, the location, the produced or received time, the
expiry, and the supplier invoice reference. `stock_ledger_entry` gains a nullable
`lot_id`, so every existing row stays valid.

Shelf life lives on the item in days. A recipe can override it. Production stamps
the expiry on the produced lot. A recall query then names the sales that consumed
the lot. _Source-backed tradeoff._

### D10. The supplier CFDI XML is the primary invoice path

A validated supplier CFDI 4.0 file is parsed with a dedicated XML parser. The parser
reads the issuer, the folio, the UUID, the concepts, the quantities and the unit
prices. The upload is idempotent on the UUID.

The platform already talks to a PAC and stamps the CFDIs it issues
(`apps/umi-api/src/modules/fiscal/fiscal-pac.port.ts:8`). A received CFDI is a
different object, so the parser is new. It reuses the fiscal module's knowledge of
the format. _Umi-specific inference._

### D11. A photo is assistive, never authoritative

The fallback path stores the image. An extraction step proposes lines. A human
confirms each line before any write. Nothing reaches the ledger from an unconfirmed
extraction. _Source-backed tradeoff._

### D12. The console authors, and the till operates

The owner console owns items, conversions, recipes, allergens and invoices. The till
gains production, labels and allergen display.

The POS is a native app
(`docs/architecture/2026-09-16-pos-is-a-native-app.md`). A dense food-cost editor
fits a browser surface better than a till. The operator who produces the prep is the
same operator who rings a sale today. _Umi-specific inference._

### D13. The prep list reuses the existing forecast

The prep quantity is par minus on-hand minus forecast usage over the shelf-life
window. The forecast math already exists at `inventory-costing-domain.ts:225`,
`:240` and `:261`. The plan adds a read and a tab, not a second forecast.
_Umi-specific inference._

### D14. Labels render on the server as a sheet

The server renders a PDF or PNG sheet. The café prints it on its current printer.
There is no new printer integration in v1. _Source-backed tradeoff._

### D15. Every write is an administrative command

Each write is versioned, fingerprinted and idempotent. The plan adds policies to
`administrative-command.policy.ts:18` and cases to
`administrative-command-execution.service.ts:57`. It reuses the fingerprint helper
at `integrity/canonical-json.ts:10`.

The procurement module already uses this pattern at
`procurement.service.ts:351`. A new write path would duplicate the audit trail and
the approval machinery. _Umi-specific inference._

### D16. Menu engineering is margin times popularity

The four classes are stars, plow horses, puzzles and dogs. Margin comes from plate
costing. Popularity comes from order-line counts. The period is selectable.

Both inputs already exist. _Umi-specific inference._

## 5. The data model

**One migration, `76_recipes_inventory.sql`, on a chain that ends at 75.** The
highest migration today is `75_table_order_credential.sql`. The live `.env:20` says
`build-v3-75`. The example files at `apps/umi-api/.env.example:68` and
`deploy/pilot/pilot.env.example:16` still say `build-v3-71`, and this migration
moves them to the new head.

| Change                                        | Detail                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `inventory_recipe.target_item_id`             | New nullable column, with the exactly-one-target check of D2                                             |
| `inventory_recipe.product_id`, `variant_id`   | Become nullable                                                                                          |
| `inventory_item.shelf_life_days`              | New nullable integer                                                                                     |
| `inventory_recipe.shelf_life_days`            | New nullable integer; overrides the item                                                                 |
| `stock_lot`                                   | New table: item, location, origin, produced or received time, expiry, invoice line                       |
| `stock_ledger_entry.lot_id`                   | New nullable column                                                                                      |
| `inventory_allergen`                          | New table: merchant, code, label, active                                                                 |
| `inventory_item_allergen`                     | New table: item, allergen                                                                                |
| `supplier_invoice`                            | New table: supplier, folio, UUID, date, totals, currency, source, artifact                               |
| `supplier_invoice_line`                       | New table: raw description, quantity, unit, unit cost, matched item, confidence, method                  |
| `purchase_order_receipt_line.invoice_line_id` | New nullable column, so a cost names its document                                                        |
| Ledger entry types                            | Add `production_consumed`, `production_produced`, `production_yield_loss`, `invoice_variance_adjustment` |

The migration adds tables and columns. It replaces only the entry-type check on the
ledger, and the new set holds 24 values. It drops no row and no column.

**No name is stored twice.** A recipe carries no name of its own. The thing it
targets already has one, and a second copy would go stale on the next rename. Every
read that needs a label resolves the product name or the item display name, and the
contract calls that field `targetName`.

**The cost of a receipt names its document.** `purchase_order_receipt_line` gains
`invoice_line_id`, so the cost basis read can answer which invoice set a price,
rather than only which receipts averaged into it.

## 6. The public interface

### 6.1 Contract

- New module `packages/contract/src/recipes.ts`.
- Extensions to `packages/contract/src/procurement.ts` for invoices.
- Extensions to `packages/contract/src/inventory-costing.ts` for usage, variance,
  recipe-cost history, prep list and menu engineering.
- New route-table entries for items, unit conversions, recipes, allergens and
  supplier invoices.

The console's item record is `InventoryAuthoringItem`, not `InventoryItem`. The POS
surface already publishes `InventoryItem` as its stock view, and one barrel cannot
carry one name twice. The authoring shape adds the conversions, the allergens and
the per-location on-hand that the editor needs.

### 6.2 Routes

| Route                                                           | Purpose                       |
| --------------------------------------------------------------- | ----------------------------- |
| `/api/merchants/:merchantId/items`                              | List, create, update, archive |
| `/api/merchants/:merchantId/unit-conversions`                   | List and set                  |
| `/api/merchants/:merchantId/recipes`                            | List, create, update, retire  |
| `/api/merchants/:merchantId/allergens`                          | List and set                  |
| `/api/merchants/:merchantId/supplier-invoices`                  | Upload, match, commit         |
| `/api/merchants/:merchantId/inventory-costing/usage-variance`   | The variance read             |
| `/api/merchants/:merchantId/inventory-costing/recipe-costs`     | The cost history              |
| `/api/merchants/:merchantId/inventory-costing/menu-engineering` | The four classes              |
| `/api/merchants/:merchantId/prep-list`                          | The prep list                 |

**Correction, 2026-09-17.** The table above mixes two different surfaces, and the
build keeps only the reads as paths. Under D15 every write in this cluster is an
administrative command, and the platform already has one door for that work:
`POST /api/merchants/:merchantId/administrative-commands`, which claims the
idempotency key, stamps the fingerprint, records the audit trail and checks the
approval. The console catalogue writes already use it. Adding twelve dedicated
write routes would re-implement that machinery, which is the duplication D15
forbids.

The reads stay as paths, and they stay behind `merchant.manage`, because an
`inventory.*` key is carried only by POS operator sessions and would put these
paths out of reach of the console. The writes are operations:
`inventory.item.create|update|archive`, `inventory.conversion.set`,
`inventory.allergen.set`, `inventory.item_allergen.set`,
`inventory.recipe.create|update|retire`, and
`inventory.invoice.upload|match|commit`.

### 6.3 Commands and permissions

Commands: `inventory.item.create|update|archive`,
`inventory.recipe.create|update|retire`, `inventory.conversion.set`,
`inventory.allergen.set`, `inventory.invoice.upload|match|commit`.

Permissions: `inventory.item.manage`, `inventory.recipe.manage`,
`inventory.recipe.approve`, `inventory.conversion.manage`,
`inventory.invoice.capture`, `inventory.invoice.approve`.

The names follow the existing house vocabulary in
`packages/contract/src/route-table.ts:2595`.

## 7. The authoring surface

The console tab `Catálogo e inventario → Inventario` becomes a real workspace.

- **Item list.** Type, base unit, tracking policy and on-hand across locations.
- **Item editor.** Conversions and allergens.
- **Recipe editor.** Live cost and margin while the owner types. A sub-recipe
  picker. A "used in N recipes" back-reference.
- **Supplier-invoice inbox.** Upload, proposed lines and match state.
- **Variance report.** The decomposition of D7.

The live cost is the point of the editor. An owner who changes an ingredient sees
the plate margin move before the save. _Umi-specific inference._

## 8. Production and prep

### 8.1 The produce action

The cook chooses a prepared item and a quantity. The server explodes the recipe at
all levels. It consumes the inputs. It credits the prepared item as
`production_produced` at the rolled-up cost of D5.

The action exists on the till and in the console. The till keeps its current actions
for count, waste, damage, quarantine, adjustment and restock. Those live at
`inventory_controller.dart:191`, `:222`, `:247`, `:273`, `:558` and `:299`.

### 8.2 Yield reconciliation

The server compares the produced quantity with the recipe's declared yield. A
shortfall writes `production_yield_loss`. A yield report names the shortfall by item
and by period.

### 8.3 Lots, expiry and recall

Production and receiving may name a lot. Expiry comes from shelf life. The kitchen
prints labels from the prep list. A recall query names the sales that consumed a
lot.

### 8.4 The prep list

The prep quantity is par minus on-hand minus forecast usage over the shelf-life
window. A `/prep-list` read and a kitchen-board tab show the list. The server
renders the labels as a sheet.

### 8.5 Allergens on the ticket and the menu

The kitchen ticket shows allergen badges. The table-order guest menu read carries the
allergen list for the same product. The badges come from the derived list of D8.

## 9. Costing, variance and menu engineering

### 9.1 Theoretical usage

Theoretical usage is the sum over the period's sales of the product quantity times
each component, exploded to raw items.

### 9.2 Actual usage

Actual usage is opening on-hand plus receipts plus production produced minus closing
on-hand.

### 9.3 Variance

Variance is actual minus theoretical. The report decomposes it by ledger entry type.
Waste, damage, count correction and yield loss are named. The unexplained remainder
is the headline number.

### 9.4 Mapping

Plate costing reuses `inventory_catalog_mapping` with `mapping_type = 'recipe'`.
That link exists today at `36_pos_inventory.sql:175`. No second mapping concept is
introduced.

### 9.5 Cost history and menu engineering

Each recipe version keeps the cost it computed when its inputs changed. Menu
engineering classifies each item as star, plow horse, puzzle or dog from margin
times popularity over a selectable period.

## 10. Invoice capture

### 10.1 The XML path

A supplier CFDI 4.0 file is parsed. The parser reads the issuer, the folio, the
UUID, the date, the totals, the currency, the concepts, the quantities and the unit
prices. The upload is idempotent on the UUID, so a re-upload changes nothing.

### 10.2 The photo path

The image is stored. An extraction step proposes lines. A human confirms each line.
Nothing reaches the ledger from an unconfirmed extraction.

### 10.3 Line matching

The match order is:

1. The supplier SKU.
2. A remembered match for the same description and supplier.
3. The prior line history.
4. A fuzzy description match.
5. A manual match.

An unmatched line blocks the commit. A price that differs from the last paid price
or from the purchase-order price is flagged with both numbers.

### 10.4 The cost loop

The committed receipt references its invoice line. The cost basis read then names
the document that produced the price. This is the closed loop of claim 4 in §3.2.

## 11. The phases

### Phase 0 — Groundwork

Migration 76, the contract module, the route-table entries, the command policies and
the cycle guard. No user-visible change.

**Built 2026-09-17, with three changes to the phase.** The route-table entries are the
READS only, because D15 makes the writes administrative commands (see the correction
in §6.2). The command policies and their execution cases are deferred to the phase
that builds their services, because the execution service refuses an operation it has
no case for: a policy that lands alone is a command path that throws. The cycle guard
is in SQL and its trigger is attached, so it bites for every writer.

**Acceptance.** A pristine database builds to `build-v3-76` twice in a row. The
contract tests pass. Every new route refuses a caller without its permission. The
example environment files name the new head.

**Acceptance measured 2026-09-17.** Two pristine databases built to `build-v3-76`,
and migration 76 re-ran on its own. `pnpm --filter @umi/contract test` passed 79 of 79. Both example files name `build-v3-76`. The permission sentence is NOT yet
proven: the reads have no controller, so nothing can refuse a caller. It is proven
per route as Phase 1, 2, 4 and 5 land, and no write route joins the table at all.

### Phase 1 — Items, conversions and allergens

The item editor, the conversion editor and the allergen editor.

**Built 2026-09-17.** The console is the schema of §6.2's reads plus the six
commands of §6.3. The kitchen ticket and the guest menu carry the derived list, so
§8.5's display half is done with this phase rather than with Phase 6.

**Acceptance.** An owner creates an ingredient, sets a conversion, and sets an
allergen. The API refuses a duplicate public reference and a conversion that does
not divide. The allergen appears on the kitchen ticket, and the guest menu read
carries it.

**Acceptance measured 2026-09-17.** Every sentence above is proven. The console
click-through created the item, the exact conversion and the allergen, and the
database was read back to confirm all three. The duplicate reference and the lossy
conversion are refused at the API, and the integration suite names both codes. The
ticket and the menu are asserted by tests that write a recipe and read the label
back, and that prove the label disappears when the recipe retires.

### Phase 2 — Recipes and sub-recipes

The recipe editor, the explosion, the cycle guard and the live cost.

**Built 2026-09-17.** The cycle guard shipped with Phase 0, in SQL, and its trigger
is attached. The explosion is `merchant.explode_inventory_recipe`. The editor is the
`Recetas` tab.

**Two decisions inside the phase.** The explosion excludes modifier lines, because
`pos-checkout.repository.ts` and `inventory-costing.repository.ts` both resolve the
BASE recipe and record a modifier's extra portion beside it. A line whose exact
rational does not divide at the consumed item's scale is NOT costed: the explosion
reports the floored quantity with `exact: false`, and the recipe's cost is null. A
cost built on a rounded quantity is a cost nobody can reconcile.

**Cost storage is deferred to Phase 4.** D3 asks a recipe version to keep the cost it
computed. That column and the recompute that fills it belong with the cost-history
read, which is what needs them. Phase 2 computes the live cost on read, which is what
the editor needs.

**Acceptance.** An owner creates an ingredient, a sub-recipe two levels deep, and a
plate. The plate cost and margin on screen match the receipt-derived cost. A chain
that revisits an item is refused at write time.

**Acceptance measured 2026-09-17.** The console click-through created the ingredient,
the sub-recipe and the plate, and the cost on screen matched the hand-computed
receipt-derived cost at both levels. The integration suite proves the same for a
three-level chain and proves that a cycle is refused at write time.

### Phase 3 — Production, yield, lots and prep

The produce action, the yield loss, the lots, the prep list and the labels.

**Built 2026-09-17.** The produce action is one service method behind two doors, so
the console and the till post the same batch. `production_consumed` leaves the
inputs, `production_produced` credits the output with its lot and the rolled-up cost,
and `production_yield_loss` names the shortfall. The prep list reuses the low-stock
forecast rather than writing a second one, and it reads `par_quantity`, a column
this phase added because par is not the low-stock threshold. The label sheet is
rendered by the server as a PNG, and the recall states its basis.

**Acceptance.** A cook produces the prep on the till. The ledger records the
consumed inputs and the produced item at the rolled-up cost. A shortfall writes
`production_yield_loss`. The prep list names each item below par. A printed label
carries the expiry.

**Acceptance measured 2026-09-17.** All five sentences are proven. The cook produced
the prep on the native till, with real clicks, and the database held the consumed
inputs, the produced item at its rolled-up cost and the named shortfall. The prep
list named a below-par item in the console. The rendered label carried the expiry.

### Phase 4 — Variance and menu engineering

The variance read, the cost history and the four menu classes.

**Built 2026-09-17.** The variance is computed on read (D6) on the AVAILABLE basis,
which is the pool the platform's own guard uses and the only one on which a damaged or
quarantined item can appear as usage at all. Theoretical usage comes from the
period's sales, exploded to raw items through `merchant.explode_inventory_recipe`, so
one function answers the plate read, the production path, the cost history and the
report. Menu engineering classifies each sold plate against the mean of each axis.

**Acceptance.** For a seeded period, the variance report names waste, damage, count
correction, yield loss and the unexplained remainder. The decomposition sums to the
total. The four menu classes show.

**Acceptance measured 2026-09-17.** The decomposition is proven to sum, per line and
for the totals, against the ledger. All five named parts are present in the response
and in the console. The four classes are proven by the integration suite's own seeded
period; the working café cannot show them because its only mapped product did not
sell, which the screen states rather than hides.

### Phase 5 — Supplier invoices

The CFDI parser, the photo fallback, the matcher and the commit.

**Built 2026-09-17.** The XML path is the trustworthy one and it is complete. The
photo path stores the image and stops: v1 has no extractor, and D11 forbids anything
reaching the ledger from an unconfirmed extraction, so the console does not offer a
photo button at all rather than pretending. A commit reuses the purchase-order
receipt path, so the ledger door, the receipt rows and the balance projection are the
same code that a manual delivery already used.

**What v1 knowingly leaves out.** A `lotCode` on a commit line is refused with
`SUPPLIER_INVOICE_LOT_UNSUPPORTED`: `stock_lot` carries one lot per command and the
receive path posts none, so receipt lots need a schema change. `source: 'manual'` is
refused, because nothing lets a person type an invoice in. The capture and approve
permutations are the two permissions, with no separate approval token.

**Acceptance.** An owner uploads one CFDI XML. The upload is idempotent on the UUID.
The matched lines update the cost basis. An unmatched line blocks the commit. A
price change is flagged with both numbers.

**Acceptance measured 2026-09-17.** All five sentences were run live against the
working database and are recorded above.

### Phase 6 — Pilot hardening

The till surfaces, the observability and the full acceptance run.

**Built 2026-09-17.** The counters of §13 are wired, the till gained the allergen
badges it was missing, and every console surface and the whole acceptance sweep ran
against the working database.

**Acceptance.** Every acceptance sentence above passes on the native POS and in the
real browser. The offline journal and the payment rails are unchanged.

**Acceptance measured 2026-09-17.** The sentences pass where the café's data can
exercise them, and the sweep is recorded above. THE OFFLINE JOURNAL AND THE PAYMENT
RAILS ARE UNCHANGED: no file under `pos-offline`, `tender`, `mercado-pago` or the
offline journal was touched by any phase of this work, and the till's inventory
mutation policy is still the direct online POST it was.

**Three items the data cannot exercise, stated rather than claimed.**

- The four menu classes need a product that is mapped to inventory AND sold in the
  period. This café has one mapped product and it did not sell, so every row reads
  `unclassified`, which is the honest answer. The classes are proven by the
  integration suite's own seeded period.
- A live allergen badge needs a TICKET whose product maps to a recipe or item that
  carries a label. This café's open tickets are for products with no mapping. The
  derivation is proven against the database and the rendering by widget tests.
- The per-item variance of a sales-heavy period is proven by the integration suite.
  The live report shows one explained line, because the café has almost no mapped
  sales.

**A FOURTH FIXTURE DEFECT, FOUND BY THE SWEEP AND FIXED.** The three integration
fixtures that drive the administrative-command door insert their dashboard session
with `ON CONFLICT (id) DO NOTHING`. The row survives a re-run; its one-hour expiry
does not. The suit passed all afternoon and then failed every run with
`SESSION_REVOKED`. All three now refresh `expires_at` on conflict, so the fixture can
be re-run at any time, which is what an integration fixture on a shared database has
to be.

## 12. Tests and evidence

### 12.1 Integration

Run the integration suite against a pristine chain-built database, twice in a row.
The suite proves:

- Nesting explodes to three or more levels, and the totals are exact.
- A cycle is refused at write time.
- Production consumes the inputs and credits the output at the right cost.
- Yield loss is recorded and reported.
- Theoretical versus actual variance reconciles to the ledger for a seeded period.
- The decomposition sums to the total.
- A CFDI upload is idempotent on the UUID.
- An unmatched line blocks the commit.
- An allergen on an ingredient appears on the product and on the ticket.
- A recall query names the sales that consumed the lot.

### 12.2 Property tests

Use `fast-check`, the house tool. Scaled-integer arithmetic never loses a unit. A
conversion from a to b and back returns the original within the declared rounding
policy.

### 12.3 Client tests

Drive the native POS with the existing driver. Drive the console in the real browser
with `./scripts/ux-browser.sh`, per
`docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`. A component test is not evidence
about what the operator sees.

### 12.4 SQL proofs

Prove the ledger totals, the count results and the variance decomposition in SQL.
An API answer is not evidence about the rows.

## 13. Observability

Add counters for produced batches, yield loss, invoice match rate, unmatched lines
and unexplained variance quantity. Every write carries the existing
`correlationId`. The variance read states its period and its data cutoff.

## 14. Assumptions and defaults

- **The console authors, and the till operates.** The till gains production, labels
  and allergen display, not the food-cost model.
- **A sub-recipe is an item.** No second recipe tree exists.
- **The weighted average of receipts stays the cost basis.** Production rolls cost
  up from the inputs consumed.
- **No new kitchen client in v1.** The prep list is a tab and a printable.
- **The photo is assistive.** The CFDI XML is the trustworthy path.
- **Cost history is per recipe version.** A daily cost per recipe would copy the
  ledger.
- **The depth cap is 12.** It exists only as a runaway stop.
- **Untouched:** the offline journal and replay, the payment rails and the current
  KDS staging.

## 15. Open questions and unverified items

| Item                                                                                       | State                         | Action                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clover sub-recipe support                                                                  | UNVERIFIED in the research    | Not a blocker; re-check before a sales claim                                                                                                                                                                                           |
| Craftable, Apicbase, meez, KitchenCut, WISK, Supy and Crunchtime sub-recipes               | UNVERIFIED                    | Not a blocker                                                                                                                                                                                                                          |
| Fudo modifier stock consumption                                                            | UNVERIFIED                    | Not a blocker                                                                                                                                                                                                                          |
| SoftRestaurant modifier stock deduction                                                    | Not found                     | Not a blocker                                                                                                                                                                                                                          |
| G2 and Capterra content                                                                    | Unreachable from this machine | A purchasing decision for egress                                                                                                                                                                                                       |
| Full SAT validation of a received CFDI                                                     | Not in v1                     | Add after the structural parser proves stable                                                                                                                                                                                          |
| Lot transfer between locations                                                             | Not in v1                     | Add with the transfer workstream                                                                                                                                                                                                       |
| No application writer for `merchant.inventory_policy`                                      | Found 2026-09-17              | The till inventory surface needs a live lease, and only the demo seed and the tests write one. Give the lease an issuer before an environment depends on a seed.                                                                       |
| 142 error codes the API raises are absent from `API_ERROR_CODES`                           | Measured 2026-09-17           | `publicError` replaces an unlisted code with the generic code for its status, so a named refusal reaches the client as `CONFLICT`. Phase 5's seven were added. Add a gate that fails when a raised code is missing, then fix the rest. |
| `apps/umi-dashboard/src/lib/auth.spec.js` fails about one run in three under parallel load | Observed 2026-09-17           | It passes alone and on a re-run. It is a timing-sensitive test in another workstream's file, not this cluster's.                                                                                                                       |

## 16. Deliberately not in v1

- Expo sequencing and load balancing (gap C). A separate kitchen plan owns it.
- Seat-level ordering and split by seat (gap E). A separate ordering plan owns it.
- Multi-location franchise features. The program defers them.
- Standard costing or FIFO valuation. The weighted average stays.
- A new kitchen client. The prep list is a tab.

## 17. References

- `docs/plans/2026-09-15-ultimate-platform-plan.md` — workstream E.
- `docs/research/2026-09-17-inventory-kitchen-systems-deep-dive.md`.
- `docs/research/2026-09-17-inventory-kitchen-systems-and-reviewers.md`.
- `docs/research/2026-09-17-competitive-gap-audit-current-state.md`.
- `docs/research/2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md`.
- `docs/migration/build-v3/36_pos_inventory.sql`.
- `docs/migration/build-v3/69_procurement.sql`.
- `packages/contract/src/pos-inventory.ts`.
- `packages/contract/src/inventory-costing.ts`.
