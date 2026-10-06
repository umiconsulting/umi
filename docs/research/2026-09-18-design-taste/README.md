# Design taste: the audit, and the system that replaces it

- Date: 2026-09-18
- Question: the dashboard screens feel overwhelming and sometimes out of place.
  Is the grouping right? Should Catálogo and Inventario be one destination? What
  is missing from the design that makes it read as unfinished?
- Evidence: 16 screens captured with real clicks, at 1440×940, in
  [assets/screens/before/](assets/screens/before/). The control count for each
  screen is in [control-counts.md](assets/screens/before/control-counts.md).
- Law: [the visual principles](../2026-09-18-visual-principles-for-a-dense-console.md)
- Grouping: [the catalog versus inventory research](../2026-09-18-catalog-vs-inventory-ia.md)

## 1. What the measurement says

Every screen was walked by the existing audit tool, which counts every control it
finds. The count is not a style opinion. It is the number of things a person must
decide to ignore.

| Screen                   | Controls | Note                                                                                |
| ------------------------ | -------- | ----------------------------------------------------------------------------------- |
| Catálogo e inventario    | **72**   | The highest in the app. Six tabs, then a filter row, then a table.                  |
| Ajustes                  | **70**   | Four sections and one `Guardar cambios` button 400 pixels from the fields it saves. |
| Equipo y permisos        | 50       | A permissions matrix with 8 destructive controls.                                   |
| Lealtad y valor          | 49       |                                                                                     |
| Horario y disponibilidad | 49       |                                                                                     |
| Clientes                 | 47       |                                                                                     |
| Centro operativo         | 46       |                                                                                     |
| Reportes                 | 34       |                                                                                     |
| Pedidos                  | 32       |                                                                                     |
| Cocina                   | 27       |                                                                                     |
| Diagnóstico              | 27       |                                                                                     |
| Dispositivos             | 28       |                                                                                     |
| Caja y turnos            | 23       |                                                                                     |
| Panorama                 | 23       |                                                                                     |

For comparison, Shopify's own documentation sets a working rule for its admin: a
page holds one primary action and a small toolbar. The measured app does not.

## 2. The diagnosis

The screens are not badly built. They are **undifferentiated**. Five faults run
through all of them, and each fault is one law that the screen breaks.

### F1. The page says its own name twice, sometimes three times

**The law.** Repetition (Robin Williams). A repeated element must carry meaning
each time it appears. **Documented fact**,
[the visual principles](../2026-09-18-visual-principles-for-a-dense-console.md) §2.

**The evidence.** `Catálogo e inventario` appears in the masthead, in the hub tab,
and again as a card heading. `Clientes` appears in the masthead and as a heading
100 pixels below it.

**Why it matters.** Each repeat spends attention on a fact the person already has.
The reading order becomes: "I am here, I am here, I am here, here is content."

### F2. There is no page archetype, so every screen invents its own opening

**The law.** Alignment and repetition. A screen belongs to a small set of shapes.
**Documented fact**, same source, §2 and §3.

**The evidence.** The same slot, directly under the masthead, holds three
different things:

| Screen   | What sits in the slot                                                |
| -------- | -------------------------------------------------------------------- |
| Clientes | a heading, a description, and three stat pills                       |
| Catálogo | a card with its own title, a permission key, and three green buttons |
| Ajustes  | a full-width explanatory banner and a `Guardar cambios` button       |
| Panorama | a full-width `LIVE` bar with nothing else in it                      |
| Cocina   | a heading, a description, and a colour legend                        |

**Why it matters.** With no archetype, a person cannot learn the app. Every screen
is a new layout to decode.

### F3. Colour is decoration, not a language

**The law.** WCAG 1.4.1, Use of Color. One encoding carries one meaning.
**Documented fact**, same source, §7 and §9.

**The evidence.**

- A green pill marks `ACTIVE` on **every row** of the catalog. A column where every
  value is identical carries no information and takes the strongest colour on the
  screen.
- Green is also used for **action buttons**: `REVIEW`, `EDIT PRODUCT`, `ARCHIVE`.
  Green means success in the same screen where it means "press me".
- `+70% 28 days` is green. `Revenue this month $0` is black.
- The Overview carries one warm cream card, and it is the only warm surface in the
  whole product. It reads as a visitor from a different app.

