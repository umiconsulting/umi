# Odoo — Ecosystem Research Notes (raw)

Competitive analysis for Umi (restaurant/café POS). Odoo = all-in-one open-source ERP; POS/Restaurant is one app in a large modular suite.

Docs root: https://www.odoo.com/documentation/latest/applications/sales/point_of_sale.html (latest → Odoo 19.0)

## POS doc index / structure
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale.html

- POS is web-browser-based, runs on any device, keeps working during temporary network outages (offline-capable).
- Serves retail + restaurant; includes self-ordering (kiosk / mobile).
- Feature categories: Workflow, Products, Hardware & network, Shop features, Restaurant features, Extra features, Payment methods, Reporting.
- POS subtopic tree:
  - Workflow: Workflow, Receipts, Invoices
  - Products: Products (categories, combos, serial/lot display)
  - Hardware & network: Local Network Access, IoT system connection, Receipt printers, Electronic shelf labels, Customer display, Scale, Self-signed cert for ePOS printers
  - Shop features: quotations, "ship later" orders, barcodes
  - Restaurant features: floors, tables, tips, online delivery; UrbanPiper
  - Extra features: Multi-employee management, Preparation display, Self-ordering, Presets, Pricing features, Loyalty
  - Payment methods: cash/card, Cash machines (Cashdro, Cashmatic, Glory), Customer account, QR code payments, Payment terminals (Adyen, DPO Pay, Ingenico, Mercado Pago, Mollie, Pine Labs, QFPay, Razorpay, SIX, Stripe, Tyro, Viva.com, Worldline)
  - Reporting

## Restaurant features
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/restaurant.html

- Enable restaurant mode: POS settings → "Is a Bar/Restaurant".
- Floors & tables: create floors w/ background image; tables have number, seats, shape, height/width/color, active flag. Real-time status (available/occupied/booked). Floor plan view or table selector.
- Order types: table-linked, "Set Tab" named orders, direct sales. Build order by tapping products, assign table, "Send to validate".
- Kitchen comms: print orders to kitchen/bar printers; preparation display real-time status; course-based ordering.
- Bill management: split bills across payment methods; individual or combined payments; itemized receipts.
- Tips: percentage or fixed; before/after payment; US tip-after-payment workflow.
- Booking/reservations: activate Booking, configure Appointment Type, max capacity per table, merge tables for large parties. (Ties into Odoo Appointments app.)
- Child docs: restaurant/urban_piper.html (delivery), extra/self_order.html, extra/preparation.html, extra/employee_login.html, extra/pricing.html

## Preparation display (kitchen display)
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/preparation.html
- Digital kitchen/station workflow; replaces paper kitchen tickets. Works in retail (pickup assembly) + restaurant (kitchen).
- Setup: Point of Sale → Orders → Preparation Display. Name (e.g. "Main Kitchen"), link to specific POS or all, category filter (route by product category; empty = all), auto-clear timer, define stages with color coding + alert timers (highlight when over time).
- Interface: top bar shows counts per stage (To prepare / Ready / Completed) + Recall/Done/Close; side panel filters by timeframe, presets (dine-in/delivery), category, zoom; order cards show table, guest count, preset, timestamps, stage color, elapsed/alert.
- Mark ready: tap items to cross off; stage transitions via card; Recall undoes current stage only.
- A default "Kitchen Display" auto-created with restaurant POS. Runs in browser on mobile/touchscreen; does NOT work via IoT box.
- Optional customer SMS/WhatsApp notifications require POS Enterprise SMS WhatsApp module.

## Self-ordering (QR / kiosk)
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/self_order.html
- Three activation types: QR Menu (browse only), QR Menu + Ordering (order + pay), Kiosk (full self-service station).
- Settings → "Mobile self-order & Kiosk" → "QR menu & Kiosk activation" dropdown.
- QR codes: Print QR Codes (PDF) or Download (zip); restaurants = one QR per table, shops = single generic code; can order physical QR stands from Odoo shop.
- Service/payment: Table service (restaurants) pay after meal or per order; Pickup zone pay per order. Pay online via provider or at cashier.
- Kiosk payment: terminal via Adyen or Stripe, or QR online; NO cash in kiosk. IoT box + touchscreen = dedicated kiosk ("Launch on" field).
- Multi-language, splash screens, background images for branding. Preview via "Preview Web interface".

## Workflow (sessions / register / cash control)
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html
- Open session: POS → Dashboard → "Open Register" on POS card → verify opening cash in Opening Control → confirm.
- Register order: tap product tiles → Qty button → % discount → assign customer (optional) → Payment → select method → validate.
- Interface: product selector, cart, numpad; header = Orders overview, employee switching, barcode scan, menu.
- Customer: create in register (Customer → Create) or backend; enables loyalty + invoicing.
- Refunds: order-based and standalone; paid orders refundable via Orders overview.
- Close session: hamburger menu → cash control verifies actual vs expected cash, configurable max acceptable difference.

