# Square — Ecosystem Research Notes (raw, by area)

Compiled 2026-09-06 for Umi competitive analysis. Sources are official squareup.com help/product pages + press. Prices are US, current as of the Oct 2025 unified pricing unless noted.

---

## 0. Pricing / packaging (foundation for everything)

### Unified plans (launched Oct 6, 2025) — replaced 18 à-la-carte subscriptions with 3 plans
Source: https://squareup.com/us/en/press/unified-pricing-and-packaging
- **Square Free — $0/mo per location.** Includes POS, websites, online ordering, invoicing, Square Banking. No monthly fee; pay per transaction only.
- **Square Plus — $49/mo per location.** Advanced POS features across all 7 POS "modes" (QSR, bars, salons, retailers, etc.), advanced inventory, loyalty, marketing, staff management. In-person rate 2.5% + 15¢.
- **Square Premium — $149/mo per location.** Nearly all Square software + 24/7 phone support + advanced reporting. In-person rate 2.4% + 15¢.
- Excluded/separate: Square Payroll, Square for Franchises (separate add-ons). Hardware sold separately.
- Claim: sellers adopting Square software "see 9% higher sales" (2024 internal).

### Restaurants pricing page (has some restaurant-specific add-on framing + a new "Pro" tier)
Source: https://squareup.com/us/en/point-of-sale/restaurants/pricing
- Square Free: item/menu mgmt, pickup, local delivery, branded online ordering page. KDS & Kiosk apps NOT included.
- Square Plus: inventory tracking, close-of-day reports. KDS app add-on $30/mo per device; Kiosk app add-on $50/mo per device. (Restaurant "best value.")
- Square Premium: coursing + seat management. KDS app add-on $20/mo per device; Kiosk app add-on $30/mo per device.
- **Square Pro**: custom pricing for businesses processing > $250K/yr; hardware discounts, onboarding, technical specialists, account management. (NB: older docs called this custom/Enterprise; also "Square for Restaurants Plus was $60/mo + $40/device" pre-unification — superseded.)
- Restaurant feature list surfaced: automatic gratuity, service charges, instant payouts, open checks, house accounts, QR code payments, split checks, preauthorized bar tabs.

---

## 1. Square for Restaurants POS / register
Sources:
- https://squareup.com/us/en/point-of-sale/restaurants
- https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants (menus)
- https://squareup.com/help/us/en/article/6426-modifiers-and-categories-with-square-for-restaurants (modifiers)
- https://squareup.com/help/us/en/article/6429-check-management-with-square-for-restaurants (checks)
- https://squareup.com/help/us/en/article/8146-customize-table-management-settings (tables)
- https://squareup.com/help/us/en/article/7748-coursing-with-square-kds (coursing)

Positioning: "Cool. Calm. Connected tech." Cloud POS for single- and multi-location full-service and quick-service. 7 POS modes. iPad + Android + Square hardware. March 2025 redesign of Restaurants POS.

**Menus** (help/6424): Terminology hierarchy = Menu > Menu Group > Item; Category is INTERNAL (reporting, kitchen routing, retail) not buyer-facing. Menu = set of groups/items shown on POS, online, kiosk, delivery apps for certain periods/dayparts. Creation options: (1) upload PDF/JPG/PNG or URL → Square builds it (email when ready, <24h); (2) import from Toast/DoorDash via WoFlow; (3) AI starter menu (answer cuisine/size questions → template); (4) manual. Item has display name + kitchen-facing name + price. Menu tiles show description, calories, allergens, images. Per-menu: locations + sales channels (POS, online sites, kiosks, ordering profiles, delivery apps). Menu hours for dayparting; menu-group hours override (within menu hours). Menu drafts = zero channels. Duplicate menus (independent). Drag-and-drop menu ordering.

**Modifiers** (help/6426): Standard (±price), Text modifiers (Websites/Kiosk only, 150 char), Conversational modifiers (operator buttons: Add/No/Extra to reduce errors). Rules: optional/required, single/multi, min/max, modifier quantities. **Nested modifier sets (Beta): up to 3 levels, max 5 child sets.** Display order customizable per item/global + SEPARATE ordering for kitchen displays. Location/channel control. Hide modifiers on receipts. POS tile color. Sold-out modifiers auto-reorder. Item-level overrides. Modifiers appear on tickets, receipts, item library, sales report. Nested modifiers pass to DoorDash/Uber Eats/Grubhub/3rd-party KDS. Incompatible with barcode scanners.