**The law that resolves it.** A saturated colour on a functional surface is either
a status or the single primary action. Nothing else earns colour.

### F4. The interface talks to the engineer

**The law.** The system should speak the user's language, not the system's.
**Documented fact**, the visual principles file, §9, and the Nielsen heuristic
"match between the system and the real world".

**The evidence, quoted from the screenshots.**

- `Permission: catalog.read` on the catalog screen. A raw permission key, printed
  to an owner.
- A raw UUID under every product name in the catalog table:
  `0b4d22cd-98ba-9932-a4b3-abb84502424d`.
- `Cash changes are saved only because Umi Cash is active.` A note about the
  architecture, in the settings screen.
- `no comparison` repeated four times in the Overview stat rows.
- `0 stations · LIVE · SLOW · OFFLINE` as a legend with no data behind it.

**Why it matters.** Each one tells the operator that the screen was built for the
person who wrote it.

### F5. Nothing is allowed to be quiet

**The law.** Contrast (Williams) and Prägnanz. Hierarchy comes from difference. If
everything is emphasised, nothing is.

**The evidence.**

- On the Overview, `Active members 333` is the largest object on the screen. It
  outranks `Revenue this month`, which is the number an owner opens the app for.
- `Sales, net`, `Avg ticket`, `Sales with discount`, `Gross profit`, `Recovered`,
  `Open alerts` are five equal cards in a row on Reportes. Equal weight means no
  hierarchy.
- The Customers list holds six facts and two icons in a 300-pixel column.
- Every surface is a white card with a 20-pixel corner. Card inside card inside
  page. The boundary stops meaning anything.

## 3. The grouping question, answered

### What the market does

Fourteen products were checked against their own documentation.

| Product      | Grouping                              | The labels                                    |
| ------------ | ------------------------------------- | --------------------------------------------- |
| Square       | **One**                               | The help topic is named "Items and inventory" |
| Shopify      | **One, nested**                       | `Home > Products > Managing inventory`        |
| Toast        | **One for the menu**, stock elsewhere | "Menu & items"                                |
| Odoo         | **One, inverted**                     | Products is a section inside Inventory        |
| MarketMan    | **One, inventory-first**              | No products module                            |
| Lightspeed K | **Two**                               | Menus and items, apart from Inventory         |
| Loyverse     | **Two**                               | Items, and "Advanced inventory"               |
| Fudo         | **Two**                               | Productos, apart from Control de stock        |
| PoloTab      | **Two**                               | Inventarios, apart from Menu                  |

Five group. Four separate. No vendor states a reason for its choice. That absence
is the finding: the market has no rule, so Umi must derive one.

### What the split actually follows

The split does not follow the till and back-office line. It follows **how the
vendor models a product**:

- Where the product record IS the stock record, the two merge. MarketMan has no
  products module at all.
- Where the sellable thing and the held thing are separate tables, the two split.
  Lightspeed, Loyverse, Fudo, and PoloTab all keep them apart.

Umi separates them. `product` and `inventory_item` are different tables, joined
through the recipe. So Umi belongs in the second group.

### One finding from the market that Umi gets wrong today

**Fudo and PoloTab both put recipes with STOCK, not with the menu.** Umi puts
Recetas in the catalog hub, beside Productos and Categorías.

That is backwards. A recipe is not a menu object. It is the rule that decides what
the shop deducts when a plate is sold. It is a stock mechanic that happens to name
a menu item.

### Umi's own shape today

| Fact                               | Value                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Top-level modules                  | 19, in 6 sections                                                                                                     |
| The catalog hub                    | **6 tabs**. The only hub above 4.                                                                                     |
| The inventory domain               | Split across **two** top-level entries: `Catálogo e inventario` and `Costos y márgenes`                               |
| The objects inside the catalog hub | What the shop sells, what it names it, what it holds, how the kitchen makes it, when it prepares it, and what it buys |

Two faults, in opposite directions. Stock authoring hides under a catalog name,
and costing sits alone as a top-level entry that belongs beside it.

### The decision

**Two destinations, cut by object, and costing moves in.**

| Destination    | Owns                                     | Tabs                                |
| -------------- | ---------------------------------------- | ----------------------------------- |
| **Productos**  | What the shop sells and what it calls it | Productos, Categorías               |
| **Inventario** | What the shop holds, and what it costs   | Artículos, Recetas, Costos, Compras |

**Why.**

