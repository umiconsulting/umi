# Native POS: selected Rediseño 2

Status: source corrections complete at `4bc6589a`. Root owns final Android screenshot acceptance.

The native POS now covers the 24 audit rows and the approved inline service follow-up. The work corrects composition and density across the existing operational surfaces. The final matrix is `.superpowers/sdd/2026-11-02-redesign-parity/task-3n-corrections-report.md`.

## Selected source

The selected prototype is `/Users/moon/Documents/umipos-redesign`, design 2, release `b1adc1e9`. Its current composition sources remain authoritative. Flutter uses its existing controls and Lucide registry. The product retains lowercase umi, IBM Plex Sans and the selected palette.

UNSLOP applies the approved direction. Its author is Damir Sokolovsky (@heydamir), under CC BY 4.0.

## Result

- The shared shell retains a 72 px collapsed rail and a 56 px header. Standard dark retains navy navigation.
- Sale uses the selected category, product, account and modifier hierarchy. Product names remain 18 px/600. Frequency uses actual terminal history.
- Service selection stays inside the catalogue. It preserves the current account before confirmation. Products remain visible during the decision.
- Account and payment routes retain the actual permitted navigation with payment callbacks blocked. Completion returns to the catalogue.
- Full and partial payment retain the selected portrait work areas at 800/820 px. The account region remains 304 px.
- Count uses the cash workspace, real register identity, all denominations and fixed total controls. Portrait tablets retain two denomination groups and a 256 px submit region.
- Tables preserve published geometry. Initial state reads remain neutral. Failed refreshes retain valid prior state. Same-account previews refresh without leases and reject older replies.
- Incoming, KDS, cash, Settings and hardware retain their command owners and recovery controls. Real receipts keep merchant branding and document height.

Contract 2.51, permissions, payment guards, partial balances, persistence, leases, offline operation and hardware remain authoritative. Incoming remains summary-only with manual ring-up. The source total stays separate from the POS cart total.

## Verification

SDK: official Flutter 3.47.5 at `/Users/moon/.local/opt/flutter-3.47.5/bin/flutter`.

| Check | Result | Log |
| --- | --- | --- |
| Final full suite | 1,288 passed, 5 existing skips, 0 failures | `/private/tmp/umi-design2-corrections-full-m1-final.log` |
| Final full analyzer | 0 errors, 0 warnings, 3 existing infos | `/private/tmp/umi-design2-m1-analyze-full.log` |
| Final order-entry checks | 23 passed | `/private/tmp/umi-design2-m1-order-entry.log` |
| D focused checks | 158 passed | `/private/tmp/umi-design2-d-focused.log` |
| Diff whitespace | Clean | `git diff --check` |

The infos remain in `inventory_repository.dart:76`, `cash_keyboard_test.dart:63` and `pos_entry_brand_test.dart:3`. The skips remain the five Linux AppImage cases.

## Checkpoints and limits

P2: `0a90e721`. A: `51eaab72`. B: `aee849ae`. C: `05794250`. D: `417129ce`.

Minor D review follow-up: `4bc6589a` makes the landscape service-selector insertions mutually exclusive when the keyboard is present. The added 1340 × 800 route case with a 200 px inset verifies one compact chooser, visible products and blocked additions with the account preserved. That route also passed before the guard because the outer shell consumes the inset; it does not provide RED/GREEN evidence for the internal conditional. The corrections report records this limit. The full suite ran once on the final source.

Root owns APK builds, emulators, fixtures, authenticated Android capture and final visual comparison. Widget tests establish their stated native client behavior and geometry. Physical device and provider outcomes remain separate runtime evidence. No backend, schema, fixture or production change is included.
