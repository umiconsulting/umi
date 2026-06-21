# Notes

## Prefer skills for
- repeated feature setup
- screen conventions
- event naming rules
- repository patterns

## iPad UI defaults
- prefer multi-column or persistent-panel layouts over deep push navigation
- keep primary actions visible without hidden gestures
- design for fast repeated taps, not precision interactions
- assume the device is mounted or shared and may be viewed at a distance
- preserve context on screen during ticket review and status changes

## Prefer subagents for
- architecture tradeoffs
- large refactors
- UX alternatives
- cross-feature review

## Realtime contract
- fetch snapshot
- subscribe to ordered events
- persist last seen sequence
- reconcile after reconnect

## iPad layout rules (synthesized 2026-04-15)

### NavigationSplitView column widths — 11" iPad landscape
- sidebar (board): `min: 500, ideal: 700, max: 900`
- detail panel: `min: 300, ideal: 360, max: 400`
- rationale: sidebar min of 760pt is unsolvable with a detail min of 320pt on 1194pt wide device

### Column count and card density
- keep 4 columns always — columns = workflow stages, not load indicators
- when a column exceeds ~6 cards, switch `KDSCard` to compact mode (remove item preview, shrink padding) rather than removing a column
- do not use `LazyVGrid` — it breaks the Kanban metaphor (columns = status)
- wrap each column's card list in `ScrollView(.vertical)` so columns scroll independently

### Dynamic Type
- cap at `.xLarge` with `.dynamicTypeSize(.xSmall ... .xLarge)` on root view
- rationale: shared kitchen iPads may have large system text set for a previous user; the board becomes unusable past xLarge

