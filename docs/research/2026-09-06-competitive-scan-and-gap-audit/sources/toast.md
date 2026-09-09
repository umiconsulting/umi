# Toast Ecosystem — Raw Research Notes

Sources: support.toasttab.com (help center), doc.toasttab.com (Platform Guide — very detailed), pos.toasttab.com (product/marketing pages — MOSTLY 403 BOT-BLOCKED, recovered via search snippets).

NOTE: pos.toasttab.com returns HTTP 403 to WebFetch. Marketing/product/pricing content recovered via WebSearch snippets and third-party reviews.

---

## 1. POS / Register / Menus

### Get Started With Menus (support.toasttab.com/en/article/Get-Started-With-Menus)
Menu hierarchy = 5 levels: Menus → Menu groups → Menu items → Modifier groups → Modifiers.
Menus categorize offerings (Lunch, Dinner, Happy Hour); groups contain items + subgroups.
Editing tools in Toast Web:
- Menu Manager — create menus/groups/items, advanced features.
- Advanced Properties — bulk view/edit across menu elements; visibility, tax rates, prep stations.
- Items Database — archive/restore/version menus.
- Bulk Import Tool — spreadsheet upload to create/update in bulk (requires specific service packages).
POS Quick Edit: tap-and-hold menu buttons to edit item/modifier on the terminal; structural changes require Toast Web.
Menu changes managed in "Toast Web" = back-end platform (central config location).

### KDS overview (doc.toasttab.com/doc/platformguide/platformKDSOverview.html)
(see area 2)

---

## 2. KDS / Kitchen Display (doc.toasttab.com/doc/platformguide/platformKDSOverview.html + support)
- Replaces printed tickets with digital screens; real-time sync POS->kitchen; visual+audio alerts (new tickets, ready-to-fulfill, changes, voids); color-coded ticket ages; flash animation on new/modified tickets.
- Device roles: Expediter KDS (intermediary FOH/BOH, confirms order ready) + Prep Station KDS (items for that station). Configs: both / expediter-only / prep-only.
- Ticket lifecycle: fired items route -> marked complete (green check) -> expediter confirms ready -> FOH notified -> ticket disappears when all complete.
- NEW KDS view features: Appearance pane (Dynamic vs Grid layout, text size, light/dark mode, rows/cols); Preview tickets ("Fire on Next" — item shows before next item entered, shaded); PAID/NOT PAID indicators; Assembly Lines (sequence of prep stations an item follows); Load Balancing (distribute tickets across duplicate station devices, no dupes); Partial Fulfillment (yellow dot = in progress at >=1 station -> green when all done); Food Runner Fulfillment (single vs double check); Recipe viewing on KDS (recipe icon -> prep instructions); All Day View; production item counts (max 30 in new view; grid 5x6).
- New view requires LOCAL data sync; not recommended for ToastGo1/2; needs Local Hub for offline.
- Config path: Kitchen > Printers, tickets, & KDS devices > Kitchen and ticket setup. Configurables: preview tickets, fulfillment methods, item send destinations, two-level expediter.
- Prep stations (support Prep-Stations-Basics): areas where staff prepare/plate/package; created in Toast Web; assign printers + KDS; assign to menus/groups/items/modifiers to route. "Send to" setting: Expediter only (no prep display) / Prep station and expediter / Prep station only.
- KDS product features (marketing): All Day View, production counts, multi-language, prep station routing, kitchen productivity reporting, SMS + in-app alerts, automated firing by prep time, color-coded modifiers.
- Related platform-guide docs: routing overview, prep station assignment, assembly line, load balancing, ticket config + text messaging, item routing rules, avg fulfillment timers, start queue, workflow examples (single/dual expediter, courses), Toast IQ kitchen.

## 3. Online Ordering / Order & Pay / Delivery

