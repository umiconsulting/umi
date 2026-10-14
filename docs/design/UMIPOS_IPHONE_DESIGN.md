# UmiPOS on iPhone — design spec

- Status: draft for owner review. Date: 2026-10-04, verified 2026-10-05.
- Owner decision recorded: the iPhone is a **mobile till**. NFC payment is in flight.
- Scope: the iPhone build of `apps/umi-pos`. The first delivery is the order screen and the cart.
- Language: Simplified Technical English (ASD-STE100).
- Related: [iOS POS design constraints](../research/2026-10-04-ios-pos-design-constraints.md),
  [iOS build from Linux](../research/2026-10-03-ios-from-linux.md),
  [UmiPOS design language V1](UMIPOS_DESIGN_LANGUAGE_V1.md), and the
  [UX north star](../research/2026-09-15-ux-patterns-and-design-north-star.md).

## 1. The decision, and what it changes

**Documented fact.** The owner set the job of the iPhone. The iPhone is a mobile till. One
operator carries it and takes the order and the money.

**Inference.** This job answers four open questions at once.

| Question         | Answer for the mobile till                                    |
| ---------------- | ------------------------------------------------------------- |
| First screen     | The order (Comanda), then the cart.                           |
| Navigation model | One operator, one device. Few destinations. No dead controls. |
| Feature set      | The sale, the cart, the tender, and Tap to Pay on iPhone.     |
| Orientation      | Portrait is primary. Landscape is allowed, and must work.     |

**Inference.** The phone stops being a squeezed tablet. It becomes its own target. The design
does not copy the 1024 by 768 panel into a small window.

## 2. The evidence

**Documented fact.** The render harness writes the real `CatalogSurface` to a PNG at any
viewport, theme, and text scale. The file is
`apps/umi-pos/test/render/order_surface_render.dart`. Run it like this:

```sh
cd apps/umi-pos
RENDER_VIEWPORT=390x844 RENDER_THEME=dark \
  flutter test test/render/order_surface_render.dart --update-goldens
```

**Documented fact.** These shots exist, and a human read each one.

**Documented fact.** The `test/render/shots/` directory is ignored by the repository on purpose:
"the harness itself is the source, the images are output" (`.gitignore` lines 18 to 22). Run the
harness to regenerate every shot below.

| Shot                           | Viewport    | What it shows                                   |
| ------------------------------ | ----------- | ----------------------------------------------- |
| `order-dark-390x844.png`       | 390 by 844  | Portrait order screen.                          |
| `order-dark-390x844-cart.png`  | 390 by 844  | Portrait order screen with the cart sheet open. |
| `order-dark-390x844-text2.png` | 390 by 844  | The same screen at 200 percent text.            |
| `order-dark-390x844-empty.png` | 390 by 844  | Portrait order screen with no cart lines.       |
| `order-dark-430x932.png`       | 430 by 932  | Large phone portrait.                           |
| `order-dark-956x440.png`       | 956 by 440  | Large phone landscape.                          |
| `order-till-dark-1024x768.png` | 1024 by 768 | The certified till panel, for comparison.       |

**Documented fact.** Four faults appear in the shots.

1. **Portrait top bar clips.** The right actions leave the frame. The action "Nueva venta" and the
   operator name are cut.
2. **The category strip clips.** The last chip leaves the frame at 390 and at 430. A cut chip
   hides a real category.
3. **200 percent text breaks the product card.** "Espresso" becomes `Espress` + `o`. "Americano"
   becomes `America` + `no`. The price `MXN 38.00` splits into `MXN` and `38.00` and crosses the
   card edge.
4. **Landscape collides.** At 956 by 440 the wide layout keeps three panes. The cart panel is
   short. The "Cobrar" bar covers the total `MXN 220.20`. The category rail wastes a whole column.

**Inference.** These are layout faults, not widget faults. The screen keeps the wide layout in a
short window. The screen never reads the height.

## 3. The layout model

**Documented fact.** Apple states the rule directly: "Determine layout based on size classes, not
device type or orientation." The horizontal class gives the width. The vertical class gives the
height.

**Documented fact.** The current code reads one number, the width
(`catalog_surface.dart` line 806). It never reads the height.

**Inference.** UmiPOS must read the width **and** the height. The height separates a large phone
in landscape from a tablet.

### 3.1 The three tiers

| Tier            | Rule                               | Example     |
| --------------- | ---------------------------------- | ----------- |
| Phone portrait  | width < 600                        | 390 by 844  |
| Phone landscape | width >= 600 **and** height < 600  | 956 by 440  |
| Till or tablet  | width >= 900 **and** height >= 600 | 1024 by 768 |

