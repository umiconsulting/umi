# POS + KDS client architecture: what Toast, Square, Lightspeed, and NovaTab actually ship

- Date: 2026-09-06
- Question: Umi must decide whether to FUSE its Kitchen Display System (KDS) into its
  POS client app as a **device-role mode** — one Flutter app (`umi-pos`) that renders POS,
  KDS, or customer-display by the device's assigned role — and retire the separate native
  `umi-kds`. The decision ADR is
  [2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md](../architecture/2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md).
- Claim under test (from the ADR, "Cómo lo hacen los negocios modernos"): _"The 2026 trend
  is one platform with a single source of truth and device-role modes, not separate apps…
  The winning pattern: one codebase, the device is assigned to a role, and the same app
  renders the correct mode."_ The ADR sourced that from **secondary** comparison/SEO sites
  (sonary.com, expertmarket.com, novatab.com), not from the vendors' own docs.
- Scope: for Toast, Square, Lightspeed, and NovaTab, pressure-test the claim against
  **primary** vendor documentation on six dimensions — (1) client architecture (separate
  app vs. a mode of the POS app), (2) hardware and OS, (3) where the single source of truth
  actually lives (shared backend vs. one client binary), (4) command/interaction model,
  (5) licensing per screen, (6) explicit role-mode evidence.
- Method: primary sources only — vendor developer docs, help/support centers, and product
  pages (`doc.toasttab.com`, `support.toasttab.com`, `pos.toasttab.com`,
  `squareup.com/help`, `k-series-support.lightspeedhq.com`, `novatab.com`). Comparison blogs
  are excluded. Each claim carries a link to the owning source and a label: **VENDOR-PRIMARY**
  (a first-party vendor page), **VENDOR-MARKETING** (a first-party product/marketing page,
  lighter evidence), **SECONDARY** (a non-vendor site, kept only when no primary was found),
  or **INFERENCE** (a conclusion derived here). Dimensions that no primary source states are
  flagged **NOT VERIFIED** rather than guessed.

## 1. Summary

The crux is a distinction the ADR blurred: **"one platform / one source of truth"**
(a _backend_ property — one order store, one menu, orders that sync to a screen) is not the
same as **"one client app with device-role modes"** (a _client_ property — a single binary
that a device switches into a POS, KDS, or customer-display role).

Best-sourced findings:

1. **All four vendors claim the backend property. Only one ships the client property.**
   "One platform / single source of truth" is near-universal marketing and is real at the
   data layer. "The same app renders the KDS mode" is rare: **only Toast** demonstrably does
   it in primary docs.
