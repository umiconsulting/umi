# UmiPOS Owner Review

Updated: 2026-07-28

This is the owner-maintained visual and interaction review. Future product gates must read it
before implementation and preserve owner notes.

## Catalog

- Gate 2C catalog remains authoritative, branch-aware, paginated, and free of sample data.

## Cart

- Gate 2D adds a pinned desktop cart with server-returned lines, quantities, modifiers, notes,
  tax, discount preview, and totals.
- Checkout is visibly disabled until Gate 2E.

## Checkout

- Gate 2E uses a focused checkout sheet with server-repriced totals, payment selection, and a
  second explicit confirmation before payment.
- Cash can complete an online sale. External-terminal ambiguity is visually distinct and offers
  status lookup only—never a second payment.

## Payment

- Processing disables consequential controls. Unknown outcomes keep the correlation reference
  visible and provide no “retry payment” action.

## Receipt

- Completion presents the immutable server receipt number, lines, business date, and total.

## Navigation

- Product selection opens a focused detail sheet; the cart survives navigation within the
  authenticated tenant, branch, and operator partition.

## Animations

- Existing subtle Material motion is retained and respects reduced-motion system settings.
- Checkout transitions use bounded sheets and progress states rather than indefinite animation.

## Typography

- Existing UMI semantic typography is retained; totals receive the strongest cart emphasis.

## Spacing

- The cart follows UMI spacing tokens and a 380-pixel desktop rail.
- Checkout preserves a large primary confirmation target and separates cancellation from payment.

## Visual polish

- Review the cart rail, checkout sheet, and product-selection sheet on target pilot hardware
  before Gate 2F.
- Review receipt density and external-terminal recovery language on pilot desktop and tablet.

## Error handling

- Repricing changes require confirmation; unknown payment outcomes prohibit a new attempt.

## Button hierarchy

- Review totals → explicit confirmation → payment is the only primary path.

## Operator workflow

- The completed receipt closes into a fresh server cart. Ambiguous payments remain unresolved
  until their existing attempt is queried.

## Future observations

- Owner notes belong here. Do not turn this file into an implementation backlog.

## Offline and reconciliation

- Implemented: persistent connectivity state, encrypted provisional cash result, provisional
  receipt, replay progress, startup recovery, official mapping, conflict summary, and Recovery
  Center in English and Spanish.
- Future owner visual review: counter-distance indicator clarity, high contrast, tablet layout,
  reduced motion, keyboard/touch flow, conflict tone, blocked-device, expired-policy, stale-data,
  storage recovery, and the provisional-to-official receipt transition.
- Owner feedback remains pending. This record does not infer approval.

Recommended Mac review sequence:

1. Open the app online and load a valid offline policy.
2. Disconnect the network and complete an eligible cash sale.
3. View the provisional receipt, then return online.
4. Observe ordered replay and official receipt mapping.
5. Simulate a safe conflict and open the Recovery Center.
