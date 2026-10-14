# The iPhone target for UmiPOS: constraints and open decisions

- Date: 2026-10-04
- Question: UmiPOS now runs on a real iPhone through TestFlight. The design language does not
  certify a phone interface. What does iOS require, what do competitors ship on a phone, what does
  the app do today, and which decisions must the owner make before design starts?
- Scope: the design of the iOS build of `apps/umi-pos`. Not the build pipeline, not the signing,
  not the App Store release process.
- Method: primary sources. The Apple Human Interface Guidelines through the Apple documentation
  data files. Apple WWDC25 session pages. App Store product pages. The Flutter API documentation.
  The repository at commit `a68f5bd`.
- Labels: **Documented fact**, **Source-backed tradeoff**, **Inference**, **UNVERIFIED**.
- Related: [iOS from Linux](2026-10-03-ios-from-linux.md) for the build pipeline.
  [UX patterns and design north star](2026-09-15-ux-patterns-and-design-north-star.md) for the
  tablet design. [UmiPOS design language](../design/UMIPOS_DESIGN_LANGUAGE_V1.md) for the frozen
  rules.

## 1. Answer

**Inference.** One decision blocks the design. The owner must name the job of the iPhone in the
pilot. The job is one of three:

1. The counter till. The iPhone replaces the terminal at the counter.
2. The second device. The operator carries the iPhone to the table and keeps the terminal at the
   counter.
3. The owner device. The owner reads sales and approves actions.

**Inference.** Each job gives a different first screen, a different navigation model, and a
different feature set. Design work before this decision creates three half-products.

**Documented fact.** The design language blocks the phone on purpose. It says "No se certifica una
interfaz POS para teléfono". It certifies no screen below 600 by 900 logical pixels
([UmiPOS Design Language V1](../design/UMIPOS_DESIGN_LANGUAGE_V1.md)).

**Documented fact.** The application already allows the phone. The iOS project declares the iPhone
and the iPad (`TARGETED_DEVICE_FAMILY = "1,2"`, `ios/Runner.xcodeproj/project.pbxproj` lines 373,
500 and 553). It allows portrait and both landscape orientations (`ios/Runner/Info.plist` lines 68
to 73).

**Inference.** The product reached the phone before the design did. The next step is a design
decision. It is not a repair.

## 2. The numbers Apple publishes

**Documented fact.** These values come from the current Human Interface Guidelines.

| Item                             | Value                | Platform        | Source            |
| -------------------------------- | -------------------- | --------------- | ----------------- |
| Default control size             | 44 by 44 pt          | iOS, iPadOS     | HIG Accessibility |
| Minimum control size             | 28 by 28 pt          | iOS, iPadOS     | HIG Accessibility |
| Padding, control with a bezel    | about 12 pt          | Apple platforms | HIG Accessibility |
| Padding, control without a bezel | about 24 pt          | Apple platforms | HIG Accessibility |
| Default text size                | 17 pt                | iOS, iPadOS     | HIG Typography    |
| Minimum text size                | 11 pt                | iOS, iPadOS     | HIG Typography    |
| Text enlargement                 | at least 200 percent | Apple platforms | HIG Accessibility |
| Contrast, text up to 17 pt       | 4.5 to 1             | Apple platforms | HIG Accessibility |
| Contrast, text 18 pt and larger  | 3 to 1               | Apple platforms | HIG Accessibility |
| Contrast, bold text              | 3 to 1               | Apple platforms | HIG Accessibility |
| Screen, iPhone 17 Pro Max        | 440 by 956 pt        | iOS             | HIG Layout        |

**Documented fact.** Apple states the size class rule as a direct instruction: "Determine layout
based on size classes, not device type or orientation." Apple explains that the horizontal size
class gives the available width and the vertical size class gives the available height.

**Documented fact.** Apple states that an iPhone app in landscape can have regular width and compact
height. Apple gives this example: "A layout solely designed for landscape on iPhone with regular
width and compact height might not take advantage of the vertical space available on iPad."

