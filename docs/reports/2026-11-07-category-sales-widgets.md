# Category sales widget

## Product requirement

The administrator needs a category view of sales on the configurable home screen.
The user supplied a hexagon chart as a visual reference.
The user selected net sales after discounts and refunds as the share denominator.
Use each category's saved color and provide a link to the detailed report.
Support every merchant through the existing report context and permissions.

## Implementation

- Add **Venta neta por categoría** to the available home widgets and the default layout.
- Preserve existing saved widget choices and order. Administrators can enable the new widget through **Personalizar inicio**.
- Preserve the selected dates, branch, comparison context and refund criterion in the detail link.
- Add the category section to the sales analysis menu.
- Show exact amounts, exact monetary shares and an approximate hexagon distribution.
- Select a category row to emphasize its cells. Preserve the report denominator.
- Show six rows on home. The detailed table initially shows twenty rows and has a control for more rows.
- Use category names, amounts and percentages alongside colors. Support keyboard selection and visible focus.
- Use the current catalog's category names and saved colors. Disclose this rule beside the chart.

## Financial invariants

The backend owns category allocation.
The existing report retains its dates, timezone, merchant scope, branch scope and authorization rules.
The new `byCategory` projection uses frozen receipt amounts after line discounts.
Refund amounts use committed exception totals without tips.
This matches the existing report's tax and refund treatment.
Both `sale_result` and `period_movements` retain their existing meaning.

Each category includes sales before refunds, refunds and net sales in integer minor units.
Category net amounts sum to the canonical net total.
The frontend verifies this equality before it renders the distribution.
Unknown line allocations appear as **Sin asignación verificable** with a disclosure.
Products without a current category appear as **Sin categoría**.
Conflicting historical allocations retain the complete event amount in the unallocated row.
The system never invents proportional financial allocations for incomplete receipts.

Contract version **2.53.0** adds an optional `SalesAnalysis.byCategory` array.
The optional field supports independent API and dashboard deployments.
An older API produces an unavailable message, rather than a false zero.
Zero totals produce an explicit zero state without a percentage chart.
Negative totals or negative categories retain exact amounts without a percentage chart.
Load failures use the existing error and retry flow.

## Visual method and tool choice

React renders native SVG polygons. No chart dependency was added.
The fixed grid uses largest remainders to allocate cells from exact integer amounts.
Stable category keys resolve equal remainders.
Small categories can have zero cells and retain their exact values in the list.
The gray background is decorative and has no financial meaning.
See the [research record](../research/2026-11-07-category-sales-hexagons.md) for sources and alternatives.

## Real data verification

The local candidate dashboard used the authenticated ONCA staging session in Chromium over CDP.
The candidate report ran through the actual repository and service against staging PostgreSQL.
Every database transaction used `BEGIN READ ONLY`, role `api`, and the authorized merchant and branch scope.
The adapter compared candidate totals with the live staging API before it returned the report.
This check made no business writes and used no production data.
The temporary transport adapter stayed outside the delivered application.

For October 9 through November 7, 2026, ONCA had 300 tickets and **MXN 42,111.00** in net sales.

| Category   | Saved color |     Net sales |
| ---------- | ----------- | ------------: |
| Masa Madre | `#800000`   | MXN 19,720.00 |
| Bebidas    | `#4363d8`   | MXN 16,360.00 |
| Pan        | `#f58231`   |  MXN 4,091.00 |
| Pizzas     | `#e6194b`   |  MXN 1,190.00 |
| Kombuchas  | `#000075`   |    MXN 750.00 |

The selected seven-day period had a real zero total.
The browser checks cover populated results, saved preferences, selection, navigation, mobile bounds, zero results and an absent category projection.
The checks also cover the loading state, an API failure and successful retry.
Three axe scans found zero violations. The browser reported zero JavaScript errors.
Screenshots and machine results are in `/tmp/umi-category-evidence` on the verification host.
The reproducible browser driver is `tools/ux-sweep/category-sales-browser.mjs`.
It requires an authorized local candidate API and a private session file.

## Automated verification

The new backend and allocation tests first failed because their implementation modules did not exist.
Backend tests cover discounts, exact partial refunds, both refund criteria, legacy gaps and uncategorized products.
Frontend tests cover deterministic cell allocation, tiny shares, negative values, missing projections and large integer amounts.
The PostgreSQL integration suite checks category totals, saved colors and existing tenant and permission behavior.

Tools: Node 22.23.2, pnpm 10.29.3, Vitest, Playwright 1.62.1, Chromium 153.0.8010.52, axe-core and PostgreSQL.
The canonical repository gates apply the existing lint warning baseline.

## Standards

The independent Standards review found zero material violations or code smells.
The review compared the feature with `b04a1ba4` and used the repository instructions.

## Spec

The independent Spec review found one selection issue across cached report changes.
A selected category absent from the new report could fade every cell.
The fix limits the active selection to categories present in the current report.
The reviewer confirmed the fix. Zero findings remain unresolved.
The financial and context requirements passed the review.

## Delivery boundary

The branch starts at `origin/staging`, commit `b04a1ba4`.
The pull request targets `staging`.
The deployed staging API currently lacks the new category projection.
The complete feature needs both the API deployment and the dashboard deployment after merge.
The dashboard preview remains usable with the older API and reports that the category breakdown is unavailable.
Production deployment requires separate authorization.
