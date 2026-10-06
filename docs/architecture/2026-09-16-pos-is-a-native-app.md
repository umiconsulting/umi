# The POS is a native app, and the KDS is a mode inside it

**2026-09-16.** Status: decided, supersedes the drift described below.

## Decision

1. **`apps/umi-pos` ships as a native application.** The Linux desktop build is the
   reference for the café tablet and the counter terminal; Android is the same app. The
   Flutter **web** build is a development convenience at most. It is not the product, it is
   not what an operator runs, and nothing may be verified through it as if it were.
2. **The kitchen display is a mode inside the POS.** There is no separate KDS application.
   `apps/umi-kds` is stale and is scheduled for removal by the plan's own §8H step 1 and
   §10 item 4; the unification ADR
   (`2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md`) is the standing decision, and
   `apps/umi-pos/lib/features/kitchen/kitchen_board_surface.dart` is its implementation.

## Why this needed writing down

Both halves of the title were already the written plan, and the work still drifted.

- The plan's measured baseline (§3.2) read the **native** POS through the Dart VM service.
  Then the harnesses that followed drove the **web** build over CDP, because a web page is
  easier to attach to. The instruments quietly redefined the product as the thing they could
  measure. Every POS number reported from that point — surfaces, touch targets, screenshots,
  the Mesas map — was measured on an artifact no café will run.
- The same drift produced the sentence "KDS as an app" surviving in conversation long after
  the ADR had unified it, which is how a stale artifact (`apps/umi-kds`) keeps costing
  attention.

The general failure is worth naming, because it will recur: **an instrument that is easier
to point at the wrong artifact will be pointed at the wrong artifact.** The rule that follows
is the plan's own §4 bar applied to the tooling, not just the code: measure what the operator
runs.

## What this changes

- **The runtime of record for POS verification** is `flutter run -d linux` (debug, so the
  Dart VM service is published) with the app's `--dart-define` set, exactly as
  `scripts/umi-pos-firefox.sh` does for the web build. The semantics inventory
  (`tools/ux-sweep/pos-semantics-inventory.mjs`) is the native instrument; the CDP-based
  `pos-surfaces.mjs` describes the web build and is a development aid, not the gate.
- **Native-only capabilities are not negotiable.** The till's reason to exist is the
  hardware: the receipt printer, the cash drawer, the scanner, and the customer display are
  reached through native plugins. A browser cannot be the product for a terminal whose job
  includes opening a drawer.
- **A web build may be used for convenience only** — a quick look at a layout while
  iterating — and never to claim a POS surface, a touch target, or a flow has been verified.

## Consequences to accept

- The native path is slower to drive: `patrol` has no Linux platform (its pubspec declares
  `android, ios, macos, web`), so `integration_test` driving the Linux app, or the Dart VM
  service's semantics dump, is the available instrument. That cost is the price of measuring
  the real client, and it is smaller than the cost of the wrong measurements above.
- Any reported POS figure predating this note was measured on the web build and should be
  re-measured natively before it is trusted.
