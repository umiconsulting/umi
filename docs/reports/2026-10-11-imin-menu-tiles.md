# The menu tiles: initials on the category colour, no drawing

Date: 11 October 2026, 05:15–05:23 MST. Device: iMin D3-504, Estación build from this tree, API on
`:4013`, demo merchant.

Owner's instruction: _do not draw the menu; use the initials with the colours like the other design,
and there is already a screen to change the category colours._ All three parts are in the tree and
were checked on the till today.

## The tile

`_ProductPlaceholder` in `apps/umi-pos/lib/features/catalog/catalog_surface.dart` paints a solid block
of the category's colour with the product's own initials over it (`Bebida de temporada` → `BD`,
`Cold brew` → `CB`, `Galleta de chocolate` → `GD`). There is no drawing: the earlier revision's
`product_sketch.dart` is not in this tree, and the file's own comment records the owner's decision.
One rule covers every catalogue view — the grid, the frequent rail and the detail sheet.

## The colour comes from the dashboard

The owner sets it in the dashboard's `Categorías` screen (`apps/umi-dashboard/src/screens/
categories-workspace.jsx`), which writes `product_category.color` through
`PATCH /api/merchants/:merchantId/catalog/categories/:categoryId`. The terminal reads that same
`color` off the catalogue (`CatalogCategory.color`, `packages/contract/src/pos-catalog.ts`) and, when
a category has none, derives a stable hue from its name with the identical djb2 hash the dashboard
mirrors — so both products paint a category the same way.

Until this walk the terminal asked the dashboard to pick from a curated palette; the screen and the
terminal now agree on one colour per category, and the filter chips and the tiles come from one
helper, so a chip and its products can never disagree.

## What was checked, with taps

1. The catalogue on the till, with the demo categories: `BD` and `CL` blue (`Té y bebidas` `#4363d8`),
   `CA` and `CB` olive (`Café` `#808000`), `GD` teal (`Postres` `#469990`) — each one the value in
   `product_category`, and each chip dot the same colour as its tiles.
2. A colour changed underneath the terminal, the way the dashboard's screen changes it
   (`update merchant.product_category set color='#ff00aa' where name='Postres'`), and the catalogue
   reloaded: **`Galleta de chocolate` repainted magenta and the `Postres` chip dot with it**
   (`01-category-colour-from-the-dashboard.png`). The value was put back to `#469990` afterwards.

The tile is pinned by a widget test — `apps/umi-pos/test/catalog_test.dart`, _"a product with no
photo is a block of its category colour with its initials"_.

Evidence: `docs/reports/evidence/2026-10-11-imin-menu-tiles/`.