**Documented fact.** Apple states that an orientation lock does not remove the obligation to adapt:
"Even if your app is locked to a certain orientation, such as a landscape-only game, it's still
important to ensure your interface resizes well to provide the best experience across devices and
window sizes."

**Documented fact.** Apple permits a change in the **amount** of visible function as the space
changes. It forbids a change in **function** itself: "Don't change your app's functionality based on
the space it occupies."

**Documented fact.** UmiPOS already meets the Apple control floor. `UmiTouchTarget.minimum` is 48
and `UmiTouchTarget.primary` is 52 (`lib/core/theme/umi_theme.dart` lines 16 to 21).

**Inference.** The problem on the phone is not the size of one control. The problem is the layout
of many controls and the height of the window.

**UNVERIFIED.** The full screen table for the current iPhone line. The HIG Layout page carries the
table under "iOS, iPadOS device screen dimensions". The Apple documentation data file for that page
did not carry the table in this session, and the page itself needs JavaScript. Only the iPhone 17
Pro Max row is confirmed here: 440 by 956 pt (1320 by 2868 pixels at 3x).

## 3. Size classes, not device names

**Inference.** UmiPOS chooses layout by one number: the width. This is a close approximation of the
horizontal size class. It is not the whole rule. The height is never read. On an iPhone in
landscape the width is large and the height is small, so a width-only rule keeps the narrow layout
in a wide, short window.

**Inference.** The widest current iPhone in portrait is 440 pt, the iPhone 17 Pro Max. These
consequences follow:

- The 900 pt catalog breakpoint is unreachable in portrait.
- The 900 pt catalog breakpoint is reachable in landscape on a large iPhone (956 pt wide).
- The 1000 pt cash breakpoint is unreachable in both orientations.
- The 1400 pt grid breakpoint is unreachable in both orientations.

**Documented fact.** The current breakpoints in the app are these:

| Surface           | Rule                                                     | File and line                         |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| Catalog shell     | three panes at width ≥ 900; else one column plus a sheet | `catalog_surface.dart` 806, 434, 1326 |
| Product grid      | 6 / 5 / 4 / 2 columns at 1400 / 1050 / 760 / below       | `catalog_surface.dart` 1247           |
| Option cards      | column count from the available width                    | `catalog_surface.dart` 1970           |
| Cart sheet height | 82 percent of the window height                          | `catalog_surface.dart` 441            |
| Cash center       | two panes at width ≥ 1000; else one column               | `cash_surface.dart` 306, 1052         |
| Cash equation     | two columns at width ≥ 600                               | `cash_equation.dart` 117              |
| Denomination grid | 1 or 2 columns from the available width                  | `denomination_counter.dart` 198       |
| Floor plan        | side panel at width ≥ 720                                | `floor_plan_surface.dart` 68, 70      |
| Floor plan header | extra content at width ≥ 560                             | `floor_plan_surface.dart` 305         |
| Checkout numpad   | 3 columns, aspect ratio 2                                | `checkout_surface.dart` 3693          |
| Checkout sheet    | maximum width 560                                        | `checkout_surface.dart` 3197          |
| Entry and PIN     | card maximum width 520                                   | `entry_surface.dart` 572              |

**Inference.** The cart sheet is the clearest fault. On an iPhone 17 Pro Max in landscape the
window is 956 by 440 pt. The sheet takes 82 percent of 440 pt, so it is about 361 pt tall. A cart
with many lines, a checkout step and a numpad cannot live in that space.

## 4. Type, contrast, and motion

**Documented fact.** Flutter reports the platform text scale through
`MediaQueryData.textScaler`. The Dart documentation states that the value "typically reflects the
user-specified text scaling value in the platform's accessibility settings". Flutter thus adopts
iOS Dynamic Type without extra code.

**Documented fact.** Flutter also offers `MediaQuery.withClampedTextScaling` to limit the scaled
size to a range.

