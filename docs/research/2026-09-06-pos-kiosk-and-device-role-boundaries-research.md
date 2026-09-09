# Self-order kiosk, POS order-status, and table management: which device role owns what

- Date: 2026-09-06
- Question: This EXTENDS
  [2026-09-06-pos-kds-client-architecture-vendor-research.md](2026-09-06-pos-kds-client-architecture-vendor-research.md),
  which pressure-tested the ADR
  [2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md](../architecture/2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md)
  claim that "the 2026 pattern is one app with device-role modes." That prior file
  found the pattern is **split**: Toast fuses POS + KDS into one Android app; Square and
  Lightspeed ship the KDS as a deliberately separate, sometimes cross-OS client.
- New scope: four additional dimensions that move the fuse-vs-separate decision, because
  Umi is not only weighing POS↔KDS — a **self-order kiosk** is a plausible next device role,
  the cashier needs to know if an order is ready, table/floor management has to live somewhere,
  and fusing clients onto one binary raises a privilege-escalation question. For Toast, Square
  (and Clover where primary docs exist), investigate:
  - **A. Kiosk as a device role** — separate product/app or a mode of the POS? Dedicated
    hardware or a convertible terminal? How is the public/untrusted kiosk isolated from
    cashier/manager/payment/refund functions? Does it reuse the POS order-entry flow?
  - **B. POS order-status view** — how the cashier/front-of-house sees "is my order ready?"
    on the POS (not the KDS). Is the POS kitchen view read-only, with commands reserved to
    the KDS?
  - **C. Table / floor / seating** — confirm it is a POS/front-of-house surface, never a KDS
    concern. Which device role owns tables?
  - **D. Device mode vs user login (privilege-escalation risk of fusion)** — if the KDS is
    "the same app in KDS mode," can a staff PIN login on a kitchen screen expose POS/cashier
    powers (orders, drawer, refunds)? Is the role a **device-locked, admin-set** property, or
    is it **derived from who logs in**? Focused on Toast (the fuser); Square for contrast.
- Method: primary sources only — vendor help centers, developer/platform docs, and product
  pages (`support.toasttab.com`, `doc.toasttab.com`, `pos.toasttab.com`, `squareup.com/help`,
  `clover.com`). Comparison/SEO blogs excluded. Labels reused from the prior file:
  **VENDOR-PRIMARY** (first-party help/platform doc), **VENDOR-MARKETING** (first-party
  product page, lighter evidence), **SECONDARY** (non-vendor, kept only when no primary was
  found), **INFERENCE** (a conclusion derived here). Dimensions no primary source states are
  flagged **NOT VERIFIED**.

## 1. Framing — why the kiosk question reshapes the fuse-vs-separate decision

The prior research settled one axis: POS↔KDS is _sometimes_ one app (Toast) and _just as
often_ two purpose-built clients (Square, Lightspeed). The kiosk introduces a **second, cleaner
axis**. A kiosk is an order-entry surface: catalog → cart → modifiers → checkout — the exact
flow the POS already runs. So the reuse question is not "should the KDS be a mode of the POS"
but "which clients form a natural **order-entry/display family**?" The hypothesis under test:
the tight reuse cluster is **{POS, kiosk, customer-display}** (they share the catalog, cart,
and checkout), while **{KDS}** is a different surface (a queue of commands on an unattended
station, low order-entry overlap). If the vendors bear this out, a future kiosk **strengthens
shared code on the POS↔kiosk axis, not the POS↔KDS axis** — and, because a kiosk is public and
untrusted, it raises the priority of **server-enforced device-role authorization**, not just a
client-side "mode." The vendors confirm this strongly, and Toast — the one true fuser — draws
its own boundaries in a way that is directly instructive for Umi.

## 2. Comparison table