### Online Ordering (support Getting-Started-Online-Ordering, updated Aug 2026)
- Branded ordering page; commission-free pickup/curbside/delivery. "Keep 100% of revenue, no per-order commission." Orders flow into Toast POS same as in-house.
- Menu search 1,500+ items; mobile bottom-sheet category navigator; real-time order status + confirmation emails.
- 10-step setup: menu visibility (Toast Online Ordering channel), approval mode (manual / send direct to kitchen / rules by cash/credit/delivery/total thresholds), auto-firing device (Ethernet), dining options (takeout/curbside/delivery), server + revenue center assignment, special requests + payment methods (cash/credit/both, tip toggle), delivery setup, OO hours (independent of restaurant hours + holiday overrides), branding (logo 230x230, banner 1400x788, custom toasttab.com/[link] URL), test order.
- Delivery: personal drivers OR Toast Delivery Services (not both at once). TDS unavailable Canada/Ireland/UK.
- Third-party: DoorDash, Uber Eats, Grubhub integrations (tested separately). Toast Delivery Services = restaurant offers delivery, Toast supplies drivers via partners, saves on fees.

### Mobile Order & Pay (support Setting-Up-Toast-Mobile-Order-and-Pay, updated Jul 2026)
- Contactless QR at tables; unique QR per table -> menu -> order+modifiers -> pay on phone. Apple Pay checkout <10s.
- Models: Tabs (multiple rounds, pay at end — full service/bars/breweries) vs Pay-as-you-go (checkout each order — QSR/cafes).
- Group Ordering: multiple guests join one tab from own devices, one kitchen ticket.
- Pre-Authorization: preauth card before opening tab (not Canada/Ireland/UK). Claims ~12% higher avg ticket.
- Menu visibility by service area / time of day / item level. Tip settings: virtual server pooling, server-to-table assignment, auto service charges.
- 8-step setup: subscribe (Toast Shop) -> setup wizard -> QR signs -> auto-firing device -> menu visibility -> guest experience -> tip allocation -> train/go-live. Requires dining option w/ "Dine In" behavior + service area w/ >=1 table.

## 4. Loyalty / Marketing / Gift Cards

### Loyalty (support Toast-Loyalty-FAQ, updated Aug 2026)
- Points on post-discount, pre-tax amount; OR visit-based accrual. Best-of promo (no stacking). Gift card purchases don't earn.
- Channels: in-store POS, Online Ordering, Kiosk. Cards link to guest accounts.
- Rewards: fixed tier cash rewards OR mixed cash+free-item (up to 4 tiers). Birthday rewards (auto discount 24h after birthday added).
- Enroll: email OR phone (no physical card needed); via digital receipt link, OO account, kiosk, POS. Gift cards double as loyalty cards (incl zero-balance eGift). One email/phone per account; multiple credit cards can link.
- Redeem: in-store counter (server or guest-facing display), OO, kiosk. Multi-reward in beta (Test Kitchen). Zebra hands-free scanner via rep.
- Management: Toast Web > Marketing > Loyalty > Settings. Disable all / per-location. Loyalty Misuse Report + alerts. Guest unsubscribe: STOP SMS / Local by Toast app / contact restaurant.
- Local by Toast app: guests find loyalty programs + view progress.

### Email Marketing (support Toast-Marketing-FAQ, updated Aug 2026)
- Fully integrated; segmentation + automation. In Marketing Essential Suite (Toast Shop). Auto-enabled across all locations.
- Guest list sources: Online Ordering, Loyalty, gift card purchases, digital receipts, Toast Local app, Toast Tables. Initial import = guests who gave email + visited in last 6 months.
- Automated segments: Miss You (30+ days inactive), Welcome (new, past 24h), Big Spender (higher checks), Frequent Guest (every 5th visit). 28-day frequency cap on automated emails.
- Can't recall/edit sent campaign. Promo codes multi-use or single-use per recipient. Media PNG/JPG/GIF (<200KB rec, 2MB max).
- Sender name/address/logo/reply-to editable; sender email fixed; DKIM NOT supported currently. Permission 6.4 Publishing; 4.7 Marketing Info for group-wide.
- Attribution: 14-day window; dashboard shows delivered/opened/attributed sales. Hospitality benchmarks: ~21.7% open, ~2.1% CTR.
- SMS Marketing: in Marketing Suite (email + SMS + loyalty + gift cards); automated or one-time; AI writing assistant suggests text. (Toast survey: 57% guests want restaurant texts.)
- Marketing Essentials bundle ~$185/mo (loyalty + gift cards + email/SMS) per third-party review.

### Gift Cards (pos.toasttab.com/products/gift-card — via search)
- Physical + eGift cards sold/managed through Toast. Buy/send via email or SMS with message; redeem/check balance online or in-store. Cards can hold both cash balance AND loyalty points (stored separately).