**Checks** (help/6429): 4 actions — Comp (remove cost of already-made/delivered item; shows in sales+inventory), Void (item entered wrong, not yet made), Reassign (pass check to another clocked-in team member on shift change), Move (items between courses / to new checks / merge checks). Check with a cover count set persists on floor plan even w/o items (table shows occupied once server sets covers). Real Time Check View (beta) = bulk actions. Drag-and-merge on floor plan. Enabled via Dashboard > Device Management > Profiles. Also: split checks, open checks, house accounts, preauth bar tabs, QR pay (from pricing page).

**Tables/floor plan** (help/8146): Click-and-drag floor plan editor = digital layout. Floor plan indicators = color coding by elapsed time (Turn Yellow After / Turn Red After thresholds) + time since check opened. Track seating (needs Plus/Premium) — 3 cover modes: tracking only / optional seat positions / required positions; ties each dish to a seat. Merge tables (Android SfR 7.3+) preserves checks & seat assignments (shows "occupied"+"linked"). Section sales reporting per floor area.

**Coursing** (help/7748): "manage flow of checks front + back of house." Enable via Device Management > Modes > restaurant template > Enable Course Management. Group items into courses; Fire/Hold icons. Fired course auto-prints to kitchen/bar printer and/or shows on KDS. Two display modes: show fired+held, or only-show-fired (with full ticket summary view). Requires Premium (per pricing).

---

## 2. Square KDS
Sources:
- https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system
- https://squareup.com/help/us/en/article/7959-route-orders-with-your-kds (routing)
- https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android (setup)
- https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds
- https://squareup.com/help/us/en/article/8171-complete-orders-with-square-kds

