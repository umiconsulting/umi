# The receipt as real paper: the format, and the roll that loops

Date: 11 October 2026, 14:40–14:55 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

Owner's ask, after the first pass: _just do a real receipt format — search online for pictures — and
make a simple animation where it is connected to another unseen ticket, and once it is printed it
shows the same ticket, like a loop. It breaks from the top from the other receipt, slides down as it
is being printed, and then the other slides in to take its place, but it is just the same._

## The format, from the pictures

Real thermal receipts, read off photos of café tickets (a Chinese café's roll, an Ofuna lunch
receipt, Soulmate Coffee, Playfoots, tuman café), agree on the same skeleton: a centred, bold
shop name with the branch under it; the transaction's fine print (reference, date, time, operator);
item lines with the price right-aligned; dashed rules between sections; subtotal, tax and an
emphasised total; the payment; and a centred thank-you over a barcode.

That is what the till draws now, in the platform's monospace face so the columns line up:

```
              UMIPOS LOCAL
             Sucursal Local
  - - - - - - - - - - - - - - - - - - - -
POS-ed247436-a329-4b41-b4ba-62a11365a18e
Fecha operativa: 2026-10-11  20:16:03.720
Operador: Propietaria UmiPOS
  - - - - - - - - - - - - - - - - - - - -
Chai latte
5 × MXN 72.00                    MXN 360.00
Galleta de chocolate
1 × MXN 38.00                     MXN 38.00
  - - - - - - - - - - - - - - - - - - - -
Subtotal                         MXN 398.00
Impuestos                         MXN 54.90
Total                            MXN 398.00
  - - - - - - - - - - - - - - - - - - - -
          ¡GRACIAS POR SU COMPRA!
        |||| ||||| |||| ||| |||||
```

The fine print is set small (11) — the size a real receipt uses, and the reason a 40-character
reference still fits when the dialog is a 375-pixel-tall phone at 2× text. The barcode is painted
from the receipt's own reference, so every sale's ticket differs and every copy of one is identical.

## The roll

Two tickets, one window. At rest the sheet is out and still. When a print starts, the strip advances
**exactly one ticket**: the sheet breaks from the one above it (their seam is the perforation), it
slides down as it is being printed, and the next ticket — the same document — slides in from the top
to take its place. The piece that leaves and the piece that arrives are the same widget with the same
content, so the loop is not an imitation of a loop: there is only ever one receipt.

`Movimiento: reducido` prints with no movement at all.

## One thing this cost, and the fix

The machine's chrome (slot, body padding, perforation) took about forty pixels of the paper's window,
and the monospace fine print made the reference three lines tall: on an 812×375 screen at 2× text the
focused reference no longer fitted inside the viewport, which an existing guard catches. The chrome
now shrinks on a short paper (`< 300`), and the fine print is set at 11, so the reference is two lines
inside a 129-pixel window. The guard passes again — it was doing its job.

## Verified

| Step                                                            | Evidence                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| The format at rest                                              | `00-real-receipt-format.png`                                   |
| `Imprimir recibo`: the roll mid-print, the next ticket arriving | `01-roll-mid-print.png`                                        |
| Settled: the same ticket, exactly where the last one was        | `02-settled-same-ticket.png`                                   |
| The job behind it                                               | `receipt_copy` (the reprint as a copy, from the previous pass) |

Tests: `receipt_paper_test.dart` now has four cases — static on open, feeds on the cue, reduced
motion, and the roll advancing one ticket onto an identical one. POS **704**, `flutter analyze`
clean.

Evidence: `docs/reports/evidence/2026-10-11-imin-receipt-roll/`.

## After the owner's second look

Two details out, one fixed:

- the **model plate** (`TM-T20III`) and the **feed button** are gone from the case.
  What is left of the machine's face is its lamp, so the strip above the mouth is
  18 pixels instead of 26 and the paper gains the difference;
- the closing line no longer gets eaten by the tear. The sheet's bottom edge is a
  zigzag six pixels deep, and when the document was scrolled to its end the
  thank-you sat inside those teeth. The paper now keeps `kReceiptTearDepth` (6)
  of extra room under its last line, so `¡GRACIAS POR SU COMPRA!` and the barcode
  can be scrolled fully clear (`06-thanks-and-barcode-clear.png`).

The lamp stays: it is the one thing on a printer's face that says what the
machine is doing, and it is what turns amber while the roll runs
(`04-lamp-amber-while-printing.png`).
