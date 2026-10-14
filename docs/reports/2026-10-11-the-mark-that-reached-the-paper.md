# The mark that reached the paper

> **Environment note (added after the fact).** Every measurement below was taken against a second
> local API on `:4013` and a clone of the demo database, because that is where the till was pointed at
> the time. The setup has since been consolidated onto **one API (`:4001`) and one database
> (`umi_local`)** — see [one API, one database](2026-10-11-one-api-one-database.md) for what that took
> and what it broke. The findings and the fixes below are unchanged; only the addresses moved.

Date: 11 October 2026, 22:00–23:30 MST. Device: iMin D3-504 (`co.umiconsulting.umi_pos.estacion`),
Epson TM-T20IIIL on its USB host port, ONCA demo merchant, API from this tree on `:4013`.

The owner had asked for the café's own mark at the head of the ticket, and the day before this session
the till had been given every piece of it: `ReceiptPrintPayload.logoUrl` (contract 2.28.0), the
ESC/POS rasteriser (`thermal_logo.dart`, `GS v 0`), the fetch-and-decode step at print time, twelve
tests including ONCA's real PNG, and the receipt drawn with the jaguar **on screen**. What had never
happened was paper. This is the report of what the last mile actually needed — and it was four
separate things, each of which alone would have kept the mark off the paper.

## 1 · The server rebuilds the receipt, and it did not copy the mark

`POST /hardware/commands` with `commandType: print_receipt` **discards the client's
`printPayload`** and rebuilds it from the stored receipt snapshot
(`PosHardwareRepository.authoritativePrintPayload`). That is deliberate and stays: a till must not be
able to print a receipt nobody issued.

That function never read `merchantLogoUrl` out of the snapshot, so every printed ticket came out
without the mark while the same receipt showed it on screen — the two artefacts were built by
different code. Measured in the database, on a job that printed successfully:

```
select jsonb_object_keys(safe_document->'printPayload') …
  items footer qrValue tenders currency receiptId businessDate locationName
  merchantName registerName receiptNumber taxMinorUnits tipMinorUnits loyaltySummary
  exceptionMarker totalMinorUnits changeMinorUnits discountMinorUnits subtotalMinorUnits
  customerValueSummary
-- no logoUrl key at all
```

The snapshot had it all along:
`snapshot->>'merchantLogoUrl' = http://127.0.0.1:4013/logos/e6b14af1…-8897324fdb0ca066.png`.

**Fix.** The authoritative payload carries it, taken from the snapshot that froze it at commit — the
URL the customer's copy showed, content-addressed and public — and dropped when the café has no mark.

## 2 · The till registered the printer as unable to draw a picture

Even with the URL in the payload, the renderer is guarded:

```dart
if (logoRaster != null && !logoRaster.isEmpty && capabilities.contains('printer.image'))
```

The registration dialog wrote the capability list for a receipt printer as
`printer.receipt, printer.qr, printer.cut, printer.test_page` — in **both** places it builds one: the
manual form and the USB quick-register. So the till claimed its own printer could not print an image,
and then believed itself.

**Fix.** Both lists carry `printer.image`. A receipt printer this product talks to is an ESC/POS head
and `GS v 0` is the one command in the family every one of them implements.

For hardware registered by an older build the capability is a fact in `merchant.hardware_device`;
re-registering the printer from the hardware centre (the USB quick-register on an existing
`public_reference` updates the row) is what brings it forward. The ONCA printer was brought forward
by hand for this test, and its `receiptWidthColumns` corrected from the form default 42 to 48 — the
80 mm head's real setting, which the quick-register path already wrote.

## 3 · A raster draws from the left margin, so the mark was not centred

The owner's next report, on paper: _"el ticket de venta sale el logo alineado a la izquierda, debe ser
centrado"_. `GS v 0` draws from the left margin, and this family ignores the justification setting for
a raster; the mark is built 384 dots wide (the 58 mm head's full width) and the TM-T20III's head is
576, so the picture landed against the paper's left edge while every line under it was centred.

**Fix.** `ThermalRaster.centredOn(paperWidthDots)` pads the 1-bit layout with white dots so the ink
lands in the middle — the one method that is true of every head, because it asks the head for nothing
it might ignore. The paper's dot width comes from the columns the printer is already configured
with, at the standard font's twelve dots per column (32 columns → 384 dots for 58 mm, 48 → 576 for
80 mm), and a head configured narrower than the mark keeps the mark as it is rather than cropping it.

The padding moves in whole bytes, eight dots, so a mark whose width is not a multiple of eight can sit
up to four dots — half a millimetre — off true centre. That is as fine as this layout allows.

## 4 · A duplicate that did not say so

`Imprimir recibo` in Ventas printed a receipt that had never been printed before, so the till took the
`original == null` branch and made an `official_receipt` job: the paper carried no legend. The owner's
report: _"se supone que fue una reimpresión pero no dice la leyenda de COPIA"_.

The rule the till now follows is the one the market follows, and the one the owner named: **the paper
the sale printed is the original; anything printed afterwards is a copy, and the person holding it has
to be able to tell.** This path is reached only from the sales history, so the flag lives in
`printAuthoritativeReceipt` rather than at its call site — a second caller would otherwise inherit an
unlabelled duplicate.

`HardwareCommandRequest.copy` is the one fact about a print that no content can carry (whether this
paper is the original the sale printed or a duplicate made afterwards), so it travels beside the
receipt and the server turns it into `ReceiptPrintPayload.copy`. The head prints **COPIA** when the
payload says so or when the command is a controlled reprint of an existing job. The flag is part of
the command fingerprint on both sides — a print that says COPIA is not the print that says nothing —
and `null` is accepted as "no", because the generated client bindings write an absent optional field
as an explicit `null` (measured: a 400 `VALIDATION_FAILED` with `copy: null` on the wire).

## Also fixed while here

The receipt dialog could not report a failed print at all. `printAuthoritativeReceipt` threw a bare
`StateError` into an unguarded `await`; the surfaces that print catch `AppException`, so the refusal
escaped through an unhandled async gap. The dialog now takes an `onFailure` callback, the sales
screen catches and reports, and the operator reads a sentence inside the dialog they pressed:

> El servidor no aceptó el formato de esta operación. Actualiza la pantalla y vuelve a intentarlo; si
> sigue igual, avisa a soporte.

— measured on the till, in the dialog, while this work was in flight (it was that sentence that named
the `copy: null` mismatch).

## Proof

```sql
select job_type, safe_document->'printPayload'->>'logoUrl', safe_document->'printPayload'->>'copy',
       (select status from merchant.hardware_print_job_event e
         where e.print_job_id=j.id order by sequence desc limit 1)
  from merchant.hardware_print_job j order by created_at desc limit 1;
```

```
 official_receipt | http://127.0.0.1:4013/logos/e6b14af1…-8897324fdb0ca066.png | true | printed
```

Thirteen tests in `thermal_logo_test.dart` (including ONCA's real PNG and the new centring case),
`hardware_service_test.dart`'s fingerprint pair, 743 tests in the app, 1810 in the API.

## What is still the café's to set

`printer.image` is a claim about a device, and the console writes it at registration. A café whose
printer was registered before this change has a row that says its head cannot draw a picture; the
hardware centre's re-register path is what updates it. The console should surface the capability list
for an existing device instead of relying on a re-register to change it — that is the follow-up this
report leaves open.
