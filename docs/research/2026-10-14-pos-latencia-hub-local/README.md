# Pos latency: where the order path runs, and how the market keeps it fast

- Date: 2026-10-14
- Question: **where do the POS products run the order path, and what does that
  imply for Umi, whose till pays a wide-area round trip for almost every action?**
- Decision it informs: whether Umi's order path (open account → add items → fire →
  print/KDS) should keep depending on the cloud for each step, and what the target
  architecture is.
- Trigger: measured in production today, an action on the till costs a round trip
  to the API in Boston plus a round trip to Postgres in Ohio. The owner reports the
  till "se siente lento".

Labels: **Documented fact**, **Source-backed tradeoff**, **Inference**,
**UNVERIFIED**.

## 1. Answer

**Inference, supported by documented facts.** The market does not run the order
path over the internet. Every serious product keeps the order path **inside the
restaurant's local network** and treats the cloud as the place where configuration,
reporting and multi-site consolidation live. Toast does it with a "local hub"
device; Lightspeed documents an "active device" that all local devices talk to;
Soft Restaurant — the Mexican incumbent — installs a **server machine inside the
branch**, and the newer Mexican cloud products advertise a local server per branch
as their differentiator.

**Inference.** Umi today is the opposite shape: the till, the KDS and the drawer
are thin clients of a cloud API whose database sits in another region. That is the
structural cause of the perceived slowness, not the Flutter UI and not the
queries alone.

**Inference.** The runner-up is to stay cloud-only and buy speed with geography
(the API and the database in the same region, closer to the café) plus fewer round
trips per screen. It is cheaper than a local hub, and it does not remove the
ceiling: **the floor is one wide-area round trip per action, forever.**

## 2. Competitors examined

Six, and the count is deliberate: **Toast, Square, Clover, Lightspeed
(K-Series), Soft Restaurant, 2POS**. The first four are the international
reference; the last two are what a café in Mazatlán is actually sold locally.

## 3. What Umi actually pays today (measured, 2026-10-14)

Own measurement, on the production pilot. This is the baseline the market answer
is compared against.

| Leg                                      | Measured                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Till (café) → API (Boston)               | **96–100 ms** per round trip, stable (iMin, A9; the A11 reached 205–310 ms)   |
| API (Boston) → Postgres (Supabase, Ohio) | **~30 ms** trivial query, **~45 ms** filtered query, **220 ms** first connect |
| KDS board read (server side)             | **235 ms** median                                                             |
| Dashboard cash screens (server side)     | **1.7 s** and **2.8 s**                                                       |

So a single till action has a floor of roughly **130–200 ms** before the app does
anything, and screens that issue three or more reads multiply it.

## 4. Comparison grid

