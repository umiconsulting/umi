# Category sales: hexagon chart

Date: 2026-11-07. Scope: optional home widget and category detail.

## Decision and instrument

**UMI inference.** Use a small inline SVG component with a fixed hexagon grid.
Keep exact amounts and category names in an HTML legend or table.
The chart needs polygons and deterministic cell allocation, rather than a chart framework.
This limited geometry justifies a local implementation without a new dependency.

| Instrument                | Evidence, version and licence                                                                                                                                                                                                  | Decision                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| React DOM with inline SVG | Local lockfile: React 18.3.1. React has an [MIT licence](https://github.com/react/react/blob/v18.3.1/LICENSE). [Official React documentation](https://react.dev/reference/react-dom/components) supports browser SVG elements. | Reuse the installed renderer. No installation or additional package maintenance.             |
| SVG                       | Browser platform, specified by [W3C SVG 2](https://www.w3.org/TR/SVG2/struct.html#DescriptionAndTitleElements). A platform standard has no package licence or package version.                                                 | Use `viewBox`, polygons and an accessible image name.                                        |
| Konva                     | Local lockfile: Konva 10.5.0 and react-konva 18.2.16. Konva has an [MIT licence](https://github.com/konvajs/konva/blob/10.5.0/LICENSE).                                                                                        | Keep the existing floor-plan use. Canvas adds an unnecessary rendering layer for this chart. |

**Evidence limit.** These sources confirm available APIs and licences.
Future maintenance commitments and formal SVG conformance were not verified.
No claim of future support is required for the selected platform implementation.

## Local truth: colour and financial meaning

**Local fact.** `merchant.product_category.color` stores the selected category colour.
The catalog repository reads this field and starts new categories on a curated palette.
The category editor validates six-digit hexadecimal colours and saves owner changes.
Sources: [catalog repository](../../apps/umi-api/src/modules/dashboard-catalog/dashboard-catalog.repository.ts),
[category editor](../../apps/umi-dashboard/src/screens/categories-workspace.jsx).

**Local fact.** The existing `SalesAnalysis` contract lacks category revenue and line money.
Its product options expose category identifiers and names, without colours.
Source: [analysis contract](../../packages/contract/src/sales-analysis.ts).

**Local fact.** The legacy product summary sums original cart prices and returns at most 200 products.
It is unsuitable for a category share of canonical net revenue.
Source: [operations repository](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts), product query near line 474.

**Local fact.** New receipts contain each line's original total and allocated discount.
Subtract the saved line discount from the original line total to match sales revenue without tips.
Source: [receipt construction](../../apps/umi-api/src/modules/pos-checkout/pos-checkout.service.ts), `receipt` near line 1540.

**Local fact.** Refund exception lines store separate merchandise, tax, discount, tip and total amounts.
The merchandise field excludes tax and precedes the discount adjustment.
Canonical analysis deducts the refund total without its tip.
Use each exception line's `total_minor_units - tip_minor_units` for the matching category deduction.
Sources: [exception repository](../../apps/umi-api/src/modules/pos-exception/pos-exception.repository.ts),
[analysis repository](../../apps/umi-api/src/modules/dashboard-operations/sales-analysis.repository.ts).

**Local fact.** Historical receipts can lack line discount allocations.
The exception repository refuses unavailable historical allocations instead of inventing them.
The analysis already declares that categories use the current catalog.
Sources: exception repository, `HISTORICAL_DISCOUNT_ALLOCATION_UNAVAILABLE`; analysis contract coverage.

**UMI inference.** Extend the canonical backend analysis rather than calculating financial allocations in the dashboard.
Join categories by merchant and product identity. Preserve an explicit unattributed amount when source detail is insufficient.
Keep categories without products, missing products and deleted categories distinct from a network failure.
Every attributed amount plus any disclosed residual must equal the canonical net total.

## Visual allocation and states

**Documented fact.** The Hamilton method floors proportional quotas, then assigns remaining units by descending fractional remainder.
Source: [US Census Bureau, methods of apportionment](https://www.census.gov/about/history/historical-censuses-and-surveys/census-programs-surveys/decennial-census/methods.html).

**UMI inference.** Allocate a fixed number of cells with that method when all category values are nonnegative and the total is positive.
Use stable category identifiers to break ties. Use integer arithmetic for monetary numerators.
Keep geometry stable across hover, focus and reload.
Cells approximate the proportions; amounts in the legend remain exact.
Calculate displayed percentages from the monetary ratio, independently of cell counts.
A small category can have no cell and still appear in the legend.
Do not force one cell per category or hide the remaining amount.

**UMI inference.** A zero total has no share denominator.
Show the confirmed empty state and retain any available amounts.
Negative category revenue cannot be represented honestly as part of a positive area mosaic.
For signed results, show exact signed amounts and an explicit chart limitation, or use a signed bar/table view.
Do not take absolute values or silently omit negative categories.
If the deployed API lacks the new category data, show unavailable rather than zero.

## Accessibility and interaction

**Documented fact.** Colour must not be the only way to distinguish information.
Source: [W3C WCAG 2.2, Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

**Documented fact.** A complex image needs a short identification and a textual equivalent of its essential information.
Source: [W3C WAI, Complex Images](https://www.w3.org/WAI/tutorials/images/complex/).

**Documented fact.** SVG provides `title` and `desc` for names and descriptions.
Source: [W3C SVG 2 document structure](https://www.w3.org/TR/SVG2/struct.html#DescriptionAndTitleElements).

**UMI inference.** Give the SVG one accessible image name and a short description of approximate shares.
Expose category names, exact amounts and percentages as ordinary HTML.
Use the saved colours without random reassignment or silent palette substitution.
Add an outline when a pale colour needs separation from its background.
If category rows navigate to detail, use links with visible focus and preserve dates, branch and refund criterion.
If hover highlights a category, keyboard focus must produce the same emphasis.
Repeated colours remain valid because the named legend carries the information.

## Verification targets

- Amounts reconcile with the canonical net total after discounts and partial refunds.
- Both refund date criteria retain their existing meaning.
- Legacy allocation gaps remain disclosed.
- Cell allocation is deterministic and fills the configured grid exactly.
- Zero, signed values, missing category data and network errors remain distinct.
- Saved category colours appear in both the chart and its legend.
- The widget can be selected, ordered and restored with the existing home controls.
- Real Chromium checks cover desktop, mobile, keyboard navigation and the detail link.

**Research route.** Local source, official React and SVG documentation, W3C accessibility guidance and Census method documentation supplied the evidence.
GitHub repository pages displayed navigation errors, but their tagged licence pages remained readable.
No independent testimony or third-party product claims informed this decision.
