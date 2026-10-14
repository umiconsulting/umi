# The receipt as the ticket component the owner asked for

Date: 11 October 2026, 13:11–13:16 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

Owner's ask: _when you charge and `Ver comprobante` appears, the receipt should be that component
that got popular online — the ticket shape with a print animation; look in the component
libraries._

## What it is

The component is the **Payment Receipt Printer** from EasyUI: an animated React/Tailwind receipt with
thermal paper extruding from the slot, chassis micro-vibration and a replay control
([EasyUI · Payment Receipt Printer](https://www.easyui.site/components/payment-receipt-printer)).
The same family has two more: [intframe/thermal-receipt](https://github.com/intframe/thermal-receipt),
where each line develops from pale to ink as the paper advances, and the
[Receipt Card from CleverUI](https://cleverops.com.au/components/cards/card-receipt), which has the
perforated edge and the stamp but no feed.

**They are React and Tailwind; the till is Flutter**, so nothing was installed — the _behaviour_ was
re-made in the app's own tokens, with no new dependency.

## What the till does now

`lib/shared/widgets/receipt_paper.dart` wraps the receipt document in the machine and the paper:

| Beat                                | How                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sheet **feeds out of the slot** | a clip that reveals the top of the document, so the paper — not a fade — is what appears                                                                                                |
| It moves like a **stepper motor**   | the eased progress is quantized to 3-logical-pixel steps, the advance a thermal transport really takes                                                                                  |
| The head **works**                  | the slot shakes about a millimetre, twice per step, only while feeding                                                                                                                  |
| The paper reads as **paper**        | the machine body is `surfaceContainerHighest` and the sheet is `surface`, and the leading edge is a zigzag clip, so the tear travels with the paper and flattens when the sheet is done |
| `Movimiento: reducido`              | the sheet is already out on the first frame and nothing is scheduled — the display preference, not a second setting                                                                     |

The animation is on the _dialog_, so the receipt the cashier reads, the one printed from `Ventas` and
the one in `Pagado → Ver comprobante` all open the same way.

## Two things the walk taught

1. **The first version was invisible.** The paper was `surface` and the dialog behind it was
   `surface` too: the strip and its torn edge had nothing to contrast against. The machine body
   (`surfaceContainerHighest`) is what makes the paper a sheet.
2. **The obvious way to animate it broke the receipt.** Wrapping the document in
   `Align(heightFactor:)` loosens the constraints, so the lazily built viewport re-measured itself
   unbounded: eight tests of `receipt_document_long_test.dart` failed — 500 lines built at once and a
   12 356-pixel overflow. The fix keeps the height the dialog gives (a `SizedBox` of
   `dialog − slot`) and clips only pixels, so the document stays lazy.

## Verified

On the hardware, mid-feed and finished: `00-paper-half-out.png` catches the sheet half out with the
serration travelling along its bottom edge (`Impuestos` cut into teeth, `Total` not yet out), and
`01-sheet-complete.png` shows the finished ticket at `Total MXN 398.00`.

`test/receipt_paper_test.dart` pins both halves of the behaviour — the head moves while feeding and
rests when done, and reduced motion schedules no frame at all — checked both ways: neutering the
shake fails it. POS suite **701**, `flutter analyze` clean.

## Open

1. The **dashboard**'s `Recibos` screen could take the actual React component, since there the stack
   is React — this report only covers the till.
2. The **kitchen ticket** on `orders/fire` still prints nothing (the attached printer does not
   declare `printer.kitchen_ticket_foundation`), so the feed animation has no counterpart there yet.

Evidence: `docs/reports/evidence/2026-10-11-imin-receipt-as-ticket/`.