| Product                  | Where the order path runs                                                                                                                              | What the cloud still does                                                               | Source                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**                | Local network, through a **local hub device**                                                                                                          | Config, reporting, payments, cross-site                                                 | [Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)                                                                                                                                                     |
| **Square**               | On the device; card payments queue encrypted and upload later                                                                                          | Everything else; offline payments only for some modes and a window                      | [Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)                                                                                                                                                 |
| **Clover**               | Device keeps working offline and processes later; a POS can talk to it over the **LAN**                                                                | Cloud for reporting and app management                                                  | [Handle offline payments](https://docs.clover.com/dev/docs/handling-offline-payments)                                                                                                                                                                            |
| **Lightspeed K-Series**  | **LAN first**: "all local devices can connect to each other on the local network", with an _active device_ and passive screens                         | Cloud services (gift cards, loyalty) stop working offline                               | [Offline POS functionality](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality)                                                                                                                                |
| **Soft Restaurant** (MX) | **Server machine installed in the branch**; stations link to it by name/port                                                                           | Reporting and multi-company tools                                                       | [System requirements: "Equipo Servidor"](https://softrestaurant.com/soft-restaurant-precio) · [Linking workstations to the server](https://softrestaurant.zohodesk.com/portal/es/kb/articles/enlace-de-estaciones-de-trabajo-con-el-servidor-en-soft-restaurant) |
| **2POS** (MX)            | **"Cada sucursal trabaja en su propio servidor local"**, sold as "sin latencia"                                                                        | A "sincronizador" consolidates branches                                                 | [2pos.mx](https://2pos.mx/)                                                                                                                                                                                                                                      |
| **Parrot** (MX)          | Cloud product **with a local working copy**: one POS is the _principal_, "desde donde se sincroniza toda la información", and the rest work against it | The admin portal (menu, reports, branches); sync is asynchronous and visible per module | [Configurar punto de venta principal](https://soporte.parrotsoftware.com.mx/login-pos/configurar-punto-de-venta-principal) · [Estatus de sincronización](https://soporte.parrotsoftware.com.mx/sincronizacion/estatus-de-sincronizacion)                         |

Captures of each named page are in [`assets/`](./assets/):
`toast-local-sync.png`, `toast-offline-overview.png`,
`lightspeed-offline-lan.png`, `square-offline-payments.png`,
`softrestaurant-requisitos-servidor.png`, `2pos-arquitectura-hibrida.png`,
`parrot-pos-principal.png`, `parrot-sincronizacion.png`,
`square-kds-app.png`, `pwa-offline-storage.png`.

## 5. The claims, labelled

**Documented fact.** Toast routes orders through a device on the restaurant's own
network: _"sync uses a Toast device as the point of connection, or the local hub
device, between all devices on a restaurant's local network. This allows Toast
devices to communicate with each other in the event that an issue arises with the
internet service provider or Toast"_ — read verbatim on
[the local-sync page](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)
and captured in `toast-local-sync.png`.

**Documented fact.** Lightspeed describes the same shape without calling it a hub:
_"all local devices can connect to each other on the local network and the active
POS device can communicate with Lightspeed or other third-party integrations via
its connection to the internet"_, and its KDS keeps working because it is on that
network
([Offline POS functionality](https://k-series-support.lightspeedhq.com/hc/en-us/articles/53028167251867-Offline-POS-functionality)).

**Documented fact.** Square sells offline card acceptance as a supported mode with
seller-configurable limits, and the payments are uploaded later — its own guide
asks sellers to come back online within 24 hours of the first offline payment
([Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode),
[preparation guide PDF](https://assets.ctfassets.net/2d5q1td6cyxq/4rtVe6rP0Gs7fuKTgNV1Wh/1fc12b306941811bee0245b1d880aa49/Square_Offline_Payments_Preparation_Guide_GB.pdf)).

**Documented fact.** Clover's developer documentation states offline payments are
available **over the local connection** and that a POS talks to the device through
an embedded server on the LAN
([REST Pay connection](https://docs.clover.com/dev/docs/rest-pay-connection),
[Configure a local connection](https://docs.clover.com/dev/docs/configuring-a-local-connection)).

**Documented fact.** Parrot — the product this site ran before Umi — is a cloud
product with a **local working copy on a designated POS**. Its help centre
describes the _punto de venta principal_ as the one "desde donde se sincroniza toda
la información de tu restaurante": the POS downloads the information from the admin
portal when it is set up, and the other screens work against it
([Configurar punto de venta principal](https://soporte.parrotsoftware.com.mx/login-pos/configurar-punto-de-venta-principal),
captured in `parrot-pos-principal.png`).

**Documented fact.** Parrot's sync is asynchronous and visible per module: the
sync-status screen exists to tell whether "todo está sincronizado correctamente
entre tu punto de venta y la nube", and a yellow module means "información
pendiente por subir a la nube (puede ser por una desconexión temporal)" — the
store-and-forward shape
([Estatus de sincronización](https://soporte.parrotsoftware.com.mx/sincronizacion/estatus-de-sincronizacion),
captured in `parrot-sincronizacion.png`).

**Documented fact.** Soft Restaurant, the Mexican incumbent, ships as software you
install on a machine in the branch: its price page lists an "Equipo Servidor"
(server machine) with a minimum of 4 GB RAM, Core i3, Windows 10/Server, and its
knowledge base documents workstations joining that server by name and port
([requirements](https://softrestaurant.com/soft-restaurant-precio),
[workstation linking](https://softrestaurant.zohodesk.com/portal/es/kb/articles/enlace-de-estaciones-de-trabajo-con-el-servidor-en-soft-restaurant)).

**Documented fact.** 2POS, a Mexican cloud product, sells the local server as the
feature: "Operación Local en Tienda — Cada sucursal trabaja en su propio servidor
local. Velocidad máxima, sin latencia, sin depender de señal", with a cloud
synchroniser on top ([2pos.mx](https://2pos.mx/)).

**Documented fact.** Parrot, the other Mexican reference, states it "opera
completamente en la nube" and asks for at least 30 Mbps, while recommending to
Mexican restaurants "un POS en la nube con modo offline"
([Parrot help centre](https://parrotsoftware.com.mx/centro-de-ayuda),
[choosing a POS](https://parrotsoftware.com.mx/blog/como-elegir-software-pos-restaurante-mexico)).

**Source-backed tradeoff.** The cost of the local shape is named by vendors who
sell the cloud one: a local server per site means maintaining, patching and
backing up a machine per branch
([Toast, cloud vs on-premise](https://pos.toasttab.com/uk/blog/on-the-line/cloud-pos-vs-on-premise-for-restaurant-groups)).
The cost of the cloud shape is the latency itself, which is why the same vendors
added a local hub.

**UNVERIFIED.** No product publishes the _per-action_ latency budget of its order
path, so no vendor number can be compared with Umi's measured 130–200 ms floor.
The 20–100 ms per step and "15–20 round trips for a four-item order" figures that
appear in agency blogs
([KwickOS](https://kwickos.com/blog/cloud-vs-local-pos-comparison.html),
[DarfarPOS](https://darfarpos.com/blog/cloud-vs-hybrid-pos-systems-compared.html))
are **secondary sources** and are recorded here as context, not as evidence.

## 6. Conflicts between sources

- **Cloud against local is a sales position, not a fact.** Toast publishes "cloud
  vs on-premise" pieces that favour cloud, while documenting a local hub; 2POS
  sells the local server as the antidote to latency. Both are describing the same
  hybrid: the disagreement is where the marketing puts the emphasis.
- **Parrot says cloud-only, Soft Restaurant installs a server.** Both are sold in
  Mexico. The difference is segment: cloud for small, connected operations;
  on-premise for places where the internet is the risk.
- **Square's offline mode is narrower than Toast's.** Square queues _payments_
  and is explicit about limits and expiry; Toast keeps _orders_ flowing between
  devices on the LAN. "Offline mode" is not one thing.

## 7. What did not change since the last pass

Read first, per the skill: these prior passes already settled ground this file does
not re-litigate.

- [`2026-09-06-pos-kds-client-architecture-vendor-research.md`](../2026-09-06-pos-kds-client-architecture-vendor-research.md)
  — which products ship a KDS app, and on what hardware. Its list of _unverified_
  items included "Toast: KDS offline behavior" and "Square: offline behavior".
  **Changed:** this pass answers that for Toast (local hub), Lightspeed (LAN) and
  Square (payments only). The rest of that document stands.
- [`2026-10-01-pos-runtime-for-low-end-hardware.md`](../2026-10-01-pos-runtime-for-low-end-hardware.md)
  — keep Flutter; the lever is the widget layer and a memory budget, not a rewrite.
  **Unchanged**, and this pass adds nothing against it: the perceived slowness is
  network, not the engine.
- [`2026-09-06-competitive-scan-and-gap-audit/README.md`](../2026-09-06-competitive-scan-and-gap-audit/README.md)
  — the broader gap list. **Unchanged.**

## 8. Route log

| Route                                                    | Result                                                                                                                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc.toasttab.com` (platform guide)                      | Full access. Used for the local-hub quotes.                                                                                                                                   |
| `support.toasttab.com`                                   | Full access. Offline-mode practice articles.                                                                                                                                  |
| `k-series-support.lightspeedhq.com`                      | Full access. LAN/offline article and KDS hub setup.                                                                                                                           |
| `squareup.com/help`                                      | Full access. Offline payments limits.                                                                                                                                         |
| `docs.clover.com`                                        | Full access. Local connection and offline payments.                                                                                                                           |
| `softrestaurant.com`, `softrestaurant.zohodesk.com`      | Full access to the requirements and workstation pages. The 11/12 install manual is a **PDF behind a download form**: not fetched, the requirements page was captured instead. |
| `2pos.mx`, `parrotsoftware.com.mx`                       | Full access.                                                                                                                                                                  |
| `es.scribd.com` (Soft Restaurant manuals)                | Not used. Third-party copy of a vendor manual; the vendor's own pages answered.                                                                                               |
| Secondary blogs (kwickos, plansmith, darfarpos, skyline) | Read as context only, and labelled as secondary.                                                                                                                              |

## 9. Recommendation

**Inference.** Move the order path to the local network, in steps, and keep the
cloud for what the cloud is good at.

1. **Target: a local hub in the branch.** One device (today, the iMin) holds the
   working state for the account/order path and serves the other terminals over
   the LAN — this is Toast's and Lightspeed's shape, and it is also what Umi's
   existing offline journal is a first step towards.
2. **Keep the cloud authoritative for configuration and reporting**: catalogue,
   policies, cash reconciliation, dashboards, multi-branch. Toast, Lightspeed and
   Square all do this; nothing here requires abandoning the cloud.
3. **Before the hub exists, buy speed with geography**: the API and the database in
   the same region, and closer to Mexico. It is a configuration change, not a
   redesign, and it cuts tens of milliseconds from _every_ action.
4. **Cut round trips per screen** meanwhile: the measured worst offenders are the
   cash screens at 1.7–2.8 s.

**Runner-up:** stay cloud-only and do only 3 and 4. Cheaper, no local
infrastructure to maintain, and it keeps the working database in one place — but
it keeps a wide-area floor under every tap, and it leaves the café unable to sell
during an internet outage, which is the exact scenario both Mexican competitors
sell against.

**What would change this answer:** if Umi's terminals are ever guaranteed a
network path of a few milliseconds to a database in the same city as the café, the
local hub stops being worth its operational cost. There is no evidence that is
the plan today.

## 10. Where the site's own LAN stands (measured 2026-10-14)

The hardware for the market's shape is already in the site's inventory — and it is
**not in the path**.

- `docs/pilot/UMIPOS_SITE_DEVICE_INVENTORY.md` names the site's network
  `UMI-<SITE>-NET-01` and gives the intended topology: the **TP-Link Archer C50**
  wired to the iMin till and the Epson printer, with the A9 (KDS) and the A11
  (mobile POS) on Wi-Fi. Its pending-work list is exactly the local-network
  groundwork: rename the router and SSIDs, pin DHCP reservations by hardware MAC,
  name the devices, and register the printer against the till that prints.
- **Measured now:** all three terminals are on the café's ISP router,
  **`Megcable_2.4G_CE4F`**, over Wi-Fi on the **2.4 GHz** band. The iMin is not
  wired. The Archer is powered and belongs to the Parrot package, so its network is
  currently the old till's.

**Inference.** Putting the four devices on the site's own router buys three things
immediately, before any redesign: the tablets leave the congested 2.4 GHz band used
by the café's guests (the A11 measured 205–310 ms with jitter against the A9's
stable 100 ms), the till and the printer get a wire with ~1 ms to each other, and
the addresses become stable.

**Inference.** It buys nothing for Umi's own latency: the state still lives in
Boston and Ohio, so the order path keeps paying the wide-area round trip. The
router is the **prerequisite** of the hub, not a substitute for it. An Archer C50
is a router — 4 LAN ports, no containers — so the hub itself would live on a device
on that network: the wired, always-on till is the natural candidate today, with a
small mini PC as the alternative.

**Reported by the owner, 2026-10-14.** In the Parrot package this site ran before
Umi, **the primary POS — the one that had to stay powered on — was the iMin**, and
the Archer C50 was the network the tablets and the printer hung off. That is the
market's shape, already deployed at this address: a designated local node with the
working copy, a LAN around it, and the cloud for the portal and the sync.

**Inference.** This makes the gap precise. Umi inherited the topology — a wired,
always-on terminal at the counter, a private router with the KDS and the handheld
on it, a LAN printer — and lost the one thing that made it work: **the node role**
on the till. Our app has no principal POS; it asks the cloud for everything, and
when the internet drops it keeps only a hardware journal, not the operation.

## 11. The other branch: cloud with no node (own tablet, no devices)

The products that ask for nothing but a tablet do not remove the round trip. They
**hide** it, and they pay for it with eventual consistency.

**Documented fact.** Square's own reference for this shape keeps the order on the
device and queues the **card payment** locally, encrypted, until the connection
returns; there is a window (24 hours with some hardware, 72 hours for pending
payments) and a warning that pending payments are **lost** if the app is deleted,
the account is signed out or the device is reset
([Process offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode),
[View offline payments](https://squareup.com/help/us/en/article/8551-view-offline-payments)).
Its kitchen screen is a **separate app signed into the account**, so tickets reach
it through the cloud
([Set up Square KDS](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android),
captured in `square-kds-app.png`).

**Documented fact.** The PWA family does it with local storage and an outbox: the
app answers from the device and syncs later. Microsoft's own guidance names
IndexedDB as the practical store for that
([Store data on the device](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/offline),
captured in `pwa-offline-storage.png`), and POS products in that family document the
same recipe — every offline order written to IndexedDB and uploaded when the
connection returns ([contable.io](https://contable.io/docs/en/pos/modo-offline/),
[Pause POS](https://pausepos.com/offline)).

**Documented fact.** SumUp and Zettle make offline an **explicit session** with
rules fetched while online, transactions stored on the device and authorised later;
deleting the app before the upload loses them
([SumUp offline transactions](https://developer.sumup.com/terminal-payments/sdks/offline-transactions),
[Zettle offline card payments](https://developer.zettle.com/docs/payment-integrations/android-sdk/user-guides/manage-offline-card-payments)).

**Inference.** That branch works because the operation it serves is **per device**:
one tablet, its own orders, its own queue. The moment several screens must agree in
real time — tables, accounts, kitchen — the same vendors stop pretending: Square's
KDS is a cloud app, and the products that do promise live sharing without internet
(Toast, Lightspeed, Parrot, Clover) all grew a node in the building. Umi's operation
is the second kind: caja, KDS and handheld share the same accounts and tables.
