# Assets index - lane 2, inventory specialists

- Date: 2026-09-18
- Lane: 2 of 5
- Section file: `../sections/02-inventory-specialists.md`

All eight captures show the **rendered page** in Playwright Chromium
(`1.62.1`, headless, 1440 x 900 CSS px, `deviceScaleFactor` 1, Chrome 145 user
agent) against the live vendor host. Each file is a full-page screenshot, so the
product screen that the help article embeds is inside the image.

| File                                  | Product          | Source URL                                                                                                       | Device class                                      | What it shows                                                                                                                     |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `spec-wisk-generate-po.png`           | WISK             | <https://help.wisk.ai/en/articles/3286748-generating-a-purchase-order-web>                                       | Desktop web (help article, product images inside) | The "Cart Builder" order screen: one block per distributor, and the par-based suggested amount with the pending-PO column         |
| `spec-marginedge-place-order.png`     | MarginEdge       | <https://help.marginedge.com/hc/en-us/articles/217888378-How-to-Place-an-Order-with-a-Vendor-through-MarginEdge> | Desktop web                                       | The order guide as the ordering surface: Vendor Item, Product, Item Code, last purchase price, and the price-fluctuation graphic  |
| `spec-apicbase-purchase-order.png`    | Apicbase         | <https://support.apicbase.com/help/purchase-order>                                                               | Desktop web                                       | "Create Orders" with the per-ingredient quantity stepper, the "To Par" button, the shopping-cart panel and the delivery-date lock |
| `spec-kitchencut-approve-invoice.png` | KitchenCut       | <https://support.kitchencut.com/how-to-approve-an-invoice>                                                       | Desktop web                                       | The invoice that KitchenCut generates from the delivery record, and the Approve action that notifies Accounts Payable             |
| `spec-supy-ordering.png`              | Supy             | <https://help.supy.io/en/articles/11122708-ordering-to-your-supplier>                                            | Desktop web                                       | "Procurement > Place Order", the item and supplier list, and "Review Order" with the draft-versus-submit choice                   |
| `spec-r365-shopping-list.png`         | Restaurant365    | <https://docs.restaurant365.com/docs/purchase-orders-use-shopping-lists>                                         | Desktop web                                       | The Order Suggestion form that a Shopping List opens, and the split of one suggestion into one purchase order per vendor          |
| `spec-marketman-purchasing.png`       | MarketMan        | <https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management>                         | Desktop web (marketing page)                      | The purchasing pitch: "fill to par with one click", automatic submission, par levels, budgets and price limits, mobile receiving  |
| `spec-toast-xtrachef-product.png`     | xtraCHEF (Toast) | <https://pos.toasttab.com/products/xtrachef>                                                                     | Desktop web (marketing page)                      | The xtraCHEF position: invoice automation first, with inventory management and recipe costing as the products that pair with it   |

## Capture routes that failed

| Host                                                           | Route                                                      | Result                                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `help.wisk.ai`                                                 | `/api/v2/help_center/articles/search.json`                 | HTTP 404 - Intercom, not Zendesk                                                              |
| `support.toasttab.com`                                         | `/api/v2/help_center/...`, `/api/search`, `/api/v1/search` | HTTP 404 - not a Zendesk host                                                                 |
| `support.toasttab.com`                                         | `/sitemap.xml` xtraCHEF filter                             | HTTP 200, and the sitemap holds 778 URLs with no xtraCHEF article                             |
| `support.toasttab.com`                                         | `/en/search?q=xtraCHEF purchase order`                     | HTTP 200, and the article links are client-rendered and were not present in the DOM after 9 s |
| `help.craftable.com`, `support.craftable.com`                  | help centre root                                           | No DNS record                                                                                 |
| `help.marginedge.com`                                          | `/api/v2/help_center/articles/<id>.json`                   | HTTP 301 then a Cloudflare challenge; the search endpoint still answers                       |
| `help.marketman.com`, `support.marketman.com`                  | help centre root                                           | No DNS record                                                                                 |
| `mealticket.my.site.com`                                       | `/helpcenter/s/article/<id>`                               | HTTP 404 or a Salesforce "CSS Error" page; the article body needs a browser session           |
| `pos.toasttab.com`                                             | any path over `curl`                                       | HTTP 403, "Just a moment" Cloudflare challenge; the Playwright capture passed                 |
| G2, Capterra, Trustpilot, GetApp, Software Advice, TrustRadius | product review pages                                       | HTTP 403 from this workstation, per the channel playbook                                      |
