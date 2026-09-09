# Lightspeed — Raw Research Notes (Competitive Analysis for Umi)

Scope: Lightspeed Restaurant (K-Series) primary; Retail (X/R-Series) and product-line packaging noted where relevant.
Method: WebFetch of official *.lightspeedhq.com help + product pages, plus WebSearch. Date: 2026-09-06.
Product lines seen in K-Series hub footer: Restaurant K/L/U/O/G-Series; Retail/eCom X/E/R/C/S-Series; Golf.

---

## AREA 5 — PAYMENTS (deep dive; start URL)

### Configuring Lightspeed Payments
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4402921757083-Configuring-Lightspeed-Payments
- Lightspeed Payments = Lightspeed's own integrated processor for K-Series; accept credit/debit card payments in restaurant.
- After application approval: onboarding emails; Viking Cloud partner handles PCI compliance at NO cost to all LSP users.
- Configure at Payment > Payment methods > (Lightspeed Payments) Manage. Settings apply across all locations & POS configs.
- Payment processing modes:
  - Standard: card authorized AND captured immediately.
  - Pre-authorized or batch (AU, UK, US only): authorized instantly, captured at 5:29 AM local next morning. Required for bar tabs.
- Settings: Allow tipping; Deduct percentage from tips (auto subtract %); Bar tabs (pre-auth to verify account + hold min funds).
- Receipt options (Smart Terminal w/ Printer): upload logo (JPEG/PNG, black-and-white only, min 240x384px), restart terminal.
- Per-terminal settings (Terminal / Mobile Tap / Tap to Pay for iPhone): Name (shown on POS + receipt), Accounting reference, Include in floats, Initiate payment via QR code (works even if method disabled on POS), Open cash drawer.
- Surcharging: optional credit-card surcharge shown as separate line item to offset processing fees.
- POS configuration options for LSP: signature capture, tip management (controlled from Back Office, applied to POS devices).
- Go live: Reload POS config (POS > Devices > select > Reload devices → "Remote reload requested" → "OK"; auto-completes at next manager login) OR on device (manager login > status menu > refresh).
- Push updates to terminal: Smart Terminals: Settings > Config (PIN 5773) > Update. Verifone e285/V400/P400+: press 9 then green circle > PIN 5773 > Config > Update. Terminal restarts.

### Lightspeed Payments FAQ
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/15214224728987-Lightspeed-Payments-FAQ
- Differentiator: integrates directly with LS POS; unified management. No integration with other POS or processors.
- Apply via Back Office ("Activate Lightspeed Payments" on first login) or Product Switcher; separate application per business location.
- Lightspeed handles most gateway config after approval; merchant adjusts tipping/surcharging/signature.
- Non-LSP processing = monthly third-party processing fees. Cancel via Sales Account Manager.
- Ownership change: update via Financial Services Settings; 5-10 business days to process (avoid funding delays).
- HARDWARE (country-dependent, MUST buy from Lightspeed — no third-party): Smart Terminal, Smart Terminal with Printer, Verifone V400m, Verifone P400, Verifone e280/e285. Mobile Tap card reader supported.
- Most major credit cards auto-enabled; some third-party apps/payment types need separate activation.
- US: no PIN entry in most scenarios; international cards may prompt PIN (press green to bypass).
- Manual keyed entry: enable "Lightspeed Payments - Manual Keyed Entry"; add items > Pay > Manual Entry > key card# + expiry on terminal.
- Refunds settle to cardholder in 2-7 business days (bank-dependent).
- Reports in Financial Services tab: processed payments, settlements, monthly statements, Capital advances/offers. Automated daily reports to email.
- Deposits: settlements deposited ~1 business day after transaction.
- Chargebacks: disputed funds + chargeback fee immediately debited from merchant; LSP team emails merchant, requests evidence; merchant disputes or accepts.
- PCI: LSP hardware+software PCI compliant; merchant must handle card data securely.
- 1099-K (US only): downloadable in Financial Services > Documents.
- NOTE: FAQ does NOT publish transaction fees / processing rates / pricing.

