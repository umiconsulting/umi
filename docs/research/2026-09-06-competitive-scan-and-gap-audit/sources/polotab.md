# PoloTab — Competitive & Design Research (raw notes)

Research date: 2026-09-06. Purpose: competitive analysis + design north-star for Umi POS.
Legend: [OFFICIAL] = polotab.com/subdomains. [3P] = third-party. [IMG] = observed in screenshot via chrome-devtools.

## Company / positioning

- POS + restaurant management for cafés/restaurants/bars/ice-cream shops in **Mexico**. "Software y Punto de Venta." [OFFICIAL https://www.polotab.com/]
- Tagline: "El sistema que las cafeterías aman." Also "Diseñado para los más exigentes", "Somos una opción más, hasta que nos prueban." [OFFICIAL home]
- Scale claims: 900+ cafés/restaurants/bares, 70+ ciudades de México, 22.8M comandas/año, "100%" reliability offline. (Inventory page says 800+; home says 900+.) [OFFICIAL home, /inventarios]
- Founded 2022. Founders: Juan Chomali, Aldo Piaggio (CEO, ex-Goldman IBD, UMich Industrial Eng, 3rd-gen F&B family), Andres Richardson. ~18 employees, Mexico City (CDMX). [3P Crunchbase, Tracxn, YC]
- Y Combinator-backed (entity "PoloPay", batch ~W23). Seed funding ~$500K, later cited ~$1.3M. [3P YC https://www.ycombinator.com/companies/polotab ; Crunchbase https://www.crunchbase.com/organization/polopay ; CB Insights; PitchBook]
- Human-service angle: "En una época repleta de bots e IA, PoloTab te acompaña con calidad humana"; 24/7/365 support in Spanish. [OFFICIAL home]
- Subdomains: www.polotab.com (marketing), admin.polotab.com (back-office portal), factura.polotab.com (self-invoicing), developer.polotab.com (API portal, JS-gated), blog.polotab.com. [OFFICIAL]

## Ecosystem modules (single unified account)

POS ("Punto de Venta") · Pagos (PoloPay) · Comandero (PoloMini handheld) · KDS ("Pantalla en Cocina") · Pantalla Cliente (customer display) · Datos (CRM) · Inventarios · Delivery · Reportería · Facturación. Home tab groups: **Operación / Pagos / Administración**. [OFFICIAL home, /planes]

## 1. POS / register

- Order entry: "Comanda con atajos y modificadores en una sola pantalla." Claims 9-second orders, "comanda 40% más rápido", up to 70% less capture time with PoloMini. [OFFICIAL /tipo-negocio/cafeteria, /polomini]
- Order types: dine-in (Mesa) + takeout (Para llevar) + delivery aggregated; "pedidos de delivery y presenciales en un solo lugar." [OFFICIAL /tipo-negocio/restaurante]
- Tables/floor: "Mesas" tab exists; support FAQ "¿Cómo funcionan mesas?"; bottom nav has Mesas. [OFFICIAL /soporte, IMG POS screen]
- Bill splitting + tips: FAQ "¿Puedo dividir la cuenta y manejar propinas?"; POS shows "Consumo por persona" (per-person split). [OFFICIAL /soporte, IMG]
- Sizes/modifiers: plans list "tamaños y modificadores". POS modifier screen shows required/max rules e.g. "Sabores — Requerido: 2 de 3 máximo", "Toppings — 2 de 3 incluidos, 3 de 4 máximo", per-topping upcharges (+$10). [OFFICIAL /planes, IMG POS]
- Recipes tie items to inventory (auto-deduct). [OFFICIAL /inventarios]
- Payments in POS: cash / card / transfer / QR. [OFFICIAL /planes, /blog]
- [IMG POS sale screen /producto/puntoDeVentaNewFeat.avif]: top bar (home, "Para llevar", "Mesa", "Buscar", "Repetir"); LEFT cart pane ("Nombre", covers count, line items + modifiers, Total, "Consumo por persona", blue "Cobrar" button); MIDDLE vertical category rail w/ colored left bars (Fríos=blue, Calientes=orange, Yogurt=magenta[selected], Naturales=green…); RIGHT product/modifier grid w/ colored tiles + blue "Agregar"; BOTTOM nav tabs: Comanda(sel)/Mesas/Ventas/Ajustes.

## 2. KDS — "Pantalla en Cocina"

- "Adiós a las impresoras. Hola a la Pantalla en Cocina." / "De la mesa a cocina. Elimina la letra ilegible y las comandas extraviadas." [OFFICIAL /pantalla-en-cocina]
- Real-time order routing from tables + delivery to kitchen screens; color-coded by prep time; per-order timers; one-tap "listo/ready" alerts service; queue by time/course/table; works offline; delivery orders shown alongside dine-in. [OFFICIAL /pantalla-en-cocina]
- "kitchen stations" (estaciones de cocina) in all plans; printer routing per product ("¿Puedo imprimir sólo ciertos productos por impresora?"). [OFFICIAL /planes, /soporte]
- KDS is a token module (1 token) — not bundled free. [OFFICIAL /planes]
- [IMG KDS board /heroes/kdsHero.avif]: pure-black bg; grid of order-ticket cards (101,103,105,107 / 102,104,106); each card header colored by elapsed time — **gray(newest)→yellow→orange→red(oldest)** e.g. 101=10m2s RED, 103=6m12s ORANGE, 105=3m58s YELLOW, 107=1m2s GRAY. Header shows order#, timer, "Para llevar", staff name (Ana/Laura). Body: qty (bold), product (bold white), modifiers below — **size in vivid blue** (Grande), others gray (Deslactosada, Entera, Splenda). "N productos más" blue expand link w/ chevrons. Top-right grid/apps icon = only chrome.

## 3. Online ordering / QR / self-order / delivery

- Delivery aggregation: **Uber Eats, Rappi, DiDi Food** into one screen → POS + KDS, no double capture. "Rappi, DiDi Food y Uber Eats en una sola pantalla." "Un solo software. Magia pura." [OFFICIAL /delivery]
- Menu/price/photo/promo sync to delivery platforms from one dashboard, reflects in seconds; auto-accept OR manual accept per order; inventory auto-adjusts; unified reporting. [OFFICIAL /delivery]
- Delivery is a token add-on (3 tokens). [OFFICIAL /planes]
- QR ordering: "QR menu ordering" / "menú por QR" included in all plans (base). Customer self-invoice via QR on ticket. [OFFICIAL /planes, /facturacion]
- No standalone branded web-ordering storefront found (relies on 3P delivery apps + QR). NOT FOUND: own-brand online store / white-label web ordering.

## 4. Loyalty / marketing / gift cards / promotions

- **Weak / mostly NOT FOUND on official site.** Blog comparison explicitly does not list loyalty/gift/promotions among features. [OFFICIAL /blog/mejor-punto-de-venta...2026]
- "Datos" (CRM) = automated customer database; customer name personalization on customer display ("¡Hola, Marco!"). Marketing/campaign/points/stamps features NOT documented. [OFFICIAL home; IMG customer display]
- Promotions appear only in delivery-menu context (sync "promociones"). [OFFICIAL /delivery]
- [3P] Capterra/GetApp list generic "local gift card integrations" for Mexico — not corroborated on official site; treat as unverified. [3P Capterra]

## 5. Payments / processing / tipping / terminals

- **PoloPay** integrated processing. "El procesamiento de pagos se cotiza según tu operación" (custom-quoted, separate from software plans). [OFFICIAL home, /soporte "PoloPay setup"]
- Methods: card, cash, transfer, QR. Tipping: "Cobros exactos, propinas claras"; preset tip % (15% shown); client claim "+70% más propina" via PoloMini. [OFFICIAL /tipo-negocio, /planes]
- PoloMini = SoftPOS handheld: tap-to-pay (contactless), chip insert, swipe. [IMG /producto/datosNewFeat.avif payment screen: full vivid-blue, contactless icon, "Aproxima, inserta o desliza", "$1,667.50", "$995.00 + 15% de propina", card being tapped, reader slot.]
- Terminals: PoloPOS (all-in-one countertop w/ stand + integrated customer screen/printer at base) and PoloMini (handheld). [IMG home hero]

## 6. Hardware / devices / device management

- **PoloPOS** all-in-one terminal — MX$22,000. **PoloMini** handheld comandero — MX$11,200. [OFFICIAL /planes, /polomini]
- Proprietary hardware, pre-configured; 15-min setup ("solo requiere conexión eléctrica e impresoras térmicas, sin técnicos"); ships in ~4 business days in Mexico. [OFFICIAL /polomini, /blog]
- Thermal printers supported + per-product printer routing; support categories: Impresoras, Impresión, Conectividad, Red Interna. [OFFICIAL /soporte]
- NOT publicly on Apple App Store / Google Play as a downloadable app (bundled on their hardware). App-store searches returned only competitors. [3P Play/App Store searches]

## 7. Back office / dashboard / reporting / analytics — "Reportería 2.0"

- Portal at admin.polotab.com. "Toma decisiones con datos no intuición." Custom report builder "Playground" ("Crea tus propios reportes en segundos"); saved custom reports. [OFFICIAL /reportes; IMG]
- Group by channel/product/category/location/table/employee; branch vs chain level; period-over-period & YoY; hourly/daily/monthly. Dynamic pivot tables ("No más excel"). Shows profit not just sales ("Ve cuánto ganas, no solo cuánto vendes"), COGS. [OFFICIAL /reportes]
- [IMG admin.polotab.com — LIGHT theme]: left sidebar chain switcher ("Cadena Crema Café"), search, Favoritos, Crea tu reporte→Playground, Tus reportes (custom), Reportes (Resumen/Venta/Operación/Menú/Rentabilidad/Ajustes/Propinas/Comensales), **Trazabilidad/audit** (Pedidos/Ajustes/Caja/Personal). Time-aware greeting "Feliz noche, Marcela … 23:47". KPI tiles (Venta, Órdenes, Comensales, Ticket Promedio, Órdenes/hora, Hora pico, Ítems vendidos, Ajustes) w/ green/red deltas. Cards: Método más popular, Venta/hora blue+red bar chart, Categoría más popular; bottom pivot table. Far-left vertical multi-app icon strip.

## 8. Inventory / menu management / stock

- Dynamic recipes ("actualiza tu menú en segundos, para todas las presentaciones"); intelligent costing (cost + margin per dish); auto-deduction on sale; sub-recipes/prepared items; inter-branch transfers ("2 clicks"); automated purchase orders; waste/merma detection (shrinkage/shortage/overage); full audit history. Claim "-68% mermas". [OFFICIAL /inventarios, /tipo-negocio]
- Inventory is a token module (2 tokens). [OFFICIAL /planes]

## 9. Multi-location — "Cadena"

- "Para crecer sin perder el control." Multi-branch/multi-brand/multi-channel in all plans. Central catalog/menu/price sync ("10 seg para cambiar precios"), per-branch manager views + consolidated corporate view ("Una sola pantalla para todas tus sucursales"), 2-click inter-branch transfers, chain-level reporting. Case study: Myka 15 branches. Scales to 30+ locations. [OFFICIAL /tipo-negocio/cadena, home]

## 10. Integrations / API / automations

- Delivery: Uber Eats, Rappi, DiDi Food (native). CFDI/SAT invoicing native. [OFFICIAL]
- Developer/API portal exists: developer.polotab.com — but content is JS-gated; no static endpoint docs retrievable. Endpoints/webhooks/auth NOT FOUND (needs live JS render / possibly gated). [OFFICIAL developer.polotab.com]
- NOT FOUND: accounting integrations (QuickBooks etc.), Zapier/automation, open marketplace.

## 11. Staff / permissions / labor

- Per-employee access control / roles ("¿Cómo puedo limitar los accesos de cada empleado?"), admin user creation. [OFFICIAL /soporte]
- Biometrics + time tracking ("checador"/time clock) in all plans; sales attributed per employee; Propinas & Personal reports; staff name shown on KDS tickets. [OFFICIAL /planes, /reportes; IMG KDS]
- NOT FOUND: full scheduling/shift-planning or labor-cost forecasting.

## 12. Offline mode / reliability

- Core differentiator: "100%" functional offline — keep selling & printing tickets with no internet; auto-sync on reconnect, no data loss. Applies to POS, KDS, PoloMini. [OFFICIAL home, /pantalla-en-cocina, /blog]

## 13. Customer-facing display / kiosk

- **Pantalla Cliente** (customer display) — [IMG /producto/pantallaClienteNewFeat.avif]: dark; personalized "¡Hola, Marco! / Tu pedido Para Llevar"; order-review as dark rounded cards (qty, item, price, modifiers incl. topping qty & upcharges); big vivid-blue total "$995.00" + "Total de tu pedido". Also runs on PoloMini (customer sees order as built + tip prompt). [OFFICIAL /polomini]
- Self-order KIOSK: NOT FOUND as a distinct product (self-service ordering appears via QR menu, not a kiosk terminal mode).

## 14. Pricing / plans / target market / geography

- Software plans (MXN/month + IVA, no contract): **Esencial $990** (1 token, "Para empezar") · **Avanzado $1,490** (3 tokens, "Para sobresalir", highlighted) · **Pro $2,490** (6 tokens, "Para ganar"). Extra tokens $500+IVA/mo each. [OFFICIAL /planes]
- Token modules: Facturación (1), KDS (1), Comandero móvil (1), Inventarios (2), Delivery (3). [OFFICIAL /planes]
- All plans include: 28-day guarantee, cloud storage, remote onboarding/training, 24/7/365 support, free updates, full offline, real-time data, admin portal, multi-branch/brand/channel, event notifications, sizes/modifiers, biometrics, time tracking, kitchen stations, bill splitting, QR ordering, cash/card/transfer. [OFFICIAL /planes]
- Hardware separate: PoloPOS $22,000; PoloMini $11,200. Payment processing custom-quoted. [OFFICIAL /planes]
- Target: MX cafés, restaurants, bars, ice-cream shops (heladerías), single→chain. Geo: Mexico only (70+ cities), CFDI 4.0/SAT/RESICO/IEPS. Blog concedes rivals: Loyverse (free), SICAR (one-time license), Square (US ops). [OFFICIAL /blog]

## 15. DESIGN LANGUAGE

- **Two-surface system:** operational apps (POS, KDS, PoloMini, customer display) = **DARK (near-black #000) + vivid blue (~#0d6efd/#0066FF)**; web back-office (admin.polotab.com) = **LIGHT/white + blue**. Marketing site itself = dark + blue. [IMG all]
- **Vivid blue** = single dominant brand/action color: logo "polo", primary buttons (Cobrar/Agregar), selected states, size modifiers on KDS, totals on customer display, full-screen payment, chart bars. Outline-blue = secondary buttons.
- **Category & product color-coding:** vertical category rail with a colored left bar per category (blue/orange/magenta/green…); product & modifier tiles carry category tints (brown, gold, purple…). Strong tie to Umi's "category owns a concrete colour" model.
- **POS three-pane layout:** cart (left) | vertical colour-bar category rail (middle) | product grid / inline modifier detail (right); persistent **bottom tab nav** (Comanda/Mesas/Ventas/Ajustes). Modifiers configured inline (required/max counts, +upcharge) rather than modal-heavy.
- **KDS:** black board, multi-column ticket cards, time-based header color ramp gray→yellow→orange→red; large legible type; near-zero chrome (single apps icon).
- **Customer display / payment:** dark rounded cards; personalization by name; big blue total; payment screen floods entire screen vivid blue with white contactless glyph + preset tip.
- **Back-office:** clean light SaaS dashboard, generous whitespace, KPI tiles w/ green(+)/red(-) deltas, blue (and red for negative) bar charts, left nav grouped Reportes/Trazabilidad, chain switcher, time-aware greetings, saved/custom report "Playground" builder.
- **Typography:** modern geometric/grotesque sans, bold large headlines, tabular numerals for money; brand name lowercase "polo". Rounded corners on cards/tiles; minimalist iconography (line icons); heavy use of product 3D renders (terminal on stand, handheld in hand, card tap).
- Interaction patterns worth stealing for Umi: inline modifier picker w/ required/max + upcharge; per-person split surfaced on cart; time-color KDS ramp; report "Playground" + saved reports; audit/Trazabilidad section; personalized customer display; full-screen blue tender/payment.

## Sources

Official: https://www.polotab.com/ ; /planes ; /polomini ; /inventarios ; /reportes ; /delivery ; /facturacion ; /pantalla-en-cocina ; /tipo-negocio/{restaurante,cafeteria,cadena} ; /soporte ; /blog/mejor-punto-de-venta-para-cafeterias-y-restaurantes-en-mexico-2026 ; admin.polotab.com ; developer.polotab.com (JS-gated) ; product image assets under /producto/ and /heroes/ (viewed via chrome-devtools).
Third-party: Crunchbase (polopay), Tracxn, YC (ycombinator.com/companies/polotab), CB Insights, PitchBook, Capterra, GetApp, G2 (403/bot-blocked — not retrieved).
Blocked/empty: G2 reviews (HTTP 403); developer.polotab.com docs (JS-only, no static content); apps.apple.com id1625739382 (404 via WebFetch — unconfirmed as PoloTab).
