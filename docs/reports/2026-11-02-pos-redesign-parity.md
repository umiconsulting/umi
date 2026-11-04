# Native POS presentation review

Status: **selected Rediseño 2 applied to checkpoint A; operational surfaces in progress**. Native screenshot comparison remains required.

## Selected Rediseño 2: checkpoint A

The selected source is `/Users/moon/Documents/umipos-redesign`, design 2, release b1adc1e9.
Current source CSS and final sale captures replace all prior Task 3B visual requirements.

Checkpoint A uses IBM Plex Sans, an expandable navy rail, a centered PIN console, horizontal category keys, and photo-free product keys.
Names use 18 px and weight 600. Nuevo pedido has a filled primary action.
The modifier workspace uses side-by-side groups and stacked option keys. Account lines use separate surface cards.
Dispatch, consumption details, authoritative balances and collection retain their original callbacks and guards.
All existing themes, locales, routes, permissions and product options remain available.

Frecuente means device-local adds. Up to three products with at least two saved adds span two rows.
The initial signal stays fixed during adds and search. Catalog order remains unchanged.
No real signal produces regular keys. No demo sales rank is copied into product code.

Official Flutter 3.47.5, tag 6a19cca564, Dart 3.13.4 ran **109 focused tests**, with zero failures.
Tests cover product geometry, frequency stability, catalog, modifiers, account layouts, entry/PIN, keyboard and role access.
The desktop horizontal-category assertion failed before the source change.
The modifier stack assertion failed before the source change.
The frequency regression failed with live re-ranking and passed with the fixed initial signal.
These tests verify behavior and layout safety. They do not establish native visual acceptance.

The remaining operational surfaces and complete-suite validation follow checkpoint A.
The prior evidence below describes earlier checkpoints and their separate limitations.

## Presentation checkpoint

The current native implementation covers the shared navigation and merchant header, catalog/categories/photos, product modifiers, entry/PIN, tables and accounts, incoming summaries, KDS, cash, settings, full checkout, and partial checkout. This coverage describes implemented surfaces, not accepted design.

The changes use restrained category colors, existing merchant/product data, Lucide navigation glyphs, tablet account panes, phone disclosures, and fixed payment actions. Full and partial checkout display actual account items, options, notes, sent state, totals, and the payment ledger. Tip controls remain governed by the existing policy. Collection, retry, finalization, and unknown-payment guards retain their original handlers.

The user rejected earlier installed results, including category saturation, menu hierarchy, and the overall portrait composition. Actual Android captures also exposed individual text background rectangles on products and a missing checkout rail. The latest checkpoint replaces the text rectangles with a continuous category-colored scrim, confines product labels to its protected region, and searches past nested header pages for the permitted checkout navigation. These corrections require another native comparison.

## Native workflow evidence

Android execution used an isolated app and a synthetic local database/API. The parent recorded:

- Native enrollment and PIN authentication.
- Seating two guests at M2 and receiving a public digital Americano/Croissant order for MXN 93. Replay produced exactly one order and one table link.
- Opening a cash shift with MXN 1,000 through the denomination counter.
- Blocking Latte addition without its required variant, then adding the medium/oat selection for MXN 87 and paying with MXN 100, change MXN 13.
- Respecting the cashier's absent order-fire permission. A supervisor sent takeaway account 004; sent-line quantity and edit actions remained disabled.
- Completing the Croissant at its kitchen station while the Americano remained queued at Barra.
- Resuming account 004 from the actual account list, collecting MXN 45 with MXN 100 received, and confirming MXN 55 change through the real local API.

These are functional observations. They do not establish visual acceptance. Earlier “tablet” captures used an 800×1340 logical viewport on a resized phone emulator with a 78.5-pixel cutout inset. That was an unsuitable presentation reference. Subsequent Android review uses a restored phone and an independent 2560×1600/320dpi tablet profile (1280×800 logical pixels) without viewport overrides.

The iOS app built and installed, but authenticated runtime remains unverified. Ordinary ad-hoc credential reads failed before entry, and the simulator rejected restricted keychain entitlements with AMFI error −424. The workstation has no valid signing identity. No authentication or credential-storage requirement was weakened.

## Current functional controls

- Exact Lucide control paths; actual variant price deltas and Included labels; shared persistent photo/menu-label preferences; Settings Back and real Printing policy controls.
- Opaque phone account workspace and continuous tablet pane. Ledger-backed paid/remaining values are separate from the commercial total. Parent Android evidence confirms account 005 at MXN 135 total, MXN 45 paid and MXN 90 remaining with a persistent UMI header. After returning from payment, stale paid/remaining values are removed immediately while the new ledger query is pending; a deferred-response regression verifies replacement with the new amounts.
- Incoming list/selected detail on tablet and selection/detail navigation on phone. Reference, customer, status and known age are separate. Header and navigation counts use the existing controller with entitlement/permission gating, 30-second refresh, scope/generation protection and disposal cleanup.
- List includes actual free physical tables separately from commercial accounts. Selected table accounts have read-only product and balance previews through existing account/ledger owners, with honest loading/unavailable states. Geometry and table operation handlers remain unchanged.
- Full and partial payment share the same icon/label/selected method tile. Product-photo scrims fully cover the left image seam before fading. These presentation changes await native comparison and do not establish aesthetic acceptance.

## Verification

The latest complete Flutter suite passed **1,240 tests**, with **five skipped** and **zero failures**, in 23 seconds using `flutter test --no-pub`. Added checks cover incoming entitlement/count/polling/disposal, free table presence without open commercial accounts, read-only account lines and deferred authoritative balance, phone incoming detail/adoption, and ledger visibility. Full checkout, partial payment uncertainty/retries/finalization, role access, map operations, and keyboard/200% text regressions remain covered.

Both iOS workflows run the full `flutter test --no-pub` suite before their existing build/signing steps. No workflow was dispatched. Reproducible commands, checkpoint commits, logs and reviewer findings are recorded in `.superpowers/sdd/2026-11-02-redesign-parity/task-3b-report.md`. Widget tests establish behavior and layout safety; screenshots determine visual acceptance.

## Contract limits and remaining work

Incoming-order contracts contain summaries, not product lines/options/notes or fulfillment details. Binding an incoming order does not hydrate its lines into the cart. Entry contracts do not provide the prototype's sample shift metrics or staff picker. Counts use loaded catalog data; no estimated counts, invented table geometry, or persistent favorites were added.

Before acceptance: compare the selected Rediseño 2 with affected native screens and actual content. The iOS signing/runtime limitation remains explicit. No PR or completion claim is supported by this report yet.

## Scoped review follow-up

Round 2 restores the UMI wordmark in the phone partial-payment header and shares one read-only account-line widget between full and partial checkout. The phone assertion reproduced the missing mark before the fix. All 97 covering full/partial/terminal/local-first checkout tests passed, and analyzer reported no issues in the four scoped files. The preceding complete-suite count belongs to checkpoint `7e80993e`; this follow-up does not establish native visual acceptance.

## Ledger correctness follow-up I1

The regression reproduced the old MXN 90 remaining after a successful additional MXN 45 partial payment with unchanged cart version. The fix invalidates displayed amounts on both checkout return paths before awaiting the ledger. The test verifies loading without old paid/remaining/button amounts, then MXN 90 paid and MXN 45 remaining after the delayed response. All **102 focused tests** passed; the two-file analyzer and diff check were clean. The full-suite count above belongs to checkpoint `209a6c55`. No footer restyling or further branding/KDS changes are included.