### Getting paid with Lightspeed Payments
Source: https://k-series-support.lightspeedhq.com/hc/articles/4405144744347
- Batch cutoff = 6 AM local time. Transactions 6AM–5:59AM next day = that day's deposit.
- Payout ~1 business day (Mon txn → Tues funds). No weekend transfers (Fri/Sat/Sun → Monday deposit).
- Settlement statuses: Deposited / Pending. "Deposited" = bank received, may not yet be posted to account.
- What's deposited ≠ gross: processing fees (processors, card providers, banks) deducted before deposit.
- Pre-auth (AU/US/UK) may add a day. Instant Payout / same-day payouts available to some merchants by region + processing history.
  - Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/28477493132571 (Receiving Instant Payouts)

### Surcharging with Lightspeed Payments
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/12625085075995-Surcharging-with-Lightspeed-Payments
- Additional fee on credit-card transactions at sale, separate line item.
- Automatic surcharging ONLY in Canada + US; NOT available with Mobile Tap terminals.
- Excluded: debit/prepaid cards, card-not-present (Order Anywhere, manual entry), DCC payments, standalone refunds.
- Caps: Canada max 2.4% (disabled in Quebec); USA max 3%; never exceed your processor's rate. Credit cards only.
- Must notify Mastercard via web form before enabling; signage at entry/POS/receipt; customer can cancel w/o penalty; assessed on final amount after discounts incl. tips.
- Australia: surcharging illegal as of Oct 1 2026 — auto-disabled for AU accounts.
- Requires "At Sale" auth+capture; not compliant with pre-auth in most regions. Different from cash discounting.
- Setup: Back Office > Financial services > Settings > Payments > toggle Surcharging > customize % > Save > restart terminal.

### Tap to Pay on iPhone with Lightspeed Payments
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/10071706424347-Tap-to-Pay-on-iPhone-with-Lightspeed-Payments
- Accept payments directly on iPhone, NO extra hardware (Apple Pay, contactless cards, digital wallets).
- Requirements: iPhone XR+, iOS 18.4+, passcode/Touch ID/Face ID enabled, LSP account, Lightspeed Restaurant iOS v24.2+.
- Recommend keeping terminal(s) alongside (not all customers have contactless).
- Enable: Payment > Payment methods > Manage > Tap to Pay for iPhone > Activate > Enable > reload config. First txn links to Apple ID.
- Tipping: guest-facing tipping on POS; predefined suggestions by percentage, amount, or percentage/amount by payment threshold; customer can skip or enter custom.
- Canada Tap to Pay limit = $250 (over = declined).
- Reporting in Lightspeed Payments reports.

### Related payments articles (URLs captured, not all fetched)
- Standalone payments: https://k-series-support.lightspeedhq.com/hc/articles/5028210082715
- Mobile Tap setup: https://k-series-support.lightspeedhq.com/hc/articles/13189156370459
- Enabling optional payment methods: https://k-series-support.lightspeedhq.com/hc/articles/13724852778267
- Manually processing credit cards: https://k-series-support.lightspeedhq.com/hc/articles/12875393640859
- Lightspeed Payments reports: https://k-series-support.lightspeedhq.com/hc/articles/20584722767387
- Automated reporting: https://k-series-support.lightspeedhq.com/hc/articles/12285092786203
- Preventing chargebacks: https://k-series-support.lightspeedhq.com/hc/articles/4402308204699
- Managing chargebacks: https://k-series-support.lightspeedhq.com/hc/articles/4402294260251
- Understanding PCI compliance: https://k-series-support.lightspeedhq.com/hc/articles/4402294082459
- Troubleshooting LSP for Restaurant POS: https://k-series-support.lightspeedhq.com/hc/en-us/articles/18140638499355
- Understanding payment types: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804605710
- New suggested tips features: https://k-series-support.lightspeedhq.com/hc/en-us/articles/36568686958107

---

## AREA 1 — POS / REGISTER (order taking, tables, coursing, QS vs TS)

