# Inventory lives on three surfaces — till, floor, desk

- Date: 2026-09-18
- Status: Accepted for the desk surface. Proposed for the till and the floor.
- Supersedes: nothing. Amends the assumption behind
  `apps/umi-pos/lib/features/inventory/` and the Inventario tab.
- Research: [the surface placement report](../research/2026-09-18-inventory-surface-placement/README.md)
  and [the redesign plan](../plans/2026-09-18-inventory-workspace-redesign-plan.md).

## The decision

Inventory is three jobs. Each job gets one surface.

| Surface | Job                              | Who               | Device          | Cost data |
| ------- | -------------------------------- | ----------------- | --------------- | --------- |
| Till    | Sell, and mark one item out      | Any operator      | POS terminal    | Never     |
| Floor   | Count, waste, receive            | Many hands        | Tablet or phone | No        |
| Desk    | Item, unit, recipe, vendor, cost | Owner and manager | Desktop browser | Yes       |

The till keeps exactly one inventory action: mark an item in or out of stock. The
till does not start a count. The count is a floor job.

## Why

### The market agrees, and it is measurable

Nine products were checked against their own documentation.

- Toast allows one inventory action on the till, under one permission named
  `Inventory & Quantity`, and it keeps the record in xtraCHEF, a separate product.
- Shopify puts all four inventory permissions in the **Store** category. Its POS
  permission list holds no inventory group at all.
- Lightspeed Restaurant K-Series holds the whole Inventory module in the Back
  Office. Its till navigation has six destinations and inventory is not one of
  them.
- Square is the single exception, and Square's till-side counting serves a retail
  shop counter rather than a café.

This is a documented fact with a source per product in the research file. The
research file names the three products it could not verify and says why.

### The operators name the place, and it is never the till

Fifty-five reviews, posts, and walkthroughs were read. The place is the back room,
the freezer, the shelf, the bar walk, the warehouse floor, or the delivery dock.
Two quotes carry it. A general manager on r/KitchenConfidential: the iPad "changes
the entry, not the walk", because the count still takes six hours. A Shopify POS
reviewer states the permission requirement in one sentence: "I want staff to have
access to inventory but not all the reports."

### Umi has the split inverted today

| Role        | Inventory keys | Till inventory       | Dashboard authoring |
| ----------- | -------------- | -------------------- | ------------------- |
| owner       | 21             | yes                  | yes                 |
| **manager** | **20**         | **yes**              | **no**              |
| supervisor  | 8              | partly               | no                  |
| cashier     | 1              | opens the read shell | no                  |
| viewer      | 2              | opens the read shell | no                  |

The manager carries twenty inventory permissions and no `merchant.manage`. The
dashboard's Inventario tab needs `merchant.manage`. The person whose job inventory
is therefore gets the whole toolkit on the device built for serving guests, and
nothing on the device built for office work.

The second half of the defect is in the code comment on the `inventory-costing`
module: it gates on `merchant.manage`, "not by an `inventory.*` key", because "an
`inventory.*` key is carried only by POS operator sessions, which would make the
screen unreachable from the console." That is role explosion in miniature. NIST SP
800-162 names the same failure: "numerous roles that are ad hoc and limited in
membership, leading to what is often termed 'role explosion'."

### A screen that ships to the till is a screen the till carries

Every row in the till's inventory surface is gated by a fine-grained permission,
so the till is not careless. The defect is different and it is structural: a
permission gate decides who may open a screen. It does not decide whether the
screen belongs on that device. A count surface on the till competes with the sale
for the one device, and the operator corpus shows the cost of that competition.

## What this changes

**Now.**

1. The dashboard Inventario tab becomes a workbench: a task rail, an attention
   queue, and a resource list. See the plan.
2. The desk surface stops being a form the operator must find. It becomes the
   place the desk work happens.

**Next, and not in this change.**

3. The till keeps `inventory.read` for the item on screen and one action to mark
   an item out of stock. The count, the production batch, the recovery, and the
   history list leave the till surface.
4. The permission vocabulary gains a desk-side key. The name is not decided here,
   because the name is a contract change and a contract change needs its own
   review. The requirement is: a manager holds it, and it is not
   `merchant.manage`.
5. The floor surface is a new build. Nothing in this repository serves it yet.

## Consequences

**Good.**

- The manager can do the job the manager is responsible for.
- The till surface gets smaller, and the sale stops competing with the count.
- A costing screen stops needing the broad `merchant.manage` key.
- The three jobs map onto three permission sets, which is the split NIST's role
  explosion analysis asks for.

**Costly, and honestly so.**

- A new surface has to be built for the floor. Until it exists, the till keeps the
  count. Removing the count from the till before the floor surface ships would
  leave the operator with no way to count, and that is worse than the defect.
- The permission rename touches the contract, the seeded roles, the POS client,
  and the dashboard. It is a separate change with its own migration.
- Umi cannot undo an archive. `inventory.item.archive` sets `active = false`, and
  `inventory.item.update` accepts no `active` field. The desk surface therefore
  makes archive a single-item action with a stated consequence, and it does not
  offer the bulk archive a design-system rule would otherwise ask for.

## What would change this decision

- Evidence that a café counts at the till in practice. The current evidence says
  the opposite, and it comes from the operators themselves.
- A measured drop in count accuracy after the floor surface ships.
- A real-time requirement that a count and a sale must share one device. No source
  found asks for that.
