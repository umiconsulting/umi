# `Imprimir recibo` works as a copy, and the paper moves when it prints

Date: 11 October 2026, 14:05–14:15 MST. Device: iMin D3-504, Estación build from this tree, API from
this tree on `:4013`, demo merchant.

Two corrections from the owner, both measured on the hardware:

> _cuando me voy a ventas y reimprimir recibo no funciona, ahí también debe funcionar como
> reimpresión de copia […] la animación no es cuando se carga sino cuando se imprime._

## `Imprimir recibo` was asking for a first print

`Ventas → ⋮ → Abrir recibo → Imprimir recibo` called `printAuthoritativeReceipt`, which always
dispatched a **first** print of that receipt. The first job owns two things the second one cannot
have: the command's idempotency key (`receipt:<receiptId>:<printerId>`) and
`hardware_print_job_identity_uidx` — one `official_receipt` per receipt and printer. The tap answered

```
409 request_refused POST …/hardware/commands code=IDEMPOTENCY_CONFLICT
```

and the button did nothing. The shape it needed already existed: a **controlled reprint**
(`receipt_copy` with `original_job_id`), which the server has supported all along and which the
hardware centre's own queue uses.

`printAuthoritativeReceipt` now looks at the runtime the till already holds: if an `official_receipt`
job for that receipt and printer exists, it dispatches `controlledReprint` of it; only a receipt with
no job prints for the first time. **On the rebuild** the tap answers 201 and
`merchant.hardware_print_job` gains `receipt_copy` with `original_job_id` set — twice, once from the
receipt dialog and once from `Ventas`.

## The animation belongs to the print, not to the dialog

The feed ran when the sheet was opened, which was wrong on both counts: reading a receipt is not
printing one, and the animation was spent before the operator could ask for anything.

`ReceiptPaper` now takes a `prints` cue: the dialog fires it on the _pointer down_ of the print
action, and the paper feeds from there — the roll advancing again, a fresh sheet coming out, the
serration travelling with the leading edge. Opened on its own, the sheet is already out and nothing
is scheduled.

One follow-on: the receipt dialog used to close the moment the print command returned, which hid the
whole feed. It stays open now; the operator closes it when they are done. The widget test that pinned
the old behaviour was updated with the reason.

## Verified

| Step                              | Evidence                                                             |
| --------------------------------- | -------------------------------------------------------------------- |
| Opening the receipt from `Ventas` | static, paper already out (`00-opened-static.png`)                   |
| Pressing `Imprimir recibo`        | the sheet feeding again, dialog still up (`01-feeding-on-print.png`) |
| After the feed                    | the complete copy (`02-copy-out.png`)                                |
| The job                           | `receipt_copy`, `original_job_id` set, 201 — twice                   |

Tests: `receipt_paper_test.dart` (three cases: static on open, feeds on the cue, reduced motion shows
it already out with no frame scheduled), the hardware-service case that pins the reprint instead of a
second official receipt, and the updated dialog test. POS **703**, `flutter analyze` clean.

## Still open

The **kitchen ticket** on `orders/fire` still prints nothing, and the printer attached to this till
does not declare `printer.kitchen_ticket_foundation`. The dashboard's `Recibos` could take the React
component the paper imitates.

Evidence: `docs/reports/evidence/2026-10-11-imin-reprint-copy/`.