**Inference.** A short height is the signal. A landscape phone is wide and short. A tablet in
landscape is wide and tall. The height test is the whole difference.

### 3.2 Breakpoint changes

**Documented fact.** The current breakpoints live in the code. The table below gives the new rule.

| Surface           | Current rule                     | New rule                                      | File and line               |
| ----------------- | -------------------------------- | --------------------------------------------- | --------------------------- |
| Catalog shell     | three panes at width >= 900      | three panes at width >= 900 and height >= 600 | `catalog_surface.dart` 806  |
| Product grid      | 6 / 5 / 4 / 2 columns            | keep, and add 3 columns at width >= 560       | `catalog_surface.dart` 1247 |
| Cart panel        | panel above 900                  | panel above 900 and height >= 600             | `catalog_surface.dart` 434  |
| Cart sheet height | 82 percent of the height         | keep in portrait, and cap the height          | `catalog_surface.dart` 441  |
| Category rail     | vertical rail in the wide layout | horizontal strip above the grid on a phone    | `catalog_surface.dart` 806  |
| Cash center       | two panes at width >= 1000       | two panes at width >= 1000 and height >= 600  | `cash_surface.dart` 306     |

**Inference.** A phone in landscape must not use the three-pane shell. It must use a two-pane
shell: the product list on the left, the cart on the right, and no separate category rail.

## 4. The order screen (Comanda)

### 4.1 Portrait, 390 by 844

**Inference.** The portrait order screen is a single column with four zones.

```
+--------------------------------------+
| Comer aqui | Para llevar      [Mas]  |  order type + overflow
+--------------------------------------+
| [ search name, SKU or barcode      ] |  search, full width
+--------------------------------------+
| Todo  Cafe  Panaderia  Bebidas  ->   |  category strip, scrolls
+--------------------------------------+
|  [product]      [product]            |
|  [product]      [product]            |  grid, 2 columns
|  [product]      [product]            |
+--------------------------------------+
|                                      |
|        [ Carrito - 3 - MXN 220 ]     |  cart button, pinned
+--------------------------------------+
| Comanda | Caja | Mesas | Mas         |  bottom nav, 4 items
+--------------------------------------+
```

**Inference.** The rules for this screen follow.

- Put the order type on the top row. It is the first choice of a sale.
- Put every rare action in the "Mas" overflow. Rare actions are connectivity, new sale, operator,
  and settings. This stops the clip at the right edge.
- Keep the category strip on one line. Let it scroll. Do not clip a category.
- Use two product columns at 390. Use three columns at width >= 560.
- Pin the cart button above the bottom nav. Show the line count and the total on the button.
- Keep the bottom nav to four items. Section 7 gives the rule.

### 4.2 Landscape, 956 by 440

**Inference.** The landscape order screen is a two-pane shell. The height is small, so the shell
must give every pixel to content.

```
+-----------------------------+----------------------+
| Comer aqui | Para llevar    | Carrito actual       |
| [ search name, SKU ...   ]  | Capuchino   116.00   |
| Todo Cafe Panaderia  ->     | Croissant    42.00   |
| [prod] [prod] [prod]        | -------------------  |
| [prod] [prod] [prod]        | Total   MXN 220.20   |
| [prod] [prod] [prod]        | [      Cobrar     ]  |
+-----------------------------+----------------------+
| Comanda | Caja | Mesas | Mas |
+-----------------------------+
```

**Inference.** The rules for this screen follow.

- Left pane: search, category strip, and the product grid. Three columns fit at 956.
- Right pane: the cart, with a fixed width near 360 points.
- Pin the total and the "Cobrar" button to the bottom of the cart pane. They must never sit under
  the bottom nav.
- Do not draw the vertical category rail. It costs width and buys nothing on a phone.
- Reserve the bottom inset for the home indicator and the nav bar. The cart must scroll above it.

**Documented fact.** The current landscape shot fails these rules. The "Cobrar" bar covers the
total.

### 4.3 The product card

**Documented fact.** At 200 percent text the card breaks its name and its price.

**Inference.** The card must hold five fields: name, category, price, SKU, and the selected marker.
Three rules protect the card.

- Give the name a maximum of two lines, then wrap with an ellipsis.
- Put the price on its own line. Never let the price share a line with a long name.
- Let the card grow. Do not clip the price. The grid row height must measure the tallest card.

