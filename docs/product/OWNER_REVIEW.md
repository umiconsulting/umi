# UmiPOS Owner Review

Updated: 2026-08-03

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
- Implemented: a trusted device asks only for the personal operator PIN.
- Implemented: operator lock returns to the PIN surface for a cashier-to-manager handoff.
- Review the PIN keypad size, focus order, and lock action on pilot desktop and tablet hardware.

## Future observations

- Owner notes belong here. Do not turn this file into an implementation backlog.

## Offline and reconciliation

- Implemented: persistent connectivity state, encrypted provisional cash result, provisional
  receipt, replay progress, startup recovery, official mapping, conflict summary, and Recovery
  Center in English and Spanish. Final closeout adds typed executable recovery actions and
  restart-safe recovery of an already journaled checkout.
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

## Gate 3A sale lifecycle

- Implemented: one active editable sale for each tenant, branch, and operator.
- Implemented: start, suspend, rename, resume, cancel, restart recovery, and next-sale creation.
- Implemented: customer attach and detach. CRM, loyalty, and payment behavior stay separate.
- Implemented: suspended, committed, and cancelled sale navigation with search, sort, and filter.
- Implemented: official and provisional receipt navigation. Printer hardware stays outside Gate 3A.
- Implemented: safe sale suspension before operator lock, logout, or branch reselection.
- Review on pilot hardware: consecutive-sale focus, suspend labels, cancellation wording, and
  receipt density.
- Review keyboard and touch use on desktop and tablet. Owner approval remains pending.

## Gate 3B advanced checkout

- Implemented: cash entry, exact payment, denomination shortcuts, change, and server totals.
- Implemented: manual terminal states. The UI does not claim provider authorization.
- Implemented: mixed cash and manual-terminal tender with a visible server balance.
- Implemented: preset and custom tips, order discounts, reasons, and manager approval.
- Implemented: receipt destination, payment recovery, and automatic next-sale transition.
- Implemented: unknown terminal outcomes remain visible and query-only after restart.
- Review on pilot hardware: keypad speed, tender density, change emphasis, and dialog focus.
- Review on tablet: mixed tender layout, tip controls, discount controls, and text scaling.
- Review the English and Spanish recovery tone with cashiers and managers.
- Owner approval remains pending. Gate 3B does not include final UX certification.

## Gate 3C cash shift and register operations

- Implemented: the assigned register and the current shift status remain visible.
- Implemented: the opening flow supports zero or total opening float.
- Implemented: Paid In, Paid Out, Safe Drop, suspend, resume, and no-sale requests.
- Implemented: handoff authenticates the incoming operator by PIN and requires a new PIN entry.
- Implemented: blind count hides expected cash until the server accepts the count.
- Implemented: the variance view distinguishes expected, counted, tolerance, and difference.
- Implemented: recount preserves each prior count and manager approval binds to one variance.
- Implemented: reconciliation and close use explicit confirmation and immutable server results.
- Implemented: restart recovery restores the current shift, count, variance, and reconciliation.
- Implemented: response-loss recovery queries the original cash command before a retry.
- Implemented: a policy threshold requests a manager PIN before final close.
- Review on pilot hardware: opening speed, denomination density, and movement reason selection.
- Review on tablet: Cash Center action density, count entry, text scaling, and dialog focus.
- Review the English and Spanish terms for Paid Out, Safe Drop, and variance with operators.
- Owner approval remains pending. Gate 3C does not include final UX certification.

## Gate 3D refunds, voids, and post-sale exceptions

- Implemented: recent committed sales expose a server-authorized post-sale action.
- Implemented: the server distinguishes a narrow void from a full or partial refund.
- Implemented: partial refunds show remaining quantities and use accessible quantity controls.
- Implemented: the preview separates historical tax, discount, tip, cash, and terminal effects.
- Implemented: full refunds and voids require an explicit restock decision.
- Implemented: sensitive actions request a different manager PIN through the current PIN system.
- Implemented: the terminal flow states that UmiPOS does not prove the provider result.
- Implemented: an unknown terminal result blocks replacement action and keeps the reference.
- Implemented: the final receipt is a separate immutable compensation receipt.
- Implemented: restart and response-loss recovery query the original command result.
- Review on pilot hardware: partial-line density, reason selection, and confirmation wording.
- Review on tablet: restock controls, terminal states, text scaling, and dialog focus.
- Review English and Spanish terms for void, refund, and inventory intent with operators.
- Owner approval remains pending. Gate 3D does not include final UX certification.

