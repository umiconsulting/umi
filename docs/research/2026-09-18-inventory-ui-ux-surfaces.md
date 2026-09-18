# Inventory UI/UX surfaces: where each competitor puts inventory

- Date: 2026-09-18
- Question: Where does each major restaurant and retail POS put the inventory
  management surface? Is the surface on the till, in a web back office, or in both?
  Which screens exist there? Which device does each workflow use? Which permission
  gates each screen?
- Scope: Toast, Square, Lightspeed Restaurant, Shopify POS plus Shopify admin,
  Clover, TouchBistro, Loyverse, SpotOn, and Revel Systems. MarketMan appears as an
  integration.
- Method: primary vendor documentation, vendor changelogs, and vendor sitemaps.
  One section per product. A comparison table at the end.

## 0. Step 0 of the task, and the routes used

The doctrine requires the answers to five questions. This section gives the answers.

| Question                              | Answer                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool do this?           | Yes. `curl` with a browser User-Agent reads the vendor help centres and sitemaps. Obscura reads the JavaScript help centres. |
| Is it installed here?                 | Yes. `curl` 8.5.0 is installed. The Obscura image runs in Docker.                                                            |
| Can an agent drive it with no prompt? | Yes. Both tools take a URL argument. No login is necessary.                                                                  |
| What is the adoption cost?            | None. Both tools are already present.                                                                                        |
| What is the fallback?                 | The Wayback Machine CDX index. The Bing RSS route failed.                                                                    |

Tool versions and sources:

- `curl` 8.5.0. The research channels playbook recommended this tool.
- Obscura, Docker image `h4ckf0r0day/obscura`. The toolbox document recommended this
  tool for a JavaScript wall.
- Wayback Machine CDX index. The playbook recommended this tool as the fallback.

Routes that worked, and routes that failed:

| Route                           | Result                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `curl` on vendor help pages     | Worked for Square, Toast, Loyverse, TouchBistro marketing, Shopify changelog, Revel sitemap.     |
| Zendesk help-centre JSON search | Worked for Lightspeed Restaurant K-Series. It returned 66 inventory articles.                    |
| Vendor sitemap                  | Worked for Toast, Loyverse, Clover, and Revel.                                                   |
| Obscura rendered page           | Worked for Clover, SpotOn, and the Toast search page.                                            |
| Bing RSS with a `site:` query   | Failed. Bing ignored the operator and returned general results.                                  |
| `help.shopify.com` with `curl`  | Failed. HTTP 403. Obscura met a bot challenge.                                                   |
| `support.spoton.com`            | Failed. No DNS record.                                                                           |
| `help.touchbistro.com`          | Failed. HTTP 401 on every route. The help centre is login-gated.                                 |
| Revel article pages             | Failed. The Salesforce page renders a loading shell in the live site and in the Wayback Machine. |
| `revelsystems.com`              | Failed. HTTP 429 rate limit.                                                                     |

Label key. Every claim below carries one label.

- **Documented fact** — a vendor source states it. The URL follows.
- **Source-backed tradeoff** — a source states a cost, or two sources disagree.
- **Inference** — this report reasons from the facts.
- **UNVERIFIED** — this report did not confirm the item.

Cross-reference. Two sibling reports already cover adjacent ground. This report does
not repeat them.

- `docs/research/2026-09-18-inventory-ux-principles-and-rbac.md` holds the permission
  names for Toast, Square, and Shopify.
- `docs/research/2026-09-17-inventory-kitchen-systems-deep-dive.md` holds the recipe,
  waste, and kitchen evidence.

## 1. The short answer

The competitors do not put full inventory on the till. They put a thin stock surface
on the till and the real inventory in a web back office.

- **Documented fact.** Toast puts a stock status and a quantity count in Toast Web.
  It puts a quick edit on the POS. It puts real inventory in xtraCHEF, a separate
  product. Source:
  <https://support.toasttab.com/en/article/Setting-the-Stock-Status-and-Count-for-Menu-Items>.
- **Documented fact.** Square puts receiving, stock adjustment, and stock counts in
  the POS app. It puts the stock overview, purchase orders, vendors, and reports in
  Square Dashboard. Source:
  <https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app>.
- **Documented fact.** Lightspeed Restaurant K-Series puts the whole Inventory module
  in the Back Office. Source:
  <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517428891-About-Inventory>.
- **Inference.** The pattern is a two-surface rule. The till holds a small, fast,
  per-shift action. The back office holds the record, the cost, the vendor, and the
  report.

The one clear exception is Square For Retail. Square gives the till a real write, and
not only a status change. Square uses the POS app for receiving and for counts.

## 2. Toast (Toast POS and Toast Web)

### 2.1 Surface

Toast uses three surfaces. The depth of the inventory work decides the surface.

| Work                               | Surface            | Path in the source                                            |
| ---------------------------------- | ------------------ | ------------------------------------------------------------- |
| Stock status and quantity          | Toast Web          | `Menus > Menu management > Menu builder`, then `Update Stock` |
| Stock status on the till           | Toast POS          | `Quick Edit mode`                                             |
| Stock status on a phone            | Toast Now app      | The Toast Now app                                             |
| Food waste                         | Toast Web plus POS | `Menus > Food waste management > Food waste tracker`          |
| Vendor list                        | Toast Web          | `Bill Pay > Vendors`                                          |
| Recipe, count, depletion, variance | xtraCHEF           | A separate product                                            |

**Documented fact.** The stock status article states the path. "In Toast Web,
navigate to the menu builder by selecting `Menus > Menu management > Menu builder`."
Source:
<https://support.toasttab.com/en/article/Setting-the-Stock-Status-and-Count-for-Menu-Items>,
`curl` 200.

