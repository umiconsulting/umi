# Restaurant POS / KDS / front-of-house feature inventory: what to build for a café-first platform

- Date: 2026-09-06
- Question: Umi is a café/restaurant platform (POS + KDS on one unified backend) about to
  BUILD. The team asked, "what other features are important, like table positioning?" This
  file enumerates the operationally-important restaurant POS / KDS / front-of-house features
  from **primary** vendor documentation so we can prioritize what to build first.
- Scope: front-of-house / POS, kitchen / KDS, and cross-cutting features, each mapped to the
  device role that owns it and to whether a **small café / QSR** (counter-service coffee
  shop, not white-tablecloth) actually needs it. **Kiosk is explicitly OUT OF SCOPE** and is
  not covered here — the self-order kiosk is treated in the sibling file
  [2026-09-06-pos-kiosk-and-device-role-boundaries-research.md](2026-09-06-pos-kiosk-and-device-role-boundaries-research.md).
- Method: primary sources only — vendor help centers and platform docs for **Toast**
  (`support.toasttab.com`, `doc.toasttab.com`, `pos.toasttab.com`) and **Square / Square for
  Restaurants** (`squareup.com/help`, `squareup.com` product pages), with **Clover /
  Lightspeed** where a first-party page adds signal. Comparison/SEO/"best-POS" listicles are
  excluded; every claim is followed to the owning vendor page. This is the **third** file in
  the series and reuses its labels: **VENDOR-PRIMARY** (a first-party help/platform doc),
  **VENDOR-MARKETING** (a first-party product/blog page, lighter evidence), **SECONDARY** (a
  non-vendor site, kept only when no primary was found), **INFERENCE** (a conclusion derived
  here). Anything no primary source states is flagged **NOT VERIFIED** rather than guessed.

## 1. Framing — prioritize a café-first build

Umi's target is a **counter-service café / QSR**: a barista rings a small, modifier-heavy
menu (milk, size, shots, syrups), the guest usually pays immediately, and the drink is made
at a single bar. That context, not a full-service dining room, decides what is a must. The
value of asking the vendors is that Toast and Square between them document the *full*
restaurant feature surface; reading it against a café lets us separate three tiers:

- Features a café needs to **open the doors** (ring an order with modifiers, take split/mixed
  payment, tip, void with a manager gate, print a receipt, close the drawer, survive an
  internet drop, and mark an item 86'd) — most of these are baseline POS behavior the vendors
  treat as universal, not table-service extras.
- Features a café **adds soon** (order-ready notifications, prep timers, all-day counts,
  comps, tip pooling, dayparted menus) — real value, but a café can serve without them on day
  one.
- Features that are genuinely **full-service-only** (floor plan / table positioning, table
  transfer/merge, coursing and seat-level ordering, split-by-seat, bar-tab pre-authorization,
  auto-gratuity for large parties, expo consolidation across stations) — the answer to "like
  table positioning?" is that **table positioning itself is the archetypal full-service
  feature**, and most of its neighbors are too.

The single most useful corrective for the team: the features most likely to be **overlooked**
are not the visible dining-room ones — they are the plumbing (split tender, permission-gated
voids, on-device cash close, cross-channel 86, order-ready notifications, offline mode). Those
are P0/P1 for a café and are called out explicitly in Sections 5 and the return summary.

## 2. Feature inventory (the big table)

Device role uses Umi's own vocabulary: **POS** (the cashier/barista terminal), **KDS** (the
kitchen display surface, including an expo device-role), **FOH-manager** (a manager/shift-lead
action or a back-office configuration operated front-of-house), **backend** (the unified API /
menu / messaging layer). "Café/QSR must-have?" is **Yes** (needed to run a counter café),
**Nice** (real value, add soon), or **Full-service-only** (skip for a café MVP). All evidence
links are first-party Toast or Square pages unless labelled otherwise.

### 2.1 Front-of-house / POS

