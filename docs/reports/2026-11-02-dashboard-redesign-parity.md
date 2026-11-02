# Dashboard preservation and browser evidence

Date: 2026-11-02. Task: 1 of `docs/plans/2026-11-02-redesign-parity.md`.
Base: staging commit `b3e5bf882372eeb14c3c1b2658a6947df83c5051`.

## Result

The existing dashboard remains the implementation. This task changes tests and documentation only.
The original shell, routes, controllers, forms, permissions, and data hooks remain unchanged.
The browser cases required no layout correction.

The new suite uses the existing Playwright configuration and the actual React routes.
It uses real pointer input and rendered output in Chromium.
Its API responses are synthetic. They never write business data.
These tests prove client behavior. They do not prove service behavior, physical hardware results, or persisted data freshness.

## Reference comparison and retained controls

Read sources: `src/app.jsx`, `src/shell.jsx`, `src/styles.css`, `src/screens/login.jsx`,
`reset-password.jsx`, `ventas-report.jsx`, `recibos.jsx`, `settings.jsx`, `cash-shifts.jsx`,
`caja-turnos.jsx`, `registros.jsx`, `floor-plan.jsx`, `devices.jsx`, `inventory-hub.jsx`,
`inventory-workspace.jsx`, `inventory-item-editor.jsx`, `inventory-item-panel.jsx`, and `inventory-production.jsx`.

The design reference remains `/Users/moon/Documents/umipos-redesign`.
The comparison used its `sales-summary-windows.png`, `dashboard-auth-windows.png`, and `dashboard-iphone-business.png` captures.
The comparison also used its `docs/dashboard-parity-implementation.md`, `DomainPanels.tsx`, `FloorEditor.tsx`, and `data.ts`.
Prototype captures describe example states. They do not replace the existing behavior contract.

| Surface           | Controls and behavior retained from the real dashboard                                                                                      | Difference from the prototype                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Shell             | Navy sidebar, nested disclosures, collapse, drawer, scrim, merchant and branch context, account menu                                        | The original theme menu and locale control remain inside the product shell. Prototype view controls are separate.            |
| Theme and locale  | Umi, Oscuro, Medianoche; Español and English; saved browser preferences                                                                     | The prototype lacks the complete original shell controls.                                                                    |
| Login             | Full fish background, original hero sentence, supporting sentence, email, reveal, remember-email, locale, recovery, MFA                     | The original server-selected MFA method, challenge lifetime, errors, and session boundary remain.                            |
| Sales             | Four period buttons; summary, pivot, receipts; net sales; prior-period change; orders; average ticket; items; discounts; tips               | The prototype compresses the real supporting facts and charts into a smaller example report.                                 |
| Sales analysis    | Optional `useSalesInsight` narrative, hourly/daily series, payment mix, channel attribution state                                           | The prototype narrative is an example. The real screen keeps the narrative from the existing scoped API hook.                |
| Pivot             | Product, category, operator, and hour groups; sort buttons; units; net sales; percentages; totals                                           | The original pivot and its scroll container remain. Prototype grouping includes different example dimensions.                |
| Receipts          | Search; print-state filters; detail; lines; operator; business date; subtotal; tax; discounts; tips; tender; exceptions; controlled reprint | The original detail and print handlers remain. Prototype copies do not establish physical print results.                     |
| Settings          | Business identity; operational day and closing policy; customer segments; assistant voice; promotion dates/days; self-registration          | The original form boundaries and save handlers remain. Prototype fields do not replace these forms.                          |
| Brand and Wallet  | Logo upload, change, removal and preview; primary/secondary colors; contrast warning; pass preview; stamp reward; birthday reward           | The prototype report names logo and responsive Wallet preview as gaps. These original controls remain available.             |
| Branch settings   | Add branch; name/status; address search; map pin; latitude/longitude; aliases; description; individual saves                                | The original branch editor remains. Prototype example records do not replace its handlers.                                   |
| Cash              | Shift filters/detail; opening and count denominations; every count attempt; ledger; roles; custody history; blind-count rule                | The prototype shows example denominations and a reduced count detail. The complete original detail remains.                  |
| Checkout rules    | Manual terminal; mixed tender; dine-in without table; split-tip attribution; transfer switch and bank fields                                | The original validation and policy writes remain. Prototype local choices do not replace these rules.                        |
| Hardware          | Printer and cash-drawer inventory; transport; assigned device; health/report context                                                        | The dashboard keeps its existing read-only hardware boundary. The native POS owns physical configuration and drawer actions. |
| Floor editor      | Named areas/counts; palette; table shape/capacity; geometry; rotation; duplication; deletion; undo/redo; grid; zoom; published view         | The original canvas and callbacks remain. The existing suite tests actual drags, autosave, and publication.                  |
| Floor publication | Occupied-table refusal; account names; wait/cancel; close-and-publish; restored queue; version conflict                                     | The prototype simulates table release. The real screen keeps the existing queue and API commands.                            |
| Inventory         | Item views/search/filters; commands; selection; count; negative-stock policy; archive; adjustment; loss/damage                              | The original workspace remains. This task adds no parallel inventory logic.                                                  |
| Inventory editor  | References; type; units/decimals; stock policy; minimum/par levels; shelf life; initial cost; cost provenance; conversions; allergens       | Prototype gaps include full conversions, allergens, and cost provenance. The original editor retains these controls.         |
| Inventory hub     | Articles, recipes, preparation, costs/margins, purchases; existing permission gates                                                         | The prototype report names costing and preparation gaps. The real screens and server-plan handlers remain.                   |

