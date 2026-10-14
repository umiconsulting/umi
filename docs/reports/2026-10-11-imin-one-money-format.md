# One money format, measured and enforced

Date: 11 October 2026, 09:00–09:15 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

The till wrote money by hand in nine places. It does not any more, and this is the measurement that
made the case, the rule's new address, and the test that keeps it.

## The measurement

Two screens, one morning, one till:

| Screen                                  | What it read   | Where the string came from                                        |
| --------------------------------------- | -------------- | ----------------------------------------------------------------- |
| `Centro de caja` → `VENTAS EN EFECTIVO` | `MXN 1,877.60` | `formatMinorUnits`, the app's declared single formatter           |
| `Ventas` → a committed sale             | `MXN 1303.00`  | a hand-rolled `'${currency} ${(minor / 100).toStringAsFixed(2)}'` |
| `Pedidos entrantes` → a web order       | `$330.00`      | a third hand-rolled division, in dollars                          |

Three shapes for the same kind of figure, one of them the wrong currency entirely
(`02-incoming-dollars-before.png`).

## The rule, and its new address

`formatMinorUnits` already existed and its own doc called itself "the only money formatter in the
app" — while it lived under `features/cash/`, where the catalogue, the checkout sheet, the sales list
and the printed receipt had no business importing it. It now lives in **`lib/shared/money.dart`**,
and `features/cash/money_input.dart` re-exports it so the cash screens keep their import.

Every displayed amount goes through it now: the catalogue's tiles, its frequent rail, the product
detail, the modifier deltas, the order panel's money rows, the compact cart total, the checkout
sheet, the sales list, the refund surfaces, the printed receipt document, the offline recovery
centre, and the incoming-order row that used to price in dollars.

## What stays hand-rolled, and why

Two sets, both deliberate:

1. **The checkout sheet's fourteen field pre-fills** (`cashApplied`, `cashReceived`, `cardAmount`,
   `terminalAmount`, `customTipPercent`, `customTipFixed`, `discountPercent`). Those strings are
   _input_: they are put into an editable field, read back as amounts, and some are handed to tender
   and terminal commands. They stay plain decimals.
2. **The thermal printer's renderer** (`thermal_printer_adapter.dart`). It builds receipt text for
   ESC/POS and its CP850 encoder maps any rune it does not carry to `0x3f` — a question mark. The
   formatter's minus is U+2212, so the printer keeps its own ASCII hyphen, and a printed `MXN -45.00`
   is correct for the paper even though no screen would write it that way.

## Keeping it

`test/money_format_test.dart` fails if any file under `lib/` gains a hand-rolled
`toStringAsFixed(2)` without appearing in its allowance, which is one entry with a count and a
reason. Checked both ways: restoring the dollar expression in the incoming-order row fails the test.

## A regression caught on the glass, and the test that now catches it

Converting the catalogue card's amount to the formatter left a second site in the same widget
prefixing the currency it no longer needed, and the till printed **`MXN MXN 45.00`** on every tile
(`04-tile-double-currency-regression.png`). No test noticed, because none of them read the tile's
money. That is fixed, and the widget test now asserts the tile's price is `MXN 45.00` and that no
text anywhere contains `MXN MXN`; it fails on the doubled version.

## Verified on the hardware

| Where                                  | Before                                       | After                                       |
| -------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| `Ventas`, the `MXN 1303.00` sale       | `MXN 1303.00`                                | `MXN 1,303.00` (`01-sales-now-grouped.png`) |
| `Pedidos entrantes`, the web order     | `$330.00`                                    | `MXN 330.00` (`03-incoming-mxn-after.png`)  |
| `La carta`, product tiles              | `MXN 45.00` (and `MXN MXN 45.00` mid-change) | `MXN 45.00` (`05-tiles-after.png`)          |
| `Centro de caja`, `VENTAS EN EFECTIVO` | `MXN 1,877.60`                               | unchanged (`00-cash-centre-grouped.png`)    |

POS suite **695** (the new guard included), `flutter analyze` clean.

Evidence: `docs/reports/evidence/2026-10-11-imin-one-money-format/`.