**Documented fact.** The same article names the till surface and the phone surface.
"You can also update inventory on your POS using Quick Edit mode or the Toast Now
app." Same URL.

**Documented fact.** The article names the real-inventory product and its limit. "Item
counts only apply to an individual item... xtraCHEF can help you work around this
situation. Contact support@xtrachef.com to inquire about xtraCHEF's Recipe and
Inventory features." Same URL.

**Documented fact.** The Toast Platform Guide has no inventory section. The index
lists Orders, Menus, Off-premise dining, Publishing, Payments and money, Kitchen
operations, Multiple restaurant locations, Employees, Integrations, Guests,
Discounts, Network connections, UI options, and Glossary. Inventory is absent.
Source: <https://doc.toasttab.com/doc/platformguide/index.html>, `curl` 200.

**Documented fact.** The Toast help search holds a category named `xtraCHEF` with 559
articles. Source: <https://support.toasttab.com/en/search?q=xtraCHEF>, Obscura render.

**Documented fact.** The vendor list lives in Bill Pay. "Navigate to `Toast Web > Bill
Pay > Vendors`." The stated permission is `8.1 Financial Accounts`. Source:
<https://support.toasttab.com/en/article/Manage-Vendors-in-Bill-Pay>, `curl` 200.

### 2.2 Screens

| Screen                    | Surface   | Source                                    |
| ------------------------- | --------- | ----------------------------------------- |
| Update Stock pop-up       | Toast Web | Setting-the-Stock-Status article          |
| Quick Edit mode           | Toast POS | Setting-the-Stock-Status article          |
| Food waste tracker        | Toast Web | Get-Started-with-Food-Waste-Reduction     |
| Track Waste               | Toast POS | Get-Started-with-Food-Waste-Reduction     |
| Food Waste Education Hub  | Toast Web | Get-Started-with-Food-Waste-Reduction     |
| Food Waste Reporting      | Toast Web | Get-Started-with-Food-Waste-Reduction     |
| Vendors tab               | Toast Web | Manage-Vendors-in-Bill-Pay                |
| Low-stock clock-in pop-up | Toast POS | Why-does-an-inventory-list-pop-up article |

**Documented fact.** The food waste article gives the waste path and the permission.
"In Toast Web, navigate to `Menus > Food waste management > Food waste tracker`." The
article states "Any employee with the `6.1 Discounts Setup` permission will be able to
create and edit discounts in Toast Web." Source:
<https://support.toasttab.com/en/article/Get-Started-with-Food-Waste-Reduction>,
`curl` 200.

**Documented fact.** The clock-in pop-up is a limited-release setting. "If you are
seeing a pop-up upon clock-in containing an inventory list indicating low stock or
86'd items, this is due to a setting called Today's Shift. This setting is in limited
release at this time." Source:
<https://support.toasttab.com/en/article/Why-does-an-inventory-list-pop-up-every-time-I-clock-in>,
`curl` 200.

### 2.3 Device

**Inference.** Toast Web is a desktop browser surface. The stock article calls it
Toast Web and gives a web navigation path. Toast does not state a device in the
reached pages.

**Documented fact.** The till surface is the POS device, and the phone surface is the
Toast Now app. The stock article names both. Same URL as section 2.1.

### 2.4 Permission

**Documented fact.** The food waste reason setup needs `6.1 Discounts Setup`. The
vendor list needs `8.1 Financial Accounts`. See section 2.2 and section 2.1.

**Documented fact, cited in the sibling report.** Toast names an `Inventory &
Quantity` permission. It "Gives access to quick edit mode on the Toast POS app where
the employee can mark a menu item or modifier option as In Stock or Out of Stock, or
adjust the quantity on hand." Source:
<https://doc.toasttab.com/doc/platformguide/adminPermissions.html>, cited in
`2026-09-18-inventory-ux-principles-and-rbac.md`.

### 2.5 Why inventory stays off the till

**Inference.** Toast does not state a reason on the reached pages. The structure
states the reason. Toast keeps the inventory record in a separate product, xtraCHEF.
It keeps only a stock status on the till.

### 2.6 Media

**Documented fact.** The food waste article holds an embedded video. The caption reads
"Watch this video to see how Toast customer, Flour Bakery + Café, successfully
utilizes the Food Waste Reduction suite!" Source:
<https://support.toasttab.com/en/article/Get-Started-with-Food-Waste-Reduction>.
The video URL is UNVERIFIED.

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 3. Square (Square for Restaurants plus Square Dashboard)

### 3.1 Surface

Square uses both surfaces. The plan and the mode decide the depth.

| Work                                      | Surface                      | Path in the source                                         |
| ----------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| Stock overview                            | Square Dashboard             | `Items & services > Inventory management > Stock overview` |
| Stock overview                            | Retail POS app               | `Inventory > Stock Overview`                               |
| Receive stock                             | Retail POS app               | `Inventory > Receive stock`                                |
| Adjust stock                              | Retail POS app, or Dashboard | POS app, or the Manage stock modal                         |
| Stock count, full and cycle               | POS app                      | `Inventory > Stock counts`                                 |
| Count review and approval                 | Dashboard or POS app         | `Items > Item library > Stock counts`                      |
| Ingredient inventory                      | MarketMan in Dashboard       | `Inventory management` in Square Dashboard                 |
| Purchase orders, vendors, alerts, reports | Square Dashboard             | The Items and inventory topic                              |

**Documented fact.** The count article states both surfaces. "You can conduct
inventory counts from your POS app and review them from your Square Dashboard or POS
app." Source:
<https://squareup.com/help/us/en/article/8249-conduct-full-inventory-counts-with-square-for-retail>,
`curl` 200.

**Documented fact.** The receive and adjust article names both surfaces. "Sign in to
Square Dashboard and go to `Items & services > Inventory management > Stock
overview`." "Open the app and tap `Inventory > Stock Overview`." Source:
<https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app>,
`curl` 200.

**Documented fact.** The restaurant product is a third-party integration. "Square
Restaurant Inventory by MarketMan can provide: Real-time ingredient tracking.
Streamlined purchase orders. Robust menu costing." "Once your account is activated,
you can navigate to `Inventory management` from the Square Dashboard." Source:
<https://squareup.com/help/us/en/article/8610-manage-ingredient-inventory-with-square-restaurant-inventory>,
`curl` 200.

**Source-backed tradeoff.** Square states that the restaurant inventory add-on needs
a plan. "Restaurants Plus and Restaurants Premium subscribers. Square Plus and
Premium subscribers with advanced restaurants capabilities added." Same URL. So the
purchase-order and ingredient depth is not a base feature.

### 3.2 Screens

**Documented fact.** These screens exist in the Square `Items and inventory` topic.
Source: <https://squareup.com/help/us/en/topic/items-and-inventory>, `curl` 200.

| Screen                                        | Article URL                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Track your inventory                          | /article/7746-tracking-your-inventory-with-square-for-retail                   |
| View, receive, and adjust inventory           | /article/6110-manage-inventory-with-the-retail-pos-app                         |
| Schedule item availability and counts         | /article/8332-schedule-inventory-restocks                                      |
| Conduct, review, and approve inventory counts | /article/8249-conduct-full-inventory-counts-with-square-for-retail             |
| View stock adjustment history                 | /article/6061-view-stock-adjustment-history-with-square-for-retail             |
| Transfer stock between locations              | /article/8254-transfer-stock-between-locations-with-square-for-retail          |
| Create and manage transfer orders             | /article/8300-create-transfer-orders-with-square-for-retail                    |
| Manage ingredient inventory                   | /article/8610-manage-ingredient-inventory-with-square-restaurant-inventory     |
| Compare ingredient prices with Order Guide    | /article/8573-compare-ingredient-prices-with-square-order-guide                |
| Track ingredient costs with Square Recipes    | /article/8629-beta-track-ingredient-costs-with-square-recipes                  |
| Adjust inventory levels                       | /article/8331-set-up-inventory-tracking                                        |
| Create inventory alerts                       | /article/8333-create-inventory-alerts                                          |
| View and export inventory variance report     | /article/8251-view-and-export-inventory-variance-report-with-square-for-retail |
| Create, import, edit, and deactivate vendors  | /article/5958-vendor-management                                                |
| Create and manage purchase orders             | /article/8258-create-purchase-orders-with-square-for-retail                    |
| Set and update unit costs                     | /article/8262-set-unit-cost-with-square-for-retail-purchase-orders             |

All article URLs start with `https://squareup.com/help/us/en`.

