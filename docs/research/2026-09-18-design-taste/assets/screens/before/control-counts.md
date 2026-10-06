# Click audit

Generated: 2026-09-18T16:25:23.607Z
Base: http://127.0.0.1:4000
Mode: classify-only — nothing was clicked

| Route                                                                                        | Controls | Safe | Destructive/disabled | Clicked | Errors after click                                                                                                                     |
| -------------------------------------------------------------------------------------------- | -------- | ---- | -------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                          | 23       | 23   | 0                    | 0       | 0                                                                                                                                      |
| `/operations`                                                                                | 46       | 44   | 2                    | 0       | 0                                                                                                                                      |
| `/orders`                                                                                    | 32       | 32   | 0                    | 0       | 0                                                                                                                                      |
| `/kitchen`                                                                                   | 27       | 25   | 2                    | 0       | 0                                                                                                                                      |
| `/reportes`                                                                                  | 34       | 34   | 0                    | 0       | 0                                                                                                                                      |
| `/cash-shifts`                                                                               | 23       | 23   | 0                    | 0       | 0                                                                                                                                      |
| `/catalog-inventory`                                                                         | 72       | 71   | 1                    | 0       | 0                                                                                                                                      |
| `/inventory-costing`                                                                         | 32       | 32   | 0                    | 0       | 0                                                                                                                                      |
| `/floor-plan`                                                                                | FAILED   |      |                      |         | page.goto: Navigation to "http://127.0.0.1:4000/floor-plan" is interrupted by another navigation to "http://127.0.0.1:4000/floor-plan" |
| Call log:                                                                                    |
| [2m - navigating to "http://127.0.0.1:4000/floor-plan", waiting until "domcontentloaded"[22m |

    at collectRoute (/home/jc/umi/tools/ux-sweep/lib/collect.mjs:475:18)
    at async main (/home/jc/umi/tools/ux-sweep/click-audit.mjs:196:19) |

| `/staff` | 50 | 42 | 8 | 0 | 0 |
| `/devices` | 28 | 28 | 0 | 0 | 0 |
| `/customers` | 47 | 47 | 0 | 0 | 0 |
| `/loyalty-value` | 49 | 48 | 1 | 0 | 0 |
| `/hours` | 49 | 44 | 5 | 0 | 0 |
| `/settings` | 70 | 68 | 2 | 0 | 0 |
| `/products-billing` | 20 | 20 | 0 | 0 | 0 |
| `/diagnostics` | 27 | 25 | 2 | 0 | 0 |