| Vendor      | Kiosk client: separate app or POS mode                                                                                                                                                                                                   | Kiosk hardware / OS                                                                                                                                                                                                                                                                                                                                                         | Kiosk trust-isolation mechanism                                                                                                                                                                                                                                                                                                                  | POS order-status view (read-only?)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Table / floor owner role                                                                                                                                                                                                                                                                                                                                                                 | KDS mode: device-locked vs login-derived?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**   | **A mode of the SAME POS app.** "Kiosk Mode is a mode on the terminal, like Table Service or Quick Order" ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500))                             | Toast Flex or Elo terminal "set up as a Self-Ordering Kiosk" — an ordinary terminal converts; some sold pre-configured ("14-inch Flex sold as a kiosk") ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)). Toast POS = Android ([hardware guide](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html)) | **Client lock + PIN gate + OS lock-task.** Exit needs press-and-hold the Toast logo then "a manager or admin must enter their passcode"; "This prevents guests from closing the Toast POS app." Lock Task mode on 22" Elo V4 / 22" & 14" Flex ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)) | **Mixed.** POS "Orders Hub" is a POS mode to "approve, fire, ready, and complete" takeout/delivery orders ([Orders Hub](https://support.toasttab.com/en/article/Order-Hub-Overview)); server gets a read-only "Dishes are ready to be served" notification, fired from the KDS ([KDS notifications](https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380)). Prep/expo **fulfil commands live on the KDS** ([expediter](https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html)) | **Front-of-house.** Basic seating on the POS ([Manage Tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables)); reservations/waitlist/host-stand in **Toast Tables, a separate FOH app** "not supported on Toast hardware" ([Using Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)). KDS only _shows_ coursing, never manages tables | **Device-locked, admin-set.** KDS is a device "Primary Mode" in Device Setup — "the default screen to appear upon logging in with a passcode" ([Device Setup](https://support.toasttab.com/en/article/Device-Setup-Overview-1493004445768)). Switching a device into KDS mode needs the "1.3 Kitchen Display System Mode" permission ([Get Started KDS](https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System)) — a line cook cannot flip it to POS; drawer/refund stay per-user permissions |
| **Square**  | **A SEPARATE app** — the "Square Kiosk app," installed on an iPad ([set up](https://squareup.com/help/us/en/article/8538-set-up-square-kiosk))                                                                                           | **iPad only.** "The iPad-powered Square Kiosk hardware includes integrated payments" ([kiosk software](https://squareup.com/us/en/point-of-sale/restaurants/kiosk-software)). Needs a _separate_ "primary point of sale device running Square Point of Sale" to see orders ([set up](https://squareup.com/help/us/en/article/8538-set-up-square-kiosk))                     | **Isolation by construction:** a distinct app signed in with a kiosk device code, on dedicated kiosk hardware — the Kiosk app exposes only self-serve ordering, no cashier/manager surface. No explicit guided-access lock instruction found — **NOT VERIFIED**                                                                                  | **Thin / customer-facing.** Completion happens on the **KDS Expo station**; "order-ready texts will automatically be sent from the Square KDS app" ([order-ready texts](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants)). A rich order-ready screen _on the POS cashier_ is **NOT VERIFIED** in primary docs                                                                                                                                                            | **Front-of-house.** Floor plan is "table mapping in the Square Restaurant POS app"; "staff can merge tables directly from the POS app" ([floor plan](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)). No KDS mention                                                                                                                                             | **N/A — separate app.** KDS is a different app on a different device profile ([set up KDS](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)); no POS ordering surface exists on the device to escalate to. Physical/app separation removes the risk by construction                                                                                                                                                                                                                       |
| **Clover**  | **Separate dedicated device** — Clover Kiosk, an all-in-one self-order unit ([Clover Kiosk](https://www.clover.com/help/kiosk))                                                                                                          | **Dedicated hardware:** 24" display + 8" payment terminal + built-in printer ([Clover Kiosk](https://www.clover.com/help/kiosk))                                                                                                                                                                                                                                            | Dedicated single-purpose device; "connects to and pulls your menu directly from your Clover POS system" ([Clover Kiosk](https://www.clover.com/help/kiosk)). Isolation detail beyond dedicated-device — **NOT VERIFIED**                                                                                                                         | **NOT VERIFIED** in primary docs read here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **NOT VERIFIED** in primary docs read here (Clover has table service, but not confirmed on primary pages read)                                                                                                                                                                                                                                                                           | **NOT VERIFIED** in primary docs read here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Shopify** | **No first-party restaurant kiosk/KDS.** Kiosk and KDS are third-party App Store apps (e.g. Kioskify, Store Check-In, KitchenKit, Simmer, Flip POS) — Shopify is retail-first ([Shopify App Store](https://apps.shopify.com/kitchenkit)) | Third-party, iPad/tablet                                                                                                                                                                                                                                                                                                                                                    | n/a (third-party)                                                                                                                                                                                                                                                                                                                                | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a — not a comparable first-party restaurant platform                                                                                                                                                                                                                                                                                                                                   | n/a — not a comparable first-party restaurant platform                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 3. Dimension A — self-order kiosk as a device role

### 3.1 Toast — the kiosk IS a mode of the POS app (the clean confirmation)

Toast is the fuser, and the kiosk is the strongest example of the fuse pattern — stronger than
KDS, because the kiosk literally _is_ the POS order-entry flow pointed at a guest.

- **Same app, a switchable mode — verbatim:**
  > "Kiosk Mode is a mode on the terminal, like Table Service or Quick Order."
  > ([Toast — Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)) — VENDOR-PRIMARY.
  > And: _"A user with manager or admin permissions can switch the device into and out of Kiosk
  > Mode at any time using their passcode."_
- **Convertible hardware, not a separate device.** "Applies to: Toast POS on a **Toast Flex
  terminal or Elo terminal that has been set up as a Self-Ordering Kiosk**." An ordinary POS
  terminal converts into a kiosk; some units are simply "sold as a kiosk" (14"/22" Flex, 22"
  Elo V4) ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)). Toast POS runs on Android tablets
  ([hardware guide](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html)).
  This is the same one-binary/device-role pattern the prior file documented for KDS — the
  guide there already lists "customer kiosks" as one of the roles a Toast-POS tablet plays.
- **Trust / isolation — a client lock, a PIN gate, and an OS lock-task, layered:**
  > To exit, press and hold the "powered by Toast logo," after which _"a manager or admin must
  > enter their passcode."_ _"This prevents guests from closing the Toast POS app, whether
  > intentionally or by mistake."_ Certain hardware ("22-inch Elo V4, 22-inch Toast Flex, and
  > 14-inch Flex sold as a kiosk") add **Lock Task mode** for OS-level lockdown.
  > ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)) — VENDOR-PRIMARY. So the untrusted-device problem is solved with a
  > **manager-PIN gate to leave the mode** plus an OS kiosk-lock — not by shipping a separate
  > binary.
