# Issue 07: printer and hardware recovery

Status: repeated independent complaint.

## Operator scenario

The guest asks for a receipt. The printer shows an error or loses its address. The cashier calls support while the queue waits.

## Independent evidence

| Product | Language | Evidence | Source |
| --- | --- | --- | --- |
| Square | Spanish MX | An update removes ticket and kitchen printing. | App Store MX, 2023-09-23 |
| Square | English | An operator reports that updates remove printer profiles. | Software Advice review, 2026-08 |
| Square | English | A reviewer reports duplicate and triple prints with delays. | Software Advice review |
| Lightspeed | English | A user reports a 45 to 60 minute support call after a power loss. | Software Advice review, 2022 |
| Lightspeed | English | A user reports printer IP loss and offline cash-up problems. | Software Advice page 5 |
| Soft Restaurant | Spanish MX | A user reports that ticket printing and the cash drawer do not work after subscription and recommended hardware purchase. | Google Play MX, 2023-11-30 |
| Soft Restaurant | Spanish MX | A user reports that the Cloud app needs special hardware for thermal printers. | Google Play MX, 2025-09-04 |
| Square | English | Printers lost connection during restaurant service. | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Printers-keep-disconnecting-Restaurant-POS/m-p/399491) |
| Toast | English | Kitchen printers lost connection during dinner service. | [Reddit](https://www.reddit.com/r/restaurant/comments/1sul2od/pos_system_randomly_freezing_and_kitchen_printers/) |
| Lightspeed | English | A reviewer reported constant printer errors and billing issues. | [App Store](https://apps.apple.com/us/app/lightspeed-restaurant-pos-l/id474723658) |
| Soft Restaurant | Spanish MX | Public tutorials demonstrate station connection and update errors. | [YouTube](https://www.youtube.com/watch?v=DGNeWJL92V4) |

## Vendor behavior

**HD:** The products document receipt and kitchen printers.

The reviews show that the configuration path and the recovery path are part of the product experience. A supported printer is not useful if recovery needs a support call.

## Cascade across languages

The Spanish Square and Soft Restaurant reports and the English Lightspeed reports name the same recovery failures:

- profile loss after an update;
- printer address loss;
- duplicate paper;
- dependency on an extra app;
- long support time.

## Umi current flow

**HL:** Umi uses one serialized USB path. It caches the printable logo raster. A committed sale prints from the bound runtime. A second receipt request becomes a controlled copy.

Evidence:

- `apps/umi-pos/test/hardware_service_test.dart`
  - `a receipt already printed is reprinted as a copy, not printed again`
  - `print queue retry recovers and preserves the command identity`
  - `a committed sale prints from the bound runtime without a cloud or USB probe`
- `docs/reports/2026-10-18-ticket-printing-latency.md`

Device proof:

- cold receipt after the change: 512 ms;
- controlled reprint: 695 ms;
- USB write: 162 to 191 ms.

## Gap

**I:** The happy path is fast. The pilot needs paper-out, reconnect and duplicate-request drills.

The drill must prove:

- one queued job after paper runs out;
- no duplicate after a manual retry;
- a clear message that names the printer state;
- no cloud wait before a local print;
- a cash drawer pulse that cannot delay an independent printer.

## Acceptance scenario

1. Start a receipt print with the paper cover open.
2. Confirm the job waits and names the printer state.
3. Close the cover.
4. Confirm one receipt prints.
5. Tap reprint.
6. Confirm the paper says `COPY`.
7. Disconnect and reconnect USB.
8. Confirm one queued job and no duplicate.

## Priority

Frequency: 3

User cost: 4

Money risk: 3

Recovery difficulty: 4

Umi fit: 4

Total: 18
