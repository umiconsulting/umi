# ONCA: what the package does when the Internet is not there

Status: `DESIGN, NOT YET COMMISSIONED`. Nothing here is a promise until the drill in §7 has
been run on the real devices.
Scope: the borrowed counter package at ONCA. Physical record:
`UMIPOS_SITE_DEVICE_INVENTORY.md`. Its menu: `ONCA_MENU_TO_UMI_MAPPING.md`.
Last updated: 2026-10-06.

## 1. The one sentence

**The TP-Link is not a router in this design; it is the local network, and it is the only part
of the package that keeps working when the WAN does not.** Everything the café can still do
while the uplink is down is decided by one question: _does this operation need the server, or
only the devices that are already in the room?_

That question has an uncomfortable answer today, and the rest of this note is that answer
written down instead of discovered at 8 a.m. on a Saturday.

## 2. The topology

| Device             | Role                                             | Transport                                 | Keeps working without the WAN? |
| ------------------ | ------------------------------------------------ | ----------------------------------------- | ------------------------------ |
| iMin D3-504        | Counter till (`pos_terminal` · `static`)         | Wi-Fi to the Archer                       | Partly — see §4                |
| Galaxy Tab A11     | Handheld order taker (`pos_terminal` · `mobile`) | Wi-Fi                                     | Only as far as the till        |
| Galaxy Tab A9+     | KDS (`kds`)                                      | Wi-Fi                                     | No (today)                     |
| Epson TM-T20III    | Receipts, and the drawer's pulse path            | Ethernet, port 9100                       | Yes, from the till             |
| Cash drawer        | Cash                                             | Wired to the printer's DK port (`verify`) | Yes, from the till             |
| TP-Link Archer C50 | The LAN, and the uplink                          | —                                         | It _is_ the LAN                |
| Umi API            | Pricing, orders, kitchen tickets, cards, wallets | WAN (`api.umiconsulting.co`)              | No                             |

Every Umi device reaches the API over the WAN. There is no on-premise server in this package,
and that single fact is what shapes everything below.

## 3. The address plan to fill in at commissioning

The Archer's factory LAN is `192.168.0.0/24`, and the previous site network was already
customised (the terminal reported two different IPs across two photographs). Pin it down
once, in a maintenance window, and never by memory:

