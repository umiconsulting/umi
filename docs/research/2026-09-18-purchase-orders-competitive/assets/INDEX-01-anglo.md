# Assets index - lane 1, the English-language POS incumbents

- Date: 2026-09-18 (local, America/Mazatlan).
- Lane: 1 of 5.
- Section file: `../sections/01-anglo-pos.md`.
- Device class for every capture: desktop web. The page renders are 1440 CSS px
  wide. A vendor product image keeps its own pixel size, which the table gives.
- Licence note: the `-doc` files are renders of the vendor's own public help page.
  The named product images are the vendor's own documentation screenshots. They
  stay in this research folder with the source URL. Do not rehost them in a
  product or a marketing page.
- Commit note: the images are not committed in bulk. The `.gitignore` entry at the
  repository root excludes a bulk harvest. This index holds the source URL and the
  capture route for every image.

## Capture route

- Tool: Playwright Chromium 1.62.1 (`@playwright/test`), `headless: true`,
  `--no-sandbox`, viewport 1440 x 1000.
- User agent: Chrome 145 on Linux.
- Two kinds of file:
  - `anglo-<product>-...-doc.png` - a full-page screenshot of the rendered help
    article. The vendor's own product images are inside this image. The `-doc`
    suffix marks a page render.
  - `anglo-<product>-<screen>.png` - the vendor's product image, downloaded with
    `curl` from the URL in the table. Unit: pixels.

## Files

