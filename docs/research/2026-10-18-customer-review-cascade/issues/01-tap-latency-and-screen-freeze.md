# Issue 01: tap latency and screen freeze

Status: repeated independent complaint.

## Operator scenario

A server taps a product, a category or a payment method during a busy service. The screen shows no new state. The server taps again. The second tap becomes a duplicate item, a wrong amount or a second action.

## Independent evidence

| Product    | Language   | Evidence                                                                                                               | Source                                                                                                                                  |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Fudo       | Spanish MX | A user reports that the app turns gray often and slows the work.                                                       | App Store MX, 2025-03-01                                                                                                                |
| Fudo       | Spanish MX | A user reports that the new category index makes products harder to find during order entry.                           | App Store MX, 2024-09-13                                                                                                                |
| Lightspeed | English    | A restaurant operator reports that the system freezes when the restaurant is busy.                                     | Software Advice review, 2022                                                                                                            |
| Lightspeed | English    | Another review reports that frequent updates slow the system.                                                          | Software Advice page 5                                                                                                                  |
| Toast      | English    | A restaurant operator reports that Toast can slow down during a busy service.                                          | Software Advice review, 2019                                                                                                            |
| Square     | Spanish MX | Several reviews describe an update that removes the product grid or the payment action.                                | App Store MX, 2023                                                                                                                      |
| Clover     | English    | A reviewer reports slower performance and loading issues after an update.                                              | Clover Go App Store, US                                                                                                                 |
| Square     | English    | A register became slow on Wi-Fi in July 2026. Cash, card, and reports slowed together; a phone hotspot restored speed. | [Square Community](https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/Square-register-very-slow-laggy-on-wifi/m-p/847362) |
| Square     | English    | Tap to pay started several seconds after an update.                                                                    | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Latest-POS-update/m-p/679337)                            |
| Toast      | English    | The system froze for 15 to 25 minutes during dinner service.                                                           | [Reddit](https://www.reddit.com/r/restaurant/comments/1sul2od/pos_system_randomly_freezing_and_kitchen_printers/)                       |
| Toast      | English    | A reviewer called the system as fast as a 1999 laptop.                                                                 | [Trustpilot](https://www.trustpilot.com/reviews/6ab46964d685ccf2a0eaddf7)                                                               |
| Lightspeed | English    | A reviewer needed two taps for one action.                                                                             | [App Store](https://apps.apple.com/us/app/lightspeed-restaurant-pos-l/id474723658)                                                      |
| Clover     | English    | A reviewer called the app slow and unstable after an update.                                                           | [App Store](https://apps.apple.com/ca/app/clover/id969311778)                                                                           |

**IV:** The reviews describe different products and dates. The repeated failure is uncertainty after a tap.

## Vendor behavior

**HD:** The reviewed products have product grids, order editors and payment screens.

The public vendor pages do not state a tap latency target. The vendor pages do not show how the UI behaves when a request is slow.

## Cascade across languages

The Spanish Fudo and Square reports match the English Lightspeed, Toast and Clover reports. Each report names a visible action that failed to paint or a workflow that added hesitation.

The reports do not give a common latency number. They give the same user response: retry or wait.

The second pass also found a local-network signal. A Square register became fast
again on a phone hotspot. This shows that "online" is not enough. The service LAN
must be healthy too.

## Umi current flow

**HL:** The cart uses a local command queue. The queue paints the composed cart before the API answer.

Evidence:

- `apps/umi-pos/lib/features/cart/cart_command_queue.dart`
- `apps/umi-pos/test/cart_command_queue_test.dart`:
  - `a second tap paints while the first request is still open`
  - `a lost response journals every painted command once`
- `apps/umi-pos/lib/features/catalog/catalog_surface.dart`

The device proof in `docs/reports/2026-10-18-offline-kds-flow.md` measured:

| Action                  | Tap to paint |
| ----------------------- | -----------: |
| Product add on iMin     |       155 ms |
| Fire to kitchen on iMin |       154 ms |
| KDS start on A9         |       130 ms |
| KDS item ready on A9    |       117 ms |
| KDS complete on A9      |       118 ms |

## Gap

**I:** The product has local paint. The product does not yet have a peak-load acceptance run for the full account flow.

The run must include:

- product add;
- quantity change;
- line edit;
- account split;
- partial payment;
- KDS transition;
- print;
- recovery after an API stall.

The target is a p95 tap-to-paint value below 250 ms on the pilot hardware. A tap must never show a blocking spinner.

## Acceptance scenario

1. Start a 30-minute test with 100 rapid cart actions.
2. Add a 2-second API stall every 20 actions.
3. Record tap-to-paint for each action.
4. Confirm that each tap paints once.
5. Confirm that no duplicate line or duplicate kitchen ticket appears.
6. Confirm that the queue drains after the stall.

## Priority

Frequency: 5

User cost: 5

Money risk: 4

Recovery difficulty: 4

Umi fit: 5

Total: 23
