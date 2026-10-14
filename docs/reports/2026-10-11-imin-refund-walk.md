# The post-sale refund on the iMin — five findings, all of them closed or decided

Date: 11 October 2026, 03:25–04:05 MST. Device: iMin D3-504, signed in as `Propietaria UmiPOS`,
against the demo API on `:4013` and `umi_pos_estacion_design_20261008`. The sale under test is the
one settled earlier the same night: `34bc0092-…`, MXN 215.00, from the incoming web order.

The plan lists the native exception walk as pending (_"Recorrido nativo completo de excepciones
pendiente"_). This is that walk, and it does not complete yet. Every step below was driven with real
taps, and every verdict comes from the API's own log
(`/tmp/umi-api-estacion-N19-restored.log`) rather than from reading the client.

## What was walked

| Step                                                                                | What the till showed                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Ventas` → the sale (`Latte +1 · MXN 215.00 · Completada`) → `Acciones de la venta` | the row menu: `Estado de cocina`, `Acciones posteriores a la venta`, `Abrir recibo`                                                                                                                                                                                 |
| `Acciones posteriores a la venta`                                                   | **`Reembolso o anulación`**: `Importe restante reembolsable MXN 215.00`, the three types (`Anular venta`, `Reembolso total`, `Reembolso parcial`), a restock decision (`Reponer` / `No reponer` / `Requiere inspección`), a reason, a note, and `Revisar reembolso` |
| `Reembolso parcial` → `Aumentar cantidad` on a line                                 | per-line quantities with `Cantidad restante`; the note field raises the Android keyboard                                                                                                                                                                            |
| `Revisar reembolso`                                                                 | a preview: `Reembolso de impuestos MXN 11.72`, `Reembolso en efectivo MXN 85.00` (the 85.00 Cheesecake at 16 % included), restock, and **`Un gerente debe aprobar este cobro.`**                                                                                    |
| the manager PIN (the seed's `3333`) → that button                                   | `Confirmar reembolso` appears — the approval was accepted                                                                                                                                                                                                           |
| `Confirmar reembolso` → `¿Confirmar este reembolso?`                                | **the commit is refused**                                                                                                                                                                                                                                           |

The arithmetic is right and the approval path works. Everything below is about what happens after.

## Wall 1 — an empty manager PIN is sent, and the answer names nothing

Pressing the approval control with the PIN field empty calls the API with `managerPin: ""`, and
`RefundApprovalRequest` requires `managerPin` to match `^\d{4,8}$` (`packages/contract/src/pos-exception.ts`).

```
09:42:52  400 request_refused POST …/sales/34bc0092-…/exceptions/approval
          code=VALIDATION_FAILED detail=message=The request does not match the public contract.
```

The operator sees: _"Vuelve a intentar. Si el problema sigue, pide apoyo a un gerente. (Código:
VALIDATION_FAILED)"_ — advice to retry, and no mention of the field. The product already refuses
this shape elsewhere (the sign-in keypad's `Continuar` is disabled until four digits have landed);
this control is not.

## Wall 2 — the commit's body does not satisfy the contract, twice

With the preview and the approval both accepted (`201`), the commit is refused:

| Time     | Route               | Answer                                                                      |
| -------- | ------------------- | --------------------------------------------------------------------------- |
| 09:48:32 | `POST …/exceptions` | `400 VALIDATION_FAILED` — "The request does not match the public contract." |
| 09:51:10 | `POST …/exceptions` | the same, different correlation id                                          |

`SaleExceptionCommand` is a strict schema (`.strict()`, so an unknown field fails it as well as a
missing one), and the app's body for this route does not satisfy it. **The body itself has not been
captured yet**, so the offending field is not named here — see "What closes this" below. What is
established is that the failure is in the client's command, not in the preview (whose body was
captured and matches `RefundPreviewRequest` exactly) and not in the approval (which returned `201`).

## Wall 3 — a cash refund needs a shift this session owns, and says so in code

Later attempts stopped one step earlier:

```
10:03:20  409 request_refused POST …/exceptions/preview
          code=CONFLICT detail=code=CASH_SHIFT_NOT_ELIGIBLE
```

The preview computes a cash tender and asks the repository for the session's active cash shift; with
none, it refuses (`pos-exception.repository.ts`, `cashRefundRequiresShift`). The database says why:

| Row                                                      | Value                               |
| -------------------------------------------------------- | ----------------------------------- |
| `merchant.cash_shift` `7bbbfd9b-…` (the only open shift) | `operator_session_id = ee27e1bc-…`  |
| `runtime.operator_session` `ee27e1bc-…`                  | **`state = ended`**, ended 09:40:50 |
| the till's current session                               | `c24eda3b-…`, active                |

So the till is holding an open shift that belongs to an operator session that is gone. A sale still
commits against it (the sale earlier tonight did); a **cash refund does not**, and the operator is
told only _"(Código: CONFLICT)"_. Whether the till should adopt the open shift for the new session
the way it resumes it for sales, or tell the operator to open a shift, is a product decision — the
silence is not.

## What closes this

1. **Capture the commit body.** A transparent proxy in front of the demo API does it without
   touching the app: start `node /tmp/umi-proxy.mjs 4045`, point the device's tunnel at it
   (`adb reverse tcp:4013 tcp:4045`), and drive the flow. The app's keep-alive sockets expire after
   a few seconds, so no restart is needed — verified tonight: the proxy captured the sign-in and the
   preview without one.
2. **Get past wall 3 first**: the flow now stops at the shift gate, so the commit is unreachable
   until the till opens (or adopts) a shift for the current session.
3. Then decide the two client-side gaps: the approval control must not send an empty PIN, and the
   commit body must be fixed against `SaleExceptionCommand`.

## What this walk did leave behind

The device is back at `Ingresa tu PIN de operador` with its default preferences, its tunnel points at
the demo API again, and no test process was left running. The sale `34bc0092-…` is untouched: every
attempt was refused, so nothing was refunded and `merchant.pos_sale_exception` holds **0** rows. Four
rows sit in `merchant.pos_exception_preview` — one per `Revisar reembolso`, which is what that button
creates, and they are the record of these attempts.

## Resolution, the same night

The commit body was captured by putting a transparent proxy in front of the demo API
(`node /tmp/umi-proxy.mjs 4045` + `adb reverse tcp:4013 tcp:4045`). The app keeps HTTP connections
alive, so the proxy only sees traffic after the app reconnects — a restart with the proxy already in
place is what did it, and the device's trust survived because the proxy forwards to the same API.

The body the till sent, and the API's answer, name the defect exactly:

```json
POST …/sales/34bc0092-…/exceptions
{"locationId":"…","operatorSessionId":"…","previewId":"90172d5b-…","previewFingerprint":"6b57e463…",
 "approvalId":"2d2cc3f3-…","expectedSaleVersion":1,"commandId":"e7622436-…",
 "idempotencyKey":"a2db21a5-…","offline":false,"fiscalMotive":null}

400 {"code":"VALIDATION_FAILED","fieldErrors":
     {"fiscalMotive":["Expected '01' | '02' | '03' | '04', received null"]}}
```

**`fiscalMotive: null`.** The contract is `z.enum(['01','02','03','04']).default('02')`: Zod applies
the default when the key is ABSENT and refuses `null`. The generated Dart model carries a nullable
field and its `toJson` writes the key either way, so leaving it unset sent null — and refused every
commit. Fixed in the app: the command now carries `'02'`, the motive a counter sale uses (motive `01`
needs the UUID of a related CFDI, which a counter cannot supply). The trap is invisible to the type
system, so a test pins the field —
`test/sale_exception_test.dart`, "the commit names a fiscal motive, because the contract refuses
null" — and it was checked both ways: **without the fix it fails `Expected: '02' Actual: <null>`**.

**The empty manager PIN is closed too.** The approval action is disabled until its field matches
`^\d{4,8}$`, the way the sign-in keypad disables `Continuar` until four digits have landed, and a
widget test drives the whole dialog to prove it (empty → disabled, `12` → disabled, `3333` →
enabled). `apps/umi-pos`: **684 tests** pass and `flutter analyze` is clean.

**Wall 3 was not a defect at all.** With the drawer released and a shift opened by this session, the
proxy captured what the till does on the next sign-in:
`POST …/cash/shifts/4955b88b-…/resume → 201` — the till adopts the open shift by itself. The refusal
earlier was because that shift was held by a device that had been **revoked** during a re-enrollment;
the surface said so plainly and offered `Liberar la caja`. The only thing left in this wall is the
operator-facing copy for `CASH_SHIFT_NOT_ELIGIBLE`/`CONFLICT`, which names no cause and is a product
decision, not a bug report.

**Verified on the hardware the same night** — the rebuild, the install and the walk are in the next
section.

## Verified on the hardware, the same night

The APK was rebuilt from this tree (the recipe is in
`2026-10-11-imin-keyboard-stays-open.md`, "The build") and installed over the till's own copy with
`adb install -r` — same signing key, so the device kept its registration and its data. Then the same
refund was walked again, with taps only:

| Step                                                         | What happened                                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Reembolso parcial` → one Latte → note → `Revisar reembolso` | the preview shows, with the approval prompt                                         |
| the approval action, **with the field empty**                | **nothing happens** — no request, no error. The fix from this turn is doing its job |
| `3333` in the field, then the action                         | the approval is accepted, as before                                                 |
| `Confirmar reembolso` → `¿Confirmar este reembolso?`         | **`El reembolso quedó confirmado.`** with `Recibo de reembolso EX-6a4b81cb-…`       |

`merchant.pos_sale_exception` holds the row: `partial_refund`, `committed`, reason
`customer_changed_mind`, note `pruebaNueva`, merchandise 5603, tax 896. So both walls are down on
the hardware, and the till issues its own refund receipt.

## And that is where the fourth finding came from: the refund was a cent short

Look at those components: merchandise **5603** + tax **896** = **6499** for a line whose receipt says
`unitPrice 6500, quantity 2, lineTotal 13000`. The customer paid MXN 65.00 for one cup and the till
handed back **MXN 64.99**.

`refund-calculator.ts` allocated every component with its own integer division —
`11207 × 1 / 2 = 5603` and `1793 × 1 / 2 = 896` — and the parts then summed to less than the line's
own share whenever a division dropped a cent. A one-quantity line is unaffected (each division is
exact); a two-unit line at an odd unit total loses exactly one cent, which is the case a café with a
65.00 drink hits the first time somebody refunds one of two cups.

Fixed: the share of the line's total is computed first (exact for a counter sale, where the line
total is `unitPrice × quantity`), the tax takes the remainder — the convention the receipt itself
uses, net rounded and tax = total − net — and the components add up to the share again. The unit
test reproduces the Latte (`refund-calculator.spec.ts`, "refunds exactly what the customer paid for
the units, never a cent less") and was checked both ways: **without the fix it fails** with
`{ merchandise: 5603, tax: 896 }` where `{ 5603, 897 }` is required.

## Fifth: the preview called the refund "what is left to refund"

The same dialog showed **`Importe restante reembolsable MXN 64.99`** about the money being handed
back, in the preview and again on the confirmation. That label means "what remains refundable", and
it belongs to the eligibility row on the screen before; reusing it for the refund's own amount
invites a cashier to read the wrong number in a money dialog. Both rows now name their own thing —
`refundAmountLabel` ("Importe del reembolso" / "Refund amount") for the refund, the old label for the
remaining — and the widget test that drives the whole dialog pins it.

## One more thing the build turned up: stale generated localizations

`flutter gen-l10n` reported 86 getters whose generated Dart still carried the pre-redesign strings
("Carrito actual" where the ARB says "Comanda"). The ARBs had been edited in an earlier session
without regenerating, so any build from this tree shipped the old wording. Regenerating fixed it
(`flutter analyze` clean, `flutter test` 684 pass), and it is why the freshly built APK shows the
current copy.
