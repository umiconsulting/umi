# Catalog and inventory: one destination or two?

Date: 2026-09-18
Question: should "Catalog" and "Inventory" share one destination in the Umi
dashboard?

This file owns the NAVIGATION GROUPING question. It does not own where the
inventory screens live across the till and the back office. The file
`docs/research/2026-09-18-inventory-ui-ux-surfaces.md` owns that question.

## Step 0: tool answers

| Question                    | Answer                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Does a proven tool do this? | Yes. The vendor help centres and the design standards own the answer. No tool replaces the primary source. |
| Is the tool installed?      | Yes. `curl` 8.5.0, Obscura (Chrome 145, CDP on port 9222), Node 22.23.2, CodeGraph.                        |
| Can an agent drive it?      | Yes. `curl` is non-interactive. Obscura takes a URL and returns the rendered DOM.                          |
| What does adoption cost?    | Zero. All tools are present.                                                                               |
| What is the fallback?       | The Wayback Machine, then a vendor sitemap or a vendor API.                                                |

Tool of record: **Obscura over CDP** for every JavaScript-shell page. The source
is `docs/research/2026-09-16-agent-toolbox-and-devtools.md`, section 8.

CodeGraph version: the CLI at `/home/jc/.local/bin/codegraph`. The doctrine
requires CodeGraph for every repo audit.

## 1. The vendor answer

### Shopify

- **Documented fact.** The help page breadcrumb reads `Home > Products >
Managing inventory`. Source:
  https://help.shopify.com/en/manual/products/inventory
- **Documented fact.** The page states: "You can manage your store's inventory
  in the Inventory page of your Shopify admin." Same URL.
- **Documented fact.** The Products section page states: "The Products section
  in your Shopify admin helps you manage your store's entire product catalog."
  It also states: "Pricing and inventory: Set base prices, track stock
  quantities, and manage variant-specific inventory." Source:
  https://help.shopify.com/en/manual/products
- **Documented fact.** The Products help section lists "Managing inventory" as
  the second of 18 child pages. Source: same URL.
- **Verdict: ONE.** The vendor documentation nests inventory inside products.
- **UNVERIFIED.** The Shopify ADMIN sidebar. I could not read it from a vendor
  page in this session. The admin is behind a login. The help centre is a
  different surface from the admin sidebar.

### Square

- **Documented fact.** The help topic name is exactly **"Items and inventory"**.
  Source: https://squareup.com/help/us/en/topic/items-and-inventory
- **Documented fact.** The topic description reads: "Build your catalog of items
  and sync to your point-of-sale devices and online store. Learn how to track
  inventory and manage vendors." Same URL.
- **Documented fact.** One topic holds both areas. The area names are "Item
  library management" and "Inventory management". The topic also holds a third
  area named "Menus". Same URL.
- **Verdict: ONE.** The vendor names the pair with "and".

### Toast

- **Documented fact.** The Toast Support Center navigation holds a category
  named **"Menu & items"**. Source: https://support.toasttab.com/en
- **Verdict: ONE.** The vendor names the pair with "and" in the help navigation.
- **UNVERIFIED.** The Toast Web product navigation. The help centre is a
  JavaScript shell. The article URLs return 404 or an empty body.

### Lightspeed Restaurant K-Series

- **Documented fact.** The Back Office help centre holds these sections as
  separate entries: "About menus and items", "Inventory", "Stock management",
  "Stock movements", "Production", "Produce", "Purchase". Source:
  https://k-series-support.lightspeedhq.com/api/v2/help_center/sections.json
- **Documented fact.** A search for "inventory" returns 66 articles. Separate
  articles cover stock counts, stock levels, stock input, and recipes. Source:
  https://k-series-support.lightspeedhq.com/api/v2/help_center/articles/search.json?query=inventory
- **Verdict: TWO.** Menus and items sit apart from the stock sections.

### Clover

- **Documented fact.** Clover names item creation with the word "inventory".
  Archived help URLs include `add-new-item-inventory-web-dashboard` and
  `add-product-attributes-to-inventory`. Source:
  http://web.archive.org/cdx/search/cdx?url=help.clover.com
