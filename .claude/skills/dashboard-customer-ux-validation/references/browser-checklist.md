# Dashboard Customer UX Browser Checklist

Run this checklist when a local Dashboard UI is available.

## Viewports

- Desktop: at least one wide viewport around 1440 x 900.
- Mobile: at least one narrow viewport around 390 x 844.
- Optional tablet: use when the sidebar or tables have custom breakpoints.

## Routes

- Customers list.
- Customer profile Overview.
- Customer profile WhatsApp or conversation detail.
- Customer profile Data tab.
- Insights memory/integration health.
- Conversations triage view, if present.

## Checks

- Sidebar selection and route transitions work without dead ends.
- Customer rows remain scannable; dense tables do not create unreadable wrapping.
- No text overlaps, clipped badges, clipped buttons, or horizontal scroll traps.
- Tabs fit or convert to an overflow/scroll pattern on mobile.
- Cash/Loyalty/Wallet states respect product entitlement.
- Diagnostics are collapsed, gated, or absent from owner views.
- Empty, loading, and error states preserve layout dimensions.
- Every insight has a drill-down or action target.

## Report Format

```md
- route:
- viewport:
- result: pass | blocker | non-blocking issue
- evidence:
- owner impact:
- recommended fix:
```