### 3.3 Device

**Documented fact.** The count article names the phone and the tablet. "Use a
compatible barcode scanner or the built-in camera on your iPad or iPhone to scan the
item." Source: the count article, `curl` 200.

**Inference.** The Dashboard surface is a desktop browser surface. Square does not
state a device for the Dashboard pages on the reached pages.

### 3.4 Permission

**Documented fact.** The current Square wording names an item and inventory
permission. "Account owners or team members with item and inventory permissions to
update item availability, modifier availability, and stock counts on your point of
sale. Set permissions in Square Dashboard." Source: the count article and the receive
article, `curl` 200.

**Documented fact.** Square builds a permission set from three levels. "Select a
permission level: `Standard`, `Enhanced`, `Full`." The path is "`Staff > Team >
Permissions`." Source:
<https://squareup.com/help/us/en/article/5822-employee-permissions>, `curl` 200.

**Correction.** The 2026-09-05 report quotes Enhanced as "backing out of a sale,
updating inventory, and managing shifts". This report could not re-confirm that
sentence. The current article 5822 lists the three level names and does not print a
per-level inventory sentence in the reached text. Source:
<https://squareup.com/help/us/en/article/5822-employee-permissions>, `curl` 200.
Mark the old sentence as UNVERIFIED against the current page. Use the current
`item and inventory permissions` wording instead.

### 3.5 Why inventory is on the till

**Inference.** Square does not state a reason on the reached pages. The structure
states the reason. Square serves retail sellers. A retail seller counts and receives
at the counter. So Square gives the till the write.

### 3.6 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 4. Lightspeed Restaurant (K-Series)

### 4.1 Surface

**Documented fact.** The K-Series Inventory module is a Back Office surface. The
count article states "Log in to the Inventory module with your Lightspeed
credentials. From the navigation menu, select `Stock management > Stock counts`."
Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407510354715-Performing-stock-counts>,
`curl` 200.

**Documented fact.** The module has three parts. "Stock management", "Produce", and
"Purchase". Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517428891-About-Inventory>,
`curl` 200.

### 4.2 Screens

**Documented fact.** The K-Series help centre returns 66 articles for the query
`inventory`. These named screens are in the results. Source:
<https://k-series-support.lightspeedhq.com/api/v2/help_center/articles/search.json?query=inventory>,
`curl` 200, `count` 66.

