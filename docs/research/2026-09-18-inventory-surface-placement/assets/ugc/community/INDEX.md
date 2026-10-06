# UGC screenshots: Square and Toast communities

Capture date: 2026-09-18.
Scope: Square seller community, Toast community, Toast reseller and partner pages.
Tool: curl 8.x with a Chrome user agent for Square. Playwright 1.62.1 with Chromium 1234 for Toast.
Method: load the community search pages, read the post image URLs, and save each image.

Total images: 10.

| file name                                                     | product | source URL                                                                                                                         | source kind     | device visible                       | what the screen shows                                                                                                                                                   | class     |
| ------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| square-community-inventory-app-stock-counts-ipad-register.png | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Stock-count/m-p/755013                                                 | community forum | iPad and Square Register tablet      | The Square Inventory app shows a "Stock counts" list with "Stock overview" and "Purchase orders" on the left menu. A red box marks "Stock counts".                      | INVENTORY |
| square-community-item-library-stock-on-hand-filter.png        | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Bug-Report-Inventory-Filter-Showing-Incorrect-Results/m-p/809429       | community forum | desktop browser                      | The Item library shows the columns "Stock on hand" and "Available to sell". The "Filter by" panel shows the choice "Inventory / Sold out".                              | INVENTORY |
| square-community-item-library-stock-column.png                | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Physical-Inventory-for-Items-I-Do-Not-Have/m-p/760387                  | community forum | desktop browser                      | The Item library shows a Stock column with the quantity for each item. A zero quantity is red. The left menu shows "Inventory management".                              | INVENTORY |
| square-community-inventory-history-recount-detail.png         | Square  | https://community.squareup.com/t5/Payments-Troubleshooting/Why-are-inventory-reports-not-showing-Unit-Costs-but-do-show/m-p/832356 | community forum | desktop browser                      | The Inventory history page shows the dialog "Recount Detail". The dialog shows the SKU, the location, the adjustment, the stock count, and the unit cost.               | INVENTORY |
| square-community-inventory-report-by-category.png             | Square  | https://community.squareup.com/t5/Payments-Troubleshooting/Why-are-inventory-reports-not-showing-Unit-Costs-but-do-show/m-p/832356 | community forum | desktop browser                      | The report "Inventory by Category" shows "Total Inv. Value", "Potential Profit", and "Profit Margin" for each category. A banner asks for missing unit costs.           | INVENTORY |
| square-community-edit-item-variations-manage-stock.png        | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Conducting-inventory-counts-with-fractional-items/m-p/787641           | community forum | desktop browser                      | The "Edit item" page shows a Variations table with a Stock column. The stock values are 432, 6 pa, and 1 ca. The buttons are "Manage stock" and "Edit Stock Tracking".  | INVENTORY |
| square-community-edit-variation-manage-stock-tab.png          | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Using-Inventory-in-Restaurants/m-p/714328                              | community forum | desktop browser                      | The dialog "Edit variation" shows the tabs "Details", "Manage stock", and "Custom attributes". The form shows the unit cost, the vendor, the conversion, and the price. | INVENTORY |
| square-community-update-stock-modal.png                       | Square  | https://community.squareup.com/t5/Archived-Discussions-Read-Only/Sold-Out-Inventory/m-p/234994                                     | community forum | desktop browser                      | The dialog "Update stock" shows the count "Available online (1)". The dialog shows the switch "Track stock" and a restocking preference list.                           | INVENTORY |
| square-community-pos-menu-sold-out-badge.jpg                  | Square  | https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Using-Inventory-in-Restaurants/m-p/714328                              | community forum | Square POS tablet screen, photograph | A photograph of the Square POS item grid. The tile "Diet Coca-Cola" has the badge "Sold out". One empty tile reads "Unsupported".                                       | INVENTORY |
| toast-community-pos-quick-edit-stock-status.png               | Toast   | https://community.toasttab.com/t5/restaurant-operations/feature-request-inventory-count-management/m-p/5559                        | community forum | Android tablet emulator              | The Toast POS shows the panel "Quick edit". The panel has "In stock", "Out of stock", and "Set quantity". The item tiles show the counts 1, 3, and 7.                   | INVENTORY |