This inventory records preservation, not a claim that every listed control received a new browser case.
The focused cases below cover the requested acceptance paths.

## New browser cases

The suite adds 11 cases in `apps/umi-dashboard/e2e/redesign-parity.pw.js`.
The helper is `apps/umi-dashboard/e2e/redesign-parity-fixture.js`.

- Sales narrative, net sales, and orders follow each period and a branch change.
- Both sales requests carry the expected `range` and `locationId` after each change.
- Every period and branch has different totals and narrative text.
- A null narrative hides its panel while summary, series, and mix content remain visible.
- Summary, pivot groups, receipts, and receipt detail remain reachable at desktop and both phone widths.
- Tablet rotation preserves the period and pivot view. Drawer dismissal preserves the view.
- Drawer navigation changes the route and closes the drawer.
- All three themes persist after reload. Both locales change the visible controls and persist after reload.
- Login reveal, remember-email enable/disable, email prefill, and password clearing use the existing controls.
- Recovery request, email-MFA, TOTP-MFA, invalid-code refusal, and reset confirmation use the existing forms.

Viewports: 402×874, 412×915, 820×1180, 800×1340, 1340×800, and 1440×1000.
Desktop and phone screenshots were opened and read.
The desktop login shows the original hero copy and the fish across the complete background.
The phone retains the original responsive rule: `.login-brand` is hidden, and its text remains in the document.
The phone background still covers the complete login surface.
The phone tables scroll inside their containers. The topbar retains its existing internal scroll behavior.

## Verification

Tools: Node 22.23.3; pnpm 10.29.3; Playwright 1.62.1; Vitest 2.1.9; Vite 5.4.21.
Sources: workspace lockfile, dashboard package scripts, existing Playwright configuration, and local verification playbook.
No test framework or production dependency was added.

```sh
export PATH='/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin':"$PATH"
UMI_PARITY_CDP=http://127.0.0.1:9222 pnpm --filter @umi/dashboard exec playwright test --config playwright.config.js e2e/redesign-parity.pw.js --reporter=line
pnpm --filter @umi/dashboard test
pnpm --filter @umi/dashboard exec eslint e2e/redesign-parity.pw.js e2e/redesign-parity-fixture.js e2e/inventory-quantities.pw.js
VITE_UMI_ENVIRONMENT=test VITE_AUTH_MODE=cookie pnpm --filter @umi/dashboard build
```