2. **Toast is the one true device-role-mode vendor.** Toast's own platform guide says
   the **same Toast POS mobile app**, on an Android tablet, is used "as order terminals…
   as kitchen display system (KDS) devices; and as payment terminals"
   ([Toast hardware guide](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html)).
   You "switch a device into KDS Mode"
   ([Toast KDS FAQ](https://support.toasttab.com/en/article/KDS-FAQ)). This is exactly the
   ADR's pattern — but note KDS is still a **separately-licensed software product**.
3. **Square ships a deliberately separate, purpose-built KDS client — on a different OS
   than its POS.** Square KDS is a stand-alone app you "download… on the Google Play Store"
   ([Square KDS setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)).
   It is **Android-only**, and Square **disabled its iOS KDS on January 12, 2026**
   ([Square KDS guide](https://squareup.com/help/us/en/article/7397-square-kds-guide)) — even
   though its flagship POS runs on iPad. Two clients, two operating systems, on purpose.
4. **Lightspeed ships a separate, browser-based KDS client, sold as a paid add-on.**
   The Lightspeed KDS is "an order manager" and "a paid add-on to existing Lightspeed
   Restaurant subscriptions"
   ([About the Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System));
   you reach it by putting an IP address in a browser, "as though it were a website"
   ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)).
   It is not a mode of the POS app.
5. **NovaTab — the ADR's headline source — never actually claims the client property.**
   NovaTab's own pages claim "One platform… One source of truth for kitchen operations"
   and "No third-party tablets"
   ([NovaTab KDS](https://www.novatab.com/solutions/kitchen-display-system)), and call the KDS
   "a native, all-in-one part of the NovaTab platform"
   ([NovaTab KDS blog](https://www.novatab.com/blog/kitchen-display-system-kds-why-every-modern-restaurant-needs-one)).
   Those are **backend / single-source-of-truth** claims. NovaTab **nowhere** says "one
   codebase," "device-role modes," or "the same app renders the KDS." The ADR read a
   backend claim as a client claim.
6. **The pattern the leaders share is the one Umi already has.** Umi's backend is already
   unified: one contract, one `kds` module, a `pos-kitchen` projection the POS already reads
   (ADR, "Contexto"). That is the single source of truth. Fusing the client is a **separate,
   optional** decision that only Toast's example supports — and Square and Lightspeed
   actively argue against.

## 2. Comparison table (rows = vendors, columns = the six dimensions)

| Vendor         | 1. Client architecture                                                                                                                                                                                                         | 2. Hardware / OS                                                                                                                                                                                                                                                                                             | 3. Single source of truth lives in…                                                                                                                                                                                                         | 4. Command / interaction model                                                                                                                                                                                                                                                                           | 5. Licensing per screen                                                                                                                                                                                                              | 6. Explicit role-mode evidence                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Toast**      | **Same POS app, switched to KDS Mode** — one binary, device-role. "switch a device into KDS Mode" ([FAQ](https://support.toasttab.com/en/article/KDS-FAQ))                                                                     | Toast-branded **Android** touchscreen tablets running the Toast POS mobile app ([hardware guide](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html)); dedicated 14"/22" KDS screens sold via Toast Shop ([pos.toasttab.com](https://pos.toasttab.com/hardware/kitchen-display-system)) | **Shared backend + real-time sync**: "changes… on Toast POS devices… appear on KDS devices… in real time" ([KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html))                                             | Expediter / prep-station roles; order- **and** item-level fulfil; Recall re-opens a fulfilled ticket ("RECALLED in red"); oldest-fired on the left ([Get Started](https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System))                                                  | **Separately-subscribed SKU**: "Kitchen Display Screen Software product" ([FAQ](https://support.toasttab.com/en/article/KDS-FAQ)); price not published in docs — **NOT VERIFIED**                                                    | **YES.** Same POS mobile app used "as order terminals… as kitchen display system (KDS) devices; and as payment terminals" ([hardware guide](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html))       |
| **Square**     | **Separate app** — "download the Square KDS app on the Google Play Store" ([setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android))                                                          | **Android only** (Android 9+, ≥3 GB RAM; MicroTouch 10/15/21"); **iOS KDS disabled 12 Jan 2026** ([KDS guide](https://squareup.com/help/us/en/article/7397-square-kds-guide)) — POS runs on iPad, KDS on Android                                                                                             | **Shared backend**: orders arrive "from POS, your online ordering page, or delivery apps" ([product page](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system)); no single-source-of-truth wording on the KDS pages | Prep + **Expo/Expeditor** modes; "Complete or recall a ticket or item"; timers/aging alerts ([setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android))                                                                                                                  | **$30/device/mo (Plus), $20/device/mo (Premium)**; not on Free ([product page](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system))                                                                         | **NO — the opposite.** Purpose-built separate client, on a different OS than the POS. iOS retired in favor of a dedicated Android KDS ([KDS guide](https://squareup.com/help/us/en/article/7397-square-kds-guide))          |
| **Lightspeed** | **Separate client** — a browser-based "order manager", not a POS mode ([About KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System))                     | **Cross-platform web**: "KDS 2.0 supports the two most recent versions of iOS, Android, and Windows"; any "screen with a browser" ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)). KDS 1.0 was iOS-only.                 | **Shared backend + per-station routing**: pair by connection code, route menu items to each station ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0))     | Live order status: orders "updated as they're being prepared or once they're ready to collect" ([About KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System)); real-time-vs-poll mechanism — **NOT VERIFIED** ("Events sync" only) | **Paid add-on** to a Restaurant subscription; per-screen price not published — **NOT VERIFIED** ([About KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System)) | **NO.** A separate web client reached by IP in a browser, "as though it were a website" ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)) |
| **NovaTab**    | **Not stated** on primary pages — architecture undisclosed. Called "a native, all-in-one part of the NovaTab platform" ([blog](https://www.novatab.com/blog/kitchen-display-system-kds-why-every-modern-restaurant-needs-one)) | **NOT VERIFIED** — no hardware/OS spec on the pages read ([KDS](https://www.novatab.com/solutions/kitchen-display-system))                                                                                                                                                                                   | **Shared backend (marketing)**: "One platform… One source of truth for kitchen operations… No third-party tablets" ([KDS](https://www.novatab.com/solutions/kitchen-display-system))                                                        | "Bump bar support for fast, hands-free ticket control"; dynamic routing/load-balancing ([KDS](https://www.novatab.com/solutions/kitchen-display-system))                                                                                                                                                 | **NOT VERIFIED** — no KDS pricing published ([KDS](https://www.novatab.com/solutions/kitchen-display-system))                                                                                                                        | **NO device-role claim.** Claims one platform / one source of truth (backend), **not** "one app, device-role modes." Marketing only.                                                                                        |

## 3. Per-vendor detail

### 3.1 Toast — the one genuine device-role-mode example

Toast is the strongest support the ADR has, and it is real. Toast runs **one mobile app**
across every front- and back-of-house role.

- **One app, many roles (the exact pattern the ADR describes).** Toast's platform guide,
  describing hardware components:
  > "tablets running the Toast POS mobile app can be used as order terminals at server
  > stations, customer kiosks, or on wireless hand-held devices; as kitchen display system
  > (KDS) devices; and as payment terminals."
  > ([Toast POS hardware components](https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html)) — VENDOR-PRIMARY.
  > The same guide identifies the hardware as
  > "Touchscreen (Android) tablets, which run the mobile app and are located throughout the
  > restaurant."
- **You switch a device into the role.** The KDS FAQ: to get started you "set up your
  Kitchen Display System hardware, **switch a device into KDS Mode**, and configure how
  tickets display" ([Toast KDS FAQ](https://support.toasttab.com/en/article/KDS-FAQ)).
  The overview confirms the mode is inside the app: "From the **Kitchen Display System mode
  screen**, select the overflow menu (the ⋮ icon)"
  ([Toast KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html)). VENDOR-PRIMARY.
- **But KDS is still a separately-licensed product.** The FAQ warns when "your account
  isn't subscribed to the **Kitchen Display Screen Software product**" and tells you to
  "Confirm your restaurant subscribes to the Kitchen Display Screen Software product"
  ([Toast KDS FAQ](https://support.toasttab.com/en/article/KDS-FAQ)). So "one binary, device
  switched to a role" and "a paid entitlement per KDS" coexist. The per-screen price is not
  published in these docs — **NOT VERIFIED**.
- **Single source of truth is the backend, made visible by real-time sync.** "If changes
  are made on Toast POS devices in the front of house, those changes appear on KDS devices
  in the kitchen in **real time**"
  ([Toast KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html)). VENDOR-PRIMARY.
- **Command model.** KDS devices act "as either an **expediter or prep station** KDS
  device"; "Individual items can be marked as fulfilled on expediter KDS devices," and "Once
  all items on a ticket are marked as fulfilled, the ticket disappears" — so **order-level
  and item-level** fulfilment ([Toast KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html)).
  Recall re-opens a fulfilled ticket ("RECALLED in red"); tickets fire oldest-on-the-left
  ([Get Started](https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System)).
  Offline behavior — **NOT VERIFIED** in these pages.

### 3.2 Square — deliberately separate, and on a different OS than its POS

- **A separate app.** "From the Google Play Store app on your device… search for Square
  KDS" and install it
  ([Square KDS setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)). VENDOR-PRIMARY.
  There is a stand-alone Square KDS listing on Google Play; it is not a mode of Square POS
  or Square for Restaurants.
- **Android-only, and Square killed the iOS KDS on purpose.** "January 12, 2026: The
  Square KDS app on iOS was fully disabled. Beginning on this date, the app will no longer
  open, and kitchen tickets will no longer display through iOS devices," after Square
  "announced in July of 2023 that KDS is being retired on iOS devices"
  ([Square KDS guide](https://squareup.com/help/us/en/article/7397-square-kds-guide)). VENDOR-PRIMARY.
  This is decisive: Square's flagship POS runs on **iPad**, yet Square chose to run its KDS
  on **Android** — the opposite of "the same app renders the KDS mode." Requirements: Android
  9+, ≥3 GB RAM, MicroTouch 10.1/15.6/21.5" screens
  ([setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)).
- **Command model.** Prep stations for focused prep and **Expo/Expeditor** stations to
  finalize orders; "Complete or recall a ticket or item from an individual KDS device"; aging
  timers and alerts ([setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)).
- **Licensing.** "$30/month per device" (Square Plus) or "$20/month per device"
  (Square Premium); not available on Square Free
  ([Square KDS product page](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system)). VENDOR-PRIMARY / VENDOR-MARKETING.
- **Single source of truth.** The KDS pages describe a shared backend — orders arrive
  "from POS, your online ordering page, or delivery apps" — but carry **no** explicit
  single-source-of-truth or one-app wording ([product page](https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system)).

### 3.3 Lightspeed — a separate, browser-based KDS add-on

- **A separate client, not a POS mode.** The Lightspeed KDS is "an order manager" that
  "displays customer orders on a screen," offered as "**a paid add-on** to existing
  Lightspeed Restaurant subscriptions"
  ([About the Lightspeed KDS](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System)). VENDOR-PRIMARY.
- **Reached through a browser — clearly not the POS binary.** In KDS 2.0 you connect a
  screen by putting "the IP Address in the browser address bar" and treating it "as though
  it were a website," then pairing with a connection code and routing menu items to that
  station ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)). VENDOR-PRIMARY.
- **Cross-platform.** "KDS 2.0 supports the two most recent versions of iOS, Android, and
  Windows," and any "tablet or any screen with a browser." KDS 1.0 was iOS-only (legacy)
  ([KDS 2.0 setup](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)).
- **Interaction / real-time.** Orders are "updated as they're being prepared or once
  they're ready to collect." The setup page mentions an "Events sync" data flow but does
  **not** state whether updates are push or polled — real-time-vs-poll **NOT VERIFIED**; and
  bump/recall command detail is **NOT VERIFIED** on the pages read. Per-screen price is
  **NOT VERIFIED** (add-on; contact sales).

### 3.4 NovaTab — the ADR's headline source claims the backend property, not the client one

NovaTab is the vendor the ADR leaned on hardest, so its wording matters most.

- **What NovaTab does claim (backend / single source of truth):** "One platform. Every
  restaurant operation." — "every ticket flows through a **single kitchen workflow**" —
  "No duplicate systems. No third-party tablets. No missed orders." — "**One source of truth
  for kitchen operations**" ([NovaTab KDS](https://www.novatab.com/solutions/kitchen-display-system)). VENDOR-MARKETING.
  The blog adds it is "designed as a **native, all-in-one part of the NovaTab platform**, not
  a bolted-on third-party integration" with "no lag and no manual syncing"
  ([blog](https://www.novatab.com/blog/kitchen-display-system-kds-why-every-modern-restaurant-needs-one)).
- **What NovaTab does NOT claim:** nowhere on these primary pages does NovaTab say "one
  codebase," "device-role modes," "the same app renders the KDS," "one client binary," or
  give any hardware/OS or KDS pricing. The pages are marketing and disclose no client
  architecture — **NOT VERIFIED**.
- **INFERENCE:** NovaTab's copy is a **backend** claim ("one platform / one source of
  truth"). The ADR restated it as a **client** claim ("one codebase… the same app renders the
  correct mode"). The primary source does not support that upgrade. It does confirm bump-bar
  support and dynamic routing as the command model.

## 4. Verdict

**The ADR's specific claim — "one codebase… the same app renders the correct mode" — is
supported by only one of the four leaders (Toast), contradicted by two (Square, Lightspeed),
and never actually stated by the vendor the ADR cited most (NovaTab).** What all four share
is the _weaker, backend_ claim: one platform, one order/menu store, a single source of truth
that syncs to a screen. Toast alone runs KDS as a role of the same POS client binary (and
even Toast gates it behind a separate "Kitchen Display Screen Software" license); Square
deliberately ships a purpose-built KDS on **Android while its POS is on iPad**, and disabled
its iOS KDS on 12 Jan 2026; Lightspeed ships a separate browser-based KDS add-on. So the real
industry pattern is **"one shared backend + a KDS client tuned for the kitchen"** — sometimes
that client is a mode of the POS app (Toast), and just as often it is a separate, even
cross-OS, purpose-built client (Square, Lightspeed).

**Single most important corrective to the ADR:** the load-bearing sentence conflates two
different things. "Single source of truth" is a **backend** property, and Umi's backend is
**already** unified (one contract, one `kds` module, the `pos-kitchen` projection the POS
already reads). Fusing the _client_ is a **separate** decision that the primary evidence does
**not** make necessary — Toast is the only vendor whose docs endorse it, and Square/Lightspeed
are first-party evidence that leaders knowingly keep the KDS a separate, purpose-built client.
The ADR should stop citing "single source of truth" and NovaTab as reasons to fuse the client,
because that source of truth is already achieved at the backend and NovaTab never claims the
client-fusion pattern.

## 5. Implications for Umi

Neutral and evidence-led. The primary docs neither mandate nor forbid fusing `umi-pos` and
`umi-kds`; they reframe the trade-off.

1. **The stated headline goal is already met by the backend, not by fusing the client.**
   "Single source of truth" is a data-layer property. Umi already has it (ADR, "Contexto":
   unified backend, `pos-kitchen` contract, `kds` module). Client fusion delivers _code
   reuse and one design system_, not a new source of truth. Argue the fusion on its true
   merits (below), not on a claim the backend already satisfies.
2. **There is a real, first-party precedent for fusing (Toast).** If Umi wants the KDS to be
   a mode of `umi-pos`, Toast is proof it works at scale: one Android app runs as order
   terminal, kiosk, KDS, and payment terminal, switched by role. Umi's Flutter POS runs on
   Linux and native, so a KDS role would immediately end the "KDS is Apple-only" problem the
   ADR names — this benefit is genuine and vendor-precedented.
3. **There is equally strong first-party precedent for the opposite (Square, Lightspeed).**
   Two leaders deliberately keep the KDS a separate client — Square even on a **different
   OS** — because the kitchen surface has different ergonomics, uptime, and lifecycle needs
   (always-on, unattended, station-scoped) than the cashier surface. Square retiring its iOS
   KDS shows a vendor will accept two clients and two toolchains to serve the kitchen well.
   Umi's own ADR "Inventario" lists exactly these kitchen-specific concerns (unattended
   station session, heartbeat, connection state machine, sequenced-event reconciliation),
   which is why fusing is scoped at ~2800 lines of behavior — the split is not accidental.
4. **Whatever the client decision, keep the shared-backend invariant.** Every vendor,
   fused or not, routes through one order/menu store. Umi must keep the `pos-kitchen`
   projection and `kds` module as the single contract both surfaces consume. That invariant
   is non-negotiable and is what actually delivers "the paid order shows instantly on the
   KDS."
5. **If Umi fuses, treat the KDS as its own surface with its own device role — as the ADR
   already plans.** Toast's model is "one binary, a device is _dedicated_ to the KDS role,"
   not "the cashier screen also shows tickets." The ADR's Phase-2 goal (an additive device
   role `pos | kds | customer_display`, an unattended station session, heartbeat) matches how
   Toast actually assigns roles. The Phase-1 read-only board reusing the operator session is
   a preview, not the pattern; do not ship that as the end state.
6. **A defensible middle path is available and vendor-supported.** "Shared backend +
   separate clients" (Alternatives #1/#2 the ADR rejected as "legacy") is in fact the live
   pattern at Square and Lightspeed in 2026 — it is not legacy. If the port cost or the
   kitchen-specific reliability needs prove high, keeping `umi-kds` (or a separate Flutter
   KDS) against the shared backend is a fully industry-current choice, not a step backward.
   The decision should turn on Umi's own cost/reliability math, not on a "2026 trend" that the
   primary sources only partly support.

## 6. Dimensions not verified from primary sources (flagged, not guessed)

- **Toast:** exact per-screen license price of the "Kitchen Display Screen Software" product;
  KDS offline behavior. (SKU existence is verified; price and offline are not.)
- **Square:** real-time-vs-polling event mechanism; offline behavior; bump-bar hardware
  specifics. (App, OS, iOS-retirement date, and pricing are verified.)
- **Lightspeed:** per-screen price (add-on, "contact sales"); real-time-vs-polling mechanism
  ("Events sync" named, mechanism unstated); bump/recall command detail.
- **NovaTab:** almost everything technical — client architecture (separate app vs. role
  mode), hardware/OS, licensing/pricing. Only marketing claims ("one platform," "one source
  of truth," "native," bump-bar support) are on the primary pages. Any technical detail beyond
  those is unverified.

## 7. Primary sources

- Toast — POS hardware components (one app, many roles):
  https://doc.toasttab.com/doc/platformguide/adminHardwareComponents.html
- Toast — Kitchen display system overview:
  https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html
- Toast — KDS FAQ (KDS Mode; "Kitchen Display Screen Software product"):
  https://support.toasttab.com/en/article/KDS-FAQ
- Toast — Get Started With the KDS (recall, fire order, fulfil order/item):
  https://support.toasttab.com/en/article/Get-Started-With-the-Kitchen-Display-System
- Toast — KDS hardware product page:
  https://pos.toasttab.com/hardware/kitchen-display-system
- Square — Set up Square KDS (Android) (separate Google Play app; requirements; Plus/Premium):
  https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android
- Square — Migrate to Android from Square KDS on iOS (iOS disabled 12 Jan 2026):
  https://squareup.com/help/us/en/article/7397-square-kds-guide
- Square — KDS product page ($30/$20 per device; Android):
  https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system
- Lightspeed — About the Lightspeed Kitchen Display System (paid add-on; order manager):
  https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System
- Lightspeed — Setting up Kitchen Display System 2.0 (browser/IP; iOS/Android/Windows; stations):
  https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0
- NovaTab — Kitchen Display System (one platform / one source of truth / bump bar):
  https://www.novatab.com/solutions/kitchen-display-system
- NovaTab — Why every modern restaurant needs a KDS ("native, all-in-one part of the platform"):
  https://www.novatab.com/blog/kitchen-display-system-kds-why-every-modern-restaurant-needs-one
