# Centro de caja — interactive reference

`index.html` is a working reference implementation of the superset design. It is
not product code. It exists to be judged, criticised, and then ported.

## Open it

Open `index.html` in a browser. No build step and no server are needed.

## Run the self-check

```sh
cd docs/design/centro-de-caja
node qa.mjs            # checks + screenshots into ./shots
node qa.mjs --no-shots # checks only
```

The script drives the real page with Chromium and reports:

| Check    | Rule                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| Layout   | no horizontal overflow and no clipped content at 1440×900, 1280×800, 1024×768, 900×720, 480×900 |
| Contrast | WCAG AA (4.5:1, or 3:1 for large text) in light and dark                                        |
| Touch    | every control is at least 44×44 px                                                              |
| Names    | every control has an accessible name                                                            |
| Type     | no text below 11 px                                                                             |
| Keyboard | `⌘K` opens the palette, `/` focuses search, controls are reachable                              |
| Flow     | count → variance → PIN → reconcile → close → deposit, plus the count-cancel guard               |

Last run: **0 errors, 0 warnings**.

`PLAYWRIGHT_PATH` overrides the Playwright location. `CHROME_BIN` selects the
browser binary.

## What it proves

**The equation is computed, not printed.** `app.js` derives the expected cash by
summing the ledger's effects in minor units. Change a movement and the equation,
the expected value, the variance, the deposit, and the arqueo all move together.
The footer asserts the tie: "El libro suma $3,430.00 ✓ coincide con el esperado".

**The three High findings are closed.**

1. _Close approval compares the variance._ The rule reads
   `Cierre con PIN si la diferencia > $5.00`. Expected cash is never compared to
   a threshold. The flow test proves the boundary: a $5.00 difference passes
   without a PIN, a larger one does not.
2. _The count has an exit._ `Cancelar conteo` returns the shift to open, guarded
   by the ledger sequence. The block on new cash sales during a count stays.
3. _A missing policy is a visible state._ Choose the "Sin política" scenario:
   the header turns red, the pills explain the denial, and every action
   disables.

**Every competitor's best element is present.** See the source tags in
[superset v1](../../2026-09-29-centro-de-caja-superset-v1.md) §2.

## What each block becomes in the product

| Artifact block                | Flutter home                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| Identity bar and policy pills | `features/cash/cash_surface.dart` → `_StatusCard`                   |
| Equation strip and answer     | new widget; reads `ExpectedCash` and `CashVariance`                 |
| Drawers, shifts, deposit      | `_OpenShiftSection`, `_ActiveShiftSection`                          |
| Ledger table and filters      | new; `CashLedgerEntry` already exists in the contract               |
| Reconciliation panel          | `_VarianceCard`, `denomination_counter.dart`                        |
| Actions and custody           | `_ActionGrid`, `_AdoptShiftSection`, `_ReclaimRegisterSection`      |
| Close steps and CTA           | `_CloseStep`, `_StepAction`                                         |
| Count dialog                  | `denomination_counter.dart`, `_count()`                             |
| PIN dialog                    | `_noSale`, `_movement`, `_resolve`, `_close` already use this shape |
| Scenario switcher             | not ported; it is a review tool                                     |

Porting is mechanical because the artifact consumes the same field names as
`packages/contract/src/pos-cash.ts`.

## Known deviations

- **Filter chips are 44 px, not 48.** The design language sets a 48 px floor for
  controls. A seven-chip filter row at 48 px pushes the journal below the fold
  on a 1024×768 terminal. The chips meet Apple's 44 pt floor and the QA check
  enforces it. Decide this in the design pass.
- **The rail scrolls internally.** Every panel keeps a fixed region and scrolls
  its own content, so nothing is ever clipped by the viewport. A future pass may
  cut content instead.
- **Dark mode primary text on brand.** The product ships white text on the vivid
  blue `#2E7DFF` (3.5:1). The artifact uses `#1F6AE8` for filled buttons to
  reach AA, and keeps `#2E7DFF` for accents, borders, and tints. If the product
  keeps the vivid fill, the label must grow to 18.66 px bold or larger.
- **No offline cash.** The artifact shows the offline state as read-only, which
  matches the current backend. The policy flag is still unimplemented.

## Files

- `index.html` — structure and the dialogs
- `styles.css` — tokens, layout, and the responsive rules
- `app.js` — data, the money model, the flows, and the palette
- `qa.mjs` — the self-check
- `shots/` — the screenshots the self-check produced (git-ignored; regenerate
  with `node qa.mjs`)
- `split.html` — the till-versus-back-office decision board. 66 elements, each
  with a recommendation, a rule, and its form on both sides. Open it, change
  what you disagree with, and press **Copiar la decisión**. The record of the
  recommendation is
  [../2026-09-29-till-vs-backoffice-cash-boundary.md](../2026-09-29-till-vs-backoffice-cash-boundary.md).

Run the same self-check against the board:

```sh
ARTIFACT_URL="file://$PWD/split.html" QA_SKIP_FLOW=1 node qa.mjs
```