| Screen or workflow                                | Article URL suffix                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| About Items (Inventory)                           | /hc/en-us/articles/6669636140443-About-Items-Inventory                           |
| Stock management (Inventory)                      | /hc/en-us/articles/4407509542043-Stock-management-Inventory                      |
| Stock levels                                      | /hc/en-us/articles/4407517612699-Stock-levels                                    |
| Performing stock counts                           | /hc/en-us/articles/4407510354715-Performing-stock-counts                         |
| Stock locations                                   | /hc/en-us/articles/6670276492699-Stock-locations                                 |
| Par levels                                        | /hc/en-us/articles/6686397618843-Par-levels                                      |
| Adding new stock input                            | /hc/en-us/articles/4406100384539-Adding-new-stock-input                          |
| Adding new stock output                           | /hc/en-us/articles/4406100386459-Adding-new-stock-output                         |
| Adding new stock transfer                         | /hc/en-us/articles/4406108289819-Adding-new-stock-transfer                       |
| About Purchase                                    | /hc/en-us/articles/6752297865883-About-Purchase                                  |
| Creating purchase orders                          | /hc/en-us/articles/4407569259547-Creating-purchase-orders                        |
| Receiving, managing, and deleting purchase orders | /hc/en-us/articles/4407576020507-Receiving-managing-and-deleting-purchase-orders |
| Adding suppliers                                  | /hc/en-us/articles/4407560855707-Adding-suppliers                                |
| Creating and managing recipes                     | /hc/en-us/articles/4407511552155-Creating-and-managing-recipes                   |
| Adding production batches                         | /hc/en-us/articles/4406100692763-Adding-production-batches                       |
| Discrepancy reports                               | /hc/en-us/articles/20537741099419-Discrepancy-reports                            |
| Setting up the MarketMan integration              | /hc/en-us/articles/22675539589787-Setting-up-the-MarketMan-integration           |

All article URLs start with `https://k-series-support.lightspeedhq.com`.

**Documented fact.** The stock management article names the stock count and the stock
location. "Stock counts help you perform inventory assessments by allowing you to
enter the physical quantity on hand of each item." "Create stock locations to help
you and your staff identify where items are stored." Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407509542043-Stock-management-Inventory>,
`curl` 200.

### 4.3 Device

**Documented fact.** More than one employee can count at the same time on more than
one device. "Multiple employees can count together by each resuming the same stock
count from different devices." "If multiple employees are counting, real-time updates
across all devices ensure everyone stays coordinated." Source: the stock count
article, `curl` 200.

**Inference.** The Back Office is a web surface. The count article names a browser
navigation menu and a mouse action ("Click Save, next item"). A laptop or a tablet
browser fits. Lightspeed does not state one device in the reached pages.

**Documented fact.** Lightspeed also ships an iPad and iPhone app. The help centre
carries the article "Preparing your iPad/iPhone for Lightspeed". Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328154-Preparing-your-iPad-iPhone-for-Lightspeed>.
That article is about the POS app, not the Inventory module.

### 4.4 Permission

**Documented fact.** Lightspeed gates the Inventory section of the Back Office with
one named permission. "`Integrations and customers`: The user can access the
Integration Hub, Customers, and Inventory sections of the Back Office." Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804647149-Managing-Back-Office-users>,
`curl` 200.

