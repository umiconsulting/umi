# Ticket printing latency investigation — 18 October 2026

## Result

The random delay was not primarily in the USB write. It came from work placed
in front of that write:

1. Every process paid the receipt-logo cost again: fetch the 100 KB PNG, decode
   it, rasterise it to one bit per dot, and only then render the receipt.
2. Every post-sale print re-read the hardware registry and performed a USB
   `DLE EOT` status probe before dispatching the paper.
3. The 30-second background health sweep competed with receipts for the single
   USB worker.

On the iMin D3 and Epson TM-T20IIIL, the cold server print-job duration fell
from **1.55 s to 0.51 s**. The printer write itself is **162–191 ms**.

## Measurements

Server timestamps are from `merchant.hardware_command_event`; "duration" is
from command creation to terminal `succeeded`.

| Case                                    |   Before | Final build 167 |
| --------------------------------------- | -------: | --------------: |
| Official receipt, same receipt path     | 1,551 ms |               — |
| Official receipt after cold app start   |        — |      **512 ms** |
| Receipt copy, warm process (pre-change) |   647 ms |               — |
| Controlled reprint, final behaviour     |        — |      **695 ms** |

Instrumented build 166 showed the remaining cold-path budget precisely:

| Stage                                   |         Time |
| --------------------------------------- | -----------: |
| Server creates the hardware command     |   189–211 ms |
| Server accepts `dispatching`            | about 150 ms |
| Persisted logo read plus receipt render |       6–9 ms |
| ESC/POS encode                          |         1 ms |
| USB write, 14,493 bytes                 |   162–191 ms |
| Final server transition                 |   169–220 ms |

The logo cache was read from SQLite in **8 ms** after a process restart. Before
the change, the same cold path fetched and rasterised the PNG again and measured
about 1.3 s.

## Changes

- `CachedThermalLogoSource` persists the printable one-bit raster in the local
  SQLite working copy. The URL is content-addressed, so the cache key is the
  logo URL plus output dimensions.
- Damaged or truncated cached rasters are treated as misses, never printed as
  malformed paper.
- Failed fetches receive a 30-second negative cache instead of repeating the
  network operation for every print.
- Concurrent requests for the same mark share one fetch.
- A committed sale uses the hardware runtime already bound to the till. It no
  longer asks the cloud and the USB port to describe themselves before printing.
- Reprints still refresh the registry fact that names the original print job,
  but do so without a USB status probe.
- USB send, status, and close operations are serialized in Dart. The Kotlin
  worker was already serial, but concurrent Dart futures could reach it in an
  unpredictable order.
- The routine 30-second sweep now uses the last proven send/probe state for USB.
  The Hardware Center and explicit diagnostics still perform a real `DLE EOT`
  probe.
- Print timing uses the contract's `latencyMs` field. Diagnostic-only stage
  breakdown stays in opt-in `UMIPOS_PRINT_TRACE` logs.

## Regression caught during device validation

The first diagnostic build passed the local print but the server rejected its
final transition because the contract allows only named `SafeMetadata` fields.
The extra timing keys left the command in `dispatching`. The fix sends the
contract's `latencyMs` only, and the repeated test reached `succeeded`.

A second stale-runtime issue appeared on reprint: using the checkout-bound
reading missed the print job just created by the sale, producing an
idempotency conflict. `printAuthoritativeReceipt` now refreshes print-job
history without probing USB. The controlled reprint completed in 695 ms.

## Verification

- Flutter suite: **1,063 passed**.
- `flutter analyze`: no issues.
- Focused tests cover durable logo cache reuse, corrupt-cache misses, negative
  cache expiry, concurrent fetch deduplication, no cloud/runtime read on a
  committed receipt, no USB health probe before printing, serialized USB order,
  and background health using the last proven state.

## Device and artifact

| Item        | Value                                                                      |
| ----------- | -------------------------------------------------------------------------- |
| iMin D3     | `192.168.0.10`, build 167                                                  |
| Printer     | Epson TM-T20IIIL, USB, 48 columns                                          |
| APK         | `apps/umi-pos/build/app/outputs/flutter-apk/app-staging-lan-host-b167.apk` |
| APK SHA-256 | `0a5c0bc9ae0bc9773c719d094fbe7058781ebe2676b21e1f37ae7774ea62c1a6`         |
| Contract    | 2.40.0                                                                     |
| API         | `ghcr.io/umiconsulting/umi-api:offline-table-2.40`                         |

The final iMin state is logged in with an empty cart.
Staging contains the test sales and the commands from rejected diagnostic
builds used during this investigation; no production data was touched.

## Evidence

- [`01-final-build-receipt-paid.png`](evidence/2026-10-18-ticket-printing/01-final-build-receipt-paid.png)
- [`02-final-empty-main.png`](evidence/2026-10-18-ticket-printing/02-final-empty-main.png)

## Remaining first-use cost

The first receipt after a **new logo upload** still fetches, decodes, and
rasterises that new image once. Every later process reads the persisted raster.
Eliminating that one-time cost would require warming the new logo during upload
or at app startup; it is not on the ordinary receipt path after the first print.