## Multi-employee management / access rights
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/employee_login.html
- Enable "Log in with Employees" in PoS Interface settings. Ties into the Employees (HR) app.
- 3 access tiers: Minimal / Basic / Advanced rights (assign employee lists per tier).
  - Minimal: lock/reload, reports, order search/reprint, basic sales, assign customer, promo codes.
  - Basic: open register + cash ops, create customers, refunds, switch pricelists, manual discounts, edit price, loyalty rewards, fiscal positions.
  - Advanced: create products, backend access, close register.
- Auth: Badge ID (Employees app → Settings → generate/print barcode badge), PIN code, or pick from list. Switch employee via name in top-right or Lock icon.

## Products (POS catalog)
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/products.html
- Create via backend (POS → Products → Products, enable "Point of Sale" checkbox) or in register (hamburger → Create Product, instantly available).
- POS product categories (POS → Configuration → POS Categories) organize the register grid; product must have a category or it won't display when POS categories used.
- Product form → Point of Sale tab: To Weigh With Scale, POS Categories, Color highlight, Self-Ordering availability, Description, Optional Products (POS Optional Products add-on suggestions).
- Variants: enable in Inventory settings; Attributes & Variants tab; pick variant when adding to cart.
- Product Tags (POS → Config → Product Tags): label, customer visibility, color/image, self-order description.
- Units of Measure + "Group Products in POS" consolidates cart lines.
- Combos: create combo choices, then a combo product bundling choices (combo pricing).
- Serial/lot tracking prompts for numbers at sale.
- Long-press product in register shows stock/forecast, replenishment, optional products, price/tax/cost/margin.

## Loyalty & promotions
Sources:
- https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/loyalty_discount.html
- https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/pricing.html
- Single "Promotions, Loyalty & Gift Card" feature shared across Sales, eCommerce, and POS (Sales → Config → Settings → Pricing). Managed at Sales → Products → Discount & Loyalty (ships 3 sample programs).
- Program types: Coupons (single-use codes), Loyalty Cards (accumulate points → rewards on current/future orders), Promotions (auto when conditions met), Discount Code, Buy X Get Y, Next Order Coupons, Gift Cards, eWallet.
- Program fields: name, type, currency, date range, usage limits, Application Scope (which apps: Sales/eCommerce/POS), pricelist association, points unit name (customer-visible), company/website/POS restriction.
- Rules & Rewards: conditional rules (min qty, code) + rewards (discount, free product, gift card).
- In POS: apply codes via ellipsis → Enter Code; promotions auto; Buy X get Y and loyalty rewards via ellipsis → Reward; loyalty points shown at cart bottom.
- Gift cards & eWallet: POS → Products → Gift cards & eWallet. Sell gift card as product (auto PDF w/ code); eWallet = store credit tied to customer account, redeemed like gift card.
- Pricelists: multiple prices per product by qty/customer group/time period. Cash rounding. Fiscal positions = region tax rules + account mapping at checkout (used for eat-in vs takeout tax).

## Payment methods
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html
- POS → Configuration → Payment Methods → New. Fields: name, Online Payment (link a provider for digital pay), Identify Customer, accounting journal, assign to POS, integration type: None (cash), Terminal (card), Bank App (QR), Cash Machine.
- Terminals: Adyen, Stripe, Ingenico, Mollie, Razorpay, Worldline, DPO Pay, Mercado Pago, Pine Labs, QFPay, SIX, Tyro, Viva.com.
- Cash machines: Cashdro, Cashmatic, Glory. Customer Account (credit + deposit). QR code payments (bank app).
- One-Click Payment: skip payment screen for faster checkout; not for online/delivery/terminal/customer-ID methods.
- Child docs: payment_methods/terminals.html, cash_machines.html, customer_credit.html, qr_code_payment.html

## Reporting
Source: https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/reporting.html
- POS → Reporting → Orders (or POS card ⋮ → Reporting → Orders). Graph or pivot view; filter/group.
- Sessions view (POS card ⋮ → Sessions): who opened register, per-session detail, Orders smart button lists all session orders (ref, date, POS, receipt no, customer, employee, total, status).
- Deeper analysis flows into the Accounting/Sales analytics; POS is one data source in the ERP-wide reporting.

## Hardware / IoT
Source: https://www.odoo.com/documentation/19.0/applications/general/iot.html
- Odoo IoT connects physical devices to the Odoo DB: barcode scanners, receipt printers, payment terminals, scales, customer displays, measurement tools, cameras, footswitches.
- Two systems: IoT Box (plug-and-play micro-computer w/ preinstalled software) and Windows Virtual IoT (software on a Windows PC). MRP devices (cameras, measurement) need IoT Box.
- IoT Box subscription required for production + HTTPS cert; auto-activates on connection.
- POS hardware docs also cover: Local Network Access, direct ePOS/network receipt printers, Electronic shelf labels, Customer display, Scale, self-signed cert for ePOS printers (some hardware connects directly over LAN without IoT box).