**Documented fact.** UmiPOS does not clamp the text scale anywhere. The only reads of
`MediaQuery.textScalerOf` measure a size, in `cash_equation.dart` lines 266 and 400 and in
`denomination_counter.dart` line 195.

**Inference.** This is correct by the frozen rules. The design language requires 200 percent text in
the critical flows. It also shifts the test burden: every money screen needs a layout that survives
200 percent text on a 440 pt-wide window.

**Documented fact.** Apple states a motion rule for frequent actions: "In apps, generally avoid
adding motion to UI interactions that occur frequently."

**Documented fact.** `UmiMotion.fast` is 120 ms and `UmiMotion.standard` is 220 ms
(`lib/core/theme/umi_theme.dart` lines 23 to 26). Both sit inside the Apple range.

## 5. The iOS 26 look

**Documented fact.** iOS 26 introduces Liquid Glass. Apple describes it as the updated look and
behaviour of tab views, split views, navigation bars and toolbars. Navigation and toolbar items
"float above content with automatic grouping of bar button items into visual groups sharing glass
backgrounds" ([WWDC25 session 284](https://developer.apple.com/videos/play/wwdc2025/284/)).

**Documented fact.** The HIG change log for Layout records Liquid Glass guidance on 9 June 2025 and
iPhone 17 specifications on 9 September 2025.

**Documented fact.** The iOS deployment target of the project is 13.0
(`ios/Runner.xcodeproj/project.pbxproj` lines 369, 496 and 547).

**Inference.** A deployment target of 13.0 keeps the app off the native iOS 26 material. It also
keeps a large set of old devices in scope for no pilot benefit. The 2026-10-03 note records that
13.0 is below the Flutter iOS floor and calls it "a decision, not a build blocker"
([iOS from Linux](2026-10-03-ios-from-linux.md) section 4).

**Documented fact.** UmiPOS draws no Cupertino widget. It uses Material 3
(`useMaterial3: true`, `lib/core/theme/umi_theme.dart` line 75). The only Cupertino import is the
localization delegate in `lib/app/umi_pos_app.dart`.

**Source-backed tradeoff.** Flutter cannot inherit the iOS system look for free, because it paints
its own widgets. The team must choose: keep Material on every platform, or adopt iOS conventions on
the phone, or adopt iOS conventions everywhere. The first choice is cheaper and keeps one design
language. The second choice fits the platform and costs a second widget layer. The third choice
breaks the frozen tablet design.

## 6. What competitors ship on a phone

| Product      | On iPhone                    | Evidence                                                                                                                                |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Square POS   | Yes, with features withheld  | App Store listing: "Course and seat management (iPad only)", "Preauthorized bar tabs (iPad only)"                                       |
| Square Stand | No, iPad required            | "Requires iPad running iOS 17.1+" on Square's device page                                                                               |
| Toast Tables | Yes, but not recommended     | App Store listing: "Optimized for iPads running iOS 12 (or later), but is not recommended for iPhone as full experience may be limited" |
| Toast Now    | iPhone only, management only | App Store listing: "Only for iPhone. Run your business on the go"                                                                       |
| Loyverse POS | Yes, full till               | App Store listing: "Sell from a smartphone or tablet", camera barcode scan, Tap to Pay on iPhone, iOS 15.0 or later                     |

**Inference.** Two patterns repeat.

1. **The phone is a companion.** The full till stays on a tablet. Toast uses this pattern, and it
   says so in the listing.
2. **The phone is a till, and the product withholds the complex surfaces.** Square withholds
   restaurant seat and tab management on the phone. Loyverse keeps the sale, the cash movement, the
   printer, and the camera scanner, and it lists no seated table map.

**Inference.** No product in this set promises every surface of a full till on a phone. The
withheld surface is the same in both patterns: the seated table map.

## 7. What UmiPOS does on a phone today