1. **The object decides, and Umi has three objects.** A product is sold. An
   inventory item is held. A recipe transforms one into the other. A destination
   that holds all three is three destinations wearing one name.
2. **A recipe belongs with stock.** The two vendors in Umi's own market that
   document recipes both file them under stock. A recipe is the deduction rule.
3. **Costing is an inventory job.** `Costos y márgenes` reads the same objects the
   inventory tab writes. A separate top-level entry for it splits one job across
   two doors.
4. **Four tabs is inside every limit found.** Apple allows about five segments on
   a phone. Android and Material allow three to five destinations. Six is the only
   hub in the app above that line.
5. **The operator's questions decide the boundary.** "What do I sell?" and "What do
   I have?" are two questions. "How is it made?" and "What did it cost?" are a
   third and fourth, and both are about stock.

**What this costs.** Two module ids change, every deep link to the old hub changes,
and `role-landing` must move. That is a real migration and it is listed in the
plan.

## 4. The system that replaces it

The faults are systemic, so the fix is a system and not a set of screen edits.

### 4.1 Three page archetypes, and nothing else

| Archetype  | Used by                                        | The shape                                                        |
| ---------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **List**   | Productos, Clientes, Pedidos, Equipo, Informes | A purpose line, a view row, a resource list                      |
| **Record** | A customer, an item, an order                  | A title, a state, actions, then sections                         |
| **Board**  | Panorama, Cocina, Caja y turnos                | Live blocks in a fixed grid, each with one number and one action |

Every screen declares its archetype. A screen that fits none is a sign the screen
is doing two jobs.

### 4.2 One header contract

The masthead owns the page name. **A screen never repeats it.** Below the masthead
a screen may hold one line, and only one of these three:

- a **purpose line** when the screen needs one sentence of orientation,
- a **count** when the screen holds a set ("128 articles"),
- a **state** when the screen is live ("3 open counts").

Nothing else. No card, no banner, no stat row, no second heading.

### 4.3 Colour becomes a language

| Meaning            | Treatment                                                       |
| ------------------ | --------------------------------------------------------------- |
| Status             | A word plus a dot. Soft wash only when the row needs attention. |
| The primary action | The single navy `btn-primary`. One per screen.                  |
| Everything else    | Ink and line.                                                   |

A status colour may not repeat down a column when the value is the same in every
row. `ACTIVE` on 100 percent of rows becomes plain text, or leaves the table.

### 4.4 The numbers, fixed

| Property              | Value                                                                           | Why                                            |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| Type sizes per screen | 3 maximum                                                                       | Hierarchy, §3                                  |
| Type scale            | The existing `--font-display` and `--font-body`, at 4 sizes: 24, 16, 13.5, 11.5 | The app already uses these four                |
| Spacing               | Every gap a multiple of 4                                                       | Proportion, §4                                 |
| Group gap             | At least 2× the largest in-group gap                                            | Proximity, §1                                  |
| Radii                 | 8 for a control, 12 for a panel, 20 only for a marketing surface                | The current single 20 is too round for a table |
| Surfaces              | One canvas, one surface. No card inside a card.                                 | Common region, §1                              |
| Left edges            | 3 distinct x-positions in the content area                                      | Alignment, §2                                  |
| Contrast              | Every status readable in greyscale                                              | WCAG 1.4.1                                     |
| Text in the UI        | No identifier, no permission key, no architecture note                          | §9                                             |

### 4.5 What "inviting" means here, and what it does not

Inviting is not decoration. In this product it means three things:

1. **An empty state that offers the next action.** Not an illustration and not an
   apology. One sentence and one verb.
2. **A sentence in the operator's language where a number needs context.** "5
   articles have no stock at Congreso", not "5".
3. **Roomy entry points and tight working areas.** A screen's first band gets
   space. A row does not.

Inviting is not bigger corners, more colour, gradients, or illustration. The
sources put it plainly: warmth that costs density costs the operator.

## 5. What changes, screen by screen

