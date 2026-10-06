# Assets index - lane 4, operator voice (UGC and reviews)

- Date: 2026-09-18
- Lane: 4 of 5
- Section file: `../sections/04-ugc-and-reviews.md`

Six captures. Each one comes from a user-generated or community source. Each file
was downloaded with `curl` from the URL in the table, then verified with `file` and
`identify`. No image is a vendor help-centre screenshot, except where the caption
says that a community member posted that vendor screen inside a thread.

| File                                              | Product or subject                                                   | Source URL                                                                                                     | Device class                   | What it shows                                                                                                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ugc-01-reddit-paper-order-guide.jpeg`            | A working store (r/KitchenConfidential post)                         | <https://www.reddit.com/r/KitchenConfidential/comments/1mmuck0/this_order_guide_one_of_my_stores_uses_to_buy/> | Phone photo (1179 x 2556)      | A handwritten paper order guide on a lined notepad. The heading reads "Remi King". The list holds commissary items in pen.                                                                                                                |
| `ugc-02-shopify-community-po-receiving.png`       | Third-party Shopify purchase-order app, posted by a community member | <https://community.shopify.com/t/587455>                                                                       | Desktop web (1533 x 603)       | A "Place Purchase Order" form. Columns: Name, SKU, QTY, RETAIL (MARGIN), UNIT COST, SUBTOTAL. A totals strip holds items, qty, retail, total.                                                                                             |
| `ugc-03-shopify-community-warehouse-map.jpeg`     | SKUSavvy, posted by a vendor in a community reply                    | <https://community.shopify.com/t/615719>                                                                       | Tablet or desktop (1553 x 830) | A pick screen with a bin floor plan on the left and a live item list on the right. The header reads "Batch #00106 Pick".                                                                                                                  |
| `ugc-04-shopify-community-po-automation.png`      | SKUSavvy, posted by a vendor in a community reply                    | <https://community.shopify.com/t/615719>                                                                       | Desktop web (1920 x 912)       | The follow-up frame of the same post: a purchase-order automation screen.                                                                                                                                                                 |
| `ugc-05-shopify-community-stocky-export-repo.png` | A community-subject GitHub tool, posted in a thread                  | <https://community.shopify.com/t/657644>                                                                       | Desktop web (1200 x 600)       | The repository card for `tappacific/stocky-export`: "Export your Stocky suppliers, purchase orders and cost history to CSV before Shopify shuts it down on 31 August 2026…". The operator keeps the purchase history outside the product. |
| `ugc-06-youtube-po-tracker-spreadsheet-t45.png`   | A spreadsheet template, YouTube frame at 00:45                       | <https://www.youtube.com/watch?v=ZJm0BXaVE8s>                                                                  | Desktop web (640 x 360)        | A Google Sheets purchase order: the vendor block, the ship-to block, the line table (Description, Quantity, Price, Amount), and the tabs Vendor List, PO Template, PO Tracker, Outstanding Payment, Vendor Overview.                      |

## Capture routes

| File                                   | Route that produced it                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ugc-01`                               | The post holds an `i.redd.it` URL in its media array. `curl` of `https://i.redd.it/1fs3z884d9if1.jpeg` returned HTTP 200, 416,390 bytes.                                                               |
| `ugc-02`, `ugc-03`, `ugc-04`, `ugc-05` | The post HTML in `community.shopify.com/t/<id>.json` holds `canada1.discourse-cdn.com` URLs. The `_2_690xNNN` optimized path was rewritten to `/original/` for the full asset. Each returned HTTP 200. |
| `ugc-06`                               | `yt-dlp` downloaded the video at 480p, then `ffmpeg -ss 45` wrote the frame.                                                                                                                           |

## Capture routes that failed

| Host                     | Route                                          | Result                                                                    |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `www.reddit.com`         | `/r/KitchenConfidential/comments/1mmuck0.json` | HTTP 403, IP-level block.                                                 |
| `safereddit.com`         | `/preview/pre/1fs3z884d9if1.jpeg` with `curl`  | HTTP 200, and the body was the 4,369-byte Anubis challenge page.          |
| `community.toasttab.com` | any route                                      | HTTP 403, Cloudflare interstitial. No capture of a Toast operator thread. |

## Device classes in this set

- Phone camera: 1 (`ugc-01`). This is the only true operator-made image in the set.
- Desktop web: 4 (`ugc-02`, `ugc-04`, `ugc-05`, `ugc-06`).
- Tablet or desktop: 1 (`ugc-03`).

## Honest note on the set

**Documented fact.** Only `ugc-01` comes from an operator. The other five frames
come from app vendors who posted their own product screens into a community thread,
or from a spreadsheet-template seller. They are community-posted, and they show the
field sets that operators ask for. They are not proof of what an operator sees in a
live store.

**Inference.** A future pass should capture the same evidence from the operator
side: a screenshot inside a review, a video frame of a real order, or a forum post
with the operator's own screen.