### Adding orders in Table Service mode
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051089273-Adding-orders-in-Table-Service-mode
- Orders start in Direct Sale mode; assigning a table or opening a tab activates Table Service mode. TS = server-led dining.
- Assign table: tap on floor plan, OR keypad enter table# > Tables button.
- Open a tab (if enabled): Continue (pre-auth card) or Skip pre-auth; name tab; confirm pre-auth amount; Open tab.
- Covers: specify # of diners when opening table (if enabled in Back Office); supports split-check + guest-count reporting.
- Order items by Course: default all items to Course 1; Add a course; reassign via Actions > Edit order > Assign to > course.
- Order items by Seat: Display mode > By seat; Add a seat; per-seat notes + allergen warnings; reassign items to seats.
- Combine seat + course tracking (large groups) via "+" icons.
- Send: saves items + notifies kitchen/prep via production centers or KDS. After a course is sent, items can't be moved between courses/seats; reopen + send again (only new items print).
- Fire course: Actions > Fire course; next course ticket prints. Icons: white arrow (unfired), orange flame (fired/active), green check (completed).
- Reprint order ticket / production docket (choose centers); "** RE-PRINT **" header.
- Print check (draft receipt) before payment; then Pay. Split checks, void payments in separate About payments article.
- Related: Understanding the Tables screen (360050328494), About payments (360051089453), Bar tabs (4408079047579 / 4408089985179).

### Understanding the Register screen
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328394 (URL captured)

### About floor plans and tables / Managing floor plans and tables
Sources:
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804656689-About-floor-plans-and-tables
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804656709-Creating-and-managing-floor-plans-and-tables
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328494-Understanding-the-Tables-screen
- Floor plans mirror physical layout; staff see available/occupied/open seats; group tables into environments.

### Bar tabs
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4408089985179-Creating-and-managing-bar-tabs
- Pre-auth card to open tab, hold min funds (requires pre-auth/batch payment mode).

Note: New POS navigation article exists: https://k-series-support.lightspeedhq.com/hc/en-us/articles/43162671781659-About-the-new-POS-navigation

---

## AREA 8 — MENU / ITEMS / MODIFIERS / INVENTORY

### About menu management
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804605390-About-menu-management
- Menus determine what's orderable at POS. Assign each menu to a device (toggle configs by time of day / area).
- Structure: Main screens (categories grouping buttons) → Buttons (items, sub-screens, discounts, production instructions, transfer operations, order profiles, web extensions) → Sub-screens (nested).
- Max 20 main screens per menu. Menus can be created/edited/duplicated/deleted (unlink from config first)/imported/exported.
- Multi-location: share menus across locations.
- Related: About items (1260804656089), About modifiers (1260804656349), Transfer operations (1260804605650).

### About Inventory (add-on module)
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4407517428891-About-Inventory
- Manage stock levels, purchase orders from suppliers, recipes/ingredients for made-to-order products.
- Stock management: qty + value on hand, reorder points, export stock, stock counts. (4407509542043)
- Produce: recipes + production batches (bulk items made on schedule) for consistency. (4407511020571)
- Purchase: create POs, manage suppliers, receive/track orders. (6752297865883)
- Recipes tie finished products to ingredients so stock adjusts as items assembled. (4407511552155)
- Par levels = reorder points to flag low stock. (6686397618843)
- Ingredient-level tracking. Apicbase integration for advanced F&B management (23703291190043).
- Stated as add-on: "With the Inventory module added to Lightspeed Restaurant K Series..."
- Multi-location item scoping (from menu docs): Local (one location), Shared (all locations, per-site settings, same name), Global (all locations, changes affect all equally).

---

## AREA 2 — KDS / KITCHEN DISPLAY + ROUTING / PRINTING

### About the Lightspeed Kitchen Display System
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4418209500443-About-the-Lightspeed-Kitchen-Display-System
- KDS = order manager; displays orders on screen for kitchen/bar/prep; live picture; improves FOH↔BOH comms.
- KDS 2.0 = latest (since Jan 2024). KDS 1.0 = iOS only, legacy.
- PAID ADD-ON to existing Restaurant subscription. Contact Sales / sales@lightspeedhq.com.
- Pricing (from restaurant pricing page): $30/screen per month, all plans.
- Hardware article: KDS 2.0 hardware (23587944430747).