- **Verdict: UNVERIFIED.** The current help centre is a JavaScript shell. It
  returns a 984-byte body to `curl` and to Obscura. I could not read the current
  product navigation.

### Loyverse

- **Documented fact.** The help centre holds two separate top-level topics:
  **"Items"** at https://help.loyverse.com/help/items and **"Inventory"** at
  https://help.loyverse.com/help/advanced-inventory.
- **Documented fact.** The site footer lists "Items" and "Advanced inventory" as
  two separate products. Source: https://help.loyverse.com/help/advanced-inventory
- **Verdict: TWO.** The vendor also renames the second area to "Advanced
  inventory".

### Odoo

- **Documented fact.** Odoo 18 puts **"Inventory"** as the application, and
  **"Product management"** as a section inside it. The documentation states:
  "Odoo Inventory is both an inventory application and a warehouse management
  system." Source:
  https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory.html
- **Verdict: ONE.** Products are a child of Inventory. This is the reverse of
  the Shopify order.

### SpotOn

- **Documented fact.** The SpotOn Knowledge Base publishes an `llms.txt` index.
  Source: https://help.spoton.com/llms.txt
- **Documented fact.** SpotOn Restaurant splits into "Back of House (BOH)" and
  "Front of House (FOH)". The BOH settings groups are "Menu Settings",
  "Order Settings", "Printer Settings", "Reporting Settings", "Payments &
  Pricing Settings", "Station & Table Settings", "Kitchen Display System
  Integrations", and "Login & Employee Settings". Source:
  https://help.spoton.com/page/spoton-restaurant-backoffice.md
- **Documented fact.** Inventory is not a BOH settings group. The SpotOn
  Restaurant page states: "Explore quick tutorials on setting up menus, managing
  orders, tracking inventory, and more." Source:
  https://help.spoton.com/page/spoton-restaurant.md
- **Verdict: TWO.** Menus are a settings group. Inventory is a separate area.

### Revel

- **Documented fact.** The archived help centre holds separate article families.
  Inventory articles include "Periodic Inventory", "Adjusting Inventory Item
  Data", "Ingredient Inventory Summary", and "Low Stock Alerts". Menu articles
  include "Custom Menus" and "Prep Recipes". Source:
  https://support.revelsystems.com/hc/en-us/articles/115004411903-Adjusting-Inventory-Item-Data
- **Verdict: TWO.** The evidence is archived. The current site is a JavaScript
  shell.

### Restaurant365

- **Documented fact.** The support centre lists "Purchased and Inventory
  Reports" as a report family with 28 articles. It also lists "Recipe and
  Theoretical Reports" with 3 articles. Source:
  https://help.restaurant365.net/support/solutions
- **Verdict: UNVERIFIED.** The support centre is a reporting index. I could not
  read the R365 product navigation.

### MarketMan

- **Documented fact.** The MarketMan Solutions menu holds "Restaurant Management
  Software", "Inventory Management", "Accounts Payable Automation", "Purchasing
  and Receiving", "Multi-Unit & Commissary", "AI-Assisted Recipe Management", and
  "Menu Costing". Source: https://www.marketman.com/
- **Documented fact.** The menu holds no "Items" module and no "Products"
  module.
- **Verdict: ONE, inventory-first.** MarketMan is a purchasing and inventory
  product. A product catalog is not a peer module.

### SoftRestaurant

- **UNVERIFIED.** The site is reachable at https://www.softrestaurant.com/. The
  help centre is not. The paths `ayuda.softrestaurant.com` and
  `soporte.softrestaurant.com` do not resolve.

## 2. The reason

- **Documented fact.** No vendor states a boundary rule. I found no sentence that
  explains why products and stock sit together or apart.
- **Documented fact.** The closest statement is the Square topic description.
  Square groups the two areas by the seller's task: "Build your catalog of items
  and sync to your point-of-sale devices and online store. Learn how to track
  inventory and manage vendors." Source:
  https://squareup.com/help/us/en/topic/items-and-inventory
