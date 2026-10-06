# Inventory surface placement — till, floor, desk

- Date: 2026-09-18 (local, America/Mazatlan).
- Question: where should the inventory UI live? Umi ships a full inventory operations
  surface on the till. Is that right? Where do the competitors put it? What does the
  dashboard do about RBAC?
- Start here: [report.html](report.html) — the illustrated report.

## The answer

**Your instinct is correct. The till is the wrong place for inventory management.**
Nine competitors were checked. Seven of them keep the inventory record off the till. One
is unverified. The single exception is Square, and Square's till-side receiving and
counting is built for a retail shop counter, not a café.

The market uses three surfaces, not two:

| Surface | Job                        | Who               | Device          | Cost data |
| ------- | -------------------------- | ----------------- | --------------- | --------- |
| Till    | Sell; mark an item out     | Any employee      | POS terminal    | Never     |
| Floor   | Count, waste, receive      | Many hands        | Phone or tablet | No        |
| Desk    | Item, recipe, vendor, cost | Owner and manager | Desktop browser | Yes       |

Inventory belongs on the till as **one small action**, "this item is out". The count
belongs on the floor device. The setup, the costing, and the vendor work belong in the
desk surface.

## The Umi defect, in one table

Umi has this inverted, and the permission vocabulary holds the inversion in place.
These numbers come from `docs/migration/build-v3/35_pos_pilot_rbac.sql` and
`apps/umi-dashboard/src/lib/module-registry.js`.

| Role        | Inventory keys | Can run inventory on the till | Can author inventory in the dashboard |
| ----------- | -------------- | ----------------------------- | ------------------------------------- |
| owner       | 21             | yes                           | yes                                   |
| **manager** | **20**         | **yes**                       | **no**                                |
| supervisor  | 8              | partly                        | no                                    |
| cashier     | 1              | opens the read shell          | no                                    |
| viewer      | 2              | opens the read shell          | no                                    |

The manager — the person whose job inventory is — carries twenty inventory permissions
and no `merchant.manage`. The dashboard's Inventario tab needs `merchant.manage`. So the
manager gets the whole toolkit on the device built for serving guests, and nothing on the
device built for office work.

The `inventory-costing` module states the second half of the defect in its own source
comment: it gates on `merchant.manage`, not on an `inventory.*` key, because "an
`inventory.*` key is carried only by POS operator sessions, which would make the screen
unreachable from the console." That is role explosion in miniature.

## The files

| File                                                | Contents                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `report.html`                                       | The illustrated report. Open it in a browser.                                             |
| `assets/`                                           | Eight official Lightspeed product screenshots, with the attribution in `assets/INDEX.md`. |
| `../2026-09-18-inventory-ui-ux-surfaces.md`         | The per-product surface, screen, device, and permission evidence. Nine products.          |
| `../2026-09-18-inventory-operator-evidence.md`      | Fifty-five operator reviews, posts, and official walkthroughs.                            |
| `../2026-09-18-inventory-ux-principles-and-rbac.md` | The platform guidelines, the ERP split, and the RBAC sources.                             |

## The rules the sources support

1. Keep a frequent action on the main surface. Do not put a workflow command in a
   settings page. Microsoft Windows design guidelines.
2. Put a rare and infrequently changed task on its own surface, because the user must
   suspend the main task to reach it. Apple Human Interface Guidelines, Settings.
3. Split the action, not the person. A non-manager may enter a count. Only a manager may
   open or close it. MarginEdge role documentation.
4. Set the default to deny, and require a written reason for each grant. OWASP
   Authorization Cheat Sheet.
5. Keep cost as its own permission, separate from stock. Shopify, Lightspeed, and Wisk
   each publish a separate cost key.

## What is not verified

- The Clover, TouchBistro, SpotOn, and Revel inventory screens. The help centre is
  login-gated, absent, or a JavaScript shell.
- The Lightspeed L-Series inventory surface. Only the K-Series was verified.
- Square's per-level inventory label.
- G2 and Capterra content, which is IP-blocked from this workstation.
- Official inventory screenshots for eight of the nine products. Each vendor keeps the
  back office behind a login. Lightspeed is the one exception found.

## Next step

The placement decision is an architecture decision, not a research result. If the split
is accepted, record it as an ADR under `docs/architecture/` and take the permission
renames from section 8 of the report. This file does not make that decision for the
repository.