### Color scheme
- force dark mode: `.preferredColorScheme(.dark)` at the scene root
- rationale: kitchen environments have high ambient contrast from equipment and lighting; dark surfaces reduce glare and improve status-color contrast
- use `KDSTheme.Brand.navyAdaptive` (resolves to blue #7692CB in dark) for primary text and high-contrast elements
- do not use raw `KDSTheme.Brand.navy` (#223979) as text color — nearly invisible on dark backgrounds

## Animation rules (professional ops tool)

### Spring parameters
- response: 0.35, dampingFraction: 0.82 — tight, fast, no bounce
- never use `.bouncy`, `interactiveSpring()`, or consumer presets

### Card arrival/departure
```swift
// In BoardColumnView — on the cards VStack
.animation(.spring(response: 0.35, dampingFraction: 0.82), value: orders)
// On each card button
.transition(.asymmetric(
    insertion: .push(from: .top).combined(with: .opacity),
    removal: .opacity  // fade only — order may still exist in another column
))
```

### Age pill color shift
```swift
.animation(.easeInOut(duration: 0.6), value: ageTint)
```

### `withAnimation` vs `.animation(value:)`
- prefer `.animation(value:)` everywhere — it scopes animation to value changes
- `withAnimation` only for local `@State` mutations not driven by `@Published`
- never wrap async `repository` calls in `withAnimation`

## Performance rules

### Age display
- use `TimelineView(.periodic(from: .now, by: 60))` wrapping the age pill
- `ageInMinutes` calls `Date.now` internally so it returns fresh values on each tick
- do NOT use a shared timer publisher — it causes all cards to re-render together

### Column scrolling
- each `BoardColumnView` wraps its card `ForEach` in `ScrollView(.vertical, showsIndicators: false)`
- the column's `ScrollView` gets `.frame(maxHeight: .infinity)` so it fills the column background
- the board's `LazyHStack` handles lazy column loading; the column's `ScrollView` handles card-level laziness

### Typography and readability
- add `.monospacedDigit()` to all numeric text: age pill, order counts, metrics, sequence numbers
- status badge font: `.footnote.weight(.bold)` (upgrade from `.caption` for arm's-length readability)
- cap Dynamic Type at `.xLarge` — see layout rules above

## Haptics

### SensoryFeedback (iOS 17+)
- card selection: `.sensoryFeedback(.selection, trigger: selectedOrderID)` on the column view
- status bump: `.sensoryFeedback(.impact(weight: .medium), trigger: bumpCount)` on the action buttons HStack
- use a `@State private var bumpCount = 0` incremented in the button action

### When to use `.heavy` vs `.medium`
- `.medium`: forward status transitions (accept, start prep, mark ready, complete)
- `.heavy`: cancel/destructive actions
- `.selection`: passive selection (card tap that only changes which card is highlighted)

## UMI brand on dark mode (2026-04-15)

### Colors — allowed and forbidden
- Logo mark color on dark surfaces: use `KDSTheme.Brand.blue` (#7692CB) — **never** raw `KDSTheme.Brand.navy` (#223979); navy is nearly invisible on dark backgrounds
- Surface backgrounds: use `KDSTheme.Surfaces.levelN` — never `Color(uiColor: .systemBackground)` or similar; system colors break the navy-anchored dark palette
- Badge/container backgrounds on dark: `KDSTheme.Surfaces.level3` + `KDSTheme.Surfaces.separator` stroke — never `navy.opacity(0.07)` (invisible)

### Dark surface hierarchy — KDSTheme.Surfaces
Four UMI navy-anchored dark layers, stepped by luminance ~6-8 units per tier:
```
level0 — board bg:  (10, 15, 30)   deepest
level1 — column bg: (16, 24, 46)
level2 — card bg:   (22, 33, 62)
level3 — panel/detail: (28, 42, 76)
separator — Color.white.opacity(0.07)
```
All levels share UMI navy's blue hue ratio. Never substitute neutral grays — they break brand warmth.

### Typography on dark
- Primary font design: `.rounded` — closest system approximation to UMI's Domus (geometric, humanist)
- Section labels: `.caption.weight(.bold)` + `.tracking(1.2)` + `.uppercased()` in brand blue at 75% opacity
- Metric tile labels: `.caption2.weight(.bold)` + `.tracking(0.8)` for tight spaces

### Card design rules
- Left status strip (4pt, `RoundedRectangle(cornerRadius: 3)`) communicates status color at a glance — removes need for a status chip on the card body
- Status chip removed from card footer: the column header already names the status; duplication creates clutter
- Age pill: `.subheadline.bold` (not `.caption.bold`) — kitchen staff read from standing distance
- Items: show up to 4 (not 3); `+N more` label in `.tertiary` if overflow
- Divider between header zone (name + age + source) and items zone: `KDSTheme.Surfaces.separator.frame(maxHeight: 1)`
- Card inner padding: `KDSTheme.Spacing.cardPadding` (18pt) on trailing/vertical; 14pt leading (strip takes 4pt)
- Selected state: blue border at 0.55 opacity + elevated shadow; unselected: separator stroke + minimal shadow

### Column design rules
- Top accent line (3pt, status tint, `Rectangle()`) as first element of column VStack — gets corner-rounded by column's `clipShape`
- Column title: `.uppercased()` + `.tracking(1.2)` + status tint color + `.caption.bold`
- Count badge: status tint at 15% opacity background
- Column inner padding: `KDSTheme.Spacing.columnPadding` (14pt) applied to content VStack below accent

### Board header rules
- Single compact bar: connection pill (left) + per-status chip row (right)
- Remove redundant UMI mark from board header — it duplicates the toolbar station badge
- Remove "Kitchen Board" title text from board body — use `.navigationTitle("").navigationBarTitleDisplayMode(.inline)` to free nav bar space
- Status count chips: circle dot (status tint) + bold count + secondary label; `level1` background + tinted stroke

### Item list in detail view
- Grouped inset style: all items in a single `panelBackground` rounded container
- Separators: `KDSTheme.Surfaces.separator` hairlines, inset `.leading` by 52pt (aligns past quantity column)
- Each row: 12pt vertical padding inside the container
- Quantity: `.headline.semibold.rounded` in brand blue; 44pt width frame for alignment

## Liquid Glass — iOS 26 (2026-04-15)

### Correct API (verified against iOS 26.4 SDK)
- Type: `Glass` (not `GlassEffect` — that name does not exist)
- Modifier: `.glassEffect(_ glass: Glass = .regular, in shape: some Shape)`
- Tint: `Glass.regular.tint(_ color: Color?)` — takes `Color?`, not `ShapeStyle`
- `Color.opacity(_:)` returns `Color`, so `.tint(someColor.opacity(0.14))` is valid
- Button styles: `.buttonStyle(.glass)` and `.buttonStyle(.glassProminent)` — both exist
- Group efficiency: `.glassEffectUnion(id:namespace:)` and `GlassEffectContainer` for batching

### Where to apply glass in KDS
- Apply: toolbar badges, connection pill, status chips, age pill, source chip, detail chips, metric tiles, detail containers
- Do NOT apply: card surfaces (`KDSTheme.Colors.cardBackground`) — glass blur behind dense item rows destroys kitchen-distance readability

### Tint opacity constants (in `KDSTheme.Glass`)
- `chromeTint` (0.10): nav badges, connection indicators, source chips
- `statusTint` (0.14): status-colored elements where tint legibility matters
- `panelTint` (0.08): metric tiles, items container, note section

### Toolbar chrome
- iOS 26 automatically applies glass to the navigation bar and toolbar — no explicit call needed
- To override (e.g., force dark navy toolbar): `.toolbarBackground(color, for: .navigationBar)` + `.toolbarBackgroundVisibility(.visible, for: .navigationBar)`
- For KDS: let the nav bar go automatic glass (it picks up the dark navy board background = dark glass)

### TabView (iOS 26)
- New `Tab("Label", systemImage: "icon") { content }` initializer replaces `.tabItem {}`
- Floating glass tab bar is the iOS 26 default — no `tabViewStyle` needed
- Old `.tabItem` syntax still compiles but doesn't enable new placement/section features

### Connection indicator
- Replace static `Circle().fill(color)` with `Image(systemName: "wifi", variableValue: 0.0…1.0)`
- Variable values: `.connected` → 1.0, `.connecting` → 0.5, `.idle` → 0.2
- `.symbolEffect(.automatic, value:)` requires `DiscreteSymbolEffect` — `AutomaticSymbolEffect` does NOT conform; use `.animation(.easeInOut, value:)` on the variable value instead

### Spring animation syntax (iOS 26)
- New: `.animation(.spring(duration: 0.35, bounce: 0.0), value: someValue)`
- `bounce: 0.0` = critically damped (no oscillation) — use for all KDS card and layout animations
- Old `.spring(response:dampingFraction:)` still compiles; new `duration/bounce` syntax is idiomatic iOS 26

## Simulator design loop observations (2026-04-15)

### Fixes confirmed working
- Header status chips: add `.fixedSize()` to label Text to prevent line-wrap inside Capsule chips
- Empty state contrast: `.tertiary` + `.quaternary` text is invisible on dark navy; use `.secondary` + `.tertiary`
- Metric card value overflow: add `.lineLimit(1).minimumScaleFactor(0.6)` — "WhatsApp" now fits in one line
- Empty state background: `Surfaces.separator` alone is invisible; use `Brand.blue.opacity(0.05)` + 0.08 stroke

### NavigationSplitView portrait behavior
- `.balanced` style does NOT honor `navigationSplitViewColumnWidth(min: 500)` in portrait on iPad Pro 13"
- In portrait, the board sidebar receives ~300pt regardless of min constraint
- This is a SwiftUI behavioral issue — the KDS primary use is landscape on mounted kitchen iPad
- In portrait, the board still scrolls horizontally to show all 4 columns; functionality is intact
- Fix if portrait is needed: swap `.balanced` for `.automatic` or restructure to show detail as sheet on portrait

### Landscape target column widths (iPad Pro 13" 1376pt)
- To show 4 columns without scroll: board needs ≥ 976pt (4×235 + 3×12 + 2×20)
- Recommended: board `min: 600, ideal: 1000, max: 1100` | detail `min: 280, ideal: 340, max: 420`
- This gives landscape: board ~1000pt (4 columns visible) + detail ~376pt

### Card rendering confirmed
- Left 4pt status strip renders correctly and is clipped by `RoundedRectangle(cornerRadius: 16)`
- Age tint animation (green → orange → red) transitions correctly
- `strikethrough(item.isCancelled)` renders correctly for cancelled items
- `.sensoryFeedback(.selection, trigger: selectedOrderID)` fires on card tap ✓