## Blocked sources and empty sources

| source                                                                                                        | status code | result                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| https://community.toasttab.com/ over curl                                                                     | 403         | Cloudflare page "Just a moment...". The same URL returns 200 in Playwright Chromium 1234. |
| https://community.toasttab.com/t5/forums/recentpostspage over curl                                            | 403         | Same Cloudflare block.                                                                    |
| https://community.toasttab.com/search?q=inventory over curl                                                   | 403         | Same Cloudflare block.                                                                    |
| https://community.toasttab.com/t5/&lt;board&gt;/&lt;thread&gt;/m-p/&lt;id&gt; over the Playwright request API | 403         | The request API does not run JavaScript. Use full page navigation instead.                |
| https://community.squareup.com/api/2.0/search?q=inventory                                                     | 400         | Answer: "Invalid query syntax". The HTML search route works.                              |
| https://toast-inventory.com/                                                                                  | 200         | The page has no product image. The site returns 14 KB of HTML.                            |
| https://toast-inventory.com/tutorials/index.html                                                              | 200         | The page has no product image.                                                            |
| https://www.linecheck.tv/video/get-started-with-xtrachef-inventory                                            | 200         | Only YouTube thumbnails. No product screen.                                               |
| https://restaurantinventorymanagementsoftware.com/blog/toast-inventory-management-complete-guide              | 200         | Only one Unsplash stock photo. No product screen.                                         |
| https://www.linenow.co/blog/guides/toast-inventory-management                                                 | 200         | Only the site logo and one YouTube thumbnail. No product screen.                          |
| https://amandaspiessrestaurantconsultation.com/                                                               | 200         | Only GoDaddy stock photos. No product screen.                                             |
| https://toast-classroom.workramp.io/collections/xtrachef                                                      | 200         | Only interface icons. No product screen.                                                  |
| https://xtrachef.com/features/inventory-management/                                                           | 200         | Marketing illustrations with grey placeholder text. Not a real screen.                    |
| https://pos.toasttab.com/products/inventory-management                                                        | 200         | The same marketing illustrations as the xtrachef.com page.                                |

## Notes

- The Square community search route needs a Chromium user agent. It returns 200 and full post HTML.
- Every Square post image is available at
  `https://community.squareup.com/t5/image/serverpage/image-id/&lt;id&gt;/image-size/original?v=v2&px=-1`.
- The Toast community holds few post images. Most of the captured image IDs are member avatars.
- The Toast reseller and partner pages hold no real inventory screen. They use stock photos or
  marketing illustrations.

## Dropped candidates

Ten images is the cap for this folder. These real screens were dropped because they repeat a
surface that is already above, or because they show less of the inventory model:

- `1150iD44E51BA2F8338C0` "Price and Inventory" table, Square community.
- `19730i97F3AA451E499A35` Square Online "Item statuses" settings, Square community.
- `53214iF63C9DA74CB0E7AC` Item library rows with "Stock on hand", Square community.
- `13808i565FEAF52FEB309E` Square Online low inventory badge settings, Square community.
- `56327iDED29ACAC40328E3` Webstore results with an "Out of stock" label, Square community.

## Why the images in this folder are not in git

The screenshots are NOT committed. This index is the evidence: it holds the source
URL, the app id, the device class, and what each screen shows, so every image is
reproducible with the route recorded below.

The reason is size. The five harvest folders hold 193 images and 53 MB, against a
repository that already tracks 2.4 MB of research images and a 91 MB `.git`. The
`.gitignore` entry that keeps them out is documented in the repository root.

The curated evidence the reports cite IS committed: the eight official Lightspeed
screenshots at the root of this folder, and the before and after screen sets under
`docs/research/2026-09-18-design-taste/assets/screens/`.