- **Reuse is squarely on the POS↔kiosk axis.** The kiosk uses the same menu/catalog
  ("Kiosk: Menu Setup," configured in Toast Web) and the same order→pay flow, and it feeds the
  same kitchen: the kiosk keeps _"sending tickets to the KDS in the event that your devices
  enter Offline Mode during an outage"_
  ([Get Started With the Toast Self-Ordering Kiosk](https://support.toasttab.com/en/article/Get-Started-With-the-Toast-Self-Ordering-Kiosk)) — VENDOR-PRIMARY. The kiosk is an
  order-_entry_ client; the KDS remains the order-_queue_ client downstream.

### 3.2 Square — the kiosk is a separate app on dedicated iPad hardware, needing a primary POS

- **A separate app — verbatim:** to set up you "need a compatible iPad with the **Square Kiosk
  app** installed" ([Square — Set up Square Kiosk](https://squareup.com/help/us/en/article/8538-set-up-square-kiosk)) — VENDOR-PRIMARY. It is marketed as its own
  product: "Square Kiosk is a self-serve ordering solution built for quick-service and fast
  casual" ([kiosk software](https://squareup.com/us/en/point-of-sale/restaurants/kiosk-software)) — VENDOR-MARKETING.
- **Dedicated hardware + a required separate POS.** "The **iPad-powered** Square Kiosk hardware
  includes integrated payments." To see kiosk orders you need "at least one active point of
  sale device (phone, iPad, or Square hardware) using the **Square Point of Sale** app" — i.e.
  the kiosk and the cashier POS are **two devices, two apps**, sharing a backend
  ([set up](https://squareup.com/help/us/en/article/8538-set-up-square-kiosk)). Priced per device: "$50 per month per device with Square Plus" or
  "$30 per month per device with Square Premium" ([kiosk software](https://squareup.com/us/en/point-of-sale/restaurants/kiosk-software)).
- **Trust / isolation — by construction, not by a documented lock.** Because the kiosk is a
  _different app_ signed in with a _kiosk device code_, it structurally exposes only the
  self-serve order flow; there is no cashier, manager, refund, or drawer surface to reach.
  An explicit "guided access / single-app lock" instruction was **not found** in the primary
  docs read — **NOT VERIFIED** as an explicit mechanism (the app-separation itself is the
  isolation).
- **Reuse still on the POS↔kiosk axis at the data layer.** The kiosk shares the catalog and
  syncs sales: "keeps your FOH and BOH in sync with instant menu updates and real-time sales
  data," customizations go "straight to the kitchen"
  ([kiosk software](https://squareup.com/us/en/point-of-sale/restaurants/kiosk-software)). So Square agrees on the _family_ (kiosk shares the POS
  catalog/checkout/kitchen routing) but, exactly as it does for KDS, ships the kiosk as a
  **purpose-built separate client** rather than a mode of Square POS.

### 3.3 Clover — a dedicated self-order device that pulls the POS menu

- **Separate dedicated hardware:** the Clover Kiosk is "an all-in-one device featuring an
  enterprise grade 24" display, versatile payment terminal, and a built-in printer"
  ([Clover — Set up your Kiosk](https://www.clover.com/help/kiosk)) — VENDOR-MARKETING/PRIMARY. It "connects to and pulls your
  menu directly from your Clover POS system—keeping your items and pricing in sync." So again:
  a distinct kiosk device, sharing the POS catalog. Isolation detail beyond "dedicated device"
  — **NOT VERIFIED**.

### 3.4 Shopify — not a first-party restaurant platform

Shopify ships **no first-party** restaurant kiosk or KDS. Self-order kiosk and kitchen-display
are third-party Shopify App Store apps (Kioskify, Store Check-In, KitchenKit, Simmer, Flip POS)
([Shopify App Store](https://apps.shopify.com/kitchenkit)). It is retail-first and not a comparable data point for a
restaurant device-role taxonomy; noted for completeness only.

**Dimension A verdict:** every vendor treats the kiosk as part of the **order-entry family** —
it shares the POS catalog, cart, checkout, and kitchen routing. Whether it is a _mode of the
POS app_ (Toast) or a _separate app on the same backend_ (Square, Clover) follows the exact
same split the prior file found for the KDS. The untrusted-device problem is solved with
**role-scoped exposure + a lock**: Toast gates leaving kiosk mode behind a manager PIN and an
OS lock-task; Square/Clover expose only the kiosk app on a dedicated device. None expose
cashier/refund functions on the public device.

## 4. Dimension B — how the POS/cashier sees "is my order ready?"

### 4.1 Toast — the POS gets read-only status; fulfil commands stay on the KDS

- **The kitchen command lives on the KDS.** Prep and expediter fulfilment happen on KDS
  devices — "An expediter screen shows the entire order across every prep station"
  ([Toast — Using a KDS expediter screen](https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html)) — VENDOR-PRIMARY.
- **The POS/server receives a read-only notification of readiness.** "Any time an order is
  fulfilled, the employee who placed it will receive a **visual and sound notification on the
  device they are signed into**," triggered at the "Prep station," "First-level expediter," or
  "Second-level expediter" — i.e. **fired from the KDS** ([Toast — Notifications for KDS
  Fulfilled Orders](https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380)) — VENDOR-PRIMARY. The server device shows a passive
  "Table {n}/Check#{n}: Dishes are ready to be served" message. That is a **read-only status
  push to the POS**, with the fulfil _command_ reserved to the KDS role.
- **Nuance — Toast's POS "Orders Hub" is a command surface, but for a different job.** Orders
  Hub is "a mode on your Toast POS that brings all of your takeout and delivery orders onto one
  screen," where staff "approve, fire, ready, and complete orders"
  ([Toast — Orders Hub](https://support.toasttab.com/en/article/Order-Hub-Overview)) — VENDOR-PRIMARY. This is front-of-house **order-lifecycle**
  management for online/takeout/delivery tickets, not kitchen prep. It still routes into the
  kitchen "following the same prep station and Kitchen Display Screen (KDS) routing." So Toast
  keeps two command surfaces with distinct owners: **Orders Hub (POS/FOH) for the order
  lifecycle**, **KDS (kitchen) for prep fulfilment** — and a read-only ready-notification
  bridges kitchen → POS.
- **A dedicated guest-facing status role also exists (the Order Ready Board).** "Only orders
  fulfilled on an expediter KDS device can be marked as Order Ready," which moves the ticket
  "from the In Progress column to the Order Ready column." The board "shows guests and delivery
  drivers their order status"; it is a passive display — "no guest-initiated commands"
  ([Toast — Order Ready Board](https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration)) — VENDOR-PRIMARY. This is a fourth device role
  (order-ready display) whose input is the KDS and whose output is read-only.

### 4.2 Square — completion is a KDS-Expo command; the POS side is thin (customer texts)

- **The completion command is on the KDS Expo station.** "When the order is marked as complete
  from the **Square KDS app (from an Expeditor station)**, order-ready texts will automatically
  be sent from the Square KDS app" ([Square — Send order-ready texts](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants)) — VENDOR-PRIMARY.
  Prep and Expo stations "sync and communicate with one another in real time"
  ([Set up Square KDS](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)).
- **Square surfaces readiness to the CUSTOMER, not to a cashier screen.** The documented path
  is an order-ready **text to the guest**, not a read-only order-status view on the Square POS.
  A rich cashier-facing "is it ready?" screen on the Square POS was **NOT VERIFIED** in the
  primary docs read. INFERENCE: Square's answer to "cashier sees order status" is largely
  guest-facing notification, keeping the kitchen command firmly on the KDS Expo role.

**Dimension B verdict:** both vendors keep **prep/fulfil commands on the KDS role**. What
reaches the POS/front-of-house is **read-only** — Toast pushes a ready-notification (and offers
a separate guest-facing Order Ready Board driven by the KDS); Square pushes a text to the
customer. This directly supports the ADR's own design instinct that the POS's kitchen view be a
**read-only board**, with commands owned by the KDS role. Toast's Orders Hub is the one place a
POS holds order _commands_ — but for the takeout/delivery **order lifecycle**, a front-of-house
job, not kitchen prep.

## 5. Dimension C — table / floor / seating is a front-of-house surface, never a KDS one

### 5.1 Toast — tables are FOH; the KDS only _shows_ coursing, never manages it

- **Basic seating is on the POS.** Tables are created in Toast Web under "Front of House >
  Service areas & tables," and run on the POS: "Manage Tables With Toast POS"
  ([Toast — Manage Tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables); [Create Service Areas and Table Setup](https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430)) — VENDOR-PRIMARY.
- **Advanced reservations/waitlist/host-stand is a _separate FOH app_ — a notable finding.**
  Even Toast, the fuser, does **not** fold this into the POS binary:
  > "Toast Tables is a **separate app from Toast POS**. You download and run Toast Tables on an
  > iOS or Android tablet, Mac or Windows desktop computer… **Toast Tables is not supported on
  > Toast hardware.**"
  > "Use the Toast Tables app to run your host stand, manage the waitlist, take reservations,
  > assign servers, and seat parties on your floor plan."
  > ([Toast — Using Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)) — VENDOR-PRIMARY.
- **The KDS is a read-only consumer of table data, not an owner.** "If your restaurant uses a
  kitchen display screen, item icons on each seated table show coursing status" — the KDS
  _reflects_ coursing of items already sent, it never manages the floor
  ([Using Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)).

### 5.2 Square — floor plan is a POS/FOH surface

- "you can design your floor plan to help you manage the flow of service via **table mapping in
  the Square Restaurant POS app**"; "During service, **staff can merge tables directly from the
  POS app**" ([Square — Building your floor plan](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)) — VENDOR-PRIMARY. Sections model Dining
  Room / Bar / Patio. **No** mention of the floor plan on the KDS.

**Dimension C verdict:** unambiguous. Table/floor/seating is a **front-of-house** concern owned
by the POS (basic seating) or a dedicated FOH host-stand app (Toast Tables). **No vendor puts
floor/table management on the kitchen display.** The KDS only _reads_ coursing/table labels to
sequence prep. For Umi this means the customer/table surface belongs to the POS-family roles,
never to the KDS role — and confirms the KDS's job is a narrow prep queue.

## 6. Dimension D — device mode vs user login (the privilege-escalation question)

The sharpest objection to fusion: if the KDS is "the same app in KDS mode," could a line cook's
PIN login on a kitchen screen hand them cashier powers — take orders, open the drawer, run
refunds — on a device that should only bump tickets? The vendors answer this cleanly, and the
answer is the crux of Umi's Phase-2 device-role design.

### 6.1 Toast — the role is a DEVICE property (admin-set), not derived from who logs in

- **KDS mode is a device-level "Primary Mode," set in Device Setup — verbatim:**
  > "Primary Mode — Select the **default screen to appear upon logging in with a passcode**.
  > They include: Table Service, Quick Order, Payment Terminal, Pending Orders, **Kitchen
  > Display/Expo**, Orders Hub."
  > ([Toast — POS Device Setup Overview](https://support.toasttab.com/en/article/Device-Setup-Overview-1493004445768)) — VENDOR-PRIMARY.
  > So the surface a user lands on is a **property of the device**, configured in Device Setup
  > ("Device Setup → Primary Mode → Kitchen Display/Expo Screen → Save"), not something computed
  > from the individual's role. A login authenticates _who_; the device decides _which surface_.
- **Flipping a device into (or out of) KDS mode is permission-gated — verbatim:**
  > "The Toast user signed in to the device must have the **1.3 Kitchen Display System Mode**
  > permission to switch that device into KDS mode. To reach all of the device setup options for
  > the KDS, that user also needs the **7.3 KDS and Order Screen Setup** permission."
  > ([Toast — Get Started With the KDS](https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System)) — VENDOR-PRIMARY. A line cook without the
  > `1.3` / `7.3` permissions **cannot** reconfigure a KDS device into a POS ordering terminal.
  > Mode-switching is a manager/admin action, exactly as the kiosk exit is ("A user with manager
  > or admin permissions can switch the device into and out of Kiosk Mode… using their passcode,"
  > [Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)).
- **Capabilities are a SECOND, independent gate (the user's permissions).** Even where POS
  order-entry UI is reachable in the binary, the powerful actions — payments, cash drawer,
  voids/refunds — are governed by the signed-in employee's permission set, not by the fact that
  the app _contains_ that code. Toast's model layers **device Primary Mode (which surface)** on
  top of **per-user permissions (which capabilities)**.
- **INFERENCE (labelled):** because the surface is device-locked and mode-switching plus each
  sensitive capability are separately permission-gated, Toast's single-binary fusion does **not**
  hand a kitchen employee cashier powers by virtue of logging into a KDS device. The escalation
  is closed by _server-side authorization_, not by app separation. The client _contains_ the POS
  code (that is the residual attack surface of any fused binary); what it _permits_ is scoped by
  device role + user permission.
- **NOT VERIFIED:** whether Toast KDS requires a per-employee passcode to bump/fulfil each ticket
  or runs unattended after one login was not stated in the pages read; and no page read
  _explicitly_ says "a KDS-mode device hides the POS ordering UI." Both are inferred from the
  device-Primary-Mode + permission model above, not directly quoted.

### 6.2 Square — separation removes the escalation question by construction

Because Square ships the **KDS as a separate app** on a separate device profile
([Set up Square KDS](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android); prior file), a kitchen screen runs the Square KDS
app and **does not contain** the Square POS ordering, drawer, or refund surface at all. There is
no mode to escalate into and no POS code on the device. Whoever signs into the KDS app can only
do kitchen actions (prep/expo complete/recall). App-and-device separation makes the
privilege-escalation surface **zero by construction** — this is the security argument _for_
separate clients, and the mirror image of the code-reuse argument _for_ fusion.

### 6.3 The general principle

Toast confirms the principle Umi should adopt: **the device role is an admin-provisioned property
of the device/session, and a login only authenticates _who_, never _which surface_ — while
sensitive capabilities are independently permission-scoped.** That is precisely a _server-enforced_
model, not a client toggle. Square reaches the same safety by physical separation. Either way, the
guarantee lives on the server, not in the client's UI state.

**Dimension D verdict:** client fusion _does_ create a residual privilege-escalation surface that
separate clients avoid by construction — the fused binary carries the POS code onto the kitchen
device. Toast neutralizes it by making the KDS surface a **device-locked Primary Mode** that only
a `1.3`-permissioned user can change, and by gating drawer/refund/payment behind **per-user
permissions**. The lesson for Umi is unambiguous: a fused `umi-pos` must treat device role as a
**server-authorized attribute**, and must not let a client-side "mode" be the thing that decides
what a device may do.

## 7. Device-role taxonomy

Every distinct client each vendor ships, and whether it is one shared app or a distinct client.

**Toast** (one Android POS binary carries multiple roles; two things sit outside it):

- **POS terminal** — Toast POS app (Table Service / Quick Order mode). Shared app.
- **Handheld** — the same Toast POS app on a wireless handheld. Shared app.
- **Self-order kiosk** — the same Toast POS app in **Kiosk Mode**. **Shared app / device-role
  mode** ([Kiosk Mode Overview](https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500)).
- **KDS** — the same Toast POS app in **KDS Mode** (expediter or prep). **Shared app /
  device-role mode** (prior file), licensed separately.
- **Order Ready Board** — guest-facing status display, driven by the KDS
  ([Order Ready Board](https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration)). Configured in Toast Web; a distinct display role.
- **Toast Tables (host stand / reservations / waitlist / floor)** — **a distinct, separate app**
  that explicitly does **not** run on Toast POS hardware ([Using Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)).
- (Customer/guest-facing display — Toast has guest-facing screens/Mobile Order & Pay; the
  in-house customer-display client architecture was not the focus here — treat as **NOT
  VERIFIED** in this file.)

  → Toast fuses **POS + handheld + kiosk + KDS** into one binary; keeps **Tables** a separate
  app and the **Order Ready Board** a separate display role.

**Square** (a family of purpose-built apps on a shared backend):

- **POS terminal** — Square Point of Sale / Square for Restaurants app (iPad, and Square
  hardware). Distinct client.
- **Handheld** — Square POS on a phone/handheld. Same POS app.
- **Self-order kiosk** — **Square Kiosk app**, iPad, dedicated hardware. **Distinct client**
  ([set up](https://squareup.com/help/us/en/article/8538-set-up-square-kiosk)).
- **KDS** — **Square KDS app**, Android-only (iOS retired 12 Jan 2026). **Distinct client**
  (prior file).
- **Order-ready notification** — customer text sent from the KDS Expo, not a separate device
  ([order-ready texts](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants)).
- **Floor plan / tables** — a surface **inside** the Square Restaurant POS app, not a separate
  client ([floor plan](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)).
- (Customer-facing display — Square hardware has a customer display for payment; a standalone
  guest-display _client_ was not verified here — **NOT VERIFIED**.)

  → Square ships **POS, Kiosk, and KDS as three distinct apps** (kiosk and KDS on different
  device profiles), unified only at the backend; tables live inside the POS app.

## 8. Decision impact — does a future kiosk change the fuse-vs-separate decision, and on which axis?

**Direct answer.** Yes — a kiosk changes the framing, and it does so on the **POS↔kiosk axis,
not the POS↔KDS axis**, exactly as the hypothesis predicts. The primary evidence confirms the
kiosk belongs to the **order-entry/display family {POS, kiosk, customer-display}**: at all three
restaurant vendors the kiosk shares the POS catalog, cart, modifiers, checkout, and kitchen
routing, and Toast implements it as literally the same app in Kiosk Mode ("a mode on the
terminal, like Table Service or Quick Order"). The **KDS remains the odd one out** — a queue of
prep commands on an unattended station — and the vendors keep the _command_ there: Toast's POS
gets only a read-only ready-notification, Square's readiness is a customer text sent from the
KDS Expo, and **no vendor** puts table/floor management on the KDS. So a kiosk **raises**, not
lowers, the value of sharing code across the POS-family roles, while leaving the POS↔KDS split
exactly as ambiguous as the prior file found it.

**What this means for Umi's ADR:**

1. **The strongest fuse case is POS↔kiosk, and it is under-exploited by the current ADR.** The
   ADR frames fusion around POS↔KDS (the hardest, ~2800-line, lowest-overlap pairing). But the
   cleanest, highest-overlap reuse — and the one Toast most clearly validates — is **POS↔kiosk↔
   customer-display**, because all three run the catalog→cart→checkout flow the POS already
   has. If Umi expects a kiosk, the `umi-pos` binary is the natural host for a **kiosk device
   role** with near-zero new order-entry code. This is a _reinforcement_ of the ADR's
   single-client direction, but on a better-justified axis than KDS.

2. **The kiosk elevates server-enforced, per-device authorization from nice-to-have to
   load-bearing.** A kiosk is public and untrusted. Toast's answer is layered — a manager-PIN
   gate to exit the mode plus OS Lock Task — and Square's is a separate app on a dedicated
   device with no cashier surface. Either way the guarantee cannot be a client-side "mode":
   Umi's Phase-1 approach of reusing the operator POS session for the kitchen view does **not**
   generalize to a kiosk. The ADR's Phase-2 goal (an additive device-role attribute
   `pos | kds | customer_display`, server-authorized) should be **extended to include
   `kiosk`** and treated as the mechanism that scopes what an untrusted device may call — not a
   client toggle. This is the single most important carry-over: **untrusted device roles make
   server-side role authorization mandatory.**

3. **It does not strengthen the POS↔KDS fuse.** Confirmed against the vendors: the KDS is a
   command/queue surface, read-only from the POS side, table-blind, and (Square) even on a
   different OS. A kiosk adds order-entry siblings to the POS; it adds nothing to the KDS's
   overlap. The KDS fuse must still stand on its own cost/reliability math (the ADR's ~2800-line
   port, unattended session, heartbeat, sequenced-event reconciliation) — the kiosk gives it no
   new support.

4. **Even the fuser keeps some roles separate — plan the boundary, not a monolith.** Toast fuses
   POS + handheld + kiosk + KDS into one binary yet still ships **Toast Tables as a separate
   app that will not run on POS hardware**, and treats the **Order Ready Board** as its own
   display role. INFERENCE for Umi: "one client with device-role modes" is a spectrum, not an
   absolute. The defensible target is **one `umi-pos` binary carrying the order-entry family
   (POS, kiosk, customer-display) with server-enforced roles**, plus the KDS as its own surface
   (fused or separate on cost grounds) — and an accepted allowance that some FOH surfaces
   (reservations/host-stand) may stay separate, as they do even at Toast.

5. **Fusion adds a privilege-escalation surface; close it on the server, as Toast does.**
   A single binary that renders POS _and_ KDS _and_ kiosk carries the cashier code (orders,
   drawer, refunds) onto the kitchen and public devices — a surface that Square's separate KDS
   and Kiosk apps avoid _by construction_. Toast keeps this safe with a two-layer,
   server-authorized model: the surface is a **device-locked "Primary Mode"** that only a user
   with the `1.3 Kitchen Display System Mode` permission can change, and sensitive capabilities
   (payment, drawer, void/refund) are gated by the **signed-in user's permissions**, not by the
   app merely containing the code. INFERENCE for Umi: a fused `umi-pos` must not let a
   client-side "mode" decide what a device can do. The Phase-2 device-role attribute must be
   **server-provisioned and admin-locked**, and every sensitive action must re-check the user's
   permission server-side — so that a barista PIN on a KDS or kiosk device authenticates _who_,
   never unlocks _which surface_ or _which capability_. Do this and fusion is as safe as
   separation; skip it and fusion is strictly more dangerous.

**Net:** the prospect of a kiosk **confirms** the hypothesis. It clusters {POS, kiosk,
customer-display} as the true shared-code family, leaves {KDS} a genuinely different surface,
turns server-enforced device-role authorization into a first-class requirement rather than a
Phase-2 nicety, and makes clear that the price of one binary is a privilege-escalation surface
that only server-side role + permission enforcement can close.

## 9. Dimensions not verified from primary sources (flagged, not guessed)

- **Square kiosk isolation:** no explicit "guided access / single-app lock" instruction found
  in the primary docs read; isolation is by app-separation and dedicated device (structural),
  which is documented, but the enforced-lock mechanism is **NOT VERIFIED**.
- **Square POS-facing order-status screen:** primary docs show a customer order-ready **text**
  from the KDS Expo; a cashier-facing "is it ready?" screen on Square POS is **NOT VERIFIED**.
- **Clover:** POS order-status view and table/floor ownership were **NOT VERIFIED** in the
  primary pages read (only the kiosk device + menu sync were confirmed).
- **Customer/guest-display client architecture** for both Toast and Square (as a standalone
  in-house _client_, distinct from the payment-facing customer display) was **not** the focus
  and is **NOT VERIFIED** here.
- **Toast KDS login/isolation (Dimension D):** whether the Toast KDS requires a per-employee
  passcode to bump each ticket or runs unattended after one login is **NOT VERIFIED** in the
  pages read; and no page read _explicitly_ states "a KDS-mode device hides the POS ordering
  UI." The device-locked Primary Mode and the `1.3`/`7.3` permission gates ARE verified; the
  conclusion that this closes the escalation is a labelled INFERENCE built on them.
- **Shopify:** confirmed only that restaurant kiosk/KDS are third-party App Store apps, not
  first-party — no first-party device-role data exists to verify.

## 10. Primary sources

Dimension A — kiosk:

- Toast — Use Kiosk Mode on Your Terminal (mode like Table Service/Quick Order; exit via
  manager passcode; Lock Task; Flex/Elo hardware):
  https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500
- Toast — Get Started With the Toast Self-Ordering Kiosk (kiosk sends tickets to KDS in Offline
  Mode): https://support.toasttab.com/en/article/Get-Started-With-the-Toast-Self-Ordering-Kiosk
- Toast — POS hardware components (one app, many roles incl. customer kiosks; Android):
  https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html
- Square — Set up Square Kiosk (separate Square Kiosk app; iPad; requires a primary Square POS
  device): https://squareup.com/help/us/en/article/8538-set-up-square-kiosk
- Square — Kiosk software product page (iPad-powered; $50/$30 per device; menu sync):
  https://squareup.com/us/en/point-of-sale/restaurants/kiosk-software
- Square — Customize self-serve ordering (order-ready by name/table/order number, text):
  https://squareup.com/help/us/en/article/8313-customize-self-serve-ordering-with-square-kiosk
- Clover — Set up your Kiosk (dedicated 24" device; pulls menu from Clover POS):
  https://www.clover.com/help/kiosk
- Shopify App Store (third-party kiosk/KDS; retail-first): https://apps.shopify.com/kitchenkit

Dimension B — POS order-status:

- Toast — Orders Hub overview (POS mode to approve/fire/ready/complete takeout & delivery):
  https://support.toasttab.com/en/article/Order-Hub-Overview
- Toast — Notifications for KDS Fulfilled Orders (read-only ready-notification to the device
  that placed the order; fired from prep/expediter):
  https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380
- Toast — Order Ready Board (guest-facing status display, driven by expediter KDS; read-only):
  https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration
- Toast — Using a KDS expediter screen (expediter view across prep stations):
  https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html
- Square — Send order-ready texts (completion on KDS Expo triggers customer text):
  https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants
- Square — Set up Square KDS (Prep + Expo stations sync in real time):
  https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android

Dimension D — device mode vs user login:

- Toast — POS Device Setup Overview (Primary Mode = "default screen to appear upon logging in
  with a passcode"; Kitchen Display/Expo is a device-level Primary Mode):
  https://support.toasttab.com/en/article/Device-Setup-Overview-1493004445768
- Toast — Get Started With the KDS ("1.3 Kitchen Display System Mode" permission to switch a
  device into KDS mode; "7.3 KDS and Order Screen Setup" for device setup):
  https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System
- Toast — Use Kiosk Mode on Your Terminal (manager/admin passcode to switch modes):
  https://support.toasttab.com/en/article/Kiosk-Mode-Overview-1493053499500
- Square — Set up Square KDS (separate app on a separate device profile; no POS surface to
  escalate into): https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android

Dimension C — tables/floor:

- Toast — Using Toast Tables (separate app; not on Toast hardware; host stand/floor/waitlist;
  KDS only shows coursing): https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist
- Toast — Manage Tables With Toast POS (basic seating on the POS):
  https://support.toasttab.com/en/article/New-POS-Managing-Tables
- Toast — Create Service Areas and Table Setup (Front of House > Service areas & tables):
  https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430
- Square — Building your floor plan (table mapping in the Square Restaurant POS app; merge
  tables from POS): https://squareup.com/help/us/en/article/6427-building-your-floor-plan