| Feature | Device role | Café/QSR must-have? | Vendor evidence (Toast / Square) | Notes |
| --- | --- | --- | --- | --- |
| **Floor plan & table management** (table positioning/layout, sections, table status, visual editor) | POS (front-of-house) | **Full-service-only** | Toast: basic seating on the POS ([Manage Tables](https://support.toasttab.com/en/article/New-POS-Managing-Tables), [Service Areas & Table Setup](https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430)); Square: [Building your floor plan](https://squareup.com/help/us/en/article/6427-building-your-floor-plan) (table mapping in the POS app) | The archetypal full-service feature. A counter café has no table map. Square's floor plan requires Full-Service or Bar mode ([floor plan sections](https://squareup.com/help/us/en/article/8145-create-a-floor-plan-section-with-square-for-restaurants)). |
| **Table transfer / merge; move a check between tables/servers** | POS (server reassign often FOH-manager-gated) | **Full-service-only** (cashier reassignment on shift handoff = Nice) | Toast: [Transferring Items, Checks and Payments](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments), [Transfer a Check to Another Employee](https://support.toasttab.com/en/article/Transferring-a-Check-to-Another-Employee-1493069784457); Square: [split & merge tickets](https://squareup.com/help/us/en/article/8439-split-and-merge-open-tickets), [reassign checks](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants) | Needs a table map or long-lived open checks to matter. Reassigning a check between clocked-in cashiers at handoff is the only café-relevant slice. |
| **Coursing & seat-level ordering** (seat numbers, assign items to seats, hold & fire courses) | POS → KDS | **Full-service-only** | Toast: [Order by Seat](https://support.toasttab.com/en/article/Order-by-Seat), [Course Firing Options](https://support.toasttab.com/en/article/Course-Firing-Options); Square coursing/seat-firing **NOT VERIFIED** (not pursued — out of scope for a café) | Meal pacing for a sit-down table. A café fires one drink to one bar; skip for MVP. |
| **Split checks** (by item / evenly / by seat / by amount) | POS | **Nice** (by-seat = Full-service-only) | Toast: [Split Checks by Item](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734); Square: [Split a payment and check](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants) | Two friends splitting a coffee + pastry is the café case (split-evenly / split-by-item). Split-by-seat needs seat tracking (full-service). |
| **Split tender / multiple payments on one check** | POS | **Yes** | Toast: "common for guests to pay with multiple forms of payment to satisfy their check" ([split-checks article](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734)); Square: split "a single check into multiple payments" ([8165](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)) | **Baseline, not full-service.** Gift-card-then-card and cash-plus-card happen at any counter. Easy to overlook because it sounds table-service. |
| **Tabs / bar tabs / card pre-authorization** | POS (config = backend) | Name-tab **Nice**; card pre-auth **Full-service / bar-only** | Toast: [Starting a Tab](https://support.toasttab.com/en/article/Starting-a-Tab-1492811100378) (name-only, no saved card), [Card Pre-Authorization FAQs](https://support.toasttab.com/en/article/Card-Pre-Authorization-FAQs); Square: [preauthorization for bar tabs](https://squareup.com/help/us/en/article/8455-enable-and-configure-preauthorization-for-bar-tabs) | A name-only open tab for a regular is cheap; a **card pre-auth hold** is a bar feature (hold/settlement complexity). Both vendors confirm a name-tab does not save a card unless pre-auth is on. |
| **Order types / service modes** (dine-in / For here, takeout / To go, delivery, drive-thru) | POS (set on ticket) → KDS + backend (routing) | **Yes** (For here vs To go); delivery/drive-thru **Nice** | Toast: [Dining Options](https://support.toasttab.com/en/article/Dining-Options-1492794310377); Square: [Dining options](https://squareup.com/help/us/en/article/5573-use-dining-options-with-the-square-app), and order type drives KDS routing ([filter by order type](https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds)) | Even a counter café needs For-here vs To-go — it drives tax, receipt/label behavior, and KDS routing. |
| **Menu scheduling / dayparts** (breakfast vs lunch, time-based availability) | backend → enforced at POS + online | **Nice** (Yes only if AM/PM menus/happy hour) | Toast: [Menu Availability](https://support.toasttab.com/en/article/Settings-Menu-Availability) (menu-level only); Square: [dayparting menus](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants) (also item/category-level) | A single all-day menu is fine to start. **Toast can only schedule a whole menu**, not one item; Square can time-gate items/categories. |
| **86ing / out-of-stock / item availability** | POS or FOH-manager (quick action); backend (menu) | **Yes** | Toast: 86 blocks ordering "on the POS, online, or through third-party channels" ([86 an Item](https://support.toasttab.com/en/article/86-an-Item)); Square: "updated across channels" ([managing items](https://squareup.com/help/us/en/article/6425-managing-items-with-square-for-restaurants), [mark sold out](https://squareup.com/help/us/en/article/8430-mark-items-and-modifiers-as-sold-out)) | Propagation to **POS + online + third-party** is verified; **86 → a visible KDS "sold-out" alert is NOT VERIFIED** (86'd items simply stop generating KDS tickets). |
| **Modifiers & modifier groups** (required/optional, min/max, nested, default) | backend (config) → enforced at POS | **Yes** | Toast: required means you "won't be able to send this item to the kitchen without a modifier selection" ([Required/Optional Modifiers](https://support.toasttab.com/en/article/Required-Optional-Modifiers)); Square: min/max + defaults ([modifiers](https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants)) | Coffee/QSR is modifier-heavy; required + min/max enforcement prevents incomplete tickets. Core, not optional. |
| **Discounts** (% or amount, item or check) | POS (apply); backend (rules) | **Yes** | Square: "percentage discounts can be applied to an entire sale or to individual items" ([apply discounts](https://squareup.com/help/us/en/article/5362-apply-discounts)) | Staff/loyalty/happy-hour discounts are routine café behavior. |
| **Comps** (make an item complimentary, still tracked) | POS (permission-gated); backend (reasons) | **Nice** | Square: comp = "give goods or services… without asking for payment" ([comp & void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)) | Service-recovery tool; a discount usually covers the café case. Low cost to add. |
| **Voids** (remove item/check/same-day payment) | POS (permission-gated) | **Yes** | Toast: "A void removes an item, check, or same-day payment as if it never happened" ([Voiding Items, Payments and Checks](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)) | Mis-rings happen at any counter. |
| **Manager approval / authorization for void/comp/discount** | FOH-manager (approves at POS) + backend (assigns permission) | **Yes** | Toast: without the permission you "ask another restaurant employee who does have this permission to enter their POS access code or swipe their access card" ([void guide](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)); lock to managers by removing the "3.32 Void / Refund" permission from the server job ([voiding article](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)); Square gates comp/void behind named team permissions ([comp & void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)) | Both vendors implement "manager approval" as **role-based permission gating**, not a separate toggle. Loss-prevention control — easy to overlook. |
| **Tips / card tipping** | POS (prompt); backend (presets) | **Yes** | Square: "Turn on Collect tips" ([set up tipping](https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping)) | Card tipping at the counter is core barista revenue. |
| **Tip adjust / settle after payment** | POS / FOH-manager; backend (reconcile) | **Nice** | Square: [accept & settle tips](https://squareup.com/help/us/en/article/5069-accept-tips-with-the-square-app) | Counter tips are captured at checkout; post-hoc adjust matters more to full-service. |
| **Auto-gratuity / service charge for large parties** | POS (apply) + backend (threshold) | **Full-service-only** | Toast: configure "the minimum number of guests required at the table for the auto-gratuity" ([Setup Auto-Gratuity](https://support.toasttab.com/en/article/Setup-Auto-Gratuity)); Square: [automatic gratuity](https://squareup.com/help/us/en/article/8175-customize-and-apply-automatic-gratuity-with-square-for-restaurants) | A counter café rarely seats parties of 8+. Treated as a **service charge, not a tip** ([Toast blog](https://pos.toasttab.com/blog/on-the-line/automatic-gratuity), VENDOR-MARKETING). |
| **Tip pooling / sharing / distribution** | backend / payroll (calc); POS feeds clock-in data | **Nice** (rising to Yes with >1 barista) | Toast: Tips Manager "calculates and distributes tips… based on your restaurant's tip pooling policy" ([Tips Manager](https://support.toasttab.com/en/article/Getting-Started-with-Toast-Tips-Manager-How-to-Pool-Share-Tips)); Square: "split equally among all tip-eligible team members clocked in" ([tip pooling](https://squareup.com/help/us/en/article/7654-get-started-with-tip-pooling-for-team-management)) | A back-office payroll function, not a live counter action. Valuable for a shared tip jar. |
| **Receipts: print** | POS | **Yes** | Square: [print receipts](https://squareup.com/help/us/en/article/6139-print-receipts) | Cash and many card customers still expect paper. |
| **Receipts: reprint** | POS | **Yes** | Toast: "Reprint a guest receipt (open, closed, or voided)… or email or text a copy" ([reprint/resend](https://support.toasttab.com/en/article/Reprint-and-Resend-Receipt-from-Payment-Terminal)); Square: [reprint from Transactions](https://squareup.com/help/us/en/article/6139-print-receipts) | "Can I get another copy?" is a routine counter request. |
| **Receipts: email / SMS / digital** | POS (send); backend (auto-send) | **Nice** (trending to Yes) | Toast: [Digital Receipts](https://doc.toasttab.com/doc/platformguide/platformPwfDigitalReceipts.html); Square: digital receipts "automatically enabled" ([receipt settings](https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale), [automatic receipts](https://squareup.com/help/us/en/article/5212-automatic-receipts)) | Paperless is desirable and low-cost, but a café can open without it. |
| **Quick-service vs table-service order flow** | POS (device mode); FOH-manager (config) | Quick = **Yes**; Table-service = **Full-service-only** | Toast: "Quick Order screens work best for quick-service or fast-casual" vs Table Service for "full-service" ([ordering screens](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens)); Square: [Full/Quick/Bar modes](https://squareup.com/help/us/en/article/8458-use-modes-with-square-point-of-sale), [open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square) | Quick = ring then pay immediately (café default). Open tickets / running tab is the useful in-between (Nice). |
| **Reservations / waitlist / host stand** | FOH-manager (separate app) | **Full-service-only** | Toast Tables is "a separate app from Toast POS… not supported on Toast hardware" ([Using Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)) | Even Toast, the fuser, keeps host-stand/reservations a **separate** app. No café MVP need. |

### 2.2 Kitchen / KDS

| Feature | Device role | Café/QSR must-have? | Vendor evidence (Toast / Square) | Notes |
| --- | --- | --- | --- | --- |
| **Bump / recall / complete** (order-level and item-level) | KDS | **Yes** (the irreducible KDS core) | Toast: double-tap "to quickly fulfill an order"; a bumped ticket "will need to be unfulfilled" to recall ([item & order fulfillment](https://support.toasttab.com/en/article/Item-and-Order-Fulfillment-on-KDS)); Square: "mark single items or whole tickets as complete" ([complete orders](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds)) | No bump/complete = no KDS. Item- and order-level both matter even at one station. |
| **Prep timers / SLA color aging / bump times** | KDS (thresholds set backend/device) | **Nice** (strong — speed-of-service) | Toast: "Warning Colors… the ticket color changes the longer it sits unfulfilled" ([basic kitchen config](https://support.toasttab.com/en/article/Basic-Kitchen-Configuration)); Square: "Yellow timer and Red timer" thresholds ([Square KDS setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)) | The main tool for keeping drink waits down; not strictly required to serve. |
| **All-day counts / "all day" totals** | KDS (display); backend (aggregate) | **Nice** | Toast: "All Day Display… a list of similar items totaled so they can be made all at once" ([KDS All Day](https://support.toasttab.com/en/article/KDS-All-Day-1493055871075)); Square: "All Day counts show how many of each item… across all open orders" ([Square KDS setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)) | Batching helps during a rush; a small menu is countable at a glance. Value rises with volume. |
| **Order-ready guest board + order-ready SMS** | guest-facing display + backend (SMS), triggered by KDS/POS | **Nice** (rising to Yes for pickup-heavy coffee) | Toast: Order Ready Board "shows guests… their order status" ([Order Ready Board](https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration)); SMS "when an order is fulfilled on the KDS" ([order-fulfilled text](https://support.toasttab.com/en/article/Send-Text-Message-when-Order-is-Fulfilled-1492800294544)); Square: [order-ready texts](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants) | The "your order is ready" mechanism for mobile/pickup coffee. Fired from the KDS; read-only to the POS ([KDS fulfilled notifications](https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380)). |
| **Kitchen printer routing** (alternative/complement to KDS) | backend (printer profiles) + POS (fires print) | **Nice** (low-cost alt to a KDS) | Toast: prep station "Select an assigned ticket printer" ([Prep Stations Basics](https://support.toasttab.com/en/article/Prep-Stations-Basics)); Square: order tickets "automatically print… even if a customer receipt isn't printed" ([print order tickets](https://squareup.com/help/us/en/article/5194-print-order-tickets)) | Many small cafés run a single bar ticket printer **instead of** a KDS. |
| **Ticket routing to stations by item/category** | backend (config) → KDS / printer | **Full-service-only → Nice** | Toast: "A prep station… prepares specific items — for example, Grill, Salad, Bar, or Pizza" ([Prep Stations Basics](https://support.toasttab.com/en/article/Prep-Stations-Basics)); Square: "assign individual items to categories to route items" ([item categories](https://squareup.com/help/us/en/article/8148-create-and-assign-item-categories-with-square-for-restaurants)) | A one-station coffee bar needs no routing; becomes Nice once food splits from the espresso bar. |
| **Expediter / expo consolidation** | KDS (expo device-role) / FOH-expo | **Full-service-only** | Toast: expo shows "the entire order regardless of how items are routed to the different prep stations" ([Setting Up an Expediter](https://support.toasttab.com/en/article/Setting-Up-an-Expediter), [using expo](https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html)); Square: Expeditor station ([Square KDS setup](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)) | Pays off only with multiple prep stations feeding one pass. A single bar has nothing to consolidate. |

### 2.3 Cross-cutting

| Feature | Device role | Café/QSR must-have? | Vendor evidence (Toast / Square) | Notes |
| --- | --- | --- | --- | --- |
| **POS offline mode / local resilience** | POS | **Yes** | Toast: take orders and "accept credit and debit card payments… as long as background card processing is enabled" ([Toast offline mode](https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode)); Square: "allow offline payments to accept cash and card payments" ([offline payments](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)) | A dropped line must not halt revenue. Square offline card payments expire (upload within 24h, 72h max; several tender types excluded). |
| **KDS offline behavior** | KDS | **Nice** | Toast: with an eligible local hub, "orders made on the same local network are still received and displayed on KDS devices" ([offline KDS](https://doc.toasttab.com/doc/platformguide/platformOfflineKDSDevices.html), [local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html)); **Square KDS offline = NOT VERIFIED** (setup article silent; only community-forum posts) | Toast's is conditional on a local hub and excludes online orders. Only relevant if you run a KDS at all. |
| **Employee timeclock / labor** (clock-in/out, breaks) | POS → backend (approval/payroll) | **Yes** (with hourly staff) | Toast: enter your PIN and "select Timeclock"; Start/End Break supported ([clocking in/out](https://support.toasttab.com/en/article/Clocking-In-and-Out-for-Shifts-and-Breaks)); Square: "Enter your passcode and select Clock In" ([clock in/out](https://squareup.com/help/us/en/article/8395-clock-in-and-out-for-team-members)) | The labor-cost and payroll record. A one-person owner café could skip it (then Nice). |
| **On-device reporting: shift review, cash-drawer session, Z-report** | POS terminal / FOH-manager (owner rollups = backend) | **Yes** | Toast: "Shift review — also called end-of-day closeout" ([Shift Review](https://support.toasttab.com/en/article/Shift-Review-Overview)), [cash drawers](https://support.toasttab.com/en/article/Use-Cash-Drawers-New-Experience), [Z-report](https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture); Square: cash drawer session shows "starting cash… and the expected cash amount" ([drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session), [drawer reports](https://squareup.com/help/us/en/article/8358-view-cash-drawer-reports)) | Counting and closing the drawer **on the terminal** is the daily cash-control ritual. Must live on the device, not only the dashboard. |

## 3. Per-area detail with quotes

### 3.1 Front-of-house / POS

**Tables, transfers, coursing (the "table positioning" family) — full-service.** Table
positioning is the archetypal full-service feature and its neighbors travel with it. Toast
runs basic seating on the POS ("Manage Tables With Toast POS",
[VENDOR-PRIMARY](https://support.toasttab.com/en/article/New-POS-Managing-Tables)) and pushes
reservations/waitlist/host-stand into a **separate** app: "Toast Tables is a separate app from
Toast POS… **not supported on Toast hardware**"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)).
Square's floor plan is "table mapping in the Square Restaurant POS app" and requires
Full-Service or Bar mode
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)).
Transfers/merges move a check "from one table to another" or "ownership from one server to
another" ([Toast, VENDOR-PRIMARY](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments)).
Coursing/seat ordering ("assign menu items to a seat", auto-fire "once the line cook fulfills
the previous course",
[Toast, VENDOR-PRIMARY](https://support.toasttab.com/en/article/Course-Firing-Options)) is
meal-pacing for a dining room. **INFERENCE:** for a café none of this family is P0 — table
positioning is the clearest "not yet".

**Split tender is baseline, not full-service.** Both vendors treat paying one check with
multiple tenders as ordinary checkout: Toast — "It's common for guests to pay with multiple
forms of payment to satisfy their check"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734));
Square keeps split-tender ("split a payment by amount") on the same page, distinct from
splitting into separate checks
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)).
Gift-card-then-card and cash-plus-card are café-routine. **This is the most overlookable P0.**

**Order types drive tax, labels, and kitchen routing.** Toast pre-populates Dine In / Take Out
/ Delivery / Curbside ([Dining Options, VENDOR-PRIMARY](https://support.toasttab.com/en/article/Dining-Options-1492794310377));
Square's order type "determine[s] how the order will be handled" and can even scope a KDS
station ("Filter to only 'Dine-In' orders",
[VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds)).
For-here vs To-go is the café minimum.

**Modifiers are the café's core menu mechanic.** Toast: a required modifier means staff
"won't be able to send this item to the kitchen without a modifier selection", with min/max on
required groups
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Required-Optional-Modifiers)).
Square supports min/max and pre-selected defaults
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants)).
Coffee is milk/size/shots/syrups; required + min/max enforcement is what stops incomplete
tickets reaching the bar.

**86ing propagates across ordering channels — but not (verified) to the KDS.** Toast: 86 an
item and "guests can't order it on the POS, online, or through third-party channels"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/86-an-Item)). Square: "Available and
sold out status are updated across channels"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/6425-managing-items-with-square-for-restaurants)).
**NOT VERIFIED:** no primary page states an 86 pushes a visible "sold-out" alert onto the KDS —
the documented mechanism is exclusionary (an 86'd item simply stops generating new KDS
tickets). Treat KDS-visibility of 86 as an open design choice, not documented behavior.

**Discounts, comps, voids — and manager approval is permission-gating.** Square: percentage
discounts on a sale or item
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/5362-apply-discounts)); comp = "give
goods or services… without asking for payment"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)).
Toast: "A void removes an item, check, or same-day payment as if it never happened"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)).
The **authorization model** is the load-bearing part: Toast — without the permission you "ask
another restaurant employee who does have this permission to enter their POS access code or
swipe their access card"
([VENDOR-PRIMARY](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)), and you
lock voids to managers by *removing* the void permission from the server job
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)).
Square gates comp/void behind named team permissions
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)).
**INFERENCE:** both vendors model "manager approval" as **role-based permission gating**, not a
modal toggle — the same server-authorization pattern the kiosk/KDS file found for device roles.

**Tips: capture is P0, pooling and auto-grat are not.** Square: "Turn on Collect tips"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping)).
Auto-gratuity keys off "the minimum number of guests required at the table"
([Toast, VENDOR-PRIMARY](https://support.toasttab.com/en/article/Setup-Auto-Gratuity)) — a
large-party, full-service trigger, and it is a **service charge, not a tip**
([Toast blog, VENDOR-MARKETING](https://pos.toasttab.com/blog/on-the-line/automatic-gratuity)).
Tip pooling is a payroll/back-office calc ("calculates and distributes tips… based on your…
tip pooling policy",
[Toast Tips Manager, VENDOR-PRIMARY](https://support.toasttab.com/en/article/Getting-Started-with-Toast-Tips-Manager-How-to-Pool-Share-Tips);
Square "split equally among all tip-eligible team members clocked in",
[VENDOR-PRIMARY](https://squareup.com/help/us/en/article/7654-get-started-with-tip-pooling-for-team-management)).

**Receipts.** Print + reprint are P0; digital is P1. Toast: "Reprint a guest receipt (open,
closed, or voided)… or email or text a copy"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Reprint-and-Resend-Receipt-from-Payment-Terminal)).
Square digital receipts are "automatically enabled"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale)).

### 3.2 Kitchen / KDS

**Bump/recall/complete is the irreducible core.** Toast: double-tap "to quickly fulfill an
order", and a bumped ticket "will need to be unfulfilled" to recall
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Item-and-Order-Fulfillment-on-KDS)).
Square: "mark single items or whole tickets as complete"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds)).
Item-level and order-level both matter at a single bar (bump one drink, or the whole ticket).

**Timers/aging and all-day counts are the next KDS layer.** Toast "Warning Colors… the ticket
color changes the longer it sits unfulfilled"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Basic-Kitchen-Configuration)); Square
Yellow/Red timers
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android)).
All-day: Toast "a list of similar items totaled so they can be made all at once"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/KDS-All-Day-1493055871075)); Square
"how many of each item… across all open orders". Both help a rush; neither is required to serve.

**Order-ready notification is fired from the KDS and is read-only to the POS.** Toast can "send
an automatic text message to servers and/or guests when an order is fulfilled on the KDS"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Send-Text-Message-when-Order-is-Fulfilled-1492800294544))
and drives a guest-facing Order Ready Board
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration));
the server device gets only a read-only "dishes are ready" push
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380)).
Square sends the guest an order-ready text from the KDS Expo
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants)).
**INFERENCE:** for a pickup/mobile-heavy coffee flow this quickly becomes the central "your
order is ready" mechanism — a P1 that trends to P0.

**Station routing and expo are multi-station features.** Toast prep stations ("Grill, Salad,
Bar, or Pizza",
[VENDOR-PRIMARY](https://support.toasttab.com/en/article/Prep-Stations-Basics)) and the expo
screen showing "the entire order regardless of how items are routed"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Setting-Up-an-Expediter)) only pay off
once there is more than one station. A single espresso bar needs neither. **Kitchen printer
routing** is the low-cost alternative to a KDS entirely: Square order tickets "automatically
print… even if a customer receipt isn't printed"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/5194-print-order-tickets)); Toast
assigns a ticket printer per prep station
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Prep-Stations-Basics)).

### 3.3 Cross-cutting

**POS offline mode keeps the till open.** Toast: take orders and "accept credit and debit card
payments and capture tips, as long as background card processing is enabled"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode)). Square:
"allow offline payments to accept cash and card payments"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode)),
with expiry/exclusion caveats. **KDS offline** is weaker: Toast needs an eligible local hub, and
even then online orders are excluded
([VENDOR-PRIMARY](https://doc.toasttab.com/doc/platformguide/platformOfflineKDSDevices.html));
**Square KDS offline is NOT VERIFIED** — the setup article is silent and only community-forum
posts (non-primary) discuss it.

**Timeclock and on-device close are the operator's daily plumbing.** Toast Timeclock with
breaks
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Clocking-In-and-Out-for-Shifts-and-Breaks));
Square "Enter your passcode and select Clock In"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8395-clock-in-and-out-for-team-members)).
On-device reporting: Toast "Shift review — also called end-of-day closeout"
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/Shift-Review-Overview)); Square cash
drawer session shows "the expected cash amount in your cash drawer"
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)).
**INFERENCE:** teams often assume "reporting = the dashboard" and forget the **close-out and
drawer count must run on the terminal**. It is P0 for cash control.

**Quick-service is the café's native flow.** Toast: "Quick Order screens work best for
quick-service or fast-casual restaurants" vs Table Service for full-service
([VENDOR-PRIMARY](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens));
Square exposes Full/Quick/Bar modes
([VENDOR-PRIMARY](https://squareup.com/help/us/en/article/8458-use-modes-with-square-point-of-sale)).
Both make the surface a **device/mode property** — consistent with the device-role model in the
sibling files. Open tickets are the useful in-between for a café that wants a running tab
([Square, VENDOR-PRIMARY](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)).

## 4. Café-first priority cut (opinionated, evidence-led)

Given a **small counter-service café / QSR** (not white-tablecloth):

### P0 — need to open the doors

- **Order entry with modifiers** (required/optional, min/max, defaults) — coffee is
  modifier-heavy; required-modifier enforcement stops incomplete tickets
  ([Toast](https://support.toasttab.com/en/article/Required-Optional-Modifiers)).
- **Order types: For here vs To go** — drives tax, labels, KDS routing
  ([Toast](https://support.toasttab.com/en/article/Dining-Options-1492794310377)).
- **Checkout with tips** (card tipping)
  ([Square](https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping)).
- **Split tender / multiple payments on one check** — baseline, not full-service
  ([Square](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)).
- **Discounts + voids, gated by manager permission** — routine, plus loss prevention
  ([Toast void permissions](https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html)).
- **86 / item availability** propagating to POS + online
  ([Toast](https://support.toasttab.com/en/article/86-an-Item)).
- **Receipts: print + reprint**
  ([Toast](https://support.toasttab.com/en/article/Reprint-and-Resend-Receipt-from-Payment-Terminal)).
- **On-device shift close / cash-drawer session / Z-report**
  ([Square drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session)).
- **Employee timeclock** (with hourly staff)
  ([Toast](https://support.toasttab.com/en/article/Clocking-In-and-Out-for-Shifts-and-Breaks)).
- **POS offline mode** (keep ringing orders and cards during an outage)
  ([Toast](https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode)).
- **KDS core: bump / recall / complete** (item- and order-level) — the irreducible KDS
  ([Square](https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds)). *(A
  café may substitute a single bar ticket printer for a KDS at first —
  [Square](https://squareup.com/help/us/en/article/5194-print-order-tickets).)*

### P1 — add soon

- **Order-ready notifications** (guest SMS + a ready board) — central to pickup coffee
  ([Toast](https://support.toasttab.com/en/article/Send-Text-Message-when-Order-is-Fulfilled-1492800294544)).
- **Email / SMS digital receipts**
  ([Square](https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale)).
- **KDS prep timers / color aging** (speed-of-service)
  ([Toast](https://support.toasttab.com/en/article/Basic-Kitchen-Configuration)).
- **All-day counts**
  ([Toast](https://support.toasttab.com/en/article/KDS-All-Day-1493055871075)).
- **Comps** (service recovery)
  ([Square](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)).
- **Tip pooling** (shared tip jar, >1 barista)
  ([Square](https://squareup.com/help/us/en/article/7654-get-started-with-tip-pooling-for-team-management)).
- **Menu scheduling / dayparts** (if AM/PM menus or happy hour)
  ([Square](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)).
- **Split checks by item / evenly** and **name-only tabs / open tickets**
  ([Toast split](https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734),
  [Square open tickets](https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square)).
- **Kitchen printer routing** and **KDS offline / local resilience** (grow with volume)
  ([Toast offline KDS](https://doc.toasttab.com/doc/platformguide/platformOfflineKDSDevices.html)).
- **Delivery / drive-thru order types** (only if the café offers them).

### P2 — later / full-service-only

- **Floor plan & table positioning / sections / table status**
  ([Square](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)).
- **Table transfer / merge; move a check between tables**
  ([Toast](https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments)).
- **Coursing & seat-level ordering (hold & fire, seat numbers)**
  ([Toast](https://support.toasttab.com/en/article/Order-by-Seat)).
- **Split-by-seat**
  ([Square](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants)).
- **Card pre-authorization / bar tabs**
  ([Square](https://squareup.com/help/us/en/article/8455-enable-and-configure-preauthorization-for-bar-tabs)).
- **Auto-gratuity for large parties**
  ([Toast](https://support.toasttab.com/en/article/Setup-Auto-Gratuity)).
- **KDS expediter / expo consolidation** and **multi-station routing**
  ([Toast](https://support.toasttab.com/en/article/Setting-Up-an-Expediter)).
- **Reservations / waitlist / host stand** (a separate app even at Toast)
  ([Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist)).

## 5. Mapping note — which role owns each P0/P1 (neutral, for client architecture)

For each P0/P1 feature, the primary owner is one of **POS-role** (cashier/barista surface),
**KDS-role** (kitchen surface), or **backend** (unified API / menu / messaging / config).
This is neutral input to the fuse-vs-separate client question the ADR is weighing; it does not
argue a client shape.

| Feature | Primary role | Secondary / config |
| --- | --- | --- |
| Order entry + modifiers | **POS** | backend (modifier config) |
| Order types (For here / To go) | **POS** | backend (routing) + KDS (consumes) |
| Tips capture | **POS** | backend (presets) |
| Split tender | **POS** | — |
| Discounts + voids | **POS** | backend (permissions/reasons); FOH-manager (approval) |
| 86 / item availability | **POS** or FOH-manager | backend (propagates to online/third-party) |
| Receipts: print + reprint | **POS** | — |
| On-device shift close / cash drawer / Z | **POS** | backend (owner rollups) |
| Employee timeclock | **POS** | backend (approval/payroll) |
| POS offline mode | **POS** | backend (reconcile on reconnect) |
| KDS bump / recall / complete | **KDS** | backend (order store) |
| Order-ready SMS + guest board | **backend** (messaging) + guest display | triggered by **KDS** completion; read-only to **POS** |
| Digital receipts | **POS** (send) | backend (auto-send) |
| KDS prep timers / aging | **KDS** | backend/device (thresholds) |
| All-day counts | **KDS** | backend (aggregate) |
| Comps | **POS** | backend (reasons/permissions) |
| Tip pooling | **backend** (payroll) | POS feeds clock-in data |
| Menu scheduling / dayparts | **backend** | enforced at POS + online |
| Split checks (item/evenly), open tickets | **POS** | — |
| Kitchen printer routing | **backend** (printer profiles) | POS (fires print) |
| KDS offline | **KDS** | backend / local hub |

**Reading of the map (INFERENCE):** the P0 set is dominated by **POS-role** features
(order/modifiers, tender, discounts/voids, receipts, drawer close, timeclock, offline) plus a
single **KDS-role** core (bump/complete). Money, checks, tips, receipts, and cash control are
POS-owned; the KDS owns **none** of them — consistent with the sibling files' finding that the
KDS is a narrow prep-queue surface. The features that most bind POS and KDS together are the
**order store and the order-ready path** (KDS completion → read-only status/SMS to the POS/guest),
which are **backend** concerns. This reinforces the prior conclusion: the single source of truth
is a backend property already met by Umi's `pos-kitchen` projection and `kds` module, and it is
what makes "paid at the POS → shows on the KDS → guest notified" work regardless of whether the
clients are fused.

## 6. Not verified from primary sources (flagged, not guessed)

- **86 → KDS visible alert:** propagation to **POS + online + third-party** is verified for both
  Toast and Square; a visible "sold-out" alert *on the KDS* is **NOT VERIFIED** (the documented
  mechanism only stops 86'd items from generating new tickets).
- **Square KDS offline behavior:** **NOT VERIFIED** — the Square KDS setup article is silent;
  only non-primary community-forum posts discuss it. (Toast KDS offline is verified but
  conditional on a local hub and excludes online orders.)
- **Square coursing / seat-level firing:** **NOT VERIFIED** — not pursued because it is
  out-of-scope for a café. Toast coursing/seat ordering is verified.
- **Toast item-level dayparting:** confirmed *limitation* — menu availability is "a menu-level
  setting only", so time-gating a single item needs a separate scheduled menu
  ([Toast](https://support.toasttab.com/en/article/Settings-Menu-Availability)). Square supports
  item/category-level time-based availability.

## 7. Primary sources

Front-of-house / POS:
- Toast — Manage Tables With Toast POS: https://support.toasttab.com/en/article/New-POS-Managing-Tables
- Toast — Create Service Areas and Table Setup: https://support.toasttab.com/en/article/Creating-Service-Areas-and-Table-Setup-1493049150430
- Toast — Using Toast Tables (separate FOH app; not on Toast hardware): https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist
- Toast — Transferring Items, Checks and Payments: https://support.toasttab.com/en/article/Transferring-Items-Checks-and-Payments
- Toast — Transfer a Check to Another Employee: https://support.toasttab.com/en/article/Transferring-a-Check-to-Another-Employee-1493069784457
- Toast — Splitting Checks by Item (also split-tender/"multiple forms of payment"): https://support.toasttab.com/en/article/Splitting-Checks-by-Item-1492811097734
- Toast — Starting a Tab (name-only, no saved card): https://support.toasttab.com/en/article/Starting-a-Tab-1492811100378
- Toast — Card Pre-Authorization FAQs: https://support.toasttab.com/en/article/Card-Pre-Authorization-FAQs
- Toast — Dining Options: https://support.toasttab.com/en/article/Dining-Options-1492794310377
- Toast — Menu Availability (menu-level scheduling only): https://support.toasttab.com/en/article/Settings-Menu-Availability
- Toast — 86 an Item (POS + online + third-party): https://support.toasttab.com/en/article/86-an-Item
- Toast — Required/Optional Modifiers (min/max, "can't send to kitchen without a selection"): https://support.toasttab.com/en/article/Required-Optional-Modifiers
- Toast — Voiding Items, Payments and Checks (lock voids to managers): https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks
- Toast — Voiding Orders (access-code / swipe approval): https://doc.toasttab.com/doc/platformguide/adminVoidingOrders.html
- Toast — Setup Auto-Gratuity (minimum guests): https://support.toasttab.com/en/article/Setup-Auto-Gratuity
- Toast — Toast Tips Manager (tip pooling): https://support.toasttab.com/en/article/Getting-Started-with-Toast-Tips-Manager-How-to-Pool-Share-Tips
- Toast — Reprint and Resend Receipt: https://support.toasttab.com/en/article/Reprint-and-Resend-Receipt-from-Payment-Terminal
- Toast — Digital Receipts: https://doc.toasttab.com/doc/platformguide/platformPwfDigitalReceipts.html
- Toast — Course Firing Options / Order by Seat: https://support.toasttab.com/en/article/Course-Firing-Options · https://support.toasttab.com/en/article/Order-by-Seat
- Toast — Quick Order vs Table Service ordering screens: https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens
- Square — Building your floor plan: https://squareup.com/help/us/en/article/6427-building-your-floor-plan
- Square — Floor plan sections (requires Full-Service/Bar): https://squareup.com/help/us/en/article/8145-create-a-floor-plan-section-with-square-for-restaurants
- Square — Split & merge open tickets: https://squareup.com/help/us/en/article/8439-split-and-merge-open-tickets
- Square — Comp, void, and reassign checks: https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants
- Square — Split a payment and check (split tender / by amount / by seat): https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants
- Square — Preauthorization for bar tabs: https://squareup.com/help/us/en/article/8455-enable-and-configure-preauthorization-for-bar-tabs
- Square — Dining options: https://squareup.com/help/us/en/article/5573-use-dining-options-with-the-square-app
- Square — Create menus / dayparting: https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants
- Square — Managing items (sold-out sync across channels): https://squareup.com/help/us/en/article/6425-managing-items-with-square-for-restaurants
- Square — Mark items and modifiers as sold out: https://squareup.com/help/us/en/article/8430-mark-items-and-modifiers-as-sold-out
- Square — Modifiers and categories (min/max, defaults): https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants
- Square — Apply discounts: https://squareup.com/help/us/en/article/5362-apply-discounts
- Square — Get started with comp and void (permissions): https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void
- Square — Set up and customize tipping: https://squareup.com/help/us/en/article/8631-set-up-and-customize-tipping
- Square — Accept & settle tips: https://squareup.com/help/us/en/article/5069-accept-tips-with-the-square-app
- Square — Automatic gratuity: https://squareup.com/help/us/en/article/8175-customize-and-apply-automatic-gratuity-with-square-for-restaurants
- Square — Tip pooling: https://squareup.com/help/us/en/article/7654-get-started-with-tip-pooling-for-team-management
- Square — Print receipts / reprint: https://squareup.com/help/us/en/article/6139-print-receipts
- Square — Manage receipt settings (digital auto-enabled): https://squareup.com/help/us/en/article/8669-manage-receipt-settings-on-square-point-of-sale · https://squareup.com/help/us/en/article/5212-automatic-receipts
- Square — Modes (Full/Quick/Bar) / Open tickets: https://squareup.com/help/us/en/article/8458-use-modes-with-square-point-of-sale · https://squareup.com/help/us/en/article/5337-use-open-tickets-with-square
- Toast auto-gratuity classification (VENDOR-MARKETING, blog): https://pos.toasttab.com/blog/on-the-line/automatic-gratuity

Kitchen / KDS:
- Toast — Item and Order Fulfillment on KDS (bump/recall, item + order): https://support.toasttab.com/en/article/Item-and-Order-Fulfillment-on-KDS
- Toast — Basic Kitchen Configuration (Warning Colors / aging; prep stations): https://support.toasttab.com/en/article/Basic-Kitchen-Configuration
- Toast — KDS All Day: https://support.toasttab.com/en/article/KDS-All-Day-1493055871075
- Toast — Order Ready Board: https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration
- Toast — Send Text Message when Order is Fulfilled (KDS-fired SMS): https://support.toasttab.com/en/article/Send-Text-Message-when-Order-is-Fulfilled-1492800294544
- Toast — Notifications for KDS Fulfilled Orders (read-only push to POS): https://support.toasttab.com/en/article/Notifications-for-KDS-Fulfilled-Orders-1492809350380
- Toast — Prep Stations Basics (routing + assigned ticket printer): https://support.toasttab.com/en/article/Prep-Stations-Basics
- Toast — Setting Up an Expediter / Using a KDS expediter screen: https://support.toasttab.com/en/article/Setting-Up-an-Expediter · https://doc.toasttab.com/doc/platformguide/adminUsingExpo.html
- Square — Get started with Square KDS (all-day, timers, expo, station types): https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android
- Square — Complete orders with Square KDS (item vs whole ticket): https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds
- Square — Filter orders by category with Square KDS (order-type routing): https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds
- Square — Create and assign item categories (printer/station routing): https://squareup.com/help/us/en/article/8148-create-and-assign-item-categories-with-square-for-restaurants
- Square — Print order tickets (kitchen printer): https://squareup.com/help/us/en/article/5194-print-order-tickets
- Square — Order-ready texts: https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants

Cross-cutting:
- Toast — Using Toast in Offline Mode (orders + card with background processing): https://support.toasttab.com/en/article/Using-Toast-in-Offline-Mode
- Toast — Offline KDS devices (local network, needs hub) / Offline mode local sync: https://doc.toasttab.com/doc/platformguide/platformOfflineKDSDevices.html · https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html
- Toast — Clocking In and Out for Shifts and Breaks: https://support.toasttab.com/en/article/Clocking-In-and-Out-for-Shifts-and-Breaks
- Toast — Shift Review Overview / Use Cash Drawers / Close Out Day Z-Report: https://support.toasttab.com/en/article/Shift-Review-Overview · https://support.toasttab.com/en/article/Use-Cash-Drawers-New-Experience · https://support.toasttab.com/en/article/Close-Out-Day-Z-Report-Auto-Capture
- Square — Process card payments with offline mode: https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode
- Square — Clock in and out for team members / Set up time tracking: https://squareup.com/help/us/en/article/8395-clock-in-and-out-for-team-members · https://squareup.com/help/us/en/article/8389-set-up-time-tracking
- Square — Start and end a cash drawer session / View cash drawer reports: https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session · https://squareup.com/help/us/en/article/8358-view-cash-drawer-reports

Related Umi research (context):
- POS + KDS client architecture (Toast/Square/Lightspeed/NovaTab): [2026-09-06-pos-kds-client-architecture-vendor-research.md](2026-09-06-pos-kds-client-architecture-vendor-research.md)
- Kiosk, POS order-status, tables, device-role boundaries: [2026-09-06-pos-kiosk-and-device-role-boundaries-research.md](2026-09-06-pos-kiosk-and-device-role-boundaries-research.md)
- Decision ADR (Spanish): [2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md](../architecture/2026-09-06-unificar-kds-en-pos-modos-por-rol-adr.md)
