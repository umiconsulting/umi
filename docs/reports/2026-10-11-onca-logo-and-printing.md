# ONCA's jaguar: the real mark, and the head that can draw it

Date: 11 October 2026, 18:05–19:30 MST. The owner sent the café's mark as a phone screenshot, asked
for it to be the logo, and asked for the logo to be visible **in the POS and printed**.

## The mark, rebuilt from a screenshot

The file was a WhatsApp screenshot: the jaguar drawn in black inside a white disc, on a dark grey
phone background, with a status bar on top — and, measured rather than eyeballed, **the disc is
cropped by ~26 px on each side** by the screenshot itself.

| Step                | What was done                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Find the disc       | the two visible poles (rows 403 and 1203) give centre (374, 803) and radius 400; the missing rim is drawn from that circle         |
| Clean the ink       | median pass against JPEG speckle, threshold at 140, then resample the mask from 2× — crisp curves, no grey halo                    |
| What is transparent | everything outside the disc. The badge is the disc and its ink, so it reads on white paper (disc invisible) and on a coloured pass |
| The vector          | traced to **62 paths** (`vtracer`), then rasterised from the paths at 1024/768/512 — no upscaled raster anywhere                   |

Assets: `docs/reports/evidence/2026-10-11-onca-logo/` — `onca-badge.svg` and `onca-mark.svg` (the
mark alone, for a 1-bit head or a dark surface), plus PNGs at 1024 and 768. The 768 one is what is
stored: **101 384 bytes**, 768 × 768, and `merchant.logo_url` for `onca` now points at it.

## Printing it

The till sends ESC/POS to the printer, so the mark has to arrive as the head's own bitmap. That is
new code, and it is in the till because that is where the printer is:

