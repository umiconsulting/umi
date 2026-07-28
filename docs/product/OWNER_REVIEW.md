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

## Navigation

- Product selection opens a focused detail sheet; the cart survives navigation within the
  authenticated tenant, branch, and operator partition.

## Animations

- Existing subtle Material motion is retained and respects reduced-motion system settings.

## Typography

- Existing UMI semantic typography is retained; totals receive the strongest cart emphasis.

## Spacing

- The cart follows UMI spacing tokens and a 380-pixel desktop rail.

## Visual polish

- Review the cart rail and product-selection sheet on target pilot hardware before Gate 2E.

## Future observations

- Owner notes belong here. Do not turn this file into an implementation backlog.