**Documented fact.** The app ships one interface for every device. The surfaces are:

| Surface          | File                                                      |
| ---------------- | --------------------------------------------------------- |
| Entry and PIN    | `lib/features/entry/entry_surface.dart`                   |
| Catalog and cart | `lib/features/catalog/catalog_surface.dart`               |
| Checkout         | `lib/features/checkout/checkout_surface.dart`             |
| Cash center      | `lib/features/cash/cash_surface.dart`                     |
| Floor plan       | `lib/features/tables/floor_plan_surface.dart`             |
| Kitchen board    | `lib/features/kitchen/kitchen_board_surface.dart`         |
| Sales            | `lib/features/sale/sale_surface.dart`                     |
| Exceptions       | `lib/features/exception/exception_surface.dart`           |
| Inventory        | `lib/features/inventory/inventory_surface.dart`           |
| Customer value   | `lib/features/customer_value/customer_value_surface.dart` |
| Hardware         | `lib/features/hardware/hardware_surface.dart`             |
| Recovery center  | `lib/features/offline/recovery_center.dart`               |

**Documented fact.** The primary navigation is a Material 3 `NavigationBar`
(`catalog_surface.dart` line 760). The entries are built from operator permissions, and the
`selectedIndex` is fixed at 0. A destination without permission keeps `onTap: null`, so it stays on
screen and does nothing (`catalog_surface.dart` lines 683 to 712 and 760 to 764).

**Documented fact.** Apple advises against this shape. The HIG tab bar page states: "Don't disable
or hide tab bar buttons, even when their content is unavailable. Having tab bar buttons available
in some cases but not others makes your app's interface appear unstable and unpredictable."

**Documented fact.** Apple gives a count limit for a bar the operator can customise: "aim for a
default list of five or fewer to preserve continuity between compact and regular view sizes".

**Documented fact.** The `entries` list can hold seven destinations: Comanda, Caja, Ventas, Mesas,
Cocina, Pedidos and Ajustes (`catalog_surface.dart` lines 683 to 752). The count depends on the
injected controllers and on the operator permissions.

**Documented fact.** Apple states the iOS tab bar behaviour: "A tab bar floats above content at the
bottom of the screen. Its items rest on a [Liquid Glass] background that allows content beneath to
peek through."

**Documented fact.** The design language also applies: "Desactiva una acción inválida y explica el
requisito". A dead control without an explanation contradicts the frozen rules.

**Documented fact.** No orientation lock exists. A search of `lib/` returns no `SystemChrome` call
and no `preferredOrientations` value.

**Documented fact.** The theme follows the system appearance. `themeMode` reads
`platformBrightness`, so a phone in dark mode shows the dark theme
(`lib/app/umi_pos_app.dart` line 124).

**Inference.** UmiPOS on iOS is one interface at three widths, not an iOS design. The phone receives
the narrow desktop layout.

## 8. The gap, in one list

1. **The job is undefined.** No document states what the iPhone does in the pilot.
2. **The height is never read.** Landscape on a phone is wide and short.
3. **The cart sheet is too tall for a short window.**
4. **The cash center cannot reach its two-pane form on a phone.**
5. **The navigation bar carries dead controls.**
6. **The platform look is unresolved.** Material 3 does not match iOS 26.
7. **The type scale at 200 percent is untested on the narrow width.**
8. **The certified resolution statement contradicts the shipped target.**

## 9. The decisions the owner must make

| #   | Decision                   | Options                                                |
| --- | -------------------------- | ------------------------------------------------------ |
| 1   | The job of the iPhone      | Counter till · second device · owner device            |
| 2   | Orientation                | Portrait only · landscape only · both                  |
| 3   | Platform look              | Material everywhere · iOS on phone · iOS everywhere    |
| 4   | Feature scope on the phone | Full till · sale and cash only · view and approve only |
| 5   | The certified floor        | Keep 600 by 900 · add a phone tier at 390 by 844       |
| 6   | iOS deployment target      | Keep 13.0 · raise to 15 · raise to the iOS 26 minimum  |