### Using the Kitchen Display System 2.0
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0
- Tickets show: collection code, server name, order type (dine-in/delivery/pickup), guest count. Full vs Condensed view.
- Statuses w/ colors: New (gray) → Preparing (blue) → Ready to collect (green) → Completed (archived); On hold (brown); Canceled (red).
- Advance status: double-tap above timestamps; tap-hold to pick next status; bump individual items. On hold/Canceled via long-press.
- POS status mirror (5 statuses shown on POS): Fired [ts], Sent [ts], Preparing, Ready to collect, Completed.
- If third-party online ordering integrated: "Ready to collect" notification sent to them on KDS status update.
- FIFO layout: tickets sorted by received timestamp, earliest left → later right.
- Coursing: each course = individual ticket (or combine into one ticket via Settings) with course number + color bands. Courses beyond first NOT auto-fired; fired from POS.
- Alerts: bell ding on new ticket. Wait Times: delayed tickets pulse orange, late tickets pulse red (configurable). Modified orders blink until confirmed.
- Item routing (All Settings > Routing): add/remove items sent to this KDS station; filter by name / accounting group / menu category.
- Undo (↺) for 5s after item/order completion. Items list grouped by status w/ bulk-move icons (bell → Ready, triangle → Ready from hold, checkmark → Completed).
- Notes blue; allergens red. Modifiers/production instructions below item. Seat info per course when enabled.
- KDS statistics report: Reports > All reports > KDS statistics (34562620309531).

### Managing production centers
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804658689-Managing-production-centers
- 3 essential printing components: production centers, device settings, printing profiles.
- Two types: Printing locations (physical printers, receipts/order tickets) vs Digital production centers (KDS screens / virtual).
- Printing location settings: Name (e.g. Grill/Bar), Printing profile (required), Order profiles (route orders; all enabled default), Ticket types (Order/Course/Transfer ticket).
- Printed ticket settings: header spacing 0-10 lines, font size S/M/L, sort by course, print SKU, single item per ticket, wider lines, open cash drawer on print, print delivery info.
- Digital production center: Device for connection (Lightspeed KDS, QSR KDS, or QSR KDS + DineTime), Name, Destination IP (for third-party KDS).
- Route orders to specific printer based on order profiles.
- Related: printing profile (1260804607010), order profiles, understanding the printing process (1260804732369).

Auto-print statuses (from KDS product search): order tickets auto-print on status change — New, Preparing, Ready to collect, On hold, Completed (each toggle-able).

### Product marketing framing (KDS)
Sources: https://www.lightspeedhq.com/pos/restaurant/kitchen-display-system/ ; .co.uk equivalent
- One KDS or many named screens (Grill, Cold Service, Bar); route items per station.

---

## AREA 3 — ONLINE ORDERING / SELF-ORDER / QR / ORDER ANYWHERE / DELIVERY

### Online ordering (K-Series)
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4686224687259-Online-ordering
- Options: Order Anywhere (native), third-party delivery integrations (Deliverect, Uber Eats), or manual entry.
- Requires order profiles with Takeaway mode for Pickup and Delivery (unique profile per method).
- Payment difference tolerance (default $0.02); Online orders report in Back Office; can pause orders for integrated systems.
- Related: Order Anywhere (1260803517810), Deliverect (25208938481691), Uber Eats (25724049883675), Order Management screen (360050328594), Online orders report (38418918961819).