- **Inference.** The vendors group by task, not by statement. Square groups the
  two areas because one job ("set up what you sell") produces both. Shopify
  groups the two areas because a stock level belongs to a product. Odoo groups
  the two areas because a product is a record inside its warehouse system.
- **Gap.** The reason is a gap in the vendor sources. Do not read a reason into
  the sources.

## 3. The IA principles

### Destination count

- **Documented fact.** Android guidance: "You should use navigation bars for:
  Three to five destinations of equal importance." Source:
  https://developer.android.com/develop/ui/compose/components/navigation-bar
- **Documented fact.** Apple HIG on tab bars: "Avoid overflow tabs." and "keep in
  mind that it's generally easier to navigate among fewer tabs". Source:
  https://developer.apple.com/design/human-interface-guidelines/tab-bars
- **Documented fact.** Apple HIG on tab bars: "If you let people select their own
  tabs, aim for a default list of five or fewer to preserve continuity between
  compact and regular view sizes." Same URL.
- **Documented fact.** Apple HIG on tab bar labels: "Use single words whenever
  possible." Same URL.
- **Documented fact.** Hick's Law: "The time it takes to make a decision
  increases with the number and complexity of choices." Source:
  https://lawsofux.com/hicks-law/
- **BLOCKED.** Material 3. The pages `m3.material.io/components/tabs/overview`
  and `m3.material.io/components/navigation-drawer/overview` return an empty
  body to `curl` and to Obscura. The site needs JavaScript that did not run. I
  used the Android Compose guidance instead.

### Tab count in a page-level tab row

- **Documented fact.** Apple HIG on segmented controls: "Limit the number of
  segments in a control. Too many segments can be hard to parse and
  time-consuming to navigate. Aim for no more than about five to seven segments
  in a wide interface and no more than about five segments on iPhone." Source:
  https://developer.apple.com/design/human-interface-guidelines/segmented-controls
- **Documented fact.** Android guidance for a navigation bar is three to five
  destinations. Source: same Android URL.
- **Source-backed tradeoff.** Apple allows up to seven segments at a wide size.
  Android allows up to five. The two sources disagree at six. A six-tab row sits
  above the Android maximum and above the Apple iPhone maximum.

### Grouping rule

- **Documented fact.** NN/g on IA labels: "clarity is the most important factor
  when choosing the words that will represent IA categories". Source:
  https://www.nngroup.com/articles/3-ia-mistakes/
- **Documented fact.** NN/g on IA labels: "users won't click on a category unless
  it's clear where they will go, before they click". Same URL. The concept is
  "information scent".
- **Documented fact.** NN/g on organization models: "The navigation is a
  user-visible partial view of the full underlying IA structure, which isn't
  visible to users." Source: https://www.nngroup.com/articles/taxonomy-101/
- **Documented fact.** NN/g defines four organization models: navigation, IA
  structure, taxonomy, and content model. Source: same URL.
- **Documented fact.** NN/g on mental models: technical classifications "are
  unclear for many users". A card sort finds the groups that users expect.
  Source: https://www.nngroup.com/articles/card-sorting-definition/
- **Documented fact.** NN/g on menu design: hiding navigation categories under
  one menu is wrong for a desktop product. "Out of sight means out of mind."
  Source: https://www.nngroup.com/articles/menu-design/

### The label rule

- **Documented fact.** Apple HIG: "Use single words whenever possible." for a tab
  label. Source: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- **Documented fact.** NN/g warns against "unnecessary parallel language" in
  navigation labels, and against long vague labels. Source:
  https://www.nngroup.com/articles/3-ia-mistakes/
- **Inference.** No source states a rule for the word "and" in a navigation
  label. The sources give an indirect rule. A label must carry strong
  information scent. A two-noun label with "and" describes two objects. It does
  not describe one task.
- **Documented fact, for scale.** Square and Toast both use an "and" label
  ("Items and inventory", "Menu & items"). Both are help topics, not a fixed tab
  row.