| Check                                                        | Result                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Focused suite with the committed configuration               | 11 passed; 0 skipped; 0 failed; 37.9 seconds            |
| Dashboard unit suite                                         | 43 files; 631 tests passed; 0 failed                    |
| ESLint for changed test files                                | Exit 0; no findings                                     |
| Production bundle with explicit test environment             | Exit 0; 330 modules; 3.21 seconds                       |
| Combined browser run after formatting and locator correction | 26 passed; 10 live-fixture skips; 0 failed; 1.7 minutes |

The plain build command first refused the absent `VITE_UMI_ENVIRONMENT`.
The explicit test environment then passed the existing build validator.
The build retained its existing warning for chunks above 500 kB.
This bundle check does not certify staging configuration.

The preferred Linux launcher uses `setsid` and a Linux Chromium path.
This macOS run used the installed headed Chromium with a dedicated profile and CDP port 9222.
The first background launch ended with its shell. A foreground process session supplied the working CDP endpoint.
The browser started only for these checks. Port 56452 and the prototype server were untouched.

The installed Chromium cache has revision 1243. The existing Playwright launcher requested absent revision 1234.
A temporary local configuration selected the installed executable for the existing floor tests.
The new parity cases and existing inventory cases used CDP. The floor cases used headed Chromium directly.
The temporary configuration only selected an executable and output directory. The committed configuration remains portable.

The existing recipe quantity test used `Cantidad del componente 1`.
The rendered original label is `Cantidad del ingrediente 1`, with value `1.25`.
Only that locator changed. The production label and quantity logic remain unchanged.
The first focused runs also corrected synthetic permissions and test selectors. They caused no production edits.

## Existing suites and external checks

The combined run reuses `floor-plan`, `inventory-quantities`, `recipe-sales-recovery`,
`inventory-import`, `inventory-initial-cost`, `inventory-mobile`, and `inventory-preparation` suites.
The successful cases include eight floor cases, four inventory quantity cases, three recipe recovery cases, and eleven new parity cases.

Ten live-fixture cases require separate local services and fixture manifests:

- Import: four cases require `UMI_IMPORT_FIXTURE`. The API/database case also requires `UMI_IMPORT_DATABASE_URL`.
- Initial cost: two cases require `UMI_INITIAL_COST_FIXTURE`, including an archived receipt-backed item.
- Mobile inventory: one case requires `UMI_MOBILE_FIXTURE`.
- Preparation: three cases require `UMI_PREPARATION_FIXTURE`.

These skips are not passes. No real credentials or live merchant records entered the new fixture.
The fixture matches current dashboard request paths and data hooks at the stated base.
Its receipt date is the synthetic test date, 2026-11-02. It is not a restored business dataset.
The parent task audits local database freshness separately.

Real-service narrative generation, authentication delivery, session cookies, inventory persistence, and server authorization remain separate checks.
Physical printing, drawer operation, Wallet delivery, and payment provider results also remain separate checks.

## Local screenshots

The focused run retains 24 PNG files under `/tmp/umi-dashboard-playwright-results/`.
The combined run uses `/private/tmp/umi-dashboard-final-browser-results/`.
These files are local evidence, not committed business data.
The suite regenerates them on each run.

Representative focused artifacts:

- `redesign-parity.pw.js-sale-a15a3--period-and-branch-controls/sales-desktop.png`
- `redesign-parity.pw.js-sale-c680d-ail-remain-reachable-at-402/summary.png`
- `redesign-parity.pw.js-sale-78f62-ail-remain-reachable-at-412/receipt-detail.png`
- `redesign-parity.pw.js-draw-0dfc6-n-the-sales-view-and-period/tablet-1340.png`
- `redesign-parity.pw.js-logi-e517e--email-and-recovery-at-1440/login.png`
- `redesign-parity.pw.js-logi-0b073-d-email-and-recovery-at-402/login.png`
- `redesign-parity.pw.js-rese-3cd0b-s-the-result-at-phone-width/reset-done.png`