**Documented fact.** A second permission gates the whole Back Office. "`Settings and
configuration`: The user can edit the POS, Business, Hardware, Operations, and
Payment sections of the Back Office." Same URL.

**Inference.** A cashier with a POS user account does not see the Inventory section.
A Back Office user with `Integrations and customers` sees it. Lightspeed does not
print a cashier-versus-manager sentence in the reached pages.

### 4.5 Why inventory is in the Back Office

**Inference.** Lightspeed does not state a reason on the reached pages. The structure
states the reason. Lightspeed puts the item, the supplier, the cost, the recipe, and
the purchase order in one Back Office place.

### 4.6 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

**UNVERIFIED.** This report verified the K-Series only. The L-Series may differ. The
L-Series help host was not confirmed.

## 5. Shopify POS plus Shopify admin

### 5.1 Surface

Shopify uses both surfaces, plus a retired third surface.

| Work                               | Surface                 | Source                                |
| ---------------------------------- | ----------------------- | ------------------------------------- |
| Inventory record and quantity      | Shopify admin           | Changelog feed                        |
| Inventory states on the till       | Shopify POS             | Inventory-states-in-POS changelog     |
| Purchase orders                    | Shopify admin           | Purchase-orders changelog             |
| Inventory transfers                | Shopify admin           | Simpler-inventory-transfers changelog |
| Adjustment history                 | Shopify admin           | Adjustment-history changelog          |
| Inventory adjustments on a phone   | Shopify mobile app      | Mobile-app changelog                  |
| Receive and stocktake in the store | Stocky plus Shopify POS | Stocky App Store page                 |

**Documented fact.** Shopify added purchase orders to the admin. "Use Purchase orders
to order and stock inventory from your suppliers." Source:
<https://changelog.shopify.com/posts/use-purchase-orders-to-order-and-stock-inventory-from-your-suppliers>,
listed in the official feed <https://changelog.shopify.com/feed>, `curl` 200.

**Documented fact.** Shopify puts inventory states on the POS. "New On hand and
Unavailable inventory states in POS." Source:
<https://changelog.shopify.com/posts/new-on-hand-and-unavailable-inventory-states-in-pos>,
official feed.

**Documented fact.** Shopify gives the phone an inventory write. "Manage your
inventory from anywhere with the Shopify mobile app." Source:
<https://changelog.shopify.com/posts/manage-your-inventory-from-anywhere-with-the-shopify-mobile-app>,
official feed.

**Documented fact.** Shopify added a scanner to the mobile app. "Updated Inventory
Scanner in the Shopify App." Source:
<https://changelog.shopify.com/posts/updated-inventory-scanner-in-the-shopify-app>,
official feed.

### 5.2 Screens

**Documented fact.** Stocky is the store-side inventory app. The Shopify App Store
describes it as "Stocky - Inventory Management for Shopify POS Pro". It states:
"Create and manage purchase orders and communicate with suppliers. Conduct
stocktakes by counting or scanning stock on hand and make adjustments. Use in-depth
reporting to make good inventory decisions through stock analytics. Review and
receive incoming inventory in Shopify POS. Use barcode scanning to speed up receiving
inventory in Shopify POS." Source: <https://apps.shopify.com/stocky>, `curl` 200.

### 5.3 Device

**Documented fact.** Shopify POS is a tablet app. Stocky extends the POS with
receiving and stocktake. Source: the Stocky App Store page, `curl` 200.

**Documented fact.** The Shopify mobile app holds an inventory adjustment surface.
Source: the mobile-app changelog, official feed.

**Inference.** The Shopify admin is a desktop browser surface.

### 5.4 Permission

**Documented fact, cited in the sibling report.** Shopify names four inventory
permissions in the Store permission category: `Manage inventory (excluding
transfers)`, `View transfers`, `Manage transfers`, and `Manage shipments`. All four
need `View products`. The POS permission list holds no inventory permission. Source:
<https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions>,
cited in `2026-09-18-inventory-ux-principles-and-rbac.md`.

**Documented fact, cited in the sibling report.** "Regardless of their assigned
location, staff members can view product inventory for all locations within the POS
app." Source:
<https://help.shopify.com/en/manual/your-account/users/roles/permissions/pos-permissions>,
cited in the sibling report.

**Inference.** A Shopify cashier can view stock on the till. The cashier does not get
an inventory write on the till, unless the merchant gives the POS Pro Stocky surface.

### 5.5 Why inventory stays off the till

**Inference.** Shopify does not state a reason on the reached pages. The structure
states the reason. Shopify treats one inventory record across web, mobile, and store.
The record lives in the admin. The POS reads it.

### 5.6 Media

**Documented fact.** The Shopify App Store listing for Stocky holds a screenshot
gallery. Source: <https://apps.shopify.com/stocky>, `curl` 200. The individual image
URLs are UNVERIFIED.

## 6. Clover

### 6.1 Surface

**Documented fact.** Clover puts item and inventory definition in the help category
"Customize your system". The page states "Define your items to build an organized
inventory and streamline order taking across your Clover devices." Source:
<https://www.clover.com/en-US/help/define-your-items>, Obscura render.

**Documented fact.** The reached page names one screen, "Work with multiple menus".
The breadcrumb is "Home > Customize your system > Define your items". Same URL.

**UNVERIFIED.** This report could not verify a Clover stock count screen, a receiving
screen, a purchase order screen, a vendor screen, or an inventory report screen. The
Clover help centre is a JavaScript app. Most old article slugs now redirect or return
"We can't find that page".

Routes tried for Clover, with the result:

| Route                                                     | Result                              |
| --------------------------------------------------------- | ----------------------------------- |
| `https://www.clover.com/help`                             | 984-byte app shell, no article text |
| `https://www.clover.com/help/inventory-app`               | Redirect to `define-your-items`     |
| `https://www.clover.com/en-US/help/inventories-and-menus` | "We can't find that page"           |
| Wayback snapshot of `/help/inventory-app`                 | App shell only                      |
| `https://www.clover.com/us/en/sitemap.xml`                | One inventory marketing page only   |

### 6.2 Device

**Documented fact.** Clover states "across your Clover devices". Source: the
define-your-items page, Obscura render. Clover does not name one device for the
inventory work on the reached pages.

### 6.3 Permission

**UNVERIFIED.** No Clover inventory permission name was verified.

**Correction on a prior source.** The 2026-09-05 report cites a Clover "Role
Permissions Index" at `bypassmobile.zendesk.com`. That host is a reseller help
centre, not a Clover-owned host. Treat that citation as a reseller source, not a
Clover primary source.

### 6.4 Why inventory is on the till

**Inference.** Clover serves small retail and food merchants. Clover places item
definition in a system-customization area. No vendor reason statement was reached.

### 6.5 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 7. TouchBistro

### 7.1 Surface

**Documented fact.** TouchBistro sells a separate inventory product. The page is
"TouchBistro Inventory Management". Source:
<https://www.touchbistro.com/inventory-management/>, `curl` 200.

**Documented fact.** The product states the reason for the separate surface. "Direct
POS integration keeps all your data in one place. The latest sales and menu data
flows seamlessly from your POS into your restaurant inventory management system every
15 minutes so you can accurately predict how much to order and determine your ideal
usage." Same URL.

**Documented fact.** The product states the counting benefit. "Speed up and simplify
the counting process with the ability to assign each item to a physical location in
your venue, add units of measure to each item, and let multiple managers count at the
same time." Same URL.

### 7.2 Screens

**Documented fact.** The marketing page names these workflows. Source: the TouchBistro
inventory page, `curl` 200.

- Inventory records and counts
- Recipe costing and management
- Food prep forecasting
- Reports for stock, expenses, and COGS
- Suggested ordering
- Vendor management and purchase orders with email to the vendor
- A "task and waste manager" for waste, theft, spoilage, and overproduction

**UNVERIFIED.** This report did not verify the screen names inside the product. The
TouchBistro help centre returns HTTP 401 on every route. The help centre is
login-gated.

Routes tried for TouchBistro, with the result:

| Route                                                          | Result                |
| -------------------------------------------------------------- | --------------------- |
| `https://help.touchbistro.com/`                                | 200 for the shell     |
| `https://help.touchbistro.com/hc/en-us`                        | 401                   |
| `https://help.touchbistro.com/hc/en-us/search?query=inventory` | 401                   |
| `https://help.touchbistro.com/api/v2/...search.json`           | 401                   |
| `https://support.touchbistro.com/`                             | S3 website, no answer |

