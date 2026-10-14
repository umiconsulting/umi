# The till's own display preferences, walked — and the money that wrapped at `Extra large`

Date: 11 October 2026, 07:35–08:05 MST. Device: iMin D3-504 running the Estación build rebuilt from
this tree (recipe at the end of `2026-10-11-imin-keyboard-stays-open.md`), API from this tree on
`:4013`, demo merchant, logical canvas 1396×737.

The walk covers `Ajustes` — appearance, text size, language, motion and the operator session — and it
found one legibility defect at the till's own `Extra large`: **the order panel's total wrapped
mid-number** (`MXN` / `245.0` / `0` on three lines). That is the panel's one job, so it was fixed in
source and re-verified on the hardware, including with a four-digit total and with a real charge.

## Every preference, exercised with taps

| Preference       | Options tried                             | What the till did                                                          | Persisted?                                 |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| Appearance       | `Follow system` → `Light` → `Dark`        | the whole shell and every surface repainted                                | yes, across a restart and an APK reinstall |
| Text size        | `Follow system` → `Large` → `Extra large` | every screen scaled; this is where the wrap below appears                  | yes                                        |
| Language         | `Español` → `English`                     | the shell, the catalogue, the checkout sheet and the receipt all follow    | yes                                        |
| Motion           | `Follow system` → `Reduced`               | transitions shorten                                                        | yes                                        |
| Operator session | `Lock operator`, `Sign out`               | lock asks for the PIN again; sign-out returns to `Enter your operator PIN` | —                                          |

The screen states its own contract — _These preferences are saved on this terminal and apply to all
its operators_ — and that is what was measured: the settings survived a process kill and the
`adb install -r` of a new build. The screen at `Extra large` is
`04-settings-text-size-extra-large.png`.

## The defect: a total that reads down three lines

At **English + `Extra large`**, the catalogue's order panel drew the total as
`MXN` / `245.0` / `0` — `00-before-order-panel-total-wraps.png`. The checkout sheet at the same text
size was fine; the panel, which is the number the operator reads while ringing, was not.

`_Total` in `apps/umi-pos/lib/features/catalog/catalog_surface.dart` is the row that draws **every**
money line of the panel — subtotal, tax, discount and the emphasized total — and it let the value
wrap like a sentence. The fix lays the amount out on one line and scales it **down** when the row is
narrow: `Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child:
Text(value, maxLines: 1, softWrap: false, …)))`. Nothing is ellipsized: a money figure that hides
digits is worse than a smaller one.

**Not** pinned by a widget test, on purpose. The first four attempts did not discriminate: the widget
harness hands the order panel the full window width, so the money always fits and the test passes
with or without the fix. A guard that cannot fail is worse than no guard, so the source fix is
verified the way the defect was found — on the till, at the real 1396×737 canvas.

## Verified on the hardware, after the rebuild

1. Same cart, same session restored (`Cliente Piloto`, `MXN 245.00`): the panel now reads
   `Total  MXN 245.00` on one line — `01-after-order-panel-total-one-line.png`.
2. A four-digit total, `MXN 1303.00`, also on one line, with the value scaled down instead of
   wrapped — `02-order-panel-total-four-digits.png`.
3. The checkout sheet at the same text size and the same four-digit total: every money row on one
   line, `Change due` and the commit button included — `03-checkout-sheet-four-digits.png`.
4. A real charge at `Extra large` still lands: `Cash received MXN 100.00` on a `MXN 72.00` bill →
   `Change due MXN 28.00` → `Paid · MXN 72.00`, `Received: MXN 100.00 · Total: MXN 72.00`
   (`05-paid-with-change.png`), committed as `merchant.pos_committed_sale` `a33548ef-17fb-44fe-bb9a-57277fd943a1`
   at 15:04:30 UTC. A second, larger charge committed the same way as `72837457-d5fb-43ed-93bd-73dd0bebc40e`
   (`MXN 1303.00`, exact tender).

`flutter analyze` clean, POS suite **692** pass (`catalog_test.dart`'s 10 included) before the APK was
built.

## Two things seen on the way, recorded and not called defects

1. **`Cobrar` on a customer-attached cart took two presses.** The first press left the API log with
   `POST …/checkout` 201 and `POST …/customer-value/preview` 201 and no commit; the second press, a
   few minutes later and with the value summary settled on screen, committed (`POST …/sales` 201).
   That is the designed order — review first, commit after — and not a failure, but the sheet says
   nothing about which press it is: it keeps reading `Loading value summary.` even once the summary
   is drawn and the commit is green.
2. **The order panel's `Borrar` (`Clear`) did not take while the cart carried a customer.** `Enviar`,
   `Borrar` and `Cobrar` were all hit-testable in the semantics tree and the cart kept `MXN 1303.00`
   across several presses, while the same cart went through a full charge and a `Nuevo pedido` reset
   fine. Not reproduced deliberately, so it is written down as an observation with no cause asserted.

Evidence: `docs/reports/evidence/2026-10-11-imin-display-preferences/`.