| Piece                            | Where                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ThermalImageCommand` + `GS v 0` | `lib/features/hardware/thermal_printer_adapter.dart`                                                                                 |
| RGBA → 1-bit raster              | `lib/features/hardware/thermal_logo.dart` — alpha flattened over **white paper**, luminance threshold, box-averaged down to 384 dots |
| Fetch + decode at print time     | `HttpThermalLogoSource`, cached by the content-addressed URL                                                                         |
| The receipt draws it             | above the café's name, and only when the head advertises `printer.image`                                                             |
| The URL travels with the job     | `ReceiptPrintPayload.logoUrl` (contract **2.28.0**, optional)                                                                        |

**12 tests**, including the real PNG: `test/thermal_logo_test.dart` decodes the stored file, runs it
through the rasteriser and asserts the ink covers 5–60 % of the block — enough to be a mark, far
from the black square a transparency bug would print. The rest pin the byte sequence
(`1d 76 30 00 …`), the no-enlargement rule, the capability gate, and that a receipt whose mark
cannot be fetched still prints.

**What is NOT proven, and cannot be from here:** paper. The Epson TM-T20III is still not on this
network, so no byte has left a real head. What is proven is the byte stream and the picture that
feeds it.

## Visible in the POS

The iMin D3-504 was enrolled to **ONCA** (setup code claimed with platform `android`, approved from
the console by the new ONCA administrator) and signed in with that administrator's PIN. The till now
shows ONCA's own world: header `ONCA`, ONCA's categories (`Pan`, `Bebidas`, `Pizzas`, each in its
own colour), and ONCA's recovered menu (`Aeropress`, `Amanecer`, `Barra MM`, `Burgir pack`…).

## The one thing that stopped the sale, said plainly

The sale could not be completed, and it is not the logo: **ONCA's cash register was never
commissioned.** Measured on the way:

- `merchant.physical_register` `Caja 1` was assigned to a device from the 7 October commissioning
  and left with a **`counting` shift open since 2026-10-07**;
- the till's Caja screen therefore refuses `Abrir turno de caja` (`Caja asignada` empty), and the
  checkout answers `CASH_SHIFT_REQUIRED` with only `Reanudar turno y reintentar`, which does not
  move;
- `tender-providers` returns nothing for ONCA, so the manual-terminal route is not offered either.

Handing the drawer to the terminal in front of me (`cash_shift.holding_device_id`) took the till
from "open a shift" to "resume the shift", which is as far as a nudge should go. Finishing it is a
commissioning task — open a clean shift for ONCA's register, or write off the 7 October one through
the product — and it is the next thing to do before an ONCA ticket exists at all.

## Verified

| Check                                                      | Evidence                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The mark as a badge, and as ink alone                      | `onca-badge.svg`, `onca-mark.svg`, `onca-badge-1024.png`, `onca-mark-1024.png` |
| Uploaded through the console card, as ONCA's administrator | 9/9 steps; `10-console-card.png`, `11-console-wallet-pass.png`                 |
| Stored row and public asset                                | 768 × 768, 101 384 bytes, `200 image/png`; the placeholder's URL is now `404`  |
| The till in ONCA's context                                 | `20-pos-onca-catalogue.png`, `21-pos-onca-checkout.png`                        |
| Where the cash path stops, with the screen that says it    | `22-pos-onca-cash-centre-blocked.png`, `23-pos-onca-cash-shift-refused.png`    |

POS **734** tests, `flutter analyze` clean; API **1803**, contract **83**, dashboard **355**.

## Fixtures, so anyone can repeat it

`scripts/onca-admin-fixture.sql` (the person and the employment) and
`scripts/onca-admin-fixture.sh` (their operator PIN — the lookup is an HMAC of the environment's
`JWT_SECRET`, so it cannot live in a .sql file). Both re-runnable, both for a disposable database.

## The onboarding, walked from the console (19:30–19:45 MST)

`tools/ux-sweep/dashboard-onca-onboarding.mjs` — real clicks, an administrator's own session, no
fixtures written by the walk itself. **5/5 steps**:

| Step                             | Result                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Sign-in as the ONCA admin        | `admin@onca.mx`, the shell names ONCA                                                        |
| Open a branch from Ajustes       | **"ONCA Sucursal 2" created and listed** (the sheet, the save, the list refresh — `01`/`02`) |
| The catalogue loads              | page 1 of 3, header `20 products`                                                            |
| The enrolled terminal is listed  | the console shows the till the enrolment claimed (`04-devices.png`)                          |
| The administrator is on the team | member of the café with a role (`05-team.png`)                                               |

**The menu is complete; the count is per page.** Walking the pages: `20` + `20` + `11` = **51**, which
is exactly ONCA's active menu. The earlier note in this report — "the console says 20 and the café has
51" — was my misreading of page size as a total; the products screen pages through all of them. The
residue worth fixing is the wording: a header that reads `20 products` over a café with 51 invites
someone to think 31 are missing.

**Then the till.** The build already on the device is the newest one (profile, build 2, contract
2.28.0), and the ticket renders for ONCA: `Ventas → ⋮ → Abrir recibo` on the 7 October sale shows
`ONCA / ONCA`, reference `POS-982a7d37…`, its two lines, subtotal, tax and total, with
`Imprimir recibo` and `Cerrar` (`30-till-ticket.png`). **It carries no logo, and that is the design
working**: the snapshot was frozen on 7 October, when the café had none. A ticket _with_ the jaguar
needs a sale committed after the upload, and that is what the next section is about.

## The blocker, with its exact shape

A new ONCA sale cannot be paid, from either surface, and it is not the logo:

1. **The drawer has been open since 7 October with a half-finished count.** The console's
   _Caja y turnos_ shows it plainly: opening float $500, cash sales $705, expected cash $1,205, a
   count of $1,005 recorded, variance pending, `OPEN 1` (`10-console-stuck-shift.png`).
2. **The till cannot see it.** The cash centre offers `Abrir turno de caja` — a shift for TODAY's
   business date — and the server then refuses, because the register already holds that 7 October
   shift. The result is the banner `No se completó la operación. Intenta de nuevo o solicita ayuda.`
   with no action that moves (`22-pos-onca-cash-centre-blocked.png`).
3. **The console cannot close it either, by design**: cash movement is POS-only policy, and
   _Caja y turnos_ is the read-and-govern lens (`caja-turnos.jsx`). So the drawer is stuck between
   two surfaces that each expect the other one to close it.

That is a defect, not a fixture problem: a shift left open on an earlier business day must be
closable from the till that holds it. Until it is, ONCA cannot take cash — and cash is the only
tender it has (`tender-providers` is empty for this café, so the manual-terminal route is not
offered either).

Handed the drawer to the terminal in front of me (`cash_shift.holding_device_id`), the till moved
from "open a shift" to "resume the shift" — which is as far as a nudge should go, and it did not
unstick the close. Closing it through the product is the next piece of work.