### 7.3 Device

**Documented fact.** "let multiple managers count at the same time". Source: the
TouchBistro inventory page, `curl` 200. The page does not name the device.

**Inference.** A multi-manager count across one venue implies more than one tablet or
phone. Mark the exact device as UNVERIFIED.

### 7.4 Permission

**UNVERIFIED.** No TouchBistro inventory permission name was verified. The help
centre is login-gated.

### 7.5 Why inventory is off the till

**Documented fact.** "The latest sales and menu data flows seamlessly from your POS
into your restaurant inventory management system every 15 minutes." Source: the
TouchBistro inventory page, `curl` 200.

**Inference.** TouchBistro treats the POS as the sales source and the inventory
product as the stock source. The POS pushes data to the inventory system.

### 7.6 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 8. Loyverse

### 8.1 Surface

Loyverse uses both surfaces. A paid tier gates the deep work.

**Documented fact.** "Advanced Inventory Management is a set of additional Back
Office features that helps you track stock levels more efficiently, monitor inventory
changes, and calculate business profitability with greater accuracy." Source:
<https://help.loyverse.com/help/advanced-inventory-management>, `curl` 200.

**Documented fact.** The POS holds a stock surface. "The Items section in the POS app
allows you to view and manage the stock of your products directly from the device."
Source: <https://help.loyverse.com/help/displaying-stock-and-cost-items-pos>,
`curl` 200.

**Documented fact.** The Back Office holds the deeper work. "While adding items
directly from the Loyverse POS app on your mobile device is quick and easy, using the
Back Office provides access to more advanced item management features." Source:
<https://help.loyverse.com/help/how-add-items-loyverse-back-office>, `curl` 200.

This last quote is the clearest vendor reason found in this research for a two-surface
split.

### 8.2 Screens

**Documented fact.** The Inventory topic lists these screens. Source:
<https://help.loyverse.com/help/advanced-inventory>, `curl` 200.

| Screen                                  | Article URL suffix                       |
| --------------------------------------- | ---------------------------------------- |
| What is Advanced Inventory Management   | /help/advanced-inventory-management      |
| Purchase Orders and Suppliers           | /help/how-purchase-orders-and-suppliers  |
| Transfer Orders                         | /help/how-work-transfer-orders           |
| Stock Adjustments                       | /help/how-work-stock-adjustments         |
| Inventory Count                         | /help/how-work-inventory-count           |
| Production                              | /help/how-work-production                |
| Inventory History                       | /help/inventory-history-and-valuation    |
| Inventory Valuation Report              | /help/inventory-valuation-report         |
| Autofill of Items in the Purchase Order | /help/autofill-items-purchase-order      |
| Additional Costs in Purchase Orders     | /help/how-work-additional-costs-purchase |
| Print Labels for Items                  | /help/how-print-labels-items             |
| Order Items by Boxes                    | /help/how-order-items-by-boxes           |
| Low Stock notification                  | /help/low-stocks                         |

All article URLs start with `https://help.loyverse.com`.

**Documented fact.** The low-stock screen holds a Back Office trigger and an email
notice. "Loyverse POS allows you to track low-stock items in the Back Office and
receive daily email notifications when stock levels are low or items are out of
stock." Then "In the Back Office, go to the `Item list`." Source:
<https://help.loyverse.com/help/low-stocks>, `curl` 200.

**Documented fact.** The count needs the paid tier. "Inventory Count is part of
Advanced Inventory Management and requires an active subscription." Source:
<https://help.loyverse.com/help/how-work-inventory-count>, `curl` 200.

### 8.3 Device

**Documented fact.** The POS app runs on a mobile device. "While adding items
directly from the Loyverse POS app on your mobile device is quick and easy." Source:
the back-office item article, `curl` 200.

**Inference.** The Back Office is a desktop browser surface. Loyverse does not name
one device in the reached pages. The email notice is the phone-facing part.

### 8.4 Permission

**UNVERIFIED.** No Loyverse inventory permission name was verified. The tier gates
the feature, not a named role.

### 8.5 Why inventory splits

**Documented fact.** "While adding items directly from the Loyverse POS app on your
mobile device is quick and easy, using the Back Office provides access to more
advanced item management features." Source:
<https://help.loyverse.com/help/how-add-items-loyverse-back-office>, `curl` 200.

### 8.6 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 9. SpotOn

### 9.1 Surface

**Documented fact.** SpotOn puts the restaurant administration in a "Back of House
(BOH)" area. The knowledge base names the section "Back of House (BOH)" and states
"View help content to learn SpotOn Restaurant Back of House (BOH/BackOffice)". Source:
<https://help.spoton.com/page/spoton-restaurant-backoffice>, Obscura render.

**Documented fact.** SpotOn names work in that back office. The reached list holds
`Adjustment Reasons`, `Menu Items`, `Menu Items Bulk Editor`, `Menu Item Import`,
`Barcode Scanner Setup & Information`, `Label Printing`, `Requisition Groups`, and
`Report Groups`. Source: the BOH page links, Obscura render.

**Documented fact.** SpotOn tells the reader that the back of house covers inventory.
"Back of house: Ensuring smooth operations from prep to inventory." Source:
<https://www.spoton.com/101/restaurantpos>, `curl` 200.

**UNVERIFIED.** This report did not verify a SpotOn stock count screen, a purchase
order screen, or a vendor list screen by name.

### 9.2 Device

**UNVERIFIED.** SpotOn does not name a device for the BOH pages in the reached pages.
The BOH is a BackOffice area.

### 9.3 Permission

**UNVERIFIED.** No SpotOn inventory permission name was verified.

