# Native POS presentation review

Status: **in progress; the user has not accepted the native design**. The earlier Task 3 report and widget captures do not establish visual parity. Task 3B expands the work to the actual Stageshow screen compositions and preserves the existing native workflows.

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

These are functional observations. They do not establish visual acceptance. Earlier “tablet” captures used an 800×1340 logical viewport on a resized phone emulator with a 78.5-pixel cutout inset. That was an unsuitable presentation reference. The next visual review must compare the same logical geometry and screen content on a restored phone and a genuine tablet emulator profile.

The iOS app built and installed, but authenticated runtime remains unverified. Ordinary ad-hoc credential reads failed before entry, and the simulator rejected restricted keychain entitlements with AMFI error −424. The workstation has no valid signing identity. No authentication or credential-storage requirement was weakened.

## Verification

The latest focused run passed **114 tests** across catalog, full checkout, partial checkout, and role/navigation coverage. This includes partial cash keypad amounts, unchanged tender amounts, payment uncertainty/retries/finalization, and phone Settings return from both Sales and KDS. Analyzer reported no issues across seven changed source/test files. `git diff --check` passed.

The complete Flutter suite passed **1,230 tests**, with **five skipped** and **zero failures**, in 22 seconds using `flutter test --no-pub --reporter expanded`. No missed-tap warnings appeared. Both iOS workflows now run the full `flutter test --no-pub` suite before their existing build/signing steps. Workflow YAML parsing and inspection verified that only the test commands changed; no workflow was dispatched.

Reproducible commands, commit checkpoints, private log paths, native observations, and open reviewer findings are recorded in `.superpowers/sdd/2026-11-02-redesign-parity/task-3b-report.md`. Widget tests establish behavior and layout safety; actual screenshots determine visual acceptance.

## Contract limits and remaining work

Incoming-order contracts contain summaries, not product lines/options/notes or fulfillment details. Binding an incoming order does not hydrate its lines into the cart. Entry contracts do not provide the prototype's sample shift metrics or staff picker. Counts use loaded catalog data; no estimated counts, invented table geometry, or persistent favorites were added.

Before acceptance: inspect the new catalog scrim and payment shell on matching native/reference geometry; run the revised partial-payment flow through native input; compare all required screens with actual content; and resolve the iOS signing/runtime limitation or record it explicitly in the final handoff. No PR or completion claim is supported by this report yet.

## Scoped review follow-up

Round 2 restores the UMI wordmark in the phone partial-payment header and shares one read-only account-line widget between full and partial checkout. The phone assertion reproduced the missing mark before the fix. All 97 covering full/partial/terminal/local-first checkout tests passed, and analyzer reported no issues in the four scoped files. The preceding complete-suite count belongs to checkpoint `7e80993e`; this follow-up does not establish native visual acceptance.