**Inference.** Decision 1 answers decisions 2, 3 and 4. Decision 1 needs the owner, not the team.

## 10. The design skills, and which ones apply here

**Documented fact.** The workspace holds 15 design skills under `.agents/skills/design/`
(`index.md`). Fourteen of them target web output: Tailwind, React, HTML, or marketing pages.

**Documented fact.** `ui-ux-pro-max` is the only skill with a Flutter stack file
(`data/stacks/flutter.csv`) and a native mobile rule set (`references/pro-rules.md`). Its own
pre-delivery checklist requires a test at 375 px, a landscape test, a Dynamic Type test, a dark
mode contrast test, and a safe area test.

**Source-backed tradeoff.** Three further skills transfer to Flutter as principles, not as code:
`better-colors` (OKLCH and APCA contrast), `better-typography` (type scale and tabular figures), and
`improve-ui` (a read-only audit against the product's own contract).

**Inference.** The remaining skills do not apply. `hallmark`, `frontend-design`,
`web-artifacts-builder`, `theme-factory`, `baseline-ui`, `baoyu-design`, `webapp-testing`, and
`fixing-metadata` all assume a web artifact.

**Documented fact.** The design index states that a source-reading audit cannot judge contrast,
focus order or overlap, and that rendered evidence is required.

**Inference.** UmiPOS has a stronger verification loop than the web skills assume. The Linux build
runs the real application, `tools/ux-sweep/pos-semantics-inventory.mjs` reads every control by label
and size, and TestFlight puts the build on the real iPhone. Use that loop for the design work.

## 11. Sources

All Apple pages below were read through the Apple documentation data files at
`https://developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`, because
the HTML pages need JavaScript. All URLs answered on 2026-10-04.

### Apple

- Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets
- Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Gestures: https://developer.apple.com/design/human-interface-guidelines/gestures
- Playing haptics: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Build a UIKit app with the new design (WWDC25 session 284):
  https://developer.apple.com/videos/play/wwdc2025/284/

### Flutter

- `MediaQueryData.textScaler`:
  https://api.flutter.dev/flutter/widgets/MediaQueryData/textScaler.html
- `MediaQuery.withClampedTextScaling`:
  https://api.flutter.dev/flutter/widgets/MediaQuery/withClampedTextScaling.html

### Product pages

- Square Point of Sale: https://apps.apple.com/us/app/square-point-of-sale-pos/id335393788
- Square device compatibility: https://squareup.com/us/en/compatibility
- Toast Tables: https://apps.apple.com/us/app/toast-tables/id1588284147
- Toast Now: https://apps.apple.com/us/app/toast-now/id6444586410
- Loyverse POS: https://apps.apple.com/us/app/loyverse-pos-point-of-sale/id1070865387

### Repository

- `apps/umi-pos/lib/core/theme/umi_theme.dart`
- `apps/umi-pos/lib/app/umi_pos_app.dart`
- `apps/umi-pos/lib/features/catalog/catalog_surface.dart`
- `apps/umi-pos/lib/features/cash/cash_surface.dart`
- `apps/umi-pos/lib/features/checkout/checkout_surface.dart`
- `apps/umi-pos/lib/features/tables/floor_plan_surface.dart`
- `apps/umi-pos/ios/Runner/Info.plist`
- `apps/umi-pos/ios/Runner.xcodeproj/project.pbxproj`

## 12. Limits of this research

**Documented fact.** This research read documents and source code. It measured no operator, ran no
application test, and made no change to application code.

**Inference.** The breakpoint analysis uses the code, not a rendered frame. A run of the real app
at 393 by 852 pt and at 956 by 440 pt must confirm every fault in section 8.

**UNVERIFIED.** The behaviour of the app on the real iPhone. The TestFlight build is the only
evidence for that, and nobody has recorded a phone session yet.