**Source-backed tradeoff.** A fixed card height keeps the grid even. A flexible card height keeps
the price readable at 200 percent text. The price matters more than the even grid. Choose the
flexible height.

## 5. The cart

### 5.1 The cart sheet, portrait

**Inference.** The cart is a sheet in portrait. It holds four blocks.

| Block   | Content                                                           |
| ------- | ----------------------------------------------------------------- |
| Header  | "Carrito actual" and the order type chip.                         |
| Body    | The customer row, then the cart lines. This block scrolls.        |
| Totals  | Subtotal, tax, discount, and the total. The total is the largest. |
| Actions | "Cobrar" (primary) and "Vaciar carrito" (destructive, secondary). |

**Inference.** The totals and the actions do not scroll with the body. They stay visible. The body
scrolls between the header and the totals.

**Documented fact.** The design language states: "Limita los sheets a 760 pixeles y permite
desplazamiento." The current sheet is 82 percent of the height. On a phone that is 692 points at
844 tall. The limit does not bind in portrait.

**Inference.** Keep the sheet at 82 percent in portrait, and add a top scroll region. Keep the
footer pinned.

### 5.2 The cart panel, landscape

**Inference.** In landscape the cart is a fixed right pane. It is not a sheet. The footer pins
inside the pane. The pane scrolls when the cart is long.

### 5.3 Line rows

**Documented fact.** The cart line carries a name, a quantity, a price, a quantity control, an
edit action, and a remove action.

**Inference.** On a phone the row must not carry five controls at 48 points each. Use this order:

- The name and the line total sit on the first line.
- The quantity control and the row menu sit on the second line.
- Put "Editar" and "Quitar" inside the row menu. Do not place two 48-point buttons beside the
  quantity control.

**Inference.** This keeps every control at the 48-point floor and keeps the row readable at 200
percent text.

## 6. The tender, with Tap to Pay on iPhone