### 9.4 Why inventory is in the back office

**Inference.** SpotOn separates Front of House from Back of House by name. SpotOn puts
the adjustment reason and the label printing in the Back of House. The reached pages
state no reason.

### 9.5 Media

**Documented fact.** SpotOn publishes an official tutorial video page for restaurant
POS work, and it names inventory. Source:
<https://www.spoton.com/101/restaurantpos>, `curl` 200. The individual video URL is
UNVERIFIED.

## 10. Revel Systems

### 10.1 Surface

**Documented fact.** Revel puts the inventory record in a "Management Console". The
official sitemap lists the article "Creating Matrix Inventory on the Management
Console". Source:
<https://support.revelsystems.com/s/sitemap-topicarticle-1.xml>, `curl` 200.

**Documented fact.** Revel puts one availability action on the till. The sitemap
lists "Managing Item Availability on the Point of Sale". Same URL.

### 10.2 Screens

**Documented fact.** The official sitemap lists these inventory articles. Source:
<https://support.revelsystems.com/s/sitemap-topicarticle-1.xml>, `curl` 200.

| Screen or workflow                                     | Article URL                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Introduction to Inventory                              | /s/article/Introduction-to-Inventory-1583148890898                              |
| Inventory FAQs                                         | /s/article/Inventory-FAQs                                                       |
| Updating Products Inventory Settings                   | /s/article/Updating-Products-Inventory-Settings-1583151245948                   |
| Creating Matrix Inventory on the Management Console    | /s/article/Creating-Matrix-Inventory-on-the-Management-Console-1583150212824    |
| Import-Export Inventory Tutorial                       | /s/article/Import-Export-Inventory-Tutorial-1583149942768                       |
| Import Matrix Inventory                                | /s/article/Import-Matrix-Inventory-1583150212831                                |
| Creating Purchase Orders                               | /s/article/Creating-Purchase-Orders-1583149943284                               |
| Low Stock Alerts Reordering for QSR-TSR                | /s/article/Low-Stock-Alerts-Reordering-for-QSR-TSR-1583149943276                |
| Low Stock Alerts Reordering for Retail                 | /s/article/Low-Stock-Alerts-Reordering-for-Retail-1583149942781                 |
| Periodic Inventory                                     | /s/article/Periodic-Inventory-1583149942773                                     |
| Physical Inventory                                     | /s/article/Physical-Inventory-1583149941728                                     |
| Stocktake                                              | /s/article/Stocktake-1583149941735                                              |
| Physical Inventory Report                              | /s/article/Physical-Inventory-Report-1583149672025                              |
| Item Tracking Report                                   | /s/article/Item-Tracking-Report-1583149672034                                   |
| Item Tracking Product Forecasting                      | /s/article/Item-Tracking-Product-Forecasting-1583149672017                      |
| Bulk Inventory Transfer Ingredient to Product Transfer | /s/article/Bulk-Inventory-Transfer-Ingredient-to-Product-Transfer-1583150213562 |
| Multi-Establishment Inventory Transfer                 | /s/article/Multi-Establishment-Inventory-Transfer-1583150213566                 |
| Inventory Stock Unit Conversions                       | /s/article/Inventory-Stock-Unit-Conversions-1583149942770                       |
| Barcodes on Stock Units                                | /s/article/Barcodes-on-Stock-Units-1583150212845                                |
| Managing Item Availability on the Point of Sale        | /s/article/Managing-Item-Availability-on-the-Point-of-Sale                      |

All article URLs start with `https://support.revelsystems.com`.

**UNVERIFIED.** This report could not read the article bodies. The Revel help site
renders a JavaScript shell. The live site and the Wayback Machine both return the
shell. The article titles above come from the official sitemap, so the titles are
primary evidence. The screen contents are not verified.

### 10.3 Device

**UNVERIFIED.** No device statement was verified. The sitemap names a "Management
Console" and a "Point of Sale".

### 10.4 Permission

**UNVERIFIED.** No Revel inventory permission name was verified. The article bodies
are not readable.

### 10.5 Why inventory splits

**Inference.** Revel names two surfaces in its own article titles. The console holds
the setup and the record. The point of sale holds the availability action.

### 10.6 Media

No official inventory screenshot URL was verified. Mark as UNVERIFIED.

## 11. MarketMan (integration, not a POS)

**Documented fact.** MarketMan is the engine behind Square Restaurant Inventory.
"Square Restaurant Inventory by MarketMan can provide: Real-time ingredient tracking.
Streamlined purchase orders. Robust menu costing." Source:
<https://squareup.com/help/us/en/article/8610-manage-ingredient-inventory-with-square-restaurant-inventory>,
`curl` 200.

**Documented fact.** Lightspeed also integrates MarketMan. The K-Series help centre
carries "Setting up the MarketMan integration". Source:
<https://k-series-support.lightspeedhq.com/hc/en-us/articles/22675539589787-Setting-up-the-MarketMan-integration>,
`curl` 200.

**Inference.** MarketMan is the clearest example of the specialist model. A POS maker
buy the ingredient layer from a specialist, and it lives in the back office.

## 12. Comparison table