## 4. Umi's current IA

### Modules

Source: `apps/umi-dashboard/src/lib/module-registry.js`. The file holds 19
modules across 6 sections.

| Module id           | Label                   | Section       | Permissions                                         | Line |
| ------------------- | ----------------------- | ------------- | --------------------------------------------------- | ---- |
| `overview`          | Resumen                 | HOME          | none                                                | L30  |
| `operations`        | Centro operativo        | OPERATIONS    | 13 keys, including `inventory.read`, `catalog.read` | L37  |
| `orders`            | Pedidos                 | OPERATIONS    | `kitchen.read`                                      | L60  |
| `reportes`          | Reportes                | OPERATIONS    | `sale.lifecycle`, `sale.exception.read`             | L155 |
| `cash-shifts`       | Caja y turnos           | OPERATIONS    | `cash.shift.read`                                   | L172 |
| `kitchen`           | Cocina                  | OPERATIONS    | `kitchen.read`                                      | L229 |
| `floor-plan`        | Plano de mesas          | BUSINESS      | `merchant.manage`                                   | L21  |
| `devices`           | Dispositivos            | BUSINESS      | `device.enroll`                                     | L69  |
| `staff`             | Equipo y accesos        | BUSINESS      | `merchant.manage`                                   | L78  |
| `catalog-inventory` | Catálogo e inventario   | BUSINESS      | `catalog.read`, `inventory.read`                    | L185 |
| `inventory-costing` | Costos y márgenes       | BUSINESS      | `merchant.manage`                                   | L194 |
| `customers`         | Clientes                | CUSTOMERS     | `customer.read`                                     | L86  |
| `triage`            | Atención                | CUSTOMERS     | `customer.read`                                     | L94  |
| `loyalty-value`     | Lealtad y valor         | CUSTOMERS     | `loyalty.read`, `gift_card.read`, `wallet.read`     | L220 |
| `hours`             | Horarios                | CONFIGURATION | `merchant.manage`                                   | L104 |
| `settings`          | Ajustes                 | CONFIGURATION | `merchant.manage`                                   | L113 |
| `products-billing`  | Productos y facturación | CONFIGURATION | none; `platform: 'super_admin'`                     | L121 |
| `diagnostics`       | Diagnóstico             | CONFIGURATION | `audit.read`, `hardware.diagnostics`                | L211 |
| `cafes`             | Cafés                   | PLATFORM      | none; `platform: 'super_admin'`                     | L143 |

The six sections are HOME, OPERATIONS, BUSINESS, CUSTOMERS, CONFIGURATION, and
PLATFORM.

### The catalog hub

Source: `apps/umi-dashboard/src/screens/catalog-inventory.jsx`.

- The `TABS` array starts at L22 and ends at L29. It holds 6 tabs.
- The tab labels are Catálogo (L23), Categorías (L24), Inventario (L25), Recetas
  (L26), Preparación (L27), and Facturas (L28).
- The array feeds `HubTabs` at L37.

### The hub pattern

Source: `apps/umi-dashboard/src/shell.jsx`, L690-L694. The comment states:
"HubTabs — the second level of the two-tier IA. A hub screen groups several
operational domains and shows one at a time. The tabs are the in-page navigation
that keeps the sidebar flat: a new feature becomes a tab here, not a sidebar
row."

### Tab counts across the dashboard

| Screen                  | Tabs |
| ----------------------- | ---- |
| `catalog-inventory.jsx` | 6    |
| `loyalty-value.jsx`     | 4    |
| `diagnostics.jsx`       | 3    |
| `inventory-costing.jsx` | 3    |

- **Documented fact.** The catalog hub holds the largest tab row in the
  dashboard. It holds twice the count of the two three-tab hubs.
- **UNVERIFIED.** The count of 72 interactive controls on the hub. The route
  needs an authenticated session. The Obscura profile holds no session, so the
  screen renders an empty body. The measurement route is Playwright over CDP on
  the dashboard at `http://127.0.0.1:4000/catalog-inventory` with the operator's
  signed-in Chrome profile.