### Order Anywhere (product + help)
Sources:
- https://www.lightspeedhq.com/pos/restaurant/order-anywhere/
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260803546769-Creating-Order-Anywhere-service-profiles
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260803553189-Placing-orders-using-Order-Anywhere
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/34339315446171-What-s-new-Self-delivery-for-Order-Anywhere
- Mobile-friendly white-label online ordering, integrates directly with POS. PAID ADD-ON.
- Unified tickets for in-house + online orders in one system. Syncs sales + inventory across all dining types.
- QR code ordering: unique QR per menu/table; contactless in-person order + pay from phone, no app download.
- Service types: In-house dine-in (digital menu + QR), Takeout (ASAP or scheduled pickup), Delivery.
- Delivery options:
  - Self-managed delivery (new feature): own fleet; custom delivery zones, min basket value, adjustable delivery fees, same-day + scheduled.
  - On-demand via Uber Direct (white-label): pay only delivery fee, 0% commission / no marketplace fees; distance+speed pricing; toggle self vs on-demand.
  - Uber Direct (own channels) vs Uber Eats (Uber's marketplace/discovery app) — distinct.
- Menu: professional digital layout, combo menus, highlight bestsellers, per-item availability + prep times, customer reviews.
- Pay-at-table: contactless payments from table; real-time txn + order updates to POS.

---

## AREA 4 — LOYALTY / GIFT CARDS / MARKETING / PROMOTIONS

### About Loyalty cards (INCLUDED with K-Series)
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4404649891099-About-Loyalty-cards
- Loyalty cards module INCLUDED with Lightspeed Restaurant K Series (not add-on). Must contact Support to request a batch of card types.
- Card types (all redeemable at POS):
  - VIP cards: auto-apply a discount to order when scanned. (4404635101467)
  - Gift cards: voucher loaded w/ monetary amount, redeem at POS. (4404650051867)
  - Punch cards: free item after buying set qty of a product/service. (4404650168091)
  - ID cards: create customer account, bill guest's consumption to account. (4404650374299)

### Gift cards 2.0
Sources:
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/6339161622427-About-gift-cards-2-0
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/4404650051867-About-gift-cards
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/43733543286683-Understanding-Gift-cards-statistics
- Generate online gift card at POS, email to customer; marketing/acquisition + loyalty; gift card statistics report.

### Marketing / loyalty integration
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/24012819812891-Setting-up-the-Marsello-integration
- Marsello = loyalty + marketing (online + in-store): points for purchases, personalized incentives, VIP tiers, exclusive perks.
- Advanced Insights includes Guestbook (customer profiles/CRM), Campaigns (event/promo tracking) — see Area 7.

### Retail context (X-Series) for packaging comparison
Source: https://www.lightspeedhq.com/pos/retail/loyalty/
- Built-in loyalty on Core/Plus retail plans; tiered loyalty; omnichannel earn/redeem in-store + online.
- Lightspeed Advanced Marketing add-on: segmentation, automated email campaigns, SMS marketing, birthday rewards, abandoned-cart, personalized promos.

---

## AREA 7 — BACK OFFICE / REPORTING / ADVANCED INSIGHTS / ANALYTICS

### About Advanced Insights
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/7625714308763-About-Advanced-Insights
- Reporting system; completed-sales data → segment reports. Navigate Analytics > Advanced Insights. Perms: [BO-WRITE], [BO-REPORT].
- Modules: Sales reports (busiest days, peak hours, repeat-customer timing), Servers reports (avg sales per check/cover, compare to average), Menu reports (item popularity/ranking), Logbook (staff daily-activity comms), Guestbook (customer profiles/CRM, behavioral search, marketing lists), Campaigns (event/promo tracking), Lightspeed Live (iOS/Android real-time monitoring app).
- Availability: North America, Australia, New Zealand. Europe uses Advanced Insights 2.0 (18812821372443).

### Benchmarks and Trends
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/28846463754523-Understanding-Benchmarks-and-Trends
- Benchmarking against anonymized peer/competitor data (per product marketing: "benchmarking against competitors").

### Core Back Office reporting
Sources:
- Introduction to the Back Office: https://k-series-support.lightspeedhq.com/hc/en-us/articles/360054950934
- About Back Office navigation changes: https://k-series-support.lightspeedhq.com/hc/en-us/articles/36985562334363
- Understanding the Dashboard page: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403208456603
- Sales Reports: https://k-series-support.lightspeedhq.com/hc/en-us/articles/18234292249883
- Menu Reports: https://k-series-support.lightspeedhq.com/hc/en-us/articles/18235324645531
- Lightspeed Live app: https://k-series-support.lightspeedhq.com/hc/en-us/articles/7363519285275
- Labor report: shift data by staff (tips, sales, discounts, hours, service charges, voids).

---

## AREA 11 — STAFF / LABOR / PERMISSIONS / TIME TRACKING

### About POS users + user groups
Sources:
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804647189-About-POS-users
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804594570-About-users-and-user-groups
- https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050309174-Clocking-in-and-out
- 4 default user groups (or configure manually):
  - Manager: access all POS settings.
  - Floor staff: only manager-configured settings.
  - Trainee: practice transactions only (no effect on sales/reports).
  - Shift tracker: clock in/out only (track hours).
- Individual OR group-level permissions (recommend bulk at group level).
- Clock in/out gating: some users must clock in before full POS access (manager/server); kitchen staff can only clock in/out; users can't process orders until clocked in.
- Adding user shifts (1260804594790), Managing Back Office users (1260804647149).
- Reports: Staff report, Labor report, Staff turnover / Global turnover / Monthly turnover.
- Payroll & Workforce Management is a listed add-on (see packaging).

---

## AREA 6 & 13 — HARDWARE / DEVICE MGMT + CUSTOMER-FACING DISPLAY / KIOSK

### Managing POS devices
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804658149-Managing-POS-devices
- Back Office > POS > Devices: table of devices, edit, remote reload (multi-select), disable, activity audit.
- Basic settings: Device name (8-char, unique), Default floor plan, Default POS configuration, Payment terminal pairing, Customer display pairing.
- Printing: Receipt printer, Note printer (kitchen tickets), "Do not print from floor POS devices" toggle.
- Account Sharing roles (multi-device sync): Active (1 recommended/location), Forced (only active exchanging BO data), Passive (secondary; switching sole active→passive loses open orders), Preferred (primary active w/ failover).
- Take Out Options: first/last collection code, reset daily.
- Transaction Tags for device-filtered sales reporting.
- Advanced details: Device ID, model, IP, app version/timestamps, SSID/BSSID, OS version, time zone (must match BO), device time.
- Reload syncs app w/ BO (menu/settings/user changes). Multiple reload methods (notification bell, status menu, control center) + remote from BO. Icon orange=updates, blue=current.
- Reload fixes: printing, connectivity, POS content, config, shift sync issues.
- Disable: app stops until reconnected; open orders closed; other devices auto-reload on reconnect.
- iOS-based (iPad) POS. Related: About POS devices (1260804658089), POS configuration (1260804658189), Connection codes (1260804658229), Cash drawer (1260804658289).

### Lightspeed Order Display Screen (customer-facing)
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4413369711771-About-Lightspeed-Order-Display-Screen
- External customer-facing display: order numbers + status (in progress / ready for pickup); real-time sync from POS or KDS.
- Hardware: Apple TV 4th gen+, HDMI to TV/monitor. QSR pickup use case. Premium add-on.
- Setup (4413369762971), Using (4413390373403).

### Customer-facing display (payment/cart, on POS device)
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/14022943949211 (paired via device settings)
- Product line lists "Customer Facing Display" as a module.
- Self-order kiosk: not surfaced as a dedicated K-Series help article in searches (marketing lists contactless/QR self-order via Order Anywhere as the self-service path; retail QSR kiosk exists on retail line).

---

## AREA 12 — OFFLINE MODE / RELIABILITY

Sources:
- Network optimization checklist: https://k-series-support.lightspeedhq.com/hc/en-us/articles/27536544139547
- Networking for Lightspeed Restaurant: https://k-series-support.lightspeedhq.com/hc/en-us/articles/16154347413275
- About WEB-SRM (Quebec): https://k-series-support.lightspeedhq.com/hc/en-us/articles/19678535506331
- Product page: offline functionality with automatic cloud sync.
- WEB-SRM works offline out of box; transactions stored locally on POS when no internet.
- Payment terminal "Cloud mode": terminal keeps processing even with unstable Wi-Fi between POS and terminal.
- Recommendations: dedicated router for POS/printers/terminals; Ethernet to receipt+kitchen printers; 4G-capable terminals for standalone payments during ISP outage.
- iPad app runs local; syncs to Back Office; reload required to pull BO changes.

---

## AREA 9 — MULTI-LOCATION / FRANCHISE / ENTERPRISE

Sources:
- Navigating business locations: https://k-series-support.lightspeedhq.com/hc/en-us/articles/23973504428059
- Sharing menus with business locations: https://k-series-support.lightspeedhq.com/hc/en-us/articles/4755505361947
- About menus and items: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804647349
- Managing Back Office users: https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804647149
- Business locations = multiple physical restaurants sharing concept/menu/settings. Basic menu structure + shared/global settings copied from first location to each new one.
- Menu sharing: share menus across locations; shared menus editable only from origin location.
- Item scoping: Local (one location), Shared (all locations, same name, per-site settings), Global (all locations, changes propagate to all).
- BO user access controllable per location.
- Multi-location management is Essential-tier+ (see packaging). Premium adds multiple revenue centers (hotels) + raw API. Enterprise = custom.

---

## AREA 10 — INTEGRATIONS / MARKETPLACE / API / AUTOMATIONS

Sources:
- Partner integrations section: https://k-series-support.lightspeedhq.com/hc/en-us/sections/8352179759131-Partner-integrations
- Add-ons and integrations category: https://k-series-support.lightspeedhq.com/hc/en-us/categories/8348643415067
- Integrations marketing: https://www.lightspeedhq.com/pos/restaurant/integrations/
- K-Series REST API docs: https://api-docs.lsk.lightspeed.app/ (sandbox: https://api-docs.sbx.lsk.lightspeed.app/)
- REST API, OAuth 2.0 authorization-code auth; endpoints incl. injecting online orders. Raw API access = Premium tier; partners join Lightspeed partner programme.
- Notable integrations: Deliverect, Uber Eats, OpenTable (4415755433627), Resy, Apicbase (inventory/F&B), Marsello (loyalty), MarketMan (inventory), Xero/accounting (Codat connector), Fresh KDS, Connecteam (staff), hotel PMS.
- Add integrations via Lightspeed marketplace; each has its own setup (login, grant permissions, configure).
- Accounting add-on (automated bookkeeping) listed in product line.

---

## AREA 14 — PRODUCT-LINE PACKAGING & PRICING

### Restaurant product page
Source: https://www.lightspeedhq.com/pos/restaurant/
- Plans: Starter (single location, simple), Essential (multi-location/omnichannel), Premium (more features), Enterprise (custom).
- Core included: order mgmt (online/tableside/QR), floor plans, menu customization, ingredient-level inventory, real-time reporting/analytics, multi-location, hotel PMS integration, offline w/ cloud sync.
- Add-ons/modules: Payments, Advanced Insights (benchmarking vs competitors), Order Anywhere, Inventory Management, Accounting, Delivery, KDS, Payroll & Workforce Management, Tableside POS (handhelds), Capital, Reservations, Customer Facing Display, Tasks, Tempo, Lightspeed Pulse (mobile app), Lightspeed AI.
- Positioning: 200+ Michelin-starred restaurants; ~146K locations; 20 yrs; bars/breweries/cafes/fine dining/full service/hotels/QSR. Claim: "40% faster on average than other leading restaurant POS in North America."

### Restaurant pricing page (concrete numbers)
Source: https://www.lightspeedhq.com/pos/restaurant/pricing/
- Starter: $69 USD/mo. Includes customizable POS, Menu manager, Floor plans, Advanced Insights, Lightspeed AI, Lightspeed Tempo, Integrated payments (Default), Take out + delivery, Single-view reconciliation, Pre-auth bar mode, Online ordering, Contactless ordering; Lightspeed Reservations + Reservations integrations as add-ons.
- Essential: $189 USD/mo. Adds Integrated payments (Custom), Lightspeed Tasks (included), Multi-location management, Advanced inventory management.
- Premium: $399 USD/mo. All Essential + multiple revenue center support (hotels) + Raw API access.
- Enterprise: custom quote — personalized software+hardware package, unlimited launch/consultation, dedicated support + CSM.
- Add-ons: KDS $30/screen/mo (all plans). Pro Services on Essential + Premium only.
- No annual pricing, processing rates, or free-trial info shown on page.

### Lightspeed Capital
Source: https://k-series-support.lightspeedhq.com/hc/en-us/articles/13262680200859
- Merchant cash advance (NOT a loan). Choose from multiple offer amounts, each w/ advance + flat fee.
- Funds in 1-2 business days after approval. One active advance per location; renewal/additional funding after % repaid.
- Repayment via holdback rate: % of daily credit-card transactions (pay more when busy, less when slow). Voluntary manual payments via Capital section.
- No interest, no set schedule, no contract period — only financing amount + agreed flat fee (paid within regular payments, not upfront).
- Support: capital@lightspeedhq.com.

### Restaurant series family (context)
- K-Series = flagship cloud restaurant POS (iPad). L-Series (older resto), U/O/G-Series also exist. Retail = X-Series (flagship), plus E/R/C/S-Series; Golf line.

---

## GAPS / NOT RECOVERED
- Exact Lightspeed Payments processing rates / interchange markup: NOT published in help center (deliberately opaque; quoted per merchant).
- Annual pricing + free trial: not on public pricing page.
- Dedicated K-Series self-order KIOSK help article: not found; self-order path is Order Anywhere QR/contactless (kiosk more prominent on Retail QSR line).
- KDS 1.0 detailed workflow (legacy/iOS) not deep-fetched; 2.0 covered.
- Modifiers/modifier-groups detailed mechanics: only the About modifiers link (1260804656349) captured, not deep-fetched.
