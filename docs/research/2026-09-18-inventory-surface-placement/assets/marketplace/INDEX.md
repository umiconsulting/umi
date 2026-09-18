# Marketplace listing screenshots

- Captured: 2026-09-18 (local, America/Mazatlan).
- Source: the Shopify App Store listing for **BR Stock Take: Inventory Count**,
  <https://apps.shopify.com/stock-take>, HTTP 200.
- Why this listing: it is the one app store that publishes the SAME inventory app in
  three labelled device classes. The listing serves a `desktop_screenshot`,
  a `mobile_screenshot`, and a `pos_screenshot` set. The device class is therefore the
  app author's own claim, and not this report's guess.
- Licence note: these are the app author's listing images. They stay in this research
  folder as evidence, with the source URL. Do not rehost them in a product or a
  marketing page.

## The images

| File                                                                                | Device class, as the listing states | What the image shows                                                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `shopify-stocktake-desktop-select-location-for-stocktake.png`                       | desktop                             | The first step: select the location for the stocktake.                                                                     |
| `shopify-stocktake-desktop-filter-product-variants-select-stocktake-type.png`       | desktop                             | Filter the product variants, then select the stocktake type.                                                               |
| `shopify-stocktake-desktop-scan-barcodes-or-edit-product-variant-counts.png`        | desktop                             | A table of variants with an editable count column and a scan control.                                                      |
| `shopify-stocktake-desktop-view-stock-value-update-stock-count.png`                 | desktop                             | The stock VALUE beside the count. Cost data lives on this screen.                                                          |
| `shopify-stocktake-desktop-import-export-menu.png`                                  | desktop                             | Import and export.                                                                                                         |
| `shopify-stocktake-desktop-preferences.png`                                         | desktop                             | Preferences.                                                                                                               |
| `shopify-stocktake-desktop-br-stock-take-inventory-count.png`                       | desktop                             | The listing's own overview image.                                                                                          |
| `shopify-stocktake-mobile-mobile-phone-stock-list.png`                              | **mobile**                          | The phone stock list: product rows with an "Actual stock" column, "Update", and "Set stock". A progress line reads 1 of 3. |
| `shopify-stocktake-mobile-use-your-mobile-phone-camera-as-an-inventory-scanner.png` | **mobile**                          | The phone camera pointed at a barcode on a carton.                                                                         |
| `shopify-stocktake-pos-ipad-camera-barcode-scanner.png`                             | **POS**                             | An iPad running the POS app, with the camera pointed at a barcode.                                                         |
| `shopify-stocktake-pos-detect-and-fix-inventory-data-issues.png`                    | **POS**                             | A data-quality screen that detects and fixes inventory problems.                                                           |

## What this adds

**One product, three device classes, and the work is divided by device.**

| Device class | The work the listing puts there                                               | The capability it needs     |
| ------------ | ----------------------------------------------------------------------------- | --------------------------- |
| desktop      | Location, filters, count sheet setup, stock value, import/export, preferences | A wide table and a keyboard |
| mobile       | The stock list and the camera scan                                            | A camera and one hand       |
| POS (iPad)   | The camera scan, and a data-quality check                                     | The camera, at the counter  |

**Documented fact**, the listing's own device classes and image contents above.

**Inference.** The setup work never appears on the phone. The same app states the
split by the screenshot set it publishes to. The independent publisher in
`assets/independent/` shows the same split across four other vendors. The pattern is
therefore not one company's choice.

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
