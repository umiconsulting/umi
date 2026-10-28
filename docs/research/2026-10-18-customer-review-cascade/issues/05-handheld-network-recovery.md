# Issue 05: handheld network recovery

Status: independent complaint and local acceptance gap.

## Operator scenario

A server walks from the floor to the kitchen. The handheld changes access point or falls back to another network. The server cannot send an order or cannot find the open account.

## Independent evidence

| Product | Language | Evidence | Source |
| --- | --- | --- | --- |
| Toast | English | A user reports random Wi-Fi drops during service. | Toast Community, 2024-01-15 |
| Toast | English | Another user reports the same failure for six months and says the handhelds are almost useless. | Toast Community, 2024-09-16 |
| Toast | English | The first user later identifies a dead zone and a competing secured network. | Toast Community, 2024-09-18 |
| Square | English | A reviewer reports that Wi-Fi loss stops the restaurant workflow. | Software Advice review |
| Clover | English | A reviewer reports that constant outages affect orders. | Clover Go App Store, US |
| Toast | English | A handheld lost KDS and expo printing when it left the truck window. | [Reddit](https://www.reddit.com/r/ToastPOS/comments/1e32cri/handheld_disconnecting_from_internet/) |
| Toast | English | A site saw devices go offline and online although the Internet was healthy. | [Reddit](https://www.reddit.com/r/ToastPOS/comments/14b9m3q/toast_is_always_malfunctioning/) |
| Square | English | A seller lost all open orders after a view update. | [Square Community](https://community.squareup.com/t5/Orders-Menu-Items-Catalog/I-lost-all-open-orders-with-the-new-update/m-p/821799) |

## Vendor behavior

**HD:** Toast documents a managed network and a local sync hub.

The public help pages do not promise seamless client roaming. The community evidence shows that the device can join the wrong network and stay there.

## Cascade across languages

This issue currently has strong evidence in English only. The user reports do not give a model or a site survey. They show a common physical condition: a moving device and more than one network.

## Umi current flow

**HL:** The pilot uses the TP-Link service network. The iMin is the host at `192.168.0.10:4244`. Android holds a multicast lock. The app tries mDNS and then the fixed hub URL.

Evidence:

- `apps/umi-pos/lib/core/network/lan_discovery.dart`
- `apps/umi-pos/lib/core/platform/multicast_lock.dart`
- `apps/umi-pos/test/api_client_test.dart`
  - `mDNS discovery falls back to the configured hub URL`
- `docs/pilot/UMIPOS_LOCAL_FIRST_IMPLEMENTATION_PLAN.md`

## Gap

**I:** The app has a fallback address. The pilot has not measured a roam between access points.

The test must cover:

- the A11 leaves the kitchen dead zone;
- the A11 joins the wrong saved network;
- the A11 returns to UmiPOS;
- the iMin stays on the same address;
- the open account and KDS state do not reset.

## Acceptance scenario

1. Open an account on the A11.
2. Walk the A11 through the kitchen dead zone.
3. Stop the cloud API for 60 seconds.
4. Resume the account and send one item.
5. Return to the floor.
6. Confirm the account and pending item.
7. Restore the cloud API.
8. Confirm one queued item and no duplicate.

## Priority

Frequency: 3

User cost: 4

Money risk: 3

Recovery difficulty: 4

Umi fit: 5

Total: 19
