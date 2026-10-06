# Reddit screenshots of inventory surfaces

Capture date: 2026-09-18.

Source kind: reddit.

Route: the Reddit JSON API is blocked. The Atom feed answered. The command was `curl` with a Chrome
User-Agent. The parse used `python3` and `xml.etree`. The pace was 45 seconds between calls.

## Images

| file name                                              | product                                                    | source URL                                                                                         | source kind | device visible              | what the screen shows                                                                                                                                                                                                     | class     |
| ------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `reddit-toastpos-xtrachef-inventory-app-01.png`        | Not labelled in the image. The post asks about XtraCHEF.   | https://www.reddit.com/r/ToastPOS/comments/1ezn31t/does_anyone_like_xtrachef/                      | reddit      | Phone. 640x1067.            | Home screen of an invoice and cost app. Cards for "Scan document", "Tasks", "Total spend", and "Price Tracker". The bottom bar has Dashboard, Task, Scan, Inventory, and More.                                            | INVENTORY |
| `reddit-halopsa-halo-stocktake-dashboard-01.png`       | Halo Stocktake System, by Halo PSA.                        | https://www.reddit.com/r/halopsa/comments/1uoott0/no_stocktake_in_halo/                            | reddit      | Desktop browser. 1220x736.  | Web dashboard. Tabs: Dashboard, New Stocktake, Active Stocktake, Reports, Labels. Three counters show 1 total stocktake, 0 in progress, and 1 completed.                                                                  | INVENTORY |
| `reddit-halopsa-halo-stocktake-active-02.png`          | Halo Stocktake System, by Halo PSA.                        | https://www.reddit.com/r/halopsa/comments/1uoott0/no_stocktake_in_halo/                            | reddit      | Desktop browser. 1206x1003. | Active stocktake. A scan field accepts a PLU or a serial number. Counters show 270 items and 97 items scanned. A table lists the items. The columns are Item Name, SKU/PLU, Location, Counted, Expected, Value, and Type. | INVENTORY |
| `reddit-microsaas-stocktake-new-01.png`                | simpleSaaS stocktake tool. The name is in the page footer. | https://www.reddit.com/r/microsaas/comments/1l8ayku/a_first_effort_into_microsaas_stocktaking_app/ | reddit      | Desktop browser. 1928x774.  | "New Stocktake" form. Fields: Stocktake Date, Email, Product Name, Description, Box Amount, Counted. Buttons: Add Line, Save Session, Load Session, Export CSV, and New Session.                                          | INVENTORY |
| `reddit-toastpos-sparkplug-inventory-dashboard-01.png` | SparkPlug.                                                 | https://www.reddit.com/r/ToastPOS/comments/1cd167h/how_are_you_running_sales_contests_for_your/    | reddit      | Desktop browser. 1307x720.  | A marketing graphic that embeds the SparkPlug dashboard. The screen has Sales and Inventory (BETA) tabs and a line chart of total units.                                                                                  | DASHBOARD |

Image count: 5.

## Blocked sources

| route                                                 | status code | note                                              |
| ----------------------------------------------------- | ----------- | ------------------------------------------------- |
| `r/ToastPOS/search.rss?q=inventory`                   | 429         | The second try answered 200.                      |
| `r/restaurantowners/search.rss?q=inventory%20count`   | 429         | Two tries. Both failed.                           |
| `r/POSSystems/search.rss?q=inventory`                 | 404         | Two tries. The subreddit did not answer.          |
| `r/restaurantindustry/search.rss?q=inventory`         | 429         | The second try answered 200 with no posts.        |
| `r/bartenders/search.rss?q=liquor%20inventory`        | 429         | One try.                                          |
| `r/wine/search.rss?q=inventory`                       | 429         | One try.                                          |
| `r/smallbusiness/top/.rss`                            | 429         | One try.                                          |
| `search.rss?q=%22inventory%20count%22`                | 429         | One try.                                          |
| `search.rss?q=%22liquor%20inventory%22`               | 429         | One try.                                          |
| `preview.redd.it` image URLs without the signed query | 403         | 301 images. The signed query string is necessary. |
| `i.redd.it` .gif files                                | 404         | 2 images.                                         |

## Rejected candidates

The team dropped these images after the check with `view_image`.

| image                                                                 | reason                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `fb7c3edc5e8d.png` from `r/additemto`                                 | The file is 140x140 pixels. The text is too small for a research asset.           |
| Toast KDS Expo tickets                                                | The screen is a kitchen display. It is not an inventory screen.                   |
| Video-game inventory screens                                          | The screens are game menus. The scope is restaurant and retail software.          |
| Equipment photos, receipts, chat windows, and paper count sheets      | The task excludes them.                                                           |
| ANYDB pharmacy graphic                                                | The image is a marketing graphic. It shows no product screen.                     |
| BeaglePrep, Store and Forget, Filament Box, and My Asset Mate screens | The products serve home, hobby, or asset use. The scope is restaurant and retail. |
| Sawmill Inventory app                                                 | The product serves a sawmill. The scope is restaurant and retail.                 |

## Notes

- `r/smallbusiness/search.rss?q=inventory%20app` answered 200 with 100 posts and no image post.
- The global search feeds answer with unrelated content. Word "inventory" matches game menus.
- The Halo and simpleSaaS screens count IT assets and general stock. They are not restaurant or
  retail products. The team kept them, because the counting workflow is the same.

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