| Product      | Surface                     | Named screens                                                | Device                                 | Permission gate                                                         |
| ------------ | --------------------------- | ------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------- |
| Toast        | Web plus a thin till        | Update Stock, Food waste tracker, Bill Pay Vendors           | Desktop web, POS, phone                | `Inventory & Quantity`; `6.1 Discounts Setup`; `8.1 Financial Accounts` |
| Square       | Both                        | Stock overview, Receive stock, Stock counts, Purchase orders | iPad and iPhone app; desktop Dashboard | `item and inventory permissions`                                        |
| Lightspeed K | Back Office                 | Stock counts, Stock levels, Purchase orders, Recipes         | Desktop web, multi-device count        | `Integrations and customers`                                            |
| Shopify      | Admin plus POS              | Purchase orders, Transfers, Stocky stocktake                 | Desktop web, tablet POS, phone app     | `Manage inventory (excluding transfers)`                                |
| Clover       | Unclear                     | Item definition only                                         | Clover devices                         | UNVERIFIED                                                              |
| TouchBistro  | Separate product            | Counts, recipes, waste, suggested ordering                   | Multi-manager count                    | UNVERIFIED                                                              |
| Loyverse     | Both, paid tier             | Inventory Count, Purchase Orders, Transfers, Valuation       | Mobile app plus Back Office            | Tier gate, not a role                                                   |
| SpotOn       | Back of House               | Adjustment Reasons, Requisition Groups, Label Printing       | UNVERIFIED                             | UNVERIFIED                                                              |
| Revel        | Management Console plus POS | Stocktake, Physical Inventory, Purchase Orders               | UNVERIFIED                             | UNVERIFIED                                                              |

## 13. Answers to the five questions, per product

| Product      | 1. Where?          | 2. Which screens?          | 3. Which device?      | 4. Which permission?      | 5. Which reason?       |
| ------------ | ------------------ | -------------------------- | --------------------- | ------------------------- | ---------------------- |
| Toast        | Both, and xtraCHEF | Stock, waste, vendors      | Web, till, phone      | `Inventory & Quantity`    | Not stated             |
| Square       | Both               | Receive, adjust, count, PO | iPad, iPhone, desktop | Item and inventory        | Not stated             |
| Lightspeed K | Back Office        | Counts, PO, recipes        | Web, multi-device     | Integration and customers | Not stated             |
| Shopify      | Admin plus POS     | PO, transfers, stocktake   | Web, tablet, phone    | Manage inventory          | Not stated             |
| Clover       | Unclear            | Item definition            | Clover devices        | UNVERIFIED                | Not stated             |
| TouchBistro  | Separate product   | Counts, waste, ordering    | Multi-manager         | UNVERIFIED                | POS pushes data        |
| Loyverse     | Both, paid tier    | Count, PO, transfer, value | Mobile, Back Office   | Tier gate                 | Back Office holds more |
| SpotOn       | Back of House      | Adjustment, requisition    | UNVERIFIED            | UNVERIFIED                | Not stated             |
| Revel        | Console plus POS   | Stocktake, physical count  | UNVERIFIED            | UNVERIFIED                | Not stated             |

## 14. Confirm or correct the earlier claims

| Earlier claim                                         | Result                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Square `Enhanced` permits "updating inventory"        | UNVERIFIED. The current article 5822 does not print that sentence. Use the current wording `item and inventory permissions` instead. |
| Toast gates inventory on the POS                      | Confirmed, and extended. The named permission is `Inventory & Quantity`.                                                             |
| Lightspeed configures in the Back Office              | Confirmed, and extended. The Inventory section needs `Integrations and customers`.                                                   |
| UmiPOS `Inventory operations` is manager-gated on POS | Supported. Every readable vendor except Square For Retail keeps the record off the till.                                             |
| Clover role permissions come from a Clover source     | Corrected. The cited host is a reseller Zendesk. Treat it as a non-primary source.                                                   |

## 15. What is still UNVERIFIED

- The Clover inventory screens, device, and permission.
- The TouchBistro screen names and permission. The help centre returns HTTP 401.
- The SpotOn inventory screen names and permission.
- The Revel screen contents, device, and permission. The site renders a shell.
- The Lightspeed L-Series inventory surface. This report verified the K-Series only.
- The Shopify Stocky sunset date from an official Shopify page. Merchants report
  August 31, 2026. Source:
  <https://community.shopify.com/t/stocky-app-going-away-after-august-31-2026/587292>,
  `curl` 200. This is a community source, not a Shopify statement.
- Official inventory screenshot URLs for every product.

## 16. Sources reached, and sources blocked

Sources reached:

- Toast: `support.toasttab.com`, `doc.toasttab.com`.
- Square: `squareup.com/help`, `squareup.com/us/en/staff`.
- Lightspeed: `k-series-support.lightspeedhq.com`.
- Shopify: `changelog.shopify.com`, `apps.shopify.com`, `community.shopify.com`,
  `shopify.dev`.
- Clover: `www.clover.com/en-US/help`.
- TouchBistro: `www.touchbistro.com`.
- Loyverse: `help.loyverse.com`.
- SpotOn: `help.spoton.com`, `www.spoton.com/101`.
- Revel: `support.revelsystems.com/s/sitemap-topicarticle-1.xml`.

Sources blocked:

- `help.shopify.com` — HTTP 403, then a bot challenge.
- `help.touchbistro.com` — HTTP 401 on every route.
- `support.spoton.com` — no DNS record.
- `support.touchbistro.com` — S3 website, no answer.
- `revelsystems.com` — HTTP 429.
- `doc.toasttab.com/doc/platformguide/adminInventory.html` — HTTP 403.
- Revel article bodies — JavaScript shell, live and archived.

## 17. The doctrine checklist

1. Did you name the tool? Yes: `curl` 8.5.0, Obscura, and the Wayback CDX index.
2. Did you record the version and the source? Yes, in section 0.
3. Did you try at least two routes for a blocked source? Yes, for Clover, TouchBistro,
   Shopify, SpotOn, and Revel.
4. Did you mark the unverified claims? Yes. Section 15 lists them.
5. Did you avoid hand-rolling what a tool does? Yes. No custom scraper was written.
6. Did the research land in a file? Yes: this file.