**Documented fact.** Tap to Pay on iPhone is available in Mexico. Apple announced Mexico in March 2026. Adyen, Clip, Mercado Pago and the Visa Acceptance Platform were the first four payment
platforms there ([Apple Mexico newsroom](https://www.apple.com/mx/newsroom/2026/03/apple-brings-tap-to-pay-on-iphone-to-mexico/)).
The Apple regions page lists Mexico, with Mercado Pago and the Adyen SDK
([Apple: countries and regions](https://developer.apple.com/tap-to-pay/regions/)).

**Documented fact.** The entitlement is
`com.apple.developer.proximity-reader.payment.acceptance`. It is a Boolean value in the app's
information property list
([Apple: setting up Tap to Pay on iPhone](https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone)).

**Documented fact — this one is a gate, not a detail.** Apple states that the request form
requires "an organization-level Apple Developer account" and the Account Holder login. Apple
reviews each application against its own criteria, and Apple adds the entitlement to the account
as a managed capability. An individual account cannot obtain it
([Apple: setting up Tap to Pay on iPhone](https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone)).

**Documented fact.** The merchant app then works with a payment service provider, which supplies
the certified terminal configuration that the merchant's device loads
([Apple: countries and regions](https://developer.apple.com/tap-to-pay/regions/)).

**Inference.** Confirm the Apple Developer account type before any design work assumes Tap to Pay.
The account must be an organization, and Apple must approve the request.

**Documented fact.** The payment card session uses the Apple `ProximityReader` API. The PSP
supplies the certified terminal configuration.

**Documented fact.** A Flutter NFC plugin reads NDEF tags only. `flutter_nfc_kit` and the other
published plugins use Core NFC reader sessions. They do not run a payment card session. A payment
read is not a tag read.

**Inference.** UmiPOS cannot add Tap to Pay with a Flutter NFC plugin. It must adopt the PSP
software, or call `ProximityReader` through a thin native bridge. This is an engineering decision,
and it stands outside this design spec.

**Documented fact.** Apple states that a device that cannot use Tap to Pay must get an alert, and
the alert recommends an iOS update.

**Documented fact.** The app today has three tender faces: cash at `tender-cash`
(`checkout_surface.dart` line 1214), the manual terminal at `tender-terminal` (line 1296), and the
card terminal at `tender-card-terminal` (line 1395).

**Inference.** Add a fourth tile, "Tap to Pay en iPhone". Its rules follow.

- Show the total first. It is the largest number on the screen.
- Show the text "Elige el metodo de pago" under the total. Then show the tiles.
- Show the Tap to Pay tile only when the device passes the four checks. When the device fails a
  check, hide the tile or disable it **with the reason beside it**. The design language forbids a
  dead control with no explanation.
- When Tap to Pay is the only method, open it when checkout starts. When other methods exist, let
  the operator choose the tile.
- Let the system draw the read screen. Apple draws its own NFC sheet. Do not draw a second one.
- Keep the wallet and card balance out of this tile. It is a card read.
- After the read, show the same three outcomes as the card terminal: success, failure, and unknown.
  Never offer a repeat on an unknown result. The design language forbids it.

**Source-backed tradeoff.** A cash-only phone needs no NFC and no PSP. A phone with Tap to Pay
needs an entitlement, a PSP contract, and a native bridge. The pilot gains a walk-around card
payment. The cost is a procurement step and a native code path. The owner decided to pursue NFC.
So the spec reserves the tile and the state machine, and the work proceeds behind the tile.

## 7. Navigation on the phone

**Documented fact.** The app builds the bottom bar from operator permissions
(`catalog_surface.dart` lines 683 to 752). A destination without permission keeps `onTap: null`.
The control stays on screen and does nothing.

**Documented fact.** The Apple tab bar page states: "Don't disable or hide tab bar buttons, even
when their content is unavailable."

**Documented fact.** The UmiPOS design language states the opposite rule for this case:
"Desactiva una accion invalida y explica el requisito."

**Source-backed tradeoff.** Apple warns that a changing bar looks unstable. The UmiPOS rule warns
that a dead control lies to the operator. On a one-operator mobile till the second risk is
greater, because a dead tab teaches the operator that the till is broken.

**Inference.** Resolve the conflict with a fixed bar and an explained refusal.

- Pick four destinations by role. The default set is Comanda, Caja, Mesas, and "Mas".
- Keep the set stable for the operator session. Do not remove an item when a permission is absent.
- When the operator taps an item without permission, keep the bar stable and show one line that
  names the missing permission. Do not run an empty screen.
- Put the rest of the destinations in "Mas".

**Documented fact.** The bar can hold seven entries today. Four fits the phone.

## 8. Type, contrast, and touch

**Documented fact.** Apple gives these floors.

| Item                 | Value           |
| -------------------- | --------------- |
| Touch target         | 44 by 44 points |
| Text size            | 17 points       |
| Text enlargement     | 200 percent     |
| Contrast, small text | 4.5 to 1        |
| Contrast, large text | 3 to 1          |

**Documented fact.** UmiPOS already meets the Apple touch floor. `UmiTouchTarget.minimum` is 48 and
`UmiTouchTarget.primary` is 52 (`lib/core/theme/umi_theme.dart` lines 16 to 21).

**Inference.** The phone keeps the 48-point floor and the 52-point primary height.

**Documented fact.** Flutter adopts iOS Dynamic Type through `MediaQueryData.textScaler`. UmiPOS
does not clamp the text scale.

**Inference.** Do not clamp the text scale. The design language requires 200 percent text in the
critical flows. The card, the cart row, and the totals must survive 200 percent text at 390 width.
Shot `order-dark-390x844-text2.png` shows the current failure.

## 9. The platform look

**Documented fact.** The app uses Material 3 on every platform
(`useMaterial3: true`, `lib/core/theme/umi_theme.dart` line 75). It draws no Cupertino widget.

**Documented fact.** iOS 26 introduces Liquid Glass for tab views, toolbars, and navigation bars.
A Flutter app does not inherit that look, because Flutter paints its own widgets.

**Source-backed tradeoff.**

| Option                     | Cost                                          | Benefit                                    |
| -------------------------- | --------------------------------------------- | ------------------------------------------ |
| Material on every platform | One design language. Lowest cost.             | The phone does not match iOS 26.           |
| iOS look on the phone      | A second widget layer and a second test loop. | The phone matches the platform.            |
| iOS look everywhere        | Breaks the frozen tablet design.              | One language, but the till loses its look. |

**Inference.** Keep Material on the phone for the pilot. Adopt the iOS behaviors that cost nothing:
safe areas, the back gesture, the system NFC sheet, and Dynamic Type. Revisit the look after the
pilot, when the owner can judge a real device. This keeps one design language and one test loop.

## 10. The amendment to the design language

**Documented fact.** Design Language V1 states: "No se certifica una interfaz POS para telefono."
It certifies no screen below 600 by 900 logical pixels.

**Inference.** The owner reversed this stance when the owner chose the mobile till. V1 needs a
written amendment. The spec proposes this text, and the owner signs it.

- Add a phone tier to the adaptive rules.
- Certified phone resolution: 390 by 844 logical pixels in portrait, and 844 by 390 in landscape.
- The small floor: 375 by 667 logical pixels.
- Read the width and the height. Choose the layout by both.
- Keep the 48-point tap floor and the 200 percent text rule on the phone.
- Keep the cart as a sheet below 900 width. Use a right pane on a landscape phone when the height
  is below 600.

**Inference.** Do not edit the frozen V1 text in place. Add the amendment as a dated section. A
frozen document keeps its history.

## 11. Verification

**Documented fact.** The render harness is the first proof. It runs the real widget on Linux. It
needs no Mac.

**Inference.** Every change to the order screen or the cart passes this gate.

1. Render 390 by 844 in dark and in light.
2. Render 390 by 844 at 200 percent text.
3. Render 956 by 440 in dark.
4. Render 1024 by 768, and compare it to the till. The till must not change.
5. Read every PNG. Check the top bar, the category strip, the card, and the cart footer.
6. Check the four Apple touch and contrast floors of section 8.
7. Check the safe area at the top and at the bottom.

**Documented fact.** The design skill `ui-ux-pro-max` requires a 375-pixel test, a landscape test,
a Dynamic Type test, a dark-mode contrast test, and a safe-area test. Section 11 covers all of
them.

**Inference.** The real iPhone is the last gate. Send one TestFlight build after the renders pass.
Record the phone session. The TestFlight build is the only proof of the real device.

## 12. Open decisions for the owner

| #   | Decision               | Recommendation                                                  |
| --- | ---------------------- | --------------------------------------------------------------- |
| 1   | Orientation            | Allow both. The design must work in each.                       |
| 2   | Platform look          | Material for the pilot. Revisit after the pilot.                |
| 3   | Phone feature set      | The sale, the cart, the tender, and Tap to Pay. Defer the rest. |
| 4   | The design language    | Sign the amendment of section 10.                               |
| 5   | The PSP for Tap to Pay | Choose the PSP. Mercado Pago and Adyen both serve Mexico.       |
| 6   | The phone floor        | Certify 390 by 844, with 375 by 667 as the small floor.         |

## 13. Sources

### Apple

- Human Interface Guidelines, Layout:
  https://developer.apple.com/design/human-interface-guidelines/layout
- Human Interface Guidelines, Tab bars:
  https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Human Interface Guidelines, Tap to Pay on iPhone:
  https://developer.apple.com/design/human-interface-guidelines/tap-to-pay-on-iphone
- Human Interface Guidelines, Accessibility:
  https://developer.apple.com/design/human-interface-guidelines/accessibility
- Adding support for Tap to Pay on iPhone to your app:
  https://developer.apple.com/documentation/ProximityReader/adding-support-for-tap-to-pay-on-iphone-to-your-app
- Tap to Pay on iPhone, countries and regions:
  https://developer.apple.com/tap-to-pay/regions/
- Setting up the Tap to Pay on iPhone entitlement:
  https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone
- Apple newsroom, Tap to Pay on iPhone in Mexico:
  https://www.apple.com/mx/newsroom/2026/03/apple-brings-tap-to-pay-on-iphone-to-mexico/
- WWDC25 session 284, Build a UIKit app with the new design:
  https://developer.apple.com/videos/play/wwdc2025/284/

### Flutter and Dart

- `MediaQueryData.textScaler`:
  https://api.flutter.dev/flutter/widgets/MediaQueryData/textScaler.html
- `flutter_nfc_kit` (NDEF reader, not a payment reader):
  https://pub.dev/packages/flutter_nfc_kit

### Repository

- `apps/umi-pos/lib/features/catalog/catalog_surface.dart`
- `apps/umi-pos/lib/features/checkout/checkout_surface.dart`
- `apps/umi-pos/lib/core/theme/umi_theme.dart`
- `apps/umi-pos/test/render/order_surface_render.dart`
- `docs/research/2026-10-04-ios-pos-design-constraints.md`
- `docs/design/UMIPOS_DESIGN_LANGUAGE_V1.md`

## 14. Limits of this spec

**Documented fact.** This spec read the code, the renders, and the primary sources. It ran no test
on the real iPhone.

**UNVERIFIED.** The behaviour on the real iPhone. The TestFlight build is the only evidence, and
nobody has recorded a phone session yet.

**UNVERIFIED.** The exact Tap to Pay requirements for the chosen PSP. The PSP contract sets the
final iOS floor and the SDK shape.