| Screen                | Archetype | Change                                                                                                          |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| Catálogo e inventario | split     | Becomes **Productos** and **Inventario**                                                                        |
| Costos y márgenes     | fold      | Becomes the `Costos` tab of Inventario                                                                          |
| Panorama              | Board     | Lose the `LIVE` bar. The lead number becomes the number the owner opened the app for. One empty state, not two. |
| Clientes              | List      | Lose the repeated heading. The detail pane stops being a 60 percent empty card.                                 |
| Equipo y permisos     | List      | The permission matrix stops being a table of 50 controls.                                                       |
| Ajustes               | Record    | `Guardar cambios` moves to the section it saves. The architecture note leaves.                                  |
| Reportes              | Board     | Five equal cards become one lead figure and supporting rows.                                                    |
| Los demás             | List      | The header contract applies. Developer text leaves.                                                             |

## 6. What this audit does not claim

- The control count is a proxy, not a verdict. A dense screen can be correct. The
  count becomes a problem when the controls are undifferentiated, which is the
  finding here.
- No vendor states a reason for its grouping. The decision in §3 is Umi's, derived
  from Umi's objects and from the two vendors in Umi's own market.
- The "72 controls" figure is measured on `/catalog-inventory` at the Catalog tab,
  signed in as the owner, at 1440×940, on 2026-09-18. It is a point-in-time number.
- Two sources were blocked and are named in the research files: the Material 3
  colour roles page, and the Google Material guidance on states.

## 7. Outcome, 2026-09-18

The system in §4 is built. The screens were re-captured after the change.

- Before: [assets/screens/before/](assets/screens/before/)
- After: [assets/screens/after/](assets/screens/after/)
- Side by side: [assets/screens/taste-before-after.jpg](assets/screens/taste-before-after.jpg)

### The rules, measured on the rebuilt screens

Each row was read from the live DOM at 1440×940, signed in as the owner.

| Screen              | The page name said twice? | Developer text? | Green action buttons? | Primary actions | The card radius |
| ------------------- | ------------------------- | --------------- | --------------------- | --------------- | --------------- |
| `/products`         | no                        | no              | 0                     | 1               | 12px            |
| `/inventory`        | no                        | no              | 0                     | 1               | 12px            |
| `/inventory/costos` | no                        | no              | 0                     | 0               | 12px            |
| `/customers`        | no                        | no              | 0                     | 1               | —               |
| `/settings`         | no                        | no              | 0                     | 0               | 12px            |
| `/staff`            | no                        | no              | 0                     | 1               | 12px            |
| `/`                 | no                        | no              | 0                     | 0               | 12px            |

No screen scrolls sideways at 1440, 1024, or 390 pixels. No screen logs a console
error.

### What changed

| Change                                                                                                                                              | Where                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **The grouping.** `catalog-inventory` + `inventory-costing` became `products` + `inventory`. The old routes redirect.                               | `module-registry.js`, `app.jsx`, `shell.jsx`, `products-hub.jsx`, `inventory-hub.jsx` |
| **The page head contract.** A screen may hold one line: a purpose, a count, or a state.                                                             | `components/page-head.jsx`, `styles.css`                                              |
| **The radius.** The 20px marketing corner became 12px on every work surface.                                                                        | `styles.css`                                                                          |
| **Colour.** Green is status only. A status that repeats down a column loses its colour.                                                             | `operations-workspace.jsx`, `settings.jsx`, `staff.jsx`                               |
| **The developer text.** Permission keys, UUIDs, architecture notes, and repeated filler left the UI.                                                | all five screens that carried them                                                    |
| **The hierarchy.** Panorama leads with revenue, not with the member count. Reportes leads with one figure, not five equal cards.                    | `overview.jsx`, `ventas-report.jsx`                                                   |
| **Progressive disclosure.** The permission matrix went from one checkbox per permission to one row per group. `/staff` fell from 50 controls to 33. | `staff.jsx`                                                                           |
| **Proximity.** Each settings section saves itself, instead of one Save at the top of the page.                                                      | `settings.jsx`                                                                        |

### What did not change, and why

| Not changed                                                        | Reason                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| The control count on the list screens                              | The count is dominated by ROWS, not by chrome. `/products` holds 20 rows. The chrome fell; the rows stayed, because a row is the work. |
| The sidebar                                                        | It still holds 18 destinations in 6 sections. That is a separate decision and it needs its own evidence.                               |
| `dispositivos.jsx` (3446 lines) and the orders and kitchen screens | They received the radius and the header contract, and no full pass. They are the remaining work.                                       |
| Material 3's colour roles                                          | The page is unreachable from this workstation. The colour rules here come from WCAG 1.4.1 and from the design systems that did answer. |
