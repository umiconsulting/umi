# Asset index — inventory surface evidence

- Captured: 2026-09-18 (local, America/Mazatlan).
- Tool: `curl` 8.5.0 with a browser User-Agent, against the official Lightspeed
  Restaurant (K-Series) help centre.
- Route: the Zendesk article page, then the `article_attachments` URL inside it.
  The Zendesk search API
  `https://k-series-support.lightspeedhq.com/api/v2/help_center/articles/search.json`
  listed the articles.
- Licence note: these images are the vendor's own documentation screenshots. They
  stay in this research folder with their source URL. Do not rehost them in a
  product or a marketing page.

## Files

| File                                 | Vendor                         | What the image shows                                                                                                                                                                                           | Source URL                                                                                                                  | Device class           |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `lightspeed-pos-order-screen.png`    | Lightspeed Restaurant K-Series | The till order screen. The bottom navigation holds Register, Tables, Orders, Customers, Receipts, Settings. There is no inventory destination.                                                                 | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804657089-Understanding-discounts>                         | Till tablet, landscape |
| `lightspeed-bo-inventory-main.png`   | Lightspeed Restaurant K-Series | The Back Office Inventory hub. The left navigation holds Inventory, Stock management, Produce, Purchase, Reports. A "Back office" link returns to the wider console.                                           | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517428891-About-Inventory>                                 | Desktop browser        |
| `lightspeed-bo-stock-count-list.png` | Lightspeed Restaurant K-Series | A stock count in progress. A list-detail layout: the item list with current and counted quantity on the left, the count stepper for one item on the right. A progress counter reads 6 of 221.                  | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407510354715-Performing-stock-counts>                         | Desktop browser        |
| `lightspeed-bo-stock-levels.png`     | Lightspeed Restaurant K-Series | The Stock levels page.                                                                                                                                                                                         | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517612699-Stock-levels>                                    | Desktop browser        |
| `lightspeed-bo-purchase-orders.png`  | Lightspeed Restaurant K-Series | The Purchase orders list. Columns: status, order number, supplier, placed on, delivery date, supplier invoice, total. The left navigation holds Purchase orders, Recurring orders, Stock transfers, Suppliers. | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407576020507-Receiving-managing-and-deleting-purchase-orders> | Desktop browser        |
| `lightspeed-bo-suppliers.png`        | Lightspeed Restaurant K-Series | The Suppliers main page.                                                                                                                                                                                       | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407560855707-Adding-suppliers>                                | Desktop browser        |
| `lightspeed-bo-recipe-create.png`    | Lightspeed Restaurant K-Series | The Create recipe main page.                                                                                                                                                                                   | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407511552155-Creating-and-managing-recipes>                   | Desktop browser        |
| `lightspeed-bo-item-details.png`     | Lightspeed Restaurant K-Series | The Inventory item details page.                                                                                                                                                                               | <https://k-series-support.lightspeedhq.com/hc/en-us/articles/6669636140443-About-Items-Inventory>                           | Desktop browser        |

## Capture failures, recorded

| Vendor      | Result                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toast       | The help centre is a Next.js application. The article HTML returns HTTP 200 and 627 KB, and it holds no product image. No official inventory screenshot was captured. |
| Square      | The help articles return HTTP 200. They hold no product image in the served HTML. No official inventory screenshot was captured.                                      |
| Shopify     | `help.shopify.com` returns HTTP 403 to `curl` on every route tried.                                                                                                   |
| Clover      | `help.clover.com` redirects to `www.clover.com/help`, a custom application. It is not a Zendesk centre, so the search API returns HTTP 404.                           |
| TouchBistro | `help.touchbistro.com` returns HTTP 401 on every route. The centre is login-gated.                                                                                    |
| SpotOn      | `support.spoton.com` has no DNS record.                                                                                                                               |
| Revel       | The article pages render a JavaScript shell, live and in the archive.                                                                                                 |

**Inference, and it is itself a finding.** Every vendor publishes a Back Office
inventory screen behind a login. The public help centres publish the _steps_ and
not the _screens_. Lightspeed is the one exception found here, because its help
centre embeds the product screenshots in the article body.