## 5. Payments / Tipping / Handheld
- Toast is the payment processor (integrated). Take Payments on POS (Taking-Payments); Manage Payments (New-POS-Managing-Payments): tip selection screen shows tip + total, highest suggestion prioritized.
- Tip Options (Setting-Up-Tip-Options) apply across: POS, Online Ordering, Toast Go handheld, Flex terminal, S1 Handheld, Kiosk.
- Toast Go 2: fires orders + accepts payments anywhere; Apple/Samsung/Google Pay (NFC), chip (dip), contactless (tap), mag stripe (swipe), gift cards (key-in/scan/swipe). EMV enabled via Device Setup. US only.
- Digital receipts configurable (Basic-Digital-Receipt-Configuration).

## 6. Hardware / Devices (support What-Kind-of-Hardware-Do-I-Have)
- Terminals: Toast Flex 3 (compact), Toast Flex 14"; Elo terminals (10/15/22", V2/3 + V4).
- Kiosk: Elo terminals in Kiosk mode (10/15/22").
- Guest-facing displays: Toast Guest Display w/ Flex 3 (dual-screen); Toast Flex for Guest (Direct Attach + Wedge Mount, single green USB-C); Elo Guest-Facing Display (10", discontinued but supported).
- KDS: Toast Flex for Kitchen (14" only, stand/wall); Elo Kitchen Display (multi-size).
- Handhelds: Toast Go 1 (mag+EMV, discontinued/supported), Toast Go 2 (BBPOS reader dip/swipe/tap, dock charger), Toast Go 3 (latest, magnetic port charging, Wi-Fi, can print to Printing Hub).
- Printers: Toast-branded or Epson (Toast-Compatible-Printers). Toast Printing Hub: networked print target for Wi-Fi handhelds (Go 3).
- Card readers: Toast Tap (contactless NFC); regional AMS1/V400m/p400/S1 handheld/e285 (UK/IE/CA).
- Accessories: Zebra scanners (DS2208/DS9308/DS2278), Honeywell scanners; Brecknell 6710U scale (only supported scale).
- Network: Toast Hub (ethernet switch), Ubiquiti APs, Meraki routers (Z3/MX64), Toast Router.
- Order hardware via Toast Shop.

## 7. Back Office / Reporting (support Getting-Started-with-Analytics-and-Reports)
- Built-in reporting suite, all owners/managers, real-time. 40+ reports across 9 categories: Sales, Labor, Menus, Payments, Cash & Loss Management, Accounting, Kitchen Operations (needs KDS module), Marketing, Other (reservations/waitlist/location comparison).
- Access: Toast Web > Reports (left nav). Weekly Overview dashboard. Key metrics: Net Sales, Labor Cost, Guest Count, Net Sales top items.
- Sales Summary: Reports > Sales > Sales summary (or Quick Actions). Detailed sales by date range.
- Filters: time frame (day/week/month/custom), hour range, employee, multi-location, comparative (date ranges + location comparison). Show/hide columns.
- Export: email .xls/.csv, direct download, print-to-PDF (Chrome). Limitations: YoY may timeout multi-location; some reports lack all formats.

## 8. Inventory / xtraCHEF (support xtraCHEF-by-Toast, updated Jul 2026)
- xtraCHEF = AP-automation + food-cost platform. Invoice automation (AI line-item capture, approvals, reconciliation), recipe costing (ingredient cost per dish, yields), inventory (perpetual, real-time depletion via POS sales, counts, waste, variance), vendor + ordering management (orders, terms, history), analytics (spend by GL/category/vendor, food cost).
- Sections: Onboarding, Getting Started, Account Config (Setup/Users/Integrations/Accounting), Invoice Automation, Products & Item Library, Recipe Costing & Inventory, Analytics & Reporting, Budgets/Vendors/Ordering, Mobile App.
- Integrations: Toast Payroll, QuickBooks Desktop/Online, Sage Intacct, EDI vendors, Toast Web sync.

## 9. Multi-location / Enterprise (support Getting-Started-Master-Menu-Management, updated Dec 2025; doc.toasttab platform guide)
- Multilocation Management (MLM) / Master Menu Management: shared config across locations -> maintain ONE config vs many. ONLY in Restaurant Management Pro + Enterprise suites.
- Menu Manager + Publishing Center: schedule price/item changes; push to location groups (e.g. "Northeast Franchises").
- Location-specific pricing: gatekeeper enables per-item/group varying prices per location.
- Location group filtering across sales + product mix reports (location or group level).
- Serves franchises, franchise groups, individual franchisees, hundreds of multi-unit brands. Enterprise "Restaurant Management Suite" launched for enterprise brands.

## 10. Integrations / Partner Marketplace / API (doc.toasttab.com devguide apiOverview + partner overview)
- Toast Partner Integrations = marketplace; add via Toast Web (Account Admin > Manage Integrations permission). Public partner directory at pos.toasttab.com/partners/directory.
- REST APIs, 18+ domains: Analytics(era), Cash Mgmt, Configuration, Credit Cards(ccpartner), Device Details, Kitchen, Labor (full CRUD), Menus (GET), Orders (GET/POST/PATCH), Partners, Restaurants, Stock (GET/POST/PUT), Gift Cards/Loyalty/Tender (outbound — Toast POSTs to partner HTTPS endpoints), Order Mgmt Config, Packaging Config, Restaurant Availability.
- Integration types: Partner / Custom / Standard API / Analytics API. Scoped permissions (least privilege). Read=GET; Write=POST/PUT/PATCH/DELETE; Outbound APIs (Toast calls partner endpoints for gift/loyalty/tender).
- Webhooks: real-time notify when integration added/removed. Partner API accounts span multiple restaurants across mgmt groups (for service providers).
- 8-stage partner process: application -> discovery -> partner agreement -> dev kickoff -> certification -> alpha -> beta -> GA. Sandbox + credentials. Developer portal, API reference (openapi), auth guide, rate limiting, checklists.

## 11. Team / Payroll / Scheduling (support Scheduling-by-Sling-in-Toast-Web, updated Aug 2026)
- Toast Payroll & Team Management: payroll processing, tax compliance, employee payment options, tied to time tracking + tips. Product page pos.toasttab.com/products/payroll.
- Scheduling built on Sling. Create/assign shifts, open shifts (job-based pickup), recurring shifts (up to 1yr), shift notes, publish now/later, copy shifts day/week, conflict/overlap detection.
- Shift swaps + pickups (needs approval / auto-approve). Time off requests via MyToast app (NOTE: scheduling time off is UNPAID, no payroll integration).
- Pro tier adds: Team Availability tab, Revenue Forecasting (labor cost vs 23%-of-projected-sales target, On Target/At Risk/Over/Under badges), projected sales models (120+ days advanced, tiered down to <30 days = none), weather forecast overlay.
- Section by Job/Location; sort by Employee/Start time; filters; publish all/selected. MyToast app = employee self-service.
- Toast IQ can manage schedules via NL ("who's working Friday", "assign open shift", "does schedule align with forecast").
- Scheduling is largely STANDALONE from payroll (labor cost pulls wages but doesn't process payroll).
- Labor Reports: hours, labor cost, tips, productivity.

## 12. Offline Mode (doc.toasttab.com platform guide adminOfflineModeOverview + support)
- Auto-detects loss of local network / internet / Toast cloud; after ~40s yellow offline banner (cause + available actions). Auto-returns online on reconnect.
- Per-device: one device offline while others online. Two methods: (1) Offline mode — order data stored locally on each device; (2) Offline mode with local sync — a Local Hub device relays orders across LAN devices even w/o internet.
- Works offline: keep taking orders + cash + card payments; tickets print / send to KDS; background card processing (accept card, authorize on reconnect). Printers work if LAN+internet up but cloud down.
- Does NOT work offline: gift cards, loyalty redemptions, Tender API payments, text-to-pay, customer credits, comp cards, house accounts.
- Recovery: LAN (cables/router restart), ISP (call provider), Toast outage (status.toasttab.com).

## 13. Kiosk / Guest-facing display (support Kiosk-Mode-Overview)
- Self-order kiosk = Toast terminal in Kiosk Mode; guest browses/customizes/pays. Reduces wait + labor. Lock Task mode default on kiosk-sold devices.
- Hardware: Flex terminal, Elo terminal, 22" Elo V4, 14" Flex (kiosk variant).
- Payments: credit/debit direct, gift cards, cash (prints receipt, finish at cashier), keyed CC.
- Loyalty at kiosk: sign-up + redemption (Marketing > Loyalty settings > Channels). Third-party loyalty supported.
- Guest-facing displays (hardware): Toast Guest Display w/ Flex 3, Toast Flex for Guest (Direct Attach/Wedge), Elo GFD (discontinued/supported). Used for order display + loyalty redemption + tipping.

## 14. Toast Tables / Retail / Capital

### Toast Tables (support Getting-Started-Toast-Waitlist, updated Aug 2026)
- Toast-built waitlist + reservations + table management. Host app on iPad/Android tablet (NOT on Toast Flex/Go devices); syncs to Toast Web for config + reporting.
- Tiers: Toast Tables (walk-in focus, full waitlist+table tools, up to 25 reservations/mo) vs Toast Tables Plus (unlimited reservations + Experiences add-on).
- Features: seat walk-ins, online+in-person waitlist w/ 2-way SMS, reservations (online + host stand), wait-time estimator (Manual Multiplier or Smart Algorithm), flow control / capacity caps, drag-drop floor plan editor w/ real-time table status, guest profiles, email confirmations.
- Reserve with Google (Reserve a Table + Join Waitlist buttons on Google Search/Maps; deposit collection since Jan 2025). Website embed via copied URL/button.
- Floor plan (POS side): auto-updated table status; item icons show coursing status (yellow=sent not fulfilled, blue=fulfilled by kitchen).

### Toast Retail (pos.toasttab.com/products/retail-inventory-management — via search)
- Retail mode: barcode/SKU items, retail inventory. Ordering of POS buttons for retail. Inventory Management in Toast Now (beta): count stock from Toast Now mobile app, edit catalogs, process invoices. Toast IQ retail insights: restocking, pricing, seasonal, SKU management.

### Toast Capital (pos.toasttab.com/products/capital — via search)
- Loans $1,000–$300,000. Repay as fixed % of daily card sales (pay more on high days, less on low). No early-repayment fees. Also "Toast Finance" cash-flow/capital funding product.

## 15. Packaging / Pricing (third-party reviews — pos.toasttab.com pricing pages 403)
- Software tiers: Starter Kit ($0/mo, higher processing ~3.09%+$0.15), Point of Sale ($69/mo/location, ~2.49%+$0.15 in-person), Build Your Own (custom, ~$165+/mo).
- Suites (enterprise): Restaurant Management Pro + Enterprise (unlock MLM/master menu). "Toast Suites Overview" article.
- Marketing Essentials bundle ~$185/mo (loyalty + gift cards + email/SMS). Toast IQ Grow $499/mo (AI agent + human Marketing Success Manager).
- Hardware sold separately via Toast Shop; Toast is the integrated payment processor (revenue model = SaaS + payment processing spread + hardware + capital).

## BONUS: Toast IQ (AI) — cross-cutting (support Toast-IQ-Overview + pos.toasttab.com/products/toast-iq)
- Toast IQ AI Assistant: conversational AI in Toast Web (top-left nav) + Toast Now app (bottom). Included with POS at no extra cost.
- Ask business-data questions in plain language (sales, labor, menu perf, guest trends, discounts, voids, upsells, modifier-level reporting). "For You" proactive insight feed.
- Takes ACTIONS after confirmation, scoped to user's Toast Web permissions: menu mgmt (prep stations, sort order, prep times, course assignments), marketing campaign drafting (email US/UK/IE/CA, SMS US), Tips Manager, FOH config (Table Service/Quick Order), kitchen settings, schedule edits.
- Needs 4.1 Sales Reports or 4.3 Labor Reports permission. Data sent to dedicated enterprise LLM instance; NOT used for provider training.
- Toast IQ Grow ($499/mo): agentic AI marketing + dedicated human Marketing Success Manager. Toast IQ = broader "Intelligence Ecosystem" (smart features -> smart assistant, expanded Oct 2025).

## BONUS: Coursing (support Course-Firing-Options)
- Courses pace a meal: appetizers first, hold entrees, fire when ready.
- Firing modes: manual (server-fired), automated (timed), expediter-fired. Send/Hold/Stay per-course behavior (server fires vs Toast Web rules).
- Config: send whole ticket w/ chosen courses fired vs send only fired course. Courses Required/Optional/Off per Quick Order + Table Service mode. KDS shows ticket time + fire time.