**Android-only** kitchen display app (Google Play). Replaces paper tickets/printers. Pricing: Plus $30/mo/device, Premium $20/mo/device; no install cost.
Features: digital tickets, customizable ticket layouts + timers + notifications, order sources (Square POS, Square for Restaurants, online ordering, kiosk, delayed fulfillment, delivery apps e.g. Postmates), station routing, **Expeditor/Expo mode** (oversee fulfillment) vs **Prep mode** (granular per-station view of only that station's items), timers/alerts, prep insights/reports (prep times), 2-way ticket interaction, complete + recall orders, filter orders by kitchen routing category.
**Routing** (help/7959): Dashboard > Settings > Device Management > Devices > [device] > Manage > Routing > Source & fulfillment. Toggle "View point of sale orders" + choose which POS locations/devices it receives from; toggle "View online, kiosk and delayed fulfillment orders." Route items to stations via categories (Category = the routing key). Community note: to route from prep stations to expo you have one KDS per station/cook and route by category.

---

## 3. Online ordering / delivery / QR
Sources:
- https://squareup.com/us/en/online-ordering
- https://squareup.com/help/us/en/article/7142-set-up-self-serve-ordering-and-qr-codes-with-square-online
- https://squareup.com/us/en/point-of-sale/restaurants/food-delivery-software
- https://squareup.com/help/us/en/article/8438-set-up-delivery-options-with-square-online
- https://squareup.com/us/en/press/on-demand-delivery-doordash
- https://squareup.com/us/en/app-marketplace/app/doordash

**Square Online / Online Ordering profiles**: branded digital storefront, share link anywhere, free (no monthly). "up to 30% savings on marketplace commissions" for direct orders. All orders (online+in-person) flow into Square POS → kitchen; no separate ordering device. Menus, orders, customer data unified. Cash App Pay accepted. Fulfillment: in-person pickup (free), curbside, local/self delivery, on-demand delivery, shipping, dine-in QR.

**QR order & pay** (help/7142): Dashboard > Channels > Square Online > Website Settings > QR code ordering > Set up per location. Configure ordering stations (auto-assign or manual entry), hours, timezone, SMS alerts, ticket prefs. Download QR codes (unique per station or identical). Customer scans at table → mobile web ordering page → items + special requests → pays on phone. Order appears on POS and feeds kitchen printer or KDS. No cash/card handling.

**Delivery**:
- **On-demand via DoorDash** (Square dispatches a Dasher): seller pays flat $1.50/order to Square + flat DoorDash fee; can pass fees to buyer or run delivery promos.
- **Self / in-house delivery**: your own drivers. Can't run in-house + on-demand at same location simultaneously, but can switch anytime.
- **Direct DoorDash integration** (press/townsquare): manage DoorDash orders, items, menus from Square Dashboard — no extra tablet, no double entry; item availability/pricing auto-syncs to DoorDash. Also Uber Eats direct. Order integrations aggregate in-house/online/delivery/QR into one workflow.

---

## 4. Loyalty / Marketing / Gift Cards
Sources:
- https://squareup.com/us/en/software/loyalty
- https://squareup.com/help/us/en/article/3952-create-a-loyalty-program-with-square
- https://squareup.com/help/us/en/article/7794-get-started-with-square-loyalty-promotions
- https://squareup.com/us/en/marketing ; /software/marketing/email ; /software/marketing/sms ; /software/marketing/pricing
- https://squareup.com/us/en/gift-cards ; help/8402 (sell/send); help/8404 (accept); help/6000 (egift)

**Loyalty**: Points earned by visit / spend / item / category → rewards (discount/free item). **VIP Tiers (new)**: Bronze 1.5x / Silver 2x / Gold 3x point multipliers. Promotions = limited-time/recurring bonus-point campaigns. Enroll via POS, website, invoices, phone# at checkout. Apple Wallet digital passes. Transactional SMS on points/rewards earned. Integrates with Square Marketing (email+SMS) + built-in CRM (Customer Directory). 3rd-party apps (Kyoo, Kiosk Buddy, Craver, PoppinPay). Stat: loyalty customers spend 53% more, visit 40% more (F&B: +46% spend, +57% visits). Included in Plus/Premium. Setup: Dashboard > Customers > Loyalty > Get Started.

**Marketing**: Requires Plus/Premium for email/SMS. Email included in Plus/Premium. SMS = $10/mo after 30-day trial + per-text cost. Automations: welcome, birthday, abandoned-cart, win-back/reengage. Automated campaigns 1.7x open rate, 2.3x coupon redemption vs blasts. SMS 98% open rate. Customer Directory = free built-in CRM (auto opt-in list, attributed sales). Marketing Assistant. Mailchimp/Klaviyo also in marketplace.

**Gift cards** (help): eGift + physical, sold from POS (all devices) + Dashboard. Physical: Checkout > Shortcuts > Sell physical gift card (scan barcode/QR or manual 16-digit; swipe auto-loads). eGift: Library > Gift Cards > Sell an eGift card (pick design, amount, recipient email, Charge). Activated on sale, no expiry. Up to 2.5% load fee per load; no redemption fee. Max $2,000/card; max $10,000/person/day. QR/barcode load/redeem iOS-only. Gift Cards API for developers. Custom-branded gift cards available.

---

## 5. Payments / processing / tipping / Tap to Pay / Afterpay
Sources:
- https://squareup.com/us/en/payments/our-fees
- https://squareup.com/help/us/en/article/7788-afterpay-and-square-faq
- https://squareup.com/help/us/en/article/7786-get-started-with-tap-to-pay-on-iphone
- https://squareup.com/help/us/en/article/7960-get-started-with-tap-to-pay-on-android

**Processing rates (by plan)**:
- In-person tap/dip/swipe: Free 2.6%+15¢ / Plus 2.5%+15¢ / Premium 2.4%+15¢
- Online: Free 3.3%+30¢ / Plus & Premium 2.9%+30¢
- Online API (all): 2.9%+30¢
- Manual entry / card-on-file (all): 3.5%+15¢
- ACH invoice: 1% ($1 min; Plus/Premium $10 cap)
- Afterpay: 6%+30¢
- Cash/check: free; Bitcoin: 0% until 2027; EBT: 1.8%+5¢
- Fee taken from total incl. tax + tip; same rate all card brands. No monthly on Free. Custom pricing >$250K/yr.

**Tap to Pay**: iPhone (XS+, iOS 15.5+) — accepts Apple/Google/Samsung Pay + NFC cards; hold-here icon front of phone. Android (9+, NFC) — NFC on back. Per-txn limit $50,000 contactless / $10,000 physical contactless card. No hardware needed. Also: invoicing, payment links, Virtual Terminal.

**Afterpay (BNPL)**: 4 interest-free installments over 6 weeks; seller paid full upfront, no risk. Free to enable (no monthly/startup). In-person 6%+30¢. Customer taps digital Afterpay Card via Tap to Pay. Also on Square Online checkout.

---

## 6. Hardware / devices
Sources:
- https://squareup.com/us/en/hardware
- https://squareup.com/us/en/hardware/kiosk ; help/8310 (kiosk setup); help/8380 (kiosk troubleshoot)
- https://squareup.com/help/us/en/article/8245-set-up-printer-profiles
- https://squareup.com/help/us/en/article/6261-connect-recommended-hardware-to-square-register
- https://squareup.com/help/us/en/article/6334-hardware-compatibility-by-device

Products + prices:
- **Square Register (2nd gen, NEW)** — $899 / $44/mo×24. Two screens (merchant + customer), all-in-one, no phone/tablet needed.
- **Square Handheld** — $399 / $37/mo×12. Mobile POS.
- **Square Terminal** — $299 / $27/mo×12. All-in-one w/ built-in receipt printer.
- **Square Stand** — $149 / $14/mo×12. Swiveling iPad POS w/ integrated card reader (USB-C).
- **Square Kiosk** — $149 / $14/mo×12. Self-service iPad kiosk; VESA 100×100 mounts (wall/counter/stand); + Kiosk software subscription ($50/mo Plus, $30/mo Premium per device).
- Readers: contactless+chip, magstripe. Accessories, hardware kits.
- Peripherals: KDS (Android tablet), kitchen printers, label printers, keyboard, barcode scanners, cash drawers. USB accessories plug into hub on power cord (Stand/Register/Terminal); Ethernet via router → wifi to device.
**Device management**: Dashboard > Settings > Device Management > Devices (assign modes, routing) + Profiles + printer profiles. Kiosk onboarding via Device Management > Kiosk.

---

## 7. Dashboard / reporting / analytics
Sources:
- https://squareup.com/help/us/en/article/6433-reporting-with-square-for-restaurants
- https://squareup.com/help/us/en/article/8142-get-real-time-sales-data-on-square-restaurants-pos
- https://squareup.com/help/us/en/article/8579-review-daily-sales-for-your-restaurant
- https://squareup.com/help/us/en/article/6104-creating-custom-reports-in-the-online-dashboard
- https://squareup.com/us/en/point-of-sale/features/dashboard/analytics

Square Dashboard (web + iOS app). Reports: sales summary (closed sales, partial payments, tips, deposits), sales trends (daily/weekly/yearly gross+net compare), payment methods, **Section sales** (Reports > Sales > Section sales — per floor-plan area/bar/patio), **Kitchen performance** (Reports > Operations > Kitchen performance — completed ticket count + avg completed ticket time across devices/locations), daily sales review, live/real-time sales during service (open checks + total sales; staffing decisions), custom exportable reports. Advanced reporting on Premium.

---

## 8. Inventory / item library / vendors / COGS
Sources:
- https://squareup.com/us/en/point-of-sale/features/inventory-management
- https://squareup.com/us/en/inventory-management/restaurants (MarketMan)
- https://squareup.com/us/en/press/square-restaurant-inventory-marketman
- https://squareup.com/help/us/en/article/5958-vendor-management ; help/8262 (unit cost); help/8264 (missing unit costs)

Base inventory (in POS): item library (Dashboard > Items), CSV import, stock counts, receive/adjust, low-stock alerts. Unit costs on catalog items → COGS reports + margins. Vendor management: vendor profiles, SKUs + vendor codes, purchase orders, barcodes. Track missing unit costs.
**Square Restaurant Inventory by MarketMan** (add-on): ingredient-level real-time stock, automated purchasing, cost-of-goods insights, recipes. **+$99/mo per location; requires Plus or Premium.** Launched via Square×MarketMan partnership.

---

## 9. Multi-location
- Team-member location assignment gates access to data/menus/features per assigned location; can view shifts/availability across multiple locations. Per-location pricing ($/location). Menus assignable to single/multiple locations; per-location item + channel settings. Square for Franchises = separate add-on for large multi-unit. Section/kitchen reports roll up across devices+locations.

---

## 10. Integrations / App Marketplace / Developer API / offline API
Sources:
- https://developer.squareup.com/us/en ; /docs ; /reference/square
- https://developer.squareup.com/docs/app-marketplace/faq
- https://developer.squareup.com/docs/pos-api/cookbook/offline-mode
- https://squareup.com/help/us/en/article/5437-manage-your-square-app-marketplace-subscriptions

20+ APIs, 100+ endpoints. SDKs: Python, Node, Ruby, PHP, Java, .NET, plus Web Payments SDK, Mobile Payments SDK (In-App Payments). APIs: Payments, Payouts, Bank Accounts, Terminal, Checkout, Subscriptions, Invoices, Orders, Catalog, Inventory, Locations, Vendors, Merchants, Customers, Bookings, Loyalty, Gift Cards, Team/Staff/Labor, Reporting (Beta). Webhooks/events, API logs, API Explorer, GraphQL Explorer, Postman. App Marketplace to publish (technical requirements per API used). Restaurant marketplace apps: DoorDash, Uber Eats, Grubhub, OpenTable, SevenRooms, MarketMan, Mailchimp, Klaviyo. POS API offline: offline payment returns client_transaction_id (no transaction_id until synced); reader needs device online within 24h + Bluetooth.

---

## 11. Team / Payroll / Shifts / permissions
Sources:
- https://squareup.com/us/en/point-of-sale/team-management/features (→ redirects to Square Advanced Access)
- https://squareup.com/us/en/staff/shifts/features ; /staff/shifts
- https://squareup.com/help/us/en/article/7155-scheduling-with-team-management
- https://squareup.com/help/us/en/article/8356-add-and-manage-team-members

**Team Management / Advanced Access**: per-employee passcodes + team-member badges (badge tap = fast login/clock-in/overrides), custom permission sets (unlimited on Advanced Access/Plus+), control refunds/order edits/discounts/voids, activity log, per-member sales reporting. Included with Plus ($49/mo/loc) / Premium ($149/mo/loc); "Team Plus" legacy tier.
**Square Shifts**: clock in via POS/mobile (passcode + geofencing), auto timecards, scheduling (publish w/ email/app notify, duplicate schedules, open-shift claim, peer swaps, availability + time-off requests, max 3 shifts/member/day), labor-cost dashboard (hours/wages/tips), **labor-vs-sales** analysis, early clock-in prevention, break + overtime tracking, tip pooling automation, cash tip claiming, custom commission. Syncs to **Square Payroll** (+3rd-party export). Team App for self-service.
**Square Payroll** = separate paid add-on.

---

## 12. Offline mode / reliability
Sources:
- https://squareup.com/help/us/en/article/7777-process-card-payments-with-offline-mode
- https://squareup.com/help/us/en/article/8551-view-offline-payments
- https://squareup.com/au/en/payments/features/offline

Offline mode = capture cash + card while disconnected, upload on reconnect. Available on Square Reader, Stand, Register (rolled out over time; historically NOT all devices — competitive weakness). Card window: customers can tap/insert for **up to 1 hour** offline; must reconnect within **24 hours** to upload. Accepts Visa/MC/Amex/JCB + opt-in chip&PIN/Apple Pay/Google Pay. Set max per-txn amount ($1–$50,000). Settings > Checkout > Offline payments. **Risk on seller**: declined/disputed/expired offline txns are seller's liability; Square recommends signatures. Normal fees apply. NB: offline is degraded mode — no live menu/inventory/KDS sync while offline; cloud POS depends on connectivity for full function.

---

## 13. Kiosk / customer-facing display
Sources: /us/en/hardware/kiosk ; help/8310 ; help/5492 (customer display / Terminal as customer display)
- **Square Kiosk**: self-order iPad kiosk; customers browse menu, customize (incl. text modifiers), pay; feeds POS + KDS/printer. Reduces labor. Kiosk software $50/mo (Plus) / $30/mo (Premium) per device + $149 hardware.
- **Customer display**: Square Register has dual screens (customer-facing); Square Terminal can pair as a customer display to a Square POS device (help/5492) for order confirm + tip + pay.

---

## 14. Adjacent products (brief)
- **Square Appointments**: bookings/scheduling (staff availability, online booking, reminders); has its own free/paid tiers; Bookings API. Beauty/services focused but relevant to reservations.
- **Square Invoices**: send invoices, recurring, ACH 1%/card 3.3%+30¢; free tier + Invoices Plus.
- **Square Banking**: checking/savings/loans; Square Capital = merchant cash advance/loans based on Square sales history; instant transfers/payouts (fee). Bundled free.
- **OpenTable / SevenRooms** integrations for reservations (help/7878, help/8270).

---

## KEY COMPETITIVE OBSERVATIONS (for Umi)
- Everything is one connected cloud graph: menu/item/category/order/customer shared across POS, online, kiosk, KDS, delivery — single source of truth. Category doubles as kitchen-routing + reporting key.
- Per-location + per-device pricing stacks up fast (KDS/Kiosk are per-device add-ons on top of $49–$149/loc). Deep inventory (MarketMan) is +$99/loc.
- KDS is Android-only; POS is iPad-first (plus Android for SfR). Fragmented OS story.
- Offline is a real weakness: degraded, time-boxed (1h/24h), seller assumes decline risk, no live sync — a cloud-dependent architecture.
- Strengths: menu ingestion (photo/PDF/AI/import from Toast/DoorDash), conversational + nested modifiers, coursing + seat-level tracking, direct DoorDash/Uber menu sync, unified loyalty/marketing/CRM, broad open API + marketplace.
- Gaps/edges: coursing gated to Premium; advanced reporting gated to Premium; SMS marketing metered; QR load/redeem iOS-only quirks; no native deep recipe/inventory (needs MarketMan partner).
