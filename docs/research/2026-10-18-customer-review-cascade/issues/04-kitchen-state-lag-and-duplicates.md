# Issue 04: kitchen state lag and duplicate work

Status: repeated independent complaint.

## Operator scenario

The counter sends a ticket. The kitchen sees it late, sees it twice or does not see it. The cook prepares the wrong quantity. The server tells the guest an incorrect wait.

## Independent evidence

| Product | Language | Evidence | Source |
| --- | --- | --- | --- |
| Toast | English | An operator reports production counts that are 3 to 15 minutes late during a rush. | Toast Community, 2026-02-27 |
| Toast | English | The KDS needs a hard-wired local sync hub when the Toast network is down. | Toast Community, 2023-11-30 |
| Toast | English | Handhelds lose Wi-Fi during service and need network repair. | Toast Community, 2024-01-15 |
| Square | English | A user reports duplicate kitchen tickets after check splits. | Square Community |
| Square | English | A reviewer reports duplicate and triple prints with delays that look like new tickets. | Software Advice review |
| Clover | English | A reviewer reports that cloud outages cause orders to be lost or deleted. | Clover Go App Store, US |
| Square | English | The receipt printer received a delivery order at once, but the KDS took 2 to 10 minutes. | [Square Community](https://community.squareup.com/t5/Hardware-Setup-Troubleshooting/KDS-is-slow-to-receive-delivery-orders/m-p/794073) |
| Square | English | Several sellers reported random wireless printer disconnects. | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/Printers-keep-disconnecting-Restaurant-POS/m-p/399491) |
| Odoo | English | A restaurant could not confirm offline KOT and bar printing with a remote server. | [Reddit](https://www.reddit.com/r/Odoo/comments/1t3j09v/does_odoo_pos_offline_mode_still_send_kots_and/) |
| Clover | English | A reviewer printed two blank pages after an OS update. | [App Store](https://apps.apple.com/us/app/clover-go-dashboard-pos/id969311778) |
| Fresh KDS | English | A Clover and Fresh KDS user reported dropped tickets and a tablet reboot every 15 minutes to make orders sync. | [Google Play, 2026](https://play.google.com/store/apps/details?id=com.freshtechnology.kds&reviewId=fe520216-862c-43ac-ac5f-3e5bf5b32ff3) |
| Fresh KDS | English | An operator reported that the KDS service was down for hours and online sales stopped. | [Google Play, 2023](https://play.google.com/store/apps/details?id=com.freshtechnology.kds&reviewId=2963503b-480a-4a34-b44e-3dd00201b665) |
| Fresh KDS | English | An operator reported screens that would not find each other on the network after an update. | [Google Play, 2022](https://play.google.com/store/apps/details?id=com.freshtechnology.kds&reviewId=51ee12fd-6586-4f55-a5bd-4a65cc30a9bf) |

## Vendor behavior

**HD:** Toast documents a local sync hub for offline operation.

**HD:** The Toast production-count report is a supported feature. The report above is the first-hand field evidence of its failure.

**I:** A local hub is necessary. A hub is not sufficient. The display must also converge to one visible state after a delay or reconnect.

## Cascade across languages

The English sources cover the full loop. Toast shows late production data. Square and Clover show duplicate or missing tickets. The common cost is repeated kitchen work and uncertain guest communication.

The Square KDS delay is a clear architectural warning. The printer was local and
immediate. The KDS depended on a slower path. Umi must send both from the same
local order event.

## Umi current flow

**HL:** The iMin hosts a local KDS node. The A9 can read the board and send commands over the service LAN.

Evidence:

- `apps/umi-pos/lib/features/kitchen/lan_kds_node.dart`
- `apps/umi-pos/lib/features/kitchen/lan_kds_bridge.dart`
- `apps/umi-pos/lib/features/kitchen/lan_kds_store.dart`
- `apps/umi-pos/test/features/kitchen/lan_kds_node_test.dart`
  - `a cart fired offline appears as a local kitchen ticket`
  - `a locally fired ticket leads the cached server board`
  - `the hub advances its own replay cursor for a cook command`

Device proof:

- iMin fire to paint: 154 ms.
- A9 start preparation: 130 ms.
- A9 item ready: 117 ms.
- A9 complete: 118 ms.
- LAN board read while the cloud was down: 126 ms.
- LAN bump: 204 ms.

## Gap

**I:** Umi proves a local kitchen path. Umi does not yet prove convergence after a sudden LAN loss, a host restart or a delayed cloud answer.

The test must prove:

- no duplicate ticket after replay;
- no lost item after a host restart;
- one terminal state after the cloud and LAN disagree;
- a visible local state that does not pretend the cloud accepted the work.

## Acceptance scenario

1. Fire a three-line ticket from the iMin.
2. Mark one item ready on the A9.
3. Stop the cloud API for 60 seconds.
4. Restart the local host process.
5. Restore the cloud API.
6. Confirm one ticket, three items and one item-ready event.
7. Confirm the replay cursor advances once.
8. Confirm no open conflict.

## Priority

Frequency: 4

User cost: 5

Money risk: 4

Recovery difficulty: 4

Umi fit: 5

Total: 22