## eCommerce / Website (online ordering channel)
Source: https://www.odoo.com/documentation/19.0/applications/websites/ecommerce.html
- Open-source online store builder; no-code page/product design (building blocks). B2B/B2C access models.
- Full order lifecycle: sales, abandoned cart recovery, delivery, inventory sync, returns, invoicing.
- Integrates natively with Inventory, Sales, and POS (unified catalog + stock across channels). External channels: Google Merchant Center, TikTok, Facebook, Instagram.
- Multiple payment providers + configurable delivery methods at checkout. 1 yr free custom domain on Odoo Online.
- For restaurants, "online ordering" is really POS Self-Order (QR/kiosk) + eCommerce/Website + delivery connector (UrbanPiper for Uber Eats/DoorDash/etc.), not a purpose-built food-delivery product.

## Inventory / stock
Source: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html
- Multi-warehouse, location-based; inventory adjustments, cycle counts.
- Replenishment: reordering rules, MTO (replenish-on-order), just-in-time. Removal strategies FIFO/LIFO/FEFO.
- Tracking: serial/lot/expiration. Barcode + RFID. Valuation: standard/average/FIFO, landed costs.
- Shipping carriers: DHL, FedEx, UPS, Sendcloud. Integrates with Purchase, Manufacturing, Sales.
- POS sales deduct stock in real time (shared product records); enables low-stock/forecast visibility in the register (long-press product).

## Accounting integration
Source: https://www.odoo.com/documentation/19.0/applications/finance/accounting.html
- Double-entry; accrual or cash basis. Auto-generates journal entries from POS orders, invoices, vendor bills, inventory moves.
- Bank synchronization (direct feed) + reconciliation; multi-currency w/ FX gain/loss.
- Real-time balance sheet / P&L / cash flow; 100+ country fiscal localization packages (tax + legal compliance); tax return + XML export.
- Multi-company: separate charts of accounts per company in one DB. POS sessions post to accounting journals on close.

## Studio / Automations (no-code + workflow)
Source: https://www.odoo.com/documentation/19.0/applications/studio.html
- No-code toolbox: add/modify fields, widgets, views, models; build an app from scratch.
- Automation rules + webhooks, approval rules, PDF report designer, security rules.
- Access via "Toggle Studio" in any app. Studio is Enterprise Custom-plan gated (installing on Standard triggers upsell to Custom).
- Automation rules = Odoo's "automated actions"; server actions available for scripted logic (Python) in the backend.

## Multi-company / multi-shop
Source: https://www.odoo.com/documentation/19.0/applications/general/companies.html
- Multiple legal entities in one DB, each own financials/settings. Company switcher; access by permission.
- Products/contacts shared by default; transactional docs tied to active company. Branches for hierarchical sub-units. Inter-company transaction rules.
- Multi-shop = multiple POS configs (each register is a POS config with its own settings, payment methods, floors, printers) under one or more companies.

## Editions & pricing
Sources: https://www.odoo.com/pricing ; https://cloudpepper.io/blog/odoo-community-vs-enterprise-... (3rd-party)
- Community: free, open-source (LGPLv3), self-hosted (GitHub/Docker/Ubuntu). Ships core apps incl. POS, eCommerce, Website, Inventory, basic Accounting.
- Enterprise: paid (OEEL license); adds Studio, advanced reporting, mobile apps, official support + version upgrades, hosting choice (Odoo Online / Odoo.sh / on-prem). Many advanced POS/restaurant features (kiosk, some IoT, SMS/WhatsApp) are Enterprise-tier.
- Plans (prices in MXN, region-dependent):
  - One App Free: $0, ONE app, unlimited users, Odoo Online only, multi-company.
  - Standard: ~$180-225/user/mo yearly — ALL apps, single fee, Odoo Online hosting.
  - Custom: ~$274-342/user/mo yearly — all apps + Studio + external API + multi-company + hosting choice (Online/sh/on-prem).
- All-inclusive per-USER pricing (not per-app): once on Standard/Custom, every app is bundled. Portal/external users free. Contrast w/ dedicated POS vendors that price per-terminal/per-location.

## Integrations / Apps store / API
Sources: POS payment terminal list; general integration search.
- External API (XML-RPC / JSON-RPC) — included in Custom plan; webhooks via Studio automation rules.
- Odoo Apps Store: large third-party module marketplace (community + paid apps) extending any app incl. POS.
- Prebuilt connectors: Shopify, WooCommerce, QuickBooks, Amazon, eBay, Google, Meta, delivery (UrbanPiper aggregator for Uber Eats/DoorDash/etc.).

## Offline / reliability
- POS is web-browser-based and "built to maintain functionality during temporary network outages" — orders continue offline and sync when connection returns. (Source: point_of_sale.html)
- Caveat: preparation display and self-order/kiosk are network/browser dependent; prep display does NOT run via IoT box.

## NOTE on failed fetches
- restaurant/floors_tables.html and restaurant/tips.html repeatedly returned empty via WebFetch (rendering/caching quirk). Their content is captured via the parent restaurant.html summary (table transfer, split, tips, coursing, booking).