## Gate 3E inventory authority

- Implemented: the catalog displays server-issued availability for the current location.
- Implemented: low, unavailable, unknown, and policy-blocked states have safe operator copy.
- Implemented: checkout creates a reservation and validates it again during the atomic sale commit.
- Implemented: the POS preserves the cart after an inventory conflict.
- Implemented: direct items, variants, recipes, configured modifiers, and bundles use versioned rules.
- Implemented: Inventory Operations shows on-hand, reserved, available, and immutable history.
- Implemented: authorized operators can request adjustments, waste, damage, and quarantine release.
- Implemented: sensitive mutations request an independent PIN approval.
- Implemented: refund commit preserves the immutable restock intent. A separate approved inventory command consumes the original sale effect.
- Implemented: a prepared product does not return ingredients without an explicit component review.
- Implemented: the count flow hides expected stock until submission.
- Implemented: the variance view requires a reason before reconciliation.
- Implemented: reconciliation creates count-correction facts. It does not overwrite an observation.
- Implemented: inventory recovery queries the original command before a retry.
- Implemented: direct inventory operations are online-only.
- Review on pilot hardware: quantity-entry speed, unit labels, and count scanning distance.
- Review on tablet: action density, long item names, text scaling, and variance reason controls.
- Review English and Spanish terms for on-hand, quarantine, waste, and restock.
- Owner decision: define production thresholds for adjustments, waste, variance, and low stock.
- Owner decision: define the allowed disposition for prepared products and packaging.
- Owner approval remains pending. Gate 3E does not include final UX certification.

## Gate 3F customers, loyalty, and stored value

- Implemented: merchant-scoped search, recent customers, minimal creation, attach, detach, and anonymous sales.
- Implemented: contact masking and separate receipt, loyalty, and marketing consent.
- Implemented: immutable points, wallet, and gift-card facts with server projections.
- Implemented: temporary reward and stored-value authorization with release and recovery.
- Implemented: atomic checkout effects and proportional refund reversals.
- Implemented: Customer Center with keyboard, touch, pointer, English, and Spanish behavior.
- Implemented: historical policy binding, one earn engine, reward scope, usage limits, and automatic expiry.
- Implemented: reward replacement requires confirmation and releases the prior authorization once.
- Implemented: manual points adjustment and protected gift-card issuance with one-time code delivery.
- Implemented: one canonical allocation and fingerprint bind wallet, gift-card, cash, and terminal tenders.
- Implemented: wallet payment, gift-card payment, mixed tender, and funded gift-card activation commit atomically.
- Implemented: a reward approval binds the manager, exact preview, tender fingerprint, expiry, and one-use state.
- Implemented: distributed lookup limits, permission-bound global history, signed cursors, and 26 real database races.
- Review: explain pending points, reward incompatibility, stale authorization, approval expiry, lockout, and recovery.
- Review on pilot hardware: search speed, duplicate warnings, masked contacts, and checkout value density.
- Review: confirm wallet and gift-card amount selection and tender redistribution before payment.
- Review: confirm the one-time gift-card code, unavailable-result state, and response-loss guidance.
- Review: confirm global history visibility, mixed-tender clarity, refund reversal, and operator confidence.
- Review: approve the English and Spanish customer-value text.
- Owner decision: define the earn rate, reward limits, wallet issuance, and gift-card limits.
- Owner decision: define the partial-refund policy for rewards.
- Legal review: approve consent text, retention, anonymization, and gift-card expiry rules.
- Engineering validation is complete. Owner approval and final UX certification remain pending.