| File                                  | Product       | Source URL                                                                                                    | Device class            | What the screen shows                                                                                                                                                                                                           |
| ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anglo-shopify-po-list-doc.png`       | Shopify       | <https://help.shopify.com/en/manual/products/inventory/purchase-orders/viewing-purchase-orders>               | Desktop web, 1440 px    | The "Viewing and filtering purchase orders" article. The page holds the filter columns and the two PO statuses, and no product image.                                                                                           |
| `anglo-shopify-po-create-doc.png`     | Shopify       | <https://help.shopify.com/en/manual/products/inventory/purchase-orders/creating-purchase-orders>              | Desktop web, 1440 px    | The "Creating and managing purchase orders" article: the Draft and Ordered statuses, and the linked inventory transfer that owns receiving.                                                                                     |
| `anglo-square-po-article-doc.png`     | Square        | <https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail>                  | Desktop web, 1440 px    | "Create and manage purchase orders": the dashboard path `Items > Inventory management > Purchase orders`, the POS path, and the Receive All sweep.                                                                              |
| `anglo-toast-billpay-vendors-doc.png` | Toast         | <https://support.toasttab.com/en/article/Manage-Vendors-in-Bill-Pay>                                          | Desktop web, 1440 px    | The "Manage Vendors in Bill Pay" article. The vendor list is the Bill Pay surface, and the route is `Toast Web > Bill Pay > Vendors`.                                                                                           |
| `anglo-toast-billpay-invoice-doc.png` | Toast         | <https://support.toasttab.com/en/article/Use-Bill-Pay-With-Toast-Checking>                                    | Desktop web, 1440 px    | "Use Bill Pay With Toast Checking": the invoice upload, the payment fields, and the payment statuses. This is accounts payable, not a goods order.                                                                              |
| `anglo-toast-billpay-vendors.png`     | Toast         | <https://support.toasttab.com/en/article/Manage-Vendors-in-Bill-Pay>                                          | Desktop web, 1879 x 556 | The Bill Pay "Vendors" tab inside Toast Web. The header holds "Add vendor"; the table holds Name, Account #, Address, and edit and delete icons.                                                                                |
| `anglo-toast-billpay-invoice.png`     | Toast         | <https://support.toasttab.com/en/article/Use-Bill-Pay-With-Toast-Checking>                                    | Desktop web, 239 x 207  | The "Upload an invoice" drop zone in Bill Pay.                                                                                                                                                                                  |
| `anglo-loyverse-po-doc.png`           | Loyverse      | <https://help.loyverse.com/help/how-purchase-orders-and-suppliers>                                            | Desktop web, 1440 px    | "How to Work with Purchase Orders and Suppliers": the supplier list, the create form, the CSV import, and the five statuses.                                                                                                    |
| `anglo-loyverse-po-list.png`          | Loyverse      | <https://help.loyverse.com/sites/default/files/users/user195/en/Purchase-Orders-and-Suppliers-2.png>          | Desktop web, 650 x 350  | The Suppliers list in the Loyverse Back Office. The green "+ ADD SUPPLIER" button is the only action. The table holds Name, Contact, Phone number, and Email.                                                                   |
| `anglo-loyverse-po-create.png`        | Loyverse      | <https://help.loyverse.com/sites/default/files/users/user195/en/Purchase-Orders-and-Suppliers-4.png>          | Desktop web, 640 x 355  | The Create Purchase Order form: supplier, store, order date, expected date, the item lines, and Create / Save as Draft.                                                                                                         |
| `anglo-revel-po-doc.png`              | Revel Systems | <https://support.revelsystems.com/s/article/Creating-Purchase-Orders-1583149943284>                           | Desktop web, 1440 px    | "Creating Purchase Orders": the Management Console route, the six statuses, and the receiving steps for console and POS.                                                                                                        |
| `anglo-revel-po-list.png`             | Revel Systems | <https://s3-us-west-2.amazonaws.com/revelup-techpubs/support/hc/en-us/212208383/Purchase+Order+Update+1+.png> | Desktop web, 1071 x 308 | The Purchase Order List in the Revel Management Console. Filters: PO Status, Invoice Status, a search box, and a date range. The row holds ID, Vendor, Receipt/Invoice #, Total, dates, PO Status, Invoice Status, and Actions. |
| `anglo-revel-po-editor.png`           | Revel Systems | <https://revelup-techpubs.s3-us-west-2.amazonaws.com/support/hc/en-us/000001789/PO2.png>                      | Desktop web, 797 x 662  | "Quick Create New Product" from the PO flow. The form holds Inventory Details: Starting Inv. Amt., Vendor, Vendor Item ID, Reorder Unit, Conversion Factor, Reorder Qty, and Reorder To PAR.                                    |
| `anglo-revel-po-receive.png`          | Revel Systems | <https://s3-us-west-2.amazonaws.com/revelup-techpubs/support/hc/en-us/212208383/7-1.png>                      | Desktop web, 1101 x 867 | The Receiving screen for a purchase order. The list holds the ordered line, the received QTY field, and the Receive Items control.                                                                                              |
| `anglo-revel-po-status.png`           | Revel Systems | <https://s3-us-west-2.amazonaws.com/revelup-techpubs/support/hc/en-us/212208383/Purchase+Orders+Update+3.png> | Desktop web, 1035 x 412 | The PO status control: New, Sent, Partially Received, Fully Received, and Finalized.                                                                                                                                            |
| `anglo-touchbistro-inventory-doc.png` | TouchBistro   | <https://www.touchbistro.com/inventory-management/>                                                           | Desktop web, 1440 px    | The Inventory Management marketing page: the suggested-order text, the vendor-management text, and the FAQ answer about creating purchase orders. No product screen is on this page.                                            |

## Capture failures, recorded

| Product     | Route tried                                                                                                   | Result                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Clover      | `https://www.clover.com/en-US/help/`, the help search, `/help/inventory-management`, `help.clover.com/...`    | HTTP 200 and a login gate. The public centre shows three articles and no inventory or purchase-order content.       |
| Clover      | `https://help.clover.com/api/v2/help_center/articles/search.json?query=inventory`                             | HTTP 301, then a login gate. Not a Zendesk centre.                                                                  |
| Clover      | `https://www.clover.com/sitemap.xml`                                                                          | HTTP 200, and the index holds marketing pages only. No help article.                                                |
| SpotOn      | `https://support.sposystems.com/` and `https://www.sposystems.com/`                                           | DNS failure. `ERR_NAME_NOT_RESOLVED`.                                                                               |
| SpotOn      | `https://help.spoton.com/page/spoton-restaurant-backoffice`, `/page/spoton-restaurant`, `/page/spoton-retail` | HTTP 200, and no inventory or purchase-order article is present. The BOH index holds menu, order and payment items. |
| TouchBistro | `https://help.touchbistro.com/hc/en-us`                                                                       | HTTP 401. The help centre is login-gated.                                                                           |
| Shopify     | `https://help.shopify.com/en/manual/orders/purchase-orders`                                                   | HTTP 200, and the page is a redirect to the order-fulfillment topic. No purchase-order content.                     |
| Square      | `https://squareup.com/help/us/en/search?q=purchase+order` (the wrong parameter)                               | HTTP 404 and a "Page not found" body. The working route is `/article/search?q=`.                                    |
| Toast       | `https://r.jina.ai/https://support.toasttab.com/...`                                                          | HTTP 403 with a Cloudflare "Just a moment" page. The direct Playwright render works.                                |
| Toast       | `https://community.toasttab.com/search.json?q=purchase+order`                                                 | HTTP 403 with a Cloudflare challenge.                                                                               |