## 5. The comparable products in Umi's own market

### Fudo

- **Documented fact.** The help centre holds a collection named "Sección
  'Productos'" at https://soporte.fu.do/es/collections/13843658-seccion-productos
  and a separate collection named "Control de stock" at
  https://soporte.fu.do/es/collections/13843739-control-de-stock.
- **Documented fact.** "Recetas de productos e ingredientes" sits under the
  Productos family. Waste, cost, and stock import sit under Control de stock.
- **Verdict: TWO.**

### PoloTab

- **Documented fact.** The support centre holds a category named "Inventarios"
  at https://www.polotab.com/soporte/categoria/inventarios, and a separate "Menu"
  family. Source: https://www.polotab.com/soporte
- **Documented fact.** The "Inventarios" category holds the recipes, the
  sub-recipes, the preparados, and the inventory costing. Recipes sit with stock,
  not with the menu.
- **Documented fact.** Both areas live inside one container named "Portal
  Administrativo".
- **Verdict: TWO destinations inside one portal.**

### SoftRestaurant

- **UNVERIFIED.** The site is reachable at https://www.softrestaurant.com/. The
  site lists a "Centro de ayuda" item. The help centre URL is not reachable from
  this address.

## 6. Summary table

| Product             | One or two           | Labels                                               | URL                                                                                           |
| ------------------- | -------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Shopify             | One (help IA)        | Products > Managing inventory                        | https://help.shopify.com/en/manual/products/inventory                                         |
| Square              | One                  | Items and inventory                                  | https://squareup.com/help/us/en/topic/items-and-inventory                                     |
| Toast               | One (help IA)        | Menu & items                                         | https://support.toasttab.com/en                                                               |
| Lightspeed K-Series | Two                  | About menus and items / Inventory / Stock management | https://k-series-support.lightspeedhq.com/api/v2/help_center/sections.json                    |
| Clover              | UNVERIFIED           | -                                                    | https://help.clover.com/                                                                      |
| Loyverse            | Two                  | Items / Inventory (Advanced inventory)               | https://help.loyverse.com/help/items                                                          |
| Odoo                | One                  | Inventory > Product management                       | https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory.html         |
| SpotOn              | Two                  | Menu Settings (BOH) / Inventory                      | https://help.spoton.com/page/spoton-restaurant-backoffice.md                                  |
| Revel               | Two (archived)       | Inventory / Custom Menus                             | https://support.revelsystems.com/hc/en-us/articles/115004411903-Adjusting-Inventory-Item-Data |
| Restaurant365       | UNVERIFIED           | Purchased and Inventory Reports                      | https://help.restaurant365.net/support/solutions                                              |
| MarketMan           | One, inventory-first | Inventory Management / Menu Costing                  | https://www.marketman.com/                                                                    |
| Fudo                | Two                  | Sección 'Productos' / Control de stock               | https://soporte.fu.do/es/collections/13843739-control-de-stock                                |
| PoloTab             | Two (one portal)     | Inventarios / Menu                                   | https://www.polotab.com/soporte                                                               |
| SoftRestaurant      | UNVERIFIED           | -                                                    | https://www.softrestaurant.com/                                                               |

Count of the 14 products: 5 group the two areas, 6 separate the two areas, and
3 are unverified.

## 7. What the sources say about Umi's six tabs

This section gives facts only. It gives no recommendation.

1. **Documented fact.** The catalog hub holds 6 tabs
   (`catalog-inventory.jsx` L22-L29).
2. **Documented fact.** Apple HIG allows about five segments on iPhone and about
   five to seven at a wide size for a fixed control.
3. **Documented fact.** Android guidance allows three to five destinations for a
   navigation bar.
4. **Inference.** The Umi tab row exceeds both limits at the phone size. It sits
   at the Android maximum plus one.
5. **Documented fact.** The hub pattern comment states that a hub exists to keep
   the sidebar flat (`shell.jsx` L690-L694).