| Thing               | Value                              | Why                                                                                                                                    |
| ------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| SSID                | `Umi-ONCA` and `Umi-ONCA-5G`       | The package stops advertising Parrot                                                                                                   |
| Wi-Fi password      | rotated (last one was Parrot's)    | Same class of secret as a till password                                                                                                |
| Gateway / LAN       | to be written here                 | The two photographed IPs have to resolve to one subnet                                                                                 |
| Printer             | DHCP reservation → a fixed address | The toolbar's printer config stores an IP; a lease that moves is a printer that stops                                                  |
| Till, handheld, KDS | reservations **by hardware MAC**   | Both Samsung tablets randomise their per-network MAC — reserving the randomised one changes the lease when the tablet forgets the SSID |
| MAC randomisation   | off for `Umi-ONCA`                 | The reason the reservations above hold                                                                                                 |

The hardware MACs are in the inventory (§2) and do not change. The per-network ones do.

## 4. What survives a WAN outage

### 4.1 The till keeps taking cash — if the policy is on, and today it is off

The platform's offline contract is `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`, and the
site-relevant half of it is this: **cash checkout is "conditionally allowed"**, and a cashier
became allowed only if the merchant has an unexpired `pos_offline_cash_policy` for that
location, a fresh signed policy fingerprint, and the `pos.offline_cash` entitlement.

`002_onca_onboarding.sql` deliberately does **not** create that policy. So on the day the till
is enrolled, a dropped uplink means the till can browse what it has already cached and cannot
commit a sale. That is the shipped default for a café that has not been certified for
provisional money, and it is the first decision this note is asking for (§6.1).

### 4.2 The receipt and the drawer keep working — inside the offline flow

This is the part worth knowing, because it is the part that makes the LAN matter. The hardware
runtime is native, and for a provisional offline sale it keeps its own deterministic print and
drawer command identities (`offline-print`, `offline-drawer`), prints a sheet marked
`OFFLINE PROVISIONAL RECEIPT`, and opens the drawer through the printer's endpoint. See
`apps/umi-pos/lib/features/hardware/hardware_service.dart` and `UMIPOS_HARDWARE_RUNTIME.md`.

What that buys: with the printer on the Archer's Ethernet and the policy on, a barista can sell
a coffee, hand over a marked receipt and open the drawer with the uplink down. What it does not
do: decide anything. The price it prints is the last authoritative catalog it holds, and the
sale stays provisional until the WAN returns and the replay gateway accepts it.

### 4.3 The devices stay connected to each other

Even with the WAN down, the Archer keeps the LAN up: the till keeps its address, the printer is
still reachable on 9100, and the handheld still talks to the till over the local network. That
is not a feature of Umi's app so much as the reason to keep the Archer in the package at all —
and the reason the SSID rename is a maintenance-window job and not a five-minute one.

## 5. What does not survive, and the cost of pretending otherwise

| Operation                                                                       | Why it cannot work offline                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The KDS**                                                                     | A kitchen ticket is a server-side projection: `kitchen-projector.ts` builds `kitchen_order` from a committed order when the order is placed. No server, no ticket. The KDS is the one device whose whole purpose is unreachable during an outage. |
| **Card balances, stamps, redemptions**                                          | The wallet's authority is the server. A provisional locally-incremented balance is a number nobody can later reconcile against a ledger.                                                                                                          |
| **Payments by card or transfer**                                                | Provider authority is real-time by definition — the policy prohibits it offline outright.                                                                                                                                                         |
| **Refunds, voids, discounts above the policy, enrollment, credential rotation** | All security-sensitive; the policy prohibits them offline.                                                                                                                                                                                        |
| **The handheld's order taking**                                                 | The legacy system sent bread never across the network and drinks to the bar as `style · product`. Umi's handheld writes to the same server as the till. Without the WAN, an order taken on the handheld has nowhere to land.                      |
| **Roster, roles, permissions, settings**                                        | Server authority.                                                                                                                                                                                                                                 |

Two of those deserve to be said out loud rather than implied:

1. **A WAN outage costs ONCA the kitchen.** Not the till, not the receipts — the kitchen
   screen. If pizzas and hot drinks are the business, that is the outage that hurts, and no
   policy flag changes it today.
2. **The handheld is not a resilience feature.** It is a second terminal on the same server. It
   adds a second place orders can be taken, not a second place they can be kept.

## 6. The decisions this note is asking for

### 6.1 Offline cash: on or off?

Enabling it is a `merchant.pos_offline_cash_policy` row per location with an explicit ceiling
on a single sale, on the accumulated amount, on the number of sales, and on how stale the
catalog, the pricing and the tax may be. Every one of those bounds is enforced in the app _and_
stored on the server, because a client-side limit is a suggestion.

The honest recommendation: **turn it on for ONCA, with tight bounds, before the first service
on the package** — the whole point of buying a local network is that a lost uplink does not
close the café — but only after the drill in §7 has been run with someone watching the tickets
come back. A café that has never seen a provisional receipt is a café that will call the
receipt wrong.

### 6.2 Does the KDS need a local fallback?

Three options, in increasing cost:

1. **Accept the outage.** The kitchen loses its screen when the WAN does. Cheapest, honest, and
   already true.
2. **A paper fallback with a defined procedure.** The till prints kitchen tickets to the Epson
   while offline, and the KDS reconciles when the WAN returns. This is the _intermediate_ step
   the package's own hardware already makes possible — the printer is on the LAN and the till
   has the order — and it needs a design for "which tickets were already made" before it is
   safe, because a reprinted ticket is a cooked pizza twice.
3. **An on-premise API replica.** The real answer, and a different project: a small box that
   holds the catalog, the tickets and a queue, and syncs upward. It is where a multi-site
   restaurant chain ends up, and it is not where one borrowed package should start.

### 6.3 What is the printer's role, exactly?

The printer is the drawer's only opening path (the pulse leaves through its endpoint) and it is
on Ethernet. That makes it the single point of failure for _money leaving the drawer_, and it
makes its DHCP reservation more important than any other address on the LAN. Confirm the
drawer is wired to the printer's DK port rather than to the terminal; if it is the terminal,
the offline drawer story changes.

## 7. The drill, before anyone serves on this package

Run with real devices, real printer, real drawer, and the actual till:

1. Sell one item by card, online. Ticket prints, drawer stays shut, sale appears on the
   dashboard.
2. Unplug the Archer's **uplink** (not its power) and leave the LAN up.
3. Confirm the till shows `offline` — the controller degrades on one timeout, goes offline on
   the third failure, and goes offline immediately if the OS reports every interface down
   (`connectivity_controller.dart`).
4. Sell one item by cash. Expect: a receipt marked `OFFLINE PROVISIONAL RECEIPT`, the drawer
   opens, the sale is provisional in the recovery centre.
5. Confirm the KDS shows nothing new. That is the finding in §5, and it is better learned in a
   drill than in a service.
6. Plug the uplink back. Confirm the controller needs **two** authoritative successes before it
   reports online again, that the provisional sale replays and maps to a real sale, and that
   the dashboard's cash figure matches the drawer.
7. Repeat step 4 three times in a row and confirm the accumulated-amount ceiling refuses the
   fourth, if the policy has one.

Record the outcome in `UMIPOS_PILOT_ISSUE_LOG_TEMPLATE.md` even when it passes.

## 8. What is still missing, in one place

1. The offline cash policy bounds for ONCA (single sale, accumulated, sale count, catalog /
   pricing / tax freshness).
2. Confirmation that the drawer is on the printer's DK port.
3. The printer's reserved address, and the port-9100 test from the till.
4. The answer to §6.2, which is a product decision and not a site one.
5. Confirmation that the tax rate and the gross-price convention in
   `ONCA_MENU_TO_UMI_MAPPING.md` §6.1 are right — an offline receipt prints a tax breakdown
   from a cached snapshot, so a wrong rate is wrong in the one place a customer keeps.
