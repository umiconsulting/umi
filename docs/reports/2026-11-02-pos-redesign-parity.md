# Native POS: selected Rediseño 2

Status: **native source implementation complete; native screenshot acceptance pending**.
The root agent owns the Android build, isolated API, fixtures, emulators and runtime comparison.

## Selected source

The selected prototype is `/Users/moon/Documents/umipos-redesign`, design 2, release b1adc1e9.
Its current `src/redesign-compositions.css` and `src/full-directions.css` replace prior Task 3B visual requirements.
The final sale captures supply the product hierarchy. Existing operational captures supply the other screen references.
UNSLOP applies the approved direction. Its author is Damir Sokolovsky (@heydamir), under CC BY 4.0.

Flutter remains native. The implementation uses the existing native controls and Lucide glyph registry.
It adds no WebView, React runtime, backend route, schema, entitlement or permission.
Contract 2.51.0 and the current controllers remain authoritative.

## Presentation changes

- Shared shell: IBM Plex Sans, persistent lowercase umi, an expandable navy rail, navy phone navigation and clear selected/focus states.
- PIN: a centered console with real terminal, location and retained operator identity. Enrollment, PIN, refusal, lock and session callbacks remain intact.
- Sale: horizontal category keys, readable counts, a primary Nuevo pedido action and photo-free product keys with 18px/600 names.
- Product emphasis: up to three keys span two rows when saved device-local adds provide a real signal. The label is Frecuente.
- Modifiers: two-column inspector groups with stacked option keys. Variants, min/max rules, quantity, courses, notes, prices and apply/cancel retain their handlers.
- Account: separate line cards, consumption details, dispatch and collection zones. Total, paid and remaining values keep their authoritative owners.
- Tables: the complete published floor remains. A wide detail dock sits below the map. Portrait and phone detail access remain available.
- Incoming: a compact queue and a broad summary desk. Source line count and source total are explicit. The existing bind callback remains.
- KDS: received, preparation and ready lanes use actual station work. Hide/show ready has a live count and changes presentation only.
- Checkout and partial payment: a method bank, payment work area and account record. Narrow tablets retain the account beside the work area.
- Cash: a status/equation band, operation areas and a separate ledger. Denomination keys keep every configured denomination, including MXN 0.50.
- Settings/hardware: horizontal section keys and responsive device panels. Registration, transports, tests, primary selection, activation, copies and print preferences remain.
- Completion: real receipt content beside the payment result, with the existing receipt/customer/print and next-order actions. Source receipt branding remains intact.

The frequency signal counts adds on this terminal. It makes no global sales claim.
The initial signal stays fixed during adds and search. Product order and repeated-add behavior remain unchanged.
No saved signal produces regular keys. The native grid also handles a catalog with no chargeable keys.
The retained photo preference controls product detail images. The product grid has no images.

## Retained behavior and limits

Domain controllers, contracts, roles, leases, persistence, hardware, idempotency and offline ownership remain unchanged.
All English/Spanish strings and light/dark/midnight themes remain supported.
Keyboard, enlarged text, sent-line guards, rounds, partial payments, exceptions and account transfers remain covered.
Current staging paid-but-occupied tables retain new consumption, explicit clear, move, merge, split and clean actions.
KDS retains station/day filters, receive/start/ready/item actions, course controls, retry and cancellation acknowledgement.
Cocina/Barra roles retain their existing destination restrictions.

Incoming orders remain summary-only with manual ring-up. Binding links the source reference to the current POS cart.
It does not import source lines, options, notes or catalog IDs. Source total stays separate from the POS cart amount.
No dashboard-only route is called. Complete source-order import needs a separate contract decision.
Entry contracts supply no staff picker or protected shift metrics. The PIN console adds neither invented metrics nor protected sales data.

## Verification

SDK: official Flutter 3.47.5, tag `6a19cca564`, engine `af7e796e16`, Dart 3.13.4.
Checkpoint A: `d960db64`; 109 focused tests passed. Its scoped analyzer found no issues.
Checkpoint B: **1,266 full-suite tests passed, five skipped, zero failures**, in 23 seconds.
A final copy-only follow-up passed 19 focused tests for incoming, display preferences and grid geometry.

Commands and logs:

- `flutter test --no-pub`: `/private/tmp/umi-design2-native-full-final2.log`.
- `flutter test --no-pub test/incoming_orders_surface_test.dart test/display_preferences_test.dart test/product_key_layout_test.dart`: `/private/tmp/umi-design2-final-label-checks.log`.
- Checkpoint A analyzer, eight changed owners: `/private/tmp/umi-design2-analyze-a-final.log`.
- Checkpoint B analyzer, 19 changed owners: `/private/tmp/umi-design2-analyzer-scoped-final.log`; no issues.
- `flutter analyze --no-pub --no-fatal-infos`: `/private/tmp/umi-design2-analyzer-full.log`; zero errors/warnings and three existing infos.
- `git diff --check`: clean.

The three existing analyzer infos are `inventory_repository.dart:76`, `cash_keyboard_test.dart:63` and `pos_entry_brand_test.dart:3`.
The five skips are Linux-only AppImage updater cases: unset APPIMAGE, replacement, current release, failed download and absent asset.
No test skip was added.

New regressions cover grid spans, regular/empty keys, stable local emphasis, real station lanes, ready visibility/counts and the floor dock.
The floor test also verifies published dimensions, element coordinates and touch access to both fixture tables.
Red evidence exists for category placement, modifier stacking, frequency changes, ready visibility, preparation placement, floor docking and empty grid geometry.
The complete suite covers payment policy, mixed tender, tip, manual/integrated terminal, unknown outcomes, transfers, receipts and retry guards.

Widget tests establish behavior and layout safety. They do not establish native visual acceptance.
The root agent must judge actual native captures against the selected source at the task's target sizes.
The prior iOS signing/runtime limitation remains separate. This task does not weaken credential storage or signing requirements.