6. **Documented fact.** The hub mixes five different domains: what the shop
   sells (Catálogo), how the shop names it (Categorías), what the shop holds
   (Inventario), how the kitchen makes it (Recetas), when it prepares it
   (Preparación), and what it buys (Facturas).
7. **Documented fact.** The four other Umi hubs hold 3 or 4 tabs. The catalog
   hub is the only hub above 4.
8. **Documented fact.** The tab row uses the label "Catálogo e inventario" as
   its accessible name (`catalog-inventory.jsx` L37).
9. **Documented fact.** The module label "Catálogo e inventario" joins two nouns
   with "e" (`module-registry.js` L186). Square and Toast use the same pattern.
10. **Documented fact.** The module permissions are `catalog.read` and
    `inventory.read` (`module-registry.js` L190). One entry holds two
    permissions.
11. **Documented fact.** A second BUSINESS module named "Costos y márgenes"
    holds the costing surface, and it gates on `merchant.manage`
    (`module-registry.js` L194-L207).
12. **Inference.** The costing surface sits outside the catalog hub. The hub
    holds no costing tab.

## 8. Sources reached

| Source                            | Route                          | Result                               |
| --------------------------------- | ------------------------------ | ------------------------------------ |
| help.shopify.com                  | Obscura over CDP               | Full article text                    |
| web.archive.org                   | `web.archive.org/web/2025/...` | Shopify and Clover articles          |
| squareup.com/help                 | `curl`                         | Topic page and subtopic list         |
| support.toasttab.com              | Obscura over CDP               | Nav category "Menu & items"          |
| k-series-support.lightspeedhq.com | Zendesk API                    | 66 articles, 40 sections             |
| help.loyverse.com                 | `curl`                         | Two separate topics                  |
| odoo.com/documentation            | `curl`                         | Inventory app structure              |
| help.spoton.com                   | `llms.txt` and `.md` pages     | Site structure and BOH groups        |
| help.restaurant365.net            | `curl`                         | Report families                      |
| marketman.com                     | `curl`                         | Solutions menu                       |
| soporte.fu.do                     | `curl`                         | Product and stock collections        |
| polotab.com/soporte               | `curl`                         | Support categories                   |
| nngroup.com                       | `curl`                         | 6 articles                           |
| developer.android.com             | Obscura over CDP               | Navigation bar and tab guidance      |
| developer.apple.com               | Obscura over CDP               | Tab bars and segmented controls      |
| lawsofux.com                      | `curl`                         | Hick's Law                           |
| CodeGraph CLI                     | `codegraph node`               | Screen structure and line references |

## 9. Sources blocked

| Source                   | Attempts                               | Result                                                          |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------- |
| m3.material.io           | `curl`, Obscura with a shadow-DOM walk | Empty body. The site needs JavaScript that did not run.         |
| m2.material.io           | `curl`                                 | One identical 68 KB shell for four URLs.                        |
| help.clover.com          | `curl`, Obscura, sitemap, Wayback CDX  | A 984-byte shell. Archived article URLs only.                   |
| support.revelsystems.com | Zendesk API, Obscura                   | The Zendesk API is retired. The new site is a Salesforce shell. |
| dukduckgo, Bing HTML     | `curl`                                 | A bot challenge, then unrelated results.                        |
| Bing RSS                 | `curl`                                 | 10 hits per query, unrelated to the query.                      |
| G2, Capterra             | Not attempted                          | Out of scope for this file.                                     |

The search-engine failures are the notable result. Both engines returned results
for a different query. I dropped the search route and read the vendor help
centres and their APIs directly. That route answered every question that the
search engines could not.

## 10. Verification checklist

1. Tool named: Obscura over CDP, `curl`, CodeGraph.
2. Version and source recorded: Chrome 145, Node 22.23.2, doctrine section 8.
3. Two routes tried for each blocked source: yes, except m3.material.io.
4. Unverified claims marked: yes, 6 claims.
5. No hand-rolled tool: correct. The one hand-rolled helper renders a page and
   reads the DOM. No tool does that in this workspace.
6. Research landed in a file: this file.
